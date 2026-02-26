import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, accounts, bankTransactions, vyaparTransactions, reconciliationMatches } from '../db/index.js';
import { eq, and, inArray } from 'drizzle-orm';

const router = Router();

const accountSchema = z.object({
  name: z.string().min(1),
  bankName: z.string().min(1),
  accountNumber: z.string().optional().nullable(),
  accountType: z.enum(['savings', 'current', 'credit_card', 'loan']),
  currency: z.string().default('INR'),
  openingBalance: z.number().default(0),
  // Bank account metadata
  ifscCode: z.string().optional().nullable(),
  branchName: z.string().optional().nullable(),
  accountHolderName: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  accountStatus: z.string().optional().nullable(),
  // Credit card specific fields
  cardName: z.string().optional().nullable(),
  cardNetwork: z.string().optional().nullable(),
  cardHolderName: z.string().optional().nullable(),
  cardImage: z.string().optional().nullable(),
  statementPassword: z.string().optional().nullable(),
});

// Get all accounts (only active by default)
router.get('/', async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    console.log(`[Accounts] Fetching accounts for userId=${req.userId}, includeInactive=${includeInactive}`);

    const allAccounts = await db
      .select()
      .from(accounts)
      .where(
        includeInactive
          ? eq(accounts.userId, req.userId!)
          : and(eq(accounts.userId, req.userId!), eq(accounts.isActive, true))
      );

    console.log(`[Accounts] Found ${allAccounts.length} accounts`);
    res.json(allAccounts);
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// Get single account
router.get('/:id', async (req, res) => {
  try {
    const account = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, req.params.id), eq(accounts.userId, req.userId!)))
      .limit(1);

    if (!account[0]) {
      return res.status(404).json({ error: 'Account not found' });
    }

    res.json(account[0]);
  } catch (error) {
    console.error('Error fetching account:', error);
    res.status(500).json({ error: 'Failed to fetch account' });
  }
});

// Create account
router.post('/', async (req, res) => {
  try {
    const data = accountSchema.parse(req.body);
    const now = new Date().toISOString();

    const newAccount = {
      id: uuidv4(),
      userId: req.userId!,
      ...data,
      currentBalance: data.openingBalance,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(accounts).values(newAccount);
    res.status(201).json(newAccount);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating account:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Update account
router.put('/:id', async (req, res) => {
  try {
    const data = accountSchema.partial().parse(req.body);
    const now = new Date().toISOString();

    await db
      .update(accounts)
      .set({ ...data, updatedAt: now })
      .where(and(eq(accounts.id, req.params.id), eq(accounts.userId, req.userId!)));

    const updated = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, req.params.id), eq(accounts.userId, req.userId!)))
      .limit(1);

    if (!updated[0]) {
      return res.status(404).json({ error: 'Account not found' });
    }

    res.json(updated[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating account:', error);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

// Delete account (hard delete with cascade)
router.delete('/:id', async (req, res) => {
  try {
    const accountId = req.params.id;
    const userId = req.userId!;

    // First verify the account belongs to this user
    const accountToDelete = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .limit(1);

    if (!accountToDelete[0]) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Collect bank transaction IDs before deleting them
    const bankTxns = await db
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(eq(bankTransactions.accountId, accountId));
    const bankTxnIds = bankTxns.map(t => t.id);

    if (bankTxnIds.length > 0) {
      // Find Vyapar transactions directly matched to these bank transactions (single matches)
      const directlyMatchedVyapar = await db
        .select({ id: vyaparTransactions.id })
        .from(vyaparTransactions)
        .where(and(
          eq(vyaparTransactions.isReconciled, true),
          inArray(vyaparTransactions.reconciledWithId, bankTxnIds)
        ));

      // Find match group records that reference these bank transactions (multi-matches)
      const matchGroupRecords = await db
        .select()
        .from(reconciliationMatches)
        .where(inArray(reconciliationMatches.bankTransactionId, bankTxnIds));

      // Collect unique match group IDs
      const affectedGroupIds = [...new Set(matchGroupRecords.map(r => r.matchGroupId))];

      // Unlink directly matched Vyapar transactions
      if (directlyMatchedVyapar.length > 0) {
        const vyaparIds = directlyMatchedVyapar.map(v => v.id);
        await db
          .update(vyaparTransactions)
          .set({ isReconciled: false, reconciledWithId: null, updatedAt: new Date().toISOString() })
          .where(inArray(vyaparTransactions.id, vyaparIds));
        console.log(`[Accounts] Unlinked ${vyaparIds.length} directly matched Vyapar transactions`);
      }

      // For multi-match groups: unlink Vyapar transactions and delete group records
      if (affectedGroupIds.length > 0) {
        // Find Vyapar transactions linked via these match groups
        const groupLinkedVyapar = await db
          .select({ id: vyaparTransactions.id })
          .from(vyaparTransactions)
          .where(and(
            eq(vyaparTransactions.isReconciled, true),
            inArray(vyaparTransactions.reconciledWithId, affectedGroupIds)
          ));

        if (groupLinkedVyapar.length > 0) {
          await db
            .update(vyaparTransactions)
            .set({ isReconciled: false, reconciledWithId: null, updatedAt: new Date().toISOString() })
            .where(inArray(vyaparTransactions.id, groupLinkedVyapar.map(v => v.id)));
          console.log(`[Accounts] Unlinked ${groupLinkedVyapar.length} group-matched Vyapar transactions`);
        }

        // Delete match group records
        await db
          .delete(reconciliationMatches)
          .where(inArray(reconciliationMatches.matchGroupId, affectedGroupIds));
        console.log(`[Accounts] Deleted ${affectedGroupIds.length} orphaned match groups`);
      }
    }

    // Delete all related transactions (cascade)
    const deletedTransactions = await db
      .delete(bankTransactions)
      .where(eq(bankTransactions.accountId, accountId));

    console.log(`[Accounts] Deleted ${bankTxnIds.length} transactions for account ${accountId}`);

    // Then delete the account
    await db
      .delete(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));

    console.log(`[Accounts] Permanently deleted account ${accountId}`);

    res.json({ success: true, message: 'Account and all related transactions permanently deleted' });
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Update account balance
router.patch('/:id/balance', async (req, res) => {
  try {
    const { balance } = z.object({ balance: z.number() }).parse(req.body);
    const now = new Date().toISOString();

    await db
      .update(accounts)
      .set({ currentBalance: balance, updatedAt: now })
      .where(and(eq(accounts.id, req.params.id), eq(accounts.userId, req.userId!)));

    const updated = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, req.params.id), eq(accounts.userId, req.userId!)))
      .limit(1);

    res.json(updated[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating balance:', error);
    res.status(500).json({ error: 'Failed to update balance' });
  }
});

// Save, update, or clear statement password for an account
router.patch('/:id/statement-password', async (req, res) => {
  try {
    const { password } = z.object({ password: z.string().nullable() }).parse(req.body);
    const now = new Date().toISOString();

    const existing = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, req.params.id), eq(accounts.userId, req.userId!)))
      .limit(1);

    if (!existing[0]) {
      return res.status(404).json({ error: 'Account not found' });
    }

    await db
      .update(accounts)
      .set({ statementPassword: password, updatedAt: now })
      .where(and(eq(accounts.id, req.params.id), eq(accounts.userId, req.userId!)));

    res.json({ success: true, hasPassword: password !== null });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating statement password:', error);
    res.status(500).json({ error: 'Failed to update statement password' });
  }
});

export default router;

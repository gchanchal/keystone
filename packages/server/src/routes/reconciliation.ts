import { Router } from 'express';
import { z } from 'zod';
import { db, bankTransactions, vyaparTransactions, reconciliationRules } from '../db/index.js';
import { eq, and, between, sql, desc } from 'drizzle-orm';
import {
  autoReconcile,
  applyMatches,
  manualMatch,
  unmatch,
  multiMatch,
  unmatchGroup,
  getMatchGroup,
  type ReconciliationMatch,
} from '../services/reconciliation-service.js';
import { reconciliationMatches } from '../db/index.js';
import { formatReconciliationReport } from '../services/export-service.js';

const router = Router();

// Get reconciliation data for a date range
router.get('/', async (req, res) => {
  try {
    const { startMonth, endMonth, accountId } = z
      .object({
        startMonth: z.string().regex(/^\d{4}-\d{2}$/),
        endMonth: z.string().regex(/^\d{4}-\d{2}$/),
        accountId: z.string().optional(),
      })
      .parse(req.query);

    const startDate = `${startMonth}-01`;
    const endDate = `${endMonth}-31`;

    // Get bank transactions (exclude personal)
    const bankConditions = [
      between(bankTransactions.date, startDate, endDate),
      eq(bankTransactions.userId, req.userId!),
      sql`(${bankTransactions.purpose} IS NULL OR ${bankTransactions.purpose} != 'personal')`,
    ];
    if (accountId) {
      bankConditions.push(eq(bankTransactions.accountId, accountId));
    }

    const bankTxns = await db
      .select()
      .from(bankTransactions)
      .where(and(...bankConditions));

    // Get vyapar transactions
    const vyaparTxns = await db
      .select()
      .from(vyaparTransactions)
      .where(and(between(vyaparTransactions.date, startDate, endDate), eq(vyaparTransactions.userId, req.userId!)));

    // Separate matched and unmatched
    const matchedBank = bankTxns.filter(t => t.isReconciled);
    const unmatchedBank = bankTxns.filter(t => !t.isReconciled);
    const matchedVyapar = vyaparTxns.filter(t => t.isReconciled);
    const unmatchedVyapar = vyaparTxns.filter(t => !t.isReconciled);

    res.json({
      bank: {
        matched: matchedBank,
        unmatched: unmatchedBank,
        total: bankTxns.length,
      },
      vyapar: {
        matched: matchedVyapar,
        unmatched: unmatchedVyapar,
        total: vyaparTxns.length,
      },
      summary: {
        matchedCount: matchedBank.length,
        unmatchedBankCount: unmatchedBank.length,
        unmatchedVyaparCount: unmatchedVyapar.length,
        matchedAmount: matchedBank.reduce((s, t) => s + t.amount, 0),
        unmatchedBankAmount: unmatchedBank.reduce((s, t) => s + t.amount, 0),
        unmatchedVyaparAmount: unmatchedVyapar.reduce((s, t) => s + t.amount, 0),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error fetching reconciliation data:', error);
    res.status(500).json({ error: 'Failed to fetch reconciliation data' });
  }
});

// Run auto-match
router.post('/auto-match', async (req, res) => {
  try {
    const { startMonth, endMonth, accountIds, apply } = z
      .object({
        startMonth: z.string().regex(/^\d{4}-\d{2}$/),
        endMonth: z.string().regex(/^\d{4}-\d{2}$/),
        accountIds: z.array(z.string()).optional(),
        apply: z.boolean().default(false),
      })
      .parse(req.body);

    const startDate = `${startMonth}-01`;
    const endDate = `${endMonth}-31`;

    const matches = await autoReconcile(startDate, endDate, accountIds, req.userId!);

    if (apply && matches.length > 0) {
      const appliedCount = await applyMatches(matches);
      return res.json({
        matches,
        applied: true,
        appliedCount,
      });
    }

    res.json({
      matches,
      applied: false,
      appliedCount: 0,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error running auto-match:', error);
    res.status(500).json({ error: 'Failed to run auto-match' });
  }
});

// Apply matches
router.post('/apply-matches', async (req, res) => {
  try {
    const { matches } = z
      .object({
        matches: z.array(
          z.object({
            bankTransactionId: z.string(),
            vyaparTransactionId: z.string(),
          })
        ),
      })
      .parse(req.body);

    const fullMatches: ReconciliationMatch[] = matches.map(m => ({
      ...m,
      confidence: 100,
      matchType: 'exact' as const,
      bankAmount: 0,
      vyaparAmount: 0,
      bankDate: '',
      vyaparDate: '',
    }));

    const appliedCount = await applyMatches(fullMatches);

    res.json({ success: true, appliedCount });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error applying matches:', error);
    res.status(500).json({ error: 'Failed to apply matches' });
  }
});

// Manual match
router.post('/manual-match', async (req, res) => {
  try {
    const { bankTransactionId, vyaparTransactionId } = z
      .object({
        bankTransactionId: z.string(),
        vyaparTransactionId: z.string(),
      })
      .parse(req.body);

    await manualMatch(bankTransactionId, vyaparTransactionId, req.userId);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error manual matching:', error);
    res.status(500).json({ error: 'Failed to match transactions' });
  }
});

// Unmatch
router.post('/unmatch', async (req, res) => {
  try {
    const { bankTransactionId } = z
      .object({
        bankTransactionId: z.string(),
      })
      .parse(req.body);

    const result = await unmatch(bankTransactionId);

    res.json({ success: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error unmatching:', error);
    res.status(500).json({ error: 'Failed to unmatch transactions' });
  }
});

// Unmatch a Vyapar transaction - also clears the bank side
router.post('/unmatch-vyapar', async (req, res) => {
  try {
    const { vyaparTransactionId } = z
      .object({
        vyaparTransactionId: z.string(),
      })
      .parse(req.body);

    const now = new Date().toISOString();

    // Get the vyapar transaction first to find its match info
    const [vyaparTxn] = await db
      .select()
      .from(vyaparTransactions)
      .where(eq(vyaparTransactions.id, vyaparTransactionId));

    if (vyaparTxn && vyaparTxn.reconciledWithId) {
      // Check if it's a match group
      const groupRecords = await db
        .select()
        .from(reconciliationMatches)
        .where(eq(reconciliationMatches.matchGroupId, vyaparTxn.reconciledWithId));

      if (groupRecords.length > 0) {
        // It's a match group - unmatch the entire group
        await unmatchGroup(vyaparTxn.reconciledWithId);
        return res.json({ success: true });
      }

      // Single match - clear bank transaction that points to this vyapar OR has this ID as reconciledWithId
      await db
        .update(bankTransactions)
        .set({
          isReconciled: false,
          reconciledWithId: null,
          reconciledWithType: null,
          updatedAt: now,
        })
        .where(eq(bankTransactions.reconciledWithId, vyaparTransactionId));

      // Also try matching by the vyapar's reconciledWithId (in case it's the bank ID)
      await db
        .update(bankTransactions)
        .set({
          isReconciled: false,
          reconciledWithId: null,
          reconciledWithType: null,
          updatedAt: now,
        })
        .where(eq(bankTransactions.id, vyaparTxn.reconciledWithId));
    }

    // Update the vyapar transaction
    await db
      .update(vyaparTransactions)
      .set({
        isReconciled: false,
        reconciledWithId: null,
        updatedAt: now,
      })
      .where(eq(vyaparTransactions.id, vyaparTransactionId));

    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error unmatching vyapar:', error);
    res.status(500).json({ error: 'Failed to unmatch vyapar transaction' });
  }
});

// Multi-match: Match multiple bank transactions to multiple vyapar transactions
router.post('/multi-match', async (req, res) => {
  try {
    const { bankTransactionIds, vyaparTransactionIds } = z
      .object({
        bankTransactionIds: z.array(z.string()).min(1),
        vyaparTransactionIds: z.array(z.string()).min(1),
      })
      .parse(req.body);

    const result = await multiMatch(bankTransactionIds, vyaparTransactionIds);

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error multi-matching:', error);
    res.status(500).json({ error: 'Failed to match transactions' });
  }
});

// Unmatch a group
router.post('/unmatch-group', async (req, res) => {
  try {
    const { matchGroupId } = z
      .object({
        matchGroupId: z.string(),
      })
      .parse(req.body);

    const result = await unmatchGroup(matchGroupId);

    res.json({ success: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error unmatching group:', error);
    res.status(500).json({ error: 'Failed to unmatch transactions' });
  }
});

// Get match group details
router.get('/match-group/:id', async (req, res) => {
  try {
    const matchGroupId = req.params.id;
    const group = await getMatchGroup(matchGroupId);

    if (!group) {
      return res.status(404).json({ error: 'Match group not found' });
    }

    res.json(group);
  } catch (error) {
    console.error('Error getting match group:', error);
    res.status(500).json({ error: 'Failed to get match group' });
  }
});

// Get full match details for a transaction (returns all linked transactions with full data)
// Can be called with bankId or vyaparId - will find and return all related matched transactions
router.get('/match-details', async (req, res) => {
  try {
    const { bankId, vyaparId } = z
      .object({
        bankId: z.string().optional(),
        vyaparId: z.string().optional(),
      })
      .parse(req.query);

    if (!bankId && !vyaparId) {
      return res.status(400).json({ error: 'Either bankId or vyaparId is required' });
    }

    let matchGroupId: string | null = null;
    let bankTxnIds: string[] = [];
    let vyaparTxnIds: string[] = [];

    if (bankId) {
      // Find the bank transaction
      const [bankTxn] = await db
        .select()
        .from(bankTransactions)
        .where(and(eq(bankTransactions.id, bankId), eq(bankTransactions.userId, req.userId!)));

      if (!bankTxn) {
        return res.status(404).json({ error: 'Bank transaction not found' });
      }

      if (!bankTxn.isReconciled || !bankTxn.reconciledWithId) {
        return res.json({ bankTransactions: [bankTxn], vyaparTransactions: [], matchType: 'unmatched' });
      }

      // Check if it's a multi-match (match group) or single match
      if (bankTxn.reconciledWithType === 'multi_vyapar') {
        matchGroupId = bankTxn.reconciledWithId;
      } else {
        // Single match - reconciledWithId is the vyapar transaction ID
        bankTxnIds = [bankId];
        vyaparTxnIds = [bankTxn.reconciledWithId];
      }
    } else if (vyaparId) {
      // Find the vyapar transaction
      const [vyaparTxn] = await db
        .select()
        .from(vyaparTransactions)
        .where(and(eq(vyaparTransactions.id, vyaparId), eq(vyaparTransactions.userId, req.userId!)));

      if (!vyaparTxn) {
        return res.status(404).json({ error: 'Vyapar transaction not found' });
      }

      if (!vyaparTxn.isReconciled || !vyaparTxn.reconciledWithId) {
        return res.json({ bankTransactions: [], vyaparTransactions: [vyaparTxn], matchType: 'unmatched' });
      }

      // reconciledWithId could be a bank ID (single match) or matchGroupId (multi match)
      // Try to find it as a match group first
      const groupRecords = await db
        .select()
        .from(reconciliationMatches)
        .where(eq(reconciliationMatches.matchGroupId, vyaparTxn.reconciledWithId));

      if (groupRecords.length > 0) {
        matchGroupId = vyaparTxn.reconciledWithId;
      } else {
        // Single match - find bank transaction that points to this vyapar
        const [bankMatch] = await db
          .select()
          .from(bankTransactions)
          .where(
            and(
              eq(bankTransactions.reconciledWithId, vyaparId),
              eq(bankTransactions.userId, req.userId!)
            )
          );

        if (bankMatch) {
          bankTxnIds = [bankMatch.id];
          vyaparTxnIds = [vyaparId];
        } else {
          // Fallback: reconciledWithId might be the bank transaction ID directly
          bankTxnIds = [vyaparTxn.reconciledWithId];
          vyaparTxnIds = [vyaparId];
        }
      }
    }

    // If we have a match group, fetch all IDs from it
    if (matchGroupId) {
      const groupRecords = await db
        .select()
        .from(reconciliationMatches)
        .where(eq(reconciliationMatches.matchGroupId, matchGroupId));

      bankTxnIds = groupRecords.filter(r => r.bankTransactionId).map(r => r.bankTransactionId!);
      vyaparTxnIds = groupRecords.filter(r => r.vyaparTransactionId).map(r => r.vyaparTransactionId!);
    }

    // Fetch full transaction data
    const bankTxns = bankTxnIds.length > 0
      ? await db
          .select()
          .from(bankTransactions)
          .where(sql`${bankTransactions.id} IN (${sql.join(bankTxnIds.map(id => sql`${id}`), sql`, `)})`)
      : [];

    const vyaparTxns = vyaparTxnIds.length > 0
      ? await db
          .select()
          .from(vyaparTransactions)
          .where(sql`${vyaparTransactions.id} IN (${sql.join(vyaparTxnIds.map(id => sql`${id}`), sql`, `)})`)
      : [];

    res.json({
      bankTransactions: bankTxns,
      vyaparTransactions: vyaparTxns,
      matchGroupId: matchGroupId || null,
      matchType: matchGroupId ? 'multi' : (bankTxns.length === 1 && vyaparTxns.length === 1 ? 'single' : 'partial'),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error getting match details:', error);
    res.status(500).json({ error: 'Failed to get match details' });
  }
});

// Export reconciliation report
router.get('/export', async (req, res) => {
  try {
    const { startMonth, endMonth, accountId } = z
      .object({
        startMonth: z.string().regex(/^\d{4}-\d{2}$/),
        endMonth: z.string().regex(/^\d{4}-\d{2}$/),
        accountId: z.string().optional(),
      })
      .parse(req.query);

    const startDate = `${startMonth}-01`;
    const endDate = `${endMonth}-31`;

    // Get bank transactions (exclude personal)
    const bankConditions = [
      between(bankTransactions.date, startDate, endDate),
      eq(bankTransactions.userId, req.userId!),
      sql`(${bankTransactions.purpose} IS NULL OR ${bankTransactions.purpose} != 'personal')`,
    ];
    if (accountId) {
      bankConditions.push(eq(bankTransactions.accountId, accountId));
    }

    const bankTxns = await db
      .select()
      .from(bankTransactions)
      .where(and(...bankConditions));

    const vyaparTxns = await db
      .select()
      .from(vyaparTransactions)
      .where(and(between(vyaparTransactions.date, startDate, endDate), eq(vyaparTransactions.userId, req.userId!)));

    // Build matched pairs
    const matches: Array<{
      bankDate: string;
      bankNarration: string;
      bankAmount: number;
      vyaparDate: string;
      vyaparParty: string;
      vyaparAmount: number;
      confidence: number;
    }> = [];

    const vyaparMap = new Map(vyaparTxns.map(v => [v.id, v]));

    for (const bank of bankTxns.filter(t => t.isReconciled && t.reconciledWithId)) {
      const vyapar = vyaparMap.get(bank.reconciledWithId!);
      if (vyapar) {
        matches.push({
          bankDate: bank.date,
          bankNarration: bank.narration,
          bankAmount: bank.amount,
          vyaparDate: vyapar.date,
          vyaparParty: vyapar.partyName || '',
          vyaparAmount: vyapar.amount,
          confidence: 100,
        });
      }
    }

    const unmatchedBank = bankTxns
      .filter(t => !t.isReconciled)
      .map(t => ({
        date: t.date,
        narration: t.narration,
        amount: t.amount,
      }));

    const unmatchedVyapar = vyaparTxns
      .filter(t => !t.isReconciled)
      .map(t => ({
        date: t.date,
        partyName: t.partyName || '',
        amount: t.amount,
      }));

    const buffer = formatReconciliationReport(matches, unmatchedBank, unmatchedVyapar);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    const filename = startMonth === endMonth
      ? `reconciliation-${startMonth}.xlsx`
      : `reconciliation-${startMonth}-to-${endMonth}.xlsx`;
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );
    res.send(buffer);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error exporting reconciliation:', error);
    res.status(500).json({ error: 'Failed to export report' });
  }
});

// ============================================
// Reconciliation Rules Management
// ============================================

// Get all reconciliation rules
router.get('/rules', async (req, res) => {
  try {
    const rules = await db
      .select()
      .from(reconciliationRules)
      .where(eq(reconciliationRules.userId, req.userId!))
      .orderBy(desc(reconciliationRules.matchCount), desc(reconciliationRules.priority));

    res.json(rules);
  } catch (error) {
    console.error('Error fetching reconciliation rules:', error);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

// Delete a reconciliation rule
router.delete('/rules/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify rule belongs to user
    const [rule] = await db
      .select()
      .from(reconciliationRules)
      .where(and(eq(reconciliationRules.id, id), eq(reconciliationRules.userId, req.userId!)));

    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    await db.delete(reconciliationRules).where(eq(reconciliationRules.id, id));

    res.json({ success: true, message: 'Rule deleted' });
  } catch (error) {
    console.error('Error deleting reconciliation rule:', error);
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

// Toggle reconciliation rule active status
router.patch('/rules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    // Verify rule belongs to user
    const [rule] = await db
      .select()
      .from(reconciliationRules)
      .where(and(eq(reconciliationRules.id, id), eq(reconciliationRules.userId, req.userId!)));

    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    await db
      .update(reconciliationRules)
      .set({
        isActive: isActive ? 1 : 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(reconciliationRules.id, id));

    const [updated] = await db
      .select()
      .from(reconciliationRules)
      .where(eq(reconciliationRules.id, id));

    res.json(updated);
  } catch (error) {
    console.error('Error updating reconciliation rule:', error);
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

// Find orphaned Vyapar matches (marked as matched but bank transaction doesn't exist)
router.get('/orphaned-matches', async (req, res) => {
  try {
    // Find all Vyapar transactions that are marked as reconciled
    const matchedVyapar = await db
      .select()
      .from(vyaparTransactions)
      .where(
        and(
          eq(vyaparTransactions.userId, req.userId!),
          eq(vyaparTransactions.isReconciled, true)
        )
      );

    // Get all bank transaction IDs
    const allBankTxns = await db
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(eq(bankTransactions.userId, req.userId!));

    const bankTxnIds = new Set(allBankTxns.map(t => t.id));

    // Find orphaned matches - Vyapar transactions whose reconciledWithId doesn't exist in bank
    const orphaned = matchedVyapar.filter(v =>
      v.reconciledWithId && !bankTxnIds.has(v.reconciledWithId)
    );

    res.json({
      count: orphaned.length,
      orphaned: orphaned.map(v => ({
        id: v.id,
        date: v.date,
        partyName: v.partyName,
        invoiceNumber: v.invoiceNumber,
        amount: v.amount,
        transactionType: v.transactionType,
        reconciledWithId: v.reconciledWithId,
      })),
    });
  } catch (error) {
    console.error('Error finding orphaned matches:', error);
    res.status(500).json({ error: 'Failed to find orphaned matches' });
  }
});

// Repair all match inconsistencies (sync both sides)
router.post('/repair-matches', async (req, res) => {
  try {
    const now = new Date().toISOString();
    let repairedCount = 0;
    let orphanedBankCount = 0;
    let orphanedVyaparCount = 0;

    // Get all bank transactions
    const allBankTxns = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.userId, req.userId!));

    // Get all Vyapar transactions
    const allVyaparTxns = await db
      .select()
      .from(vyaparTransactions)
      .where(eq(vyaparTransactions.userId, req.userId!));

    const bankMap = new Map(allBankTxns.map(t => [t.id, t]));
    const vyaparMap = new Map(allVyaparTxns.map(t => [t.id, t]));

    // 1. For each matched bank transaction, ensure Vyapar side is also matched
    for (const bank of allBankTxns) {
      if (bank.isReconciled && bank.reconciledWithId && bank.reconciledWithType === 'vyapar') {
        const vyapar = vyaparMap.get(bank.reconciledWithId);
        if (vyapar) {
          // Vyapar exists - ensure it's marked as matched back to this bank
          if (!vyapar.isReconciled || vyapar.reconciledWithId !== bank.id) {
            await db
              .update(vyaparTransactions)
              .set({
                isReconciled: true,
                reconciledWithId: bank.id,
                updatedAt: now,
              })
              .where(eq(vyaparTransactions.id, vyapar.id));
            repairedCount++;
          }
        } else {
          // Vyapar doesn't exist - unlink the bank transaction
          await db
            .update(bankTransactions)
            .set({
              isReconciled: false,
              reconciledWithId: null,
              reconciledWithType: null,
              purpose: null,
              updatedAt: now,
            })
            .where(eq(bankTransactions.id, bank.id));
          orphanedBankCount++;
        }
      }
    }

    // 2. For each matched Vyapar transaction, ensure Bank side is also matched
    for (const vyapar of allVyaparTxns) {
      if (vyapar.isReconciled && vyapar.reconciledWithId) {
        const bank = bankMap.get(vyapar.reconciledWithId);
        if (bank) {
          // Bank exists - ensure it's marked as matched back to this Vyapar
          if (!bank.isReconciled || bank.reconciledWithId !== vyapar.id) {
            await db
              .update(bankTransactions)
              .set({
                isReconciled: true,
                reconciledWithId: vyapar.id,
                reconciledWithType: 'vyapar',
                purpose: 'business',
                updatedAt: now,
              })
              .where(eq(bankTransactions.id, bank.id));
            repairedCount++;
          }
        } else {
          // Bank doesn't exist - unlink the Vyapar transaction
          await db
            .update(vyaparTransactions)
            .set({
              isReconciled: false,
              reconciledWithId: null,
              updatedAt: now,
            })
            .where(eq(vyaparTransactions.id, vyapar.id));
          orphanedVyaparCount++;
        }
      }
    }

    res.json({
      repaired: repairedCount,
      orphanedBankFixed: orphanedBankCount,
      orphanedVyaparFixed: orphanedVyaparCount,
      message: `Repaired ${repairedCount} inconsistent matches, fixed ${orphanedBankCount} orphaned bank and ${orphanedVyaparCount} orphaned Vyapar transactions`,
    });
  } catch (error) {
    console.error('Error repairing matches:', error);
    res.status(500).json({ error: 'Failed to repair matches' });
  }
});

// Fix orphaned Vyapar matches (unlink them) - DEPRECATED, use repair-matches instead
router.post('/fix-orphaned-matches', async (req, res) => {
  // Redirect to the comprehensive repair function
  try {
    const now = new Date().toISOString();
    let fixedCount = 0;

    // Get all Vyapar transactions that are marked as reconciled
    const matchedVyapar = await db
      .select()
      .from(vyaparTransactions)
      .where(
        and(
          eq(vyaparTransactions.userId, req.userId!),
          eq(vyaparTransactions.isReconciled, true)
        )
      );

    // Get all bank transaction IDs
    const allBankTxns = await db
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(eq(bankTransactions.userId, req.userId!));

    const bankTxnIds = new Set(allBankTxns.map(t => t.id));

    // Find orphaned matches - only those where bank truly doesn't exist
    for (const vyapar of matchedVyapar) {
      if (vyapar.reconciledWithId && !bankTxnIds.has(vyapar.reconciledWithId)) {
        await db
          .update(vyaparTransactions)
          .set({
            isReconciled: false,
            reconciledWithId: null,
            updatedAt: now,
          })
          .where(eq(vyaparTransactions.id, vyapar.id));
        fixedCount++;
      }
    }

    res.json({
      fixed: fixedCount,
      message: fixedCount > 0 ? `Fixed ${fixedCount} orphaned matches` : 'No orphaned matches found',
    });
  } catch (error) {
    console.error('Error fixing orphaned matches:', error);
    res.status(500).json({ error: 'Failed to fix orphaned matches' });
  }
});

export default router;

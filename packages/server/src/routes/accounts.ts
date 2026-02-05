import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, accounts } from '../db/index.js';
import { eq } from 'drizzle-orm';

const router = Router();

const accountSchema = z.object({
  name: z.string().min(1),
  bankName: z.string().min(1),
  accountNumber: z.string().optional().nullable(),
  accountType: z.enum(['savings', 'current', 'credit_card', 'loan']),
  currency: z.string().default('INR'),
  openingBalance: z.number().default(0),
});

// Get all accounts
router.get('/', async (_req, res) => {
  try {
    const allAccounts = await db.select().from(accounts);
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
      .where(eq(accounts.id, req.params.id))
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
      .where(eq(accounts.id, req.params.id));

    const updated = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, req.params.id))
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

// Delete account (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const now = new Date().toISOString();

    await db
      .update(accounts)
      .set({ isActive: false, updatedAt: now })
      .where(eq(accounts.id, req.params.id));

    res.json({ success: true });
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
      .where(eq(accounts.id, req.params.id));

    const updated = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, req.params.id))
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

export default router;

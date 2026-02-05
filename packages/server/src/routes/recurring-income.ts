import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, recurringIncome, incomeReceipts } from '../db/index.js';
import { eq, desc, and } from 'drizzle-orm';

const router = Router();

const recurringIncomeSchema = z.object({
  name: z.string().min(1),
  category: z.enum(['salary', 'rental', 'dividend', 'interest', 'freelance', 'other']),
  amount: z.number().positive(),
  currency: z.enum(['INR', 'USD']).optional(),
  frequency: z.enum(['monthly', 'quarterly', 'half_yearly', 'yearly']),
  expectedDay: z.number().min(1).max(31).optional(),
  expectedMonth: z.number().min(1).max(12).optional(),
  source: z.string().optional(),
  accountNumber: z.string().optional(),
  forWhom: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  autoCredit: z.boolean().optional(),
  creditAccount: z.string().optional(),
  notes: z.string().optional(),
});

// Get all recurring income
router.get('/', async (req, res) => {
  try {
    const incomes = await db
      .select()
      .from(recurringIncome)
      .where(eq(recurringIncome.userId, req.userId!))
      .orderBy(desc(recurringIncome.createdAt));

    res.json(incomes);
  } catch (error) {
    console.error('Error fetching recurring income:', error);
    res.status(500).json({ error: 'Failed to fetch recurring income' });
  }
});

// Get recurring income summary
router.get('/summary', async (req, res) => {
  try {
    const incomes = await db.select().from(recurringIncome).where(eq(recurringIncome.userId, req.userId!));
    const activeIncomes = incomes.filter((i) => i.status === 'active');

    // Calculate monthly total (normalize all frequencies to monthly)
    const monthlyTotal = activeIncomes.reduce((sum, i) => {
      const amount = i.amount;
      switch (i.frequency) {
        case 'yearly':
          return sum + amount / 12;
        case 'half_yearly':
          return sum + amount / 6;
        case 'quarterly':
          return sum + amount / 4;
        default:
          return sum + amount;
      }
    }, 0);

    // Calculate yearly total
    const yearlyTotal = activeIncomes.reduce((sum, i) => {
      const amount = i.amount;
      switch (i.frequency) {
        case 'yearly':
          return sum + amount;
        case 'half_yearly':
          return sum + amount * 2;
        case 'quarterly':
          return sum + amount * 4;
        default:
          return sum + amount * 12;
      }
    }, 0);

    // Group by category
    const byCategory = activeIncomes.reduce((acc, i) => {
      const cat = i.category;
      if (!acc[cat]) acc[cat] = { count: 0, monthlyAmount: 0 };
      acc[cat].count++;
      const monthly =
        i.frequency === 'yearly'
          ? i.amount / 12
          : i.frequency === 'half_yearly'
          ? i.amount / 6
          : i.frequency === 'quarterly'
          ? i.amount / 4
          : i.amount;
      acc[cat].monthlyAmount += monthly;
      return acc;
    }, {} as Record<string, { count: number; monthlyAmount: number }>);

    // Group by forWhom (family member)
    const byPerson = activeIncomes.reduce((acc, i) => {
      const person = i.forWhom || 'Family';
      if (!acc[person]) acc[person] = { count: 0, monthlyAmount: 0 };
      acc[person].count++;
      const monthly =
        i.frequency === 'yearly'
          ? i.amount / 12
          : i.frequency === 'half_yearly'
          ? i.amount / 6
          : i.frequency === 'quarterly'
          ? i.amount / 4
          : i.amount;
      acc[person].monthlyAmount += monthly;
      return acc;
    }, {} as Record<string, { count: number; monthlyAmount: number }>);

    res.json({
      totalIncomes: incomes.length,
      activeIncomes: activeIncomes.length,
      monthlyTotal,
      yearlyTotal,
      byCategory,
      byPerson,
    });
  } catch (error) {
    console.error('Error fetching recurring income summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// Get single recurring income
router.get('/:id', async (req, res) => {
  try {
    const [income] = await db
      .select()
      .from(recurringIncome)
      .where(and(eq(recurringIncome.id, req.params.id), eq(recurringIncome.userId, req.userId!)))
      .limit(1);

    if (!income) {
      return res.status(404).json({ error: 'Recurring income not found' });
    }

    // Get receipts
    const receipts = await db
      .select()
      .from(incomeReceipts)
      .where(eq(incomeReceipts.incomeId, req.params.id))
      .orderBy(desc(incomeReceipts.receiptDate));

    res.json({ ...income, receipts });
  } catch (error) {
    console.error('Error fetching recurring income:', error);
    res.status(500).json({ error: 'Failed to fetch recurring income' });
  }
});

// Create recurring income
router.post('/', async (req, res) => {
  try {
    const data = recurringIncomeSchema.parse(req.body);
    const now = new Date().toISOString();

    // Calculate next expected date
    let nextExpectedDate: string | null = null;
    if (data.expectedDay) {
      const today = new Date();
      const expectedDate = new Date(today.getFullYear(), today.getMonth(), data.expectedDay);
      if (expectedDate <= today) {
        // Move to next period
        if (data.frequency === 'monthly') {
          expectedDate.setMonth(expectedDate.getMonth() + 1);
        } else if (data.frequency === 'quarterly') {
          expectedDate.setMonth(expectedDate.getMonth() + 3);
        } else if (data.frequency === 'half_yearly') {
          expectedDate.setMonth(expectedDate.getMonth() + 6);
        } else {
          expectedDate.setFullYear(expectedDate.getFullYear() + 1);
        }
      }
      nextExpectedDate = expectedDate.toISOString().split('T')[0];
    }

    const newIncome = {
      id: uuidv4(),
      userId: req.userId!,
      name: data.name,
      category: data.category,
      amount: data.amount,
      currency: data.currency || 'INR',
      frequency: data.frequency,
      expectedDay: data.expectedDay || null,
      expectedMonth: data.expectedMonth || null,
      source: data.source || null,
      accountNumber: data.accountNumber || null,
      forWhom: data.forWhom || null,
      startDate: data.startDate || null,
      endDate: data.endDate || null,
      lastReceivedDate: null,
      nextExpectedDate,
      status: 'active',
      autoCredit: data.autoCredit ? 1 : 0,
      creditAccount: data.creditAccount || null,
      notes: data.notes || null,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(recurringIncome).values(newIncome);
    res.status(201).json(newIncome);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating recurring income:', error);
    res.status(500).json({ error: 'Failed to create recurring income' });
  }
});

// Update recurring income
router.put('/:id', async (req, res) => {
  try {
    const data = recurringIncomeSchema.partial().parse(req.body);
    const now = new Date().toISOString();

    const updateData: any = { ...data, updatedAt: now };
    if (data.autoCredit !== undefined) {
      updateData.autoCredit = data.autoCredit ? 1 : 0;
    }

    await db
      .update(recurringIncome)
      .set(updateData)
      .where(and(eq(recurringIncome.id, req.params.id), eq(recurringIncome.userId, req.userId!)));

    const [updated] = await db
      .select()
      .from(recurringIncome)
      .where(and(eq(recurringIncome.id, req.params.id), eq(recurringIncome.userId, req.userId!)))
      .limit(1);

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating recurring income:', error);
    res.status(500).json({ error: 'Failed to update recurring income' });
  }
});

// Delete recurring income
router.delete('/:id', async (req, res) => {
  try {
    // Delete receipts first
    await db.delete(incomeReceipts).where(eq(incomeReceipts.incomeId, req.params.id));
    // Delete income
    await db.delete(recurringIncome).where(and(eq(recurringIncome.id, req.params.id), eq(recurringIncome.userId, req.userId!)));
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting recurring income:', error);
    res.status(500).json({ error: 'Failed to delete recurring income' });
  }
});

// Add receipt to recurring income
router.post('/:id/receipts', async (req, res) => {
  try {
    const { receiptDate, amount, forPeriod, paymentMode, referenceNumber, notes } = z
      .object({
        receiptDate: z.string(),
        amount: z.number().positive(),
        forPeriod: z.string().optional(),
        paymentMode: z.string().optional(),
        referenceNumber: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const now = new Date().toISOString();

    const newReceipt = {
      id: uuidv4(),
      incomeId: req.params.id,
      receiptDate,
      amount,
      forPeriod: forPeriod || null,
      paymentMode: paymentMode || null,
      referenceNumber: referenceNumber || null,
      notes: notes || null,
      createdAt: now,
    };

    await db.insert(incomeReceipts).values(newReceipt);

    // Update last received date
    await db
      .update(recurringIncome)
      .set({ lastReceivedDate: receiptDate, updatedAt: now })
      .where(and(eq(recurringIncome.id, req.params.id), eq(recurringIncome.userId, req.userId!)));

    res.status(201).json(newReceipt);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error adding receipt:', error);
    res.status(500).json({ error: 'Failed to add receipt' });
  }
});

export default router;

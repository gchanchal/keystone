import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, fixedExpenses, fixedExpensePayments } from '../db/index.js';
import { eq, desc, and } from 'drizzle-orm';

const router = Router();

const fixedExpenseSchema = z.object({
  name: z.string().min(1),
  category: z.enum(['rent', 'school_fees', 'utilities', 'subscription', 'insurance', 'maintenance', 'other']),
  amount: z.number().positive(),
  currency: z.enum(['INR', 'USD']).optional(),
  frequency: z.enum(['monthly', 'quarterly', 'half_yearly', 'yearly']),
  dueDay: z.number().min(1).max(31).optional(),
  dueMonth: z.number().min(1).max(12).optional(),
  beneficiary: z.string().optional(),
  accountNumber: z.string().optional(),
  forWhom: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  autoPayEnabled: z.boolean().optional(),
  autoPayAccount: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(['active', 'paid']).optional(),
  lastPaidDate: z.string().nullable().optional(),
});

// Get all fixed expenses
router.get('/', async (req, res) => {
  try {
    const expenses = await db
      .select()
      .from(fixedExpenses)
      .where(eq(fixedExpenses.userId, req.userId!))
      .orderBy(desc(fixedExpenses.createdAt));

    res.json(expenses);
  } catch (error) {
    console.error('Error fetching fixed expenses:', error);
    res.status(500).json({ error: 'Failed to fetch fixed expenses' });
  }
});

// Get fixed expenses summary
router.get('/summary', async (req, res) => {
  try {
    const expenses = await db.select().from(fixedExpenses).where(eq(fixedExpenses.userId, req.userId!));
    const activeExpenses = expenses.filter((e) => e.status === 'active');

    // Calculate monthly total (normalize all frequencies to monthly)
    const monthlyTotal = activeExpenses.reduce((sum, e) => {
      const amount = e.amount;
      switch (e.frequency) {
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
    const yearlyTotal = activeExpenses.reduce((sum, e) => {
      const amount = e.amount;
      switch (e.frequency) {
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
    const byCategory = activeExpenses.reduce((acc, e) => {
      const cat = e.category;
      if (!acc[cat]) acc[cat] = { count: 0, monthlyAmount: 0 };
      acc[cat].count++;
      const monthly =
        e.frequency === 'yearly'
          ? e.amount / 12
          : e.frequency === 'half_yearly'
          ? e.amount / 6
          : e.frequency === 'quarterly'
          ? e.amount / 4
          : e.amount;
      acc[cat].monthlyAmount += monthly;
      return acc;
    }, {} as Record<string, { count: number; monthlyAmount: number }>);

    // Group by forWhom (family member)
    const byPerson = activeExpenses.reduce((acc, e) => {
      const person = e.forWhom || 'Family';
      if (!acc[person]) acc[person] = { count: 0, monthlyAmount: 0 };
      acc[person].count++;
      const monthly =
        e.frequency === 'yearly'
          ? e.amount / 12
          : e.frequency === 'half_yearly'
          ? e.amount / 6
          : e.frequency === 'quarterly'
          ? e.amount / 4
          : e.amount;
      acc[person].monthlyAmount += monthly;
      return acc;
    }, {} as Record<string, { count: number; monthlyAmount: number }>);

    res.json({
      totalExpenses: expenses.length,
      activeExpenses: activeExpenses.length,
      monthlyTotal,
      yearlyTotal,
      byCategory,
      byPerson,
    });
  } catch (error) {
    console.error('Error fetching fixed expenses summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// Get single fixed expense
router.get('/:id', async (req, res) => {
  try {
    const [expense] = await db
      .select()
      .from(fixedExpenses)
      .where(and(eq(fixedExpenses.id, req.params.id), eq(fixedExpenses.userId, req.userId!)))
      .limit(1);

    if (!expense) {
      return res.status(404).json({ error: 'Fixed expense not found' });
    }

    // Get payments
    const payments = await db
      .select()
      .from(fixedExpensePayments)
      .where(eq(fixedExpensePayments.expenseId, req.params.id))
      .orderBy(desc(fixedExpensePayments.paymentDate));

    res.json({ ...expense, payments });
  } catch (error) {
    console.error('Error fetching fixed expense:', error);
    res.status(500).json({ error: 'Failed to fetch fixed expense' });
  }
});

// Create fixed expense
router.post('/', async (req, res) => {
  try {
    const data = fixedExpenseSchema.parse(req.body);
    const now = new Date().toISOString();

    // Calculate next due date
    let nextDueDate: string | null = null;
    if (data.dueDay) {
      const today = new Date();
      const dueDate = new Date(today.getFullYear(), today.getMonth(), data.dueDay);
      if (dueDate <= today) {
        // Move to next period
        if (data.frequency === 'monthly') {
          dueDate.setMonth(dueDate.getMonth() + 1);
        } else if (data.frequency === 'quarterly') {
          dueDate.setMonth(dueDate.getMonth() + 3);
        } else if (data.frequency === 'half_yearly') {
          dueDate.setMonth(dueDate.getMonth() + 6);
        } else {
          dueDate.setFullYear(dueDate.getFullYear() + 1);
        }
      }
      nextDueDate = dueDate.toISOString().split('T')[0];
    }

    const newExpense = {
      id: uuidv4(),
      userId: req.userId!,
      name: data.name,
      category: data.category,
      amount: data.amount,
      currency: data.currency || 'INR',
      frequency: data.frequency,
      dueDay: data.dueDay || null,
      dueMonth: data.dueMonth || null,
      beneficiary: data.beneficiary || null,
      accountNumber: data.accountNumber || null,
      forWhom: data.forWhom || null,
      startDate: data.startDate || null,
      endDate: data.endDate || null,
      lastPaidDate: null,
      nextDueDate,
      status: 'active',
      autoPayEnabled: data.autoPayEnabled ? 1 : 0,
      autoPayAccount: data.autoPayAccount || null,
      notes: data.notes || null,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(fixedExpenses).values(newExpense);
    res.status(201).json(newExpense);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating fixed expense:', error);
    res.status(500).json({ error: 'Failed to create fixed expense' });
  }
});

// Update fixed expense
router.put('/:id', async (req, res) => {
  try {
    const data = fixedExpenseSchema.partial().parse(req.body);
    const now = new Date().toISOString();

    const updateData: any = { ...data, updatedAt: now };
    if (data.autoPayEnabled !== undefined) {
      updateData.autoPayEnabled = data.autoPayEnabled ? 1 : 0;
    }

    await db
      .update(fixedExpenses)
      .set(updateData)
      .where(and(eq(fixedExpenses.id, req.params.id), eq(fixedExpenses.userId, req.userId!)));

    const [updated] = await db
      .select()
      .from(fixedExpenses)
      .where(and(eq(fixedExpenses.id, req.params.id), eq(fixedExpenses.userId, req.userId!)))
      .limit(1);

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating fixed expense:', error);
    res.status(500).json({ error: 'Failed to update fixed expense' });
  }
});

// Delete fixed expense
router.delete('/:id', async (req, res) => {
  try {
    // Delete payments first
    await db.delete(fixedExpensePayments).where(eq(fixedExpensePayments.expenseId, req.params.id));
    // Delete expense
    await db.delete(fixedExpenses).where(and(eq(fixedExpenses.id, req.params.id), eq(fixedExpenses.userId, req.userId!)));
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting fixed expense:', error);
    res.status(500).json({ error: 'Failed to delete fixed expense' });
  }
});

// Add payment to fixed expense
router.post('/:id/payments', async (req, res) => {
  try {
    const { paymentDate, amount, forPeriod, paymentMode, referenceNumber, notes } = z
      .object({
        paymentDate: z.string(),
        amount: z.number().positive(),
        forPeriod: z.string().optional(),
        paymentMode: z.string().optional(),
        referenceNumber: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const now = new Date().toISOString();

    const newPayment = {
      id: uuidv4(),
      expenseId: req.params.id,
      paymentDate,
      amount,
      forPeriod: forPeriod || null,
      paymentMode: paymentMode || null,
      referenceNumber: referenceNumber || null,
      notes: notes || null,
      createdAt: now,
    };

    await db.insert(fixedExpensePayments).values(newPayment);

    // Update last paid date
    await db
      .update(fixedExpenses)
      .set({ lastPaidDate: paymentDate, updatedAt: now })
      .where(and(eq(fixedExpenses.id, req.params.id), eq(fixedExpenses.userId, req.userId!)));

    res.status(201).json(newPayment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error adding payment:', error);
    res.status(500).json({ error: 'Failed to add payment' });
  }
});

export default router;

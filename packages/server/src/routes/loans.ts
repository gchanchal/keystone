import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, loans, loanPayments, loanDisbursements, loanSchedule, loanGivenDetails, fixedExpenses } from '../db/index.js';
import { eq, desc, and, inArray, gte, lte } from 'drizzle-orm';
import { parseAxisHomeLoanStatement, mergeStatementData } from '../parsers/axis-home-loan-parser.js';
import type { AxisHomeLoanData } from '../parsers/axis-home-loan-parser.js';
import {
  parseAxisRepaymentSchedule,
  markPaidInstallments,
  getUpcomingEmis,
  calculateLoanProgress,
} from '../parsers/axis-repayment-schedule-parser.js';

const router = Router();

const loanSchema = z.object({
  type: z.enum(['given', 'taken']),
  loanType: z.enum(['home', 'car', 'personal', 'business', 'education']).optional(),
  partyName: z.string().min(1),
  borrowerName: z.string().optional(),
  coBorrowerName: z.string().optional(),
  agreementNumber: z.string().optional(),
  applicationNumber: z.string().optional(),
  sanctionedAmount: z.number().optional(),
  disbursedAmount: z.number().optional(),
  principalAmount: z.number().min(0).default(0), // 0 for 'given' type, derived from details
  interestRate: z.number().min(0).default(0),
  interestType: z.enum(['fixed', 'floating']).optional(),
  emiAmount: z.number().optional(),
  emiStartDate: z.string().optional(),
  totalInstallments: z.number().optional(),
  startDate: z.string(),
  disbursalDate: z.string().optional(),
  dueDate: z.string().optional(),
  maturityDate: z.string().optional(),
  propertyAddress: z.string().optional(),
  propertyType: z.string().optional(),
  repaymentBank: z.string().optional(),
  repaymentMode: z.string().optional(),
  notes: z.string().optional(),
});

const paymentSchema = z.object({
  loanId: z.string(),
  date: z.string(),
  amount: z.number().positive(),
  principalPaid: z.number().optional(),
  interestPaid: z.number().optional(),
  notes: z.string().optional(),
});

const loanGivenDetailSchema = z.object({
  particular: z.string().min(1),
  toGet: z.number().default(0),
  toGive: z.number().default(0),
  currency: z.enum(['INR', 'USD']).default('INR'),
  details: z.string().optional(),
  date: z.string(),
  notes: z.string().optional(),
});

// Cache for exchange rate (cache for 10 minutes)
let exchangeRateCache: { rate: number; timestamp: number } | null = null;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

async function fetchUsdToInrRate(): Promise<number> {
  // Check cache first
  if (exchangeRateCache && Date.now() - exchangeRateCache.timestamp < CACHE_DURATION) {
    return exchangeRateCache.rate;
  }

  try {
    // Use Google Finance via a simple fetch (scraping the rate)
    const response = await fetch(
      'https://www.google.com/finance/quote/USD-INR'
    );
    const html = await response.text();

    // Parse the rate from the HTML (looking for the data attribute or text)
    const rateMatch = html.match(/data-last-price="([\d.]+)"/);
    if (rateMatch && rateMatch[1]) {
      const rate = parseFloat(rateMatch[1]);
      exchangeRateCache = { rate, timestamp: Date.now() };
      return rate;
    }

    // Fallback: try another pattern
    const altMatch = html.match(/<div[^>]*class="[^"]*YMlKec[^"]*"[^>]*>([\d.]+)<\/div>/);
    if (altMatch && altMatch[1]) {
      const rate = parseFloat(altMatch[1]);
      exchangeRateCache = { rate, timestamp: Date.now() };
      return rate;
    }

    // Default fallback rate
    console.warn('Could not parse exchange rate, using fallback');
    return exchangeRateCache?.rate || 83.5;
  } catch (error) {
    console.error('Error fetching exchange rate:', error);
    return exchangeRateCache?.rate || 83.5; // Fallback rate
  }
}

// Get all loans
router.get('/', async (req, res) => {
  try {
    const { type, loanType, status } = z
      .object({
        type: z.enum(['given', 'taken']).optional(),
        loanType: z.enum(['home', 'car', 'personal', 'business', 'education']).optional(),
        status: z.enum(['active', 'closed', 'defaulted']).optional(),
      })
      .parse(req.query);

    const conditions = [];
    if (type) conditions.push(eq(loans.type, type));
    if (loanType) conditions.push(eq(loans.loanType, loanType));
    if (status) conditions.push(eq(loans.status, status));

    let query = db.select().from(loans).orderBy(desc(loans.createdAt));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const allLoans = await query;
    res.json(allLoans);
  } catch (error) {
    console.error('Error fetching loans:', error);
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
});

// Helper to calculate overdue payment dates for non-monthly expenses
// Only shows expenses where the due date has PASSED and not yet paid
function getUpcomingPaymentDates(expense: any, monthsAhead: number = 12): { month: string; amount: number; name: string; isPaid: boolean }[] {
  const results: { month: string; amount: number; name: string; isPaid: boolean }[] = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentDay = now.getDate();

  // Check if expense is paid for a given period
  const isPaidForPeriod = (checkDate: Date): boolean => {
    if (!expense.lastPaidDate) return false;
    const [year, month, day] = expense.lastPaidDate.split('-').map(Number);
    const lastPaid = new Date(year, month - 1, day);

    if (expense.frequency === 'yearly') {
      return lastPaid.getFullYear() === checkDate.getFullYear();
    } else if (expense.frequency === 'half_yearly') {
      const lastHalf = lastPaid.getMonth() < 6 ? 1 : 2;
      const checkHalf = checkDate.getMonth() < 6 ? 1 : 2;
      return lastPaid.getFullYear() === checkDate.getFullYear() && lastHalf === checkHalf;
    } else if (expense.frequency === 'quarterly') {
      const lastQuarter = Math.floor(lastPaid.getMonth() / 3);
      const checkQuarter = Math.floor(checkDate.getMonth() / 3);
      return lastPaid.getFullYear() === checkDate.getFullYear() && lastQuarter === checkQuarter;
    }
    return false;
  };

  // Calculate due date for the current period
  const dueDay = expense.dueDay || 1;
  const dueMonth = expense.dueMonth ? expense.dueMonth - 1 : 0;

  if (expense.frequency === 'yearly') {
    // Yearly: check if this year's payment is overdue
    const thisYearDueDate = new Date(currentYear, dueMonth, dueDay);

    // If due date has passed this year and not paid, show it
    if (thisYearDueDate < now && !isPaidForPeriod(thisYearDueDate)) {
      const monthKey = `${currentYear}-${String(dueMonth + 1).padStart(2, '0')}`;
      results.push({
        month: monthKey,
        amount: expense.amount,
        name: expense.name,
        isPaid: false,
      });
    }
  } else if (expense.frequency === 'half_yearly') {
    // Half-yearly: check current half-year
    const currentHalf = currentMonth < 6 ? 0 : 1;
    const halfYearMonth = currentHalf * 6 + (dueMonth % 6);
    const halfYearDueDate = new Date(currentYear, halfYearMonth, dueDay);

    // If due date has passed and not paid, show it
    if (halfYearDueDate < now && !isPaidForPeriod(halfYearDueDate)) {
      const monthKey = `${currentYear}-${String(halfYearMonth + 1).padStart(2, '0')}`;
      results.push({
        month: monthKey,
        amount: expense.amount,
        name: expense.name,
        isPaid: false,
      });
    }
  } else if (expense.frequency === 'quarterly') {
    // Quarterly: check current quarter
    const currentQuarter = Math.floor(currentMonth / 3);
    const quarterMonth = currentQuarter * 3 + (dueMonth % 3);
    const quarterDueDate = new Date(currentYear, quarterMonth, dueDay);

    // If due date has passed and not paid, show it
    if (quarterDueDate < now && !isPaidForPeriod(quarterDueDate)) {
      const monthKey = `${currentYear}-${String(quarterMonth + 1).padStart(2, '0')}`;
      results.push({
        month: monthKey,
        amount: expense.amount,
        name: expense.name,
        isPaid: false,
      });
    }
  }

  return results;
}

// Get loan summary
router.get('/summary', async (_req, res) => {
  try {
    const allLoans = await db.select().from(loans);

    const givenLoans = allLoans.filter(l => l.type === 'given');
    const takenLoans = allLoans.filter(l => l.type === 'taken');

    const activeGiven = givenLoans.filter(l => l.status === 'active');
    const activeTaken = takenLoans.filter(l => l.status === 'active');

    // Home loans (subset of taken loans)
    const homeLoans = allLoans.filter(l => l.loanType === 'home');
    const activeHomeLoans = homeLoans.filter(l => l.status === 'active');

    // Calculate totals for home loans
    const homeLoanStats = {
      total: homeLoans.length,
      active: activeHomeLoans.length,
      totalSanctioned: homeLoans.reduce((s, l) => s + (l.sanctionedAmount || l.principalAmount), 0),
      totalDisbursed: homeLoans.reduce((s, l) => s + (l.disbursedAmount || l.principalAmount), 0),
      outstanding: activeHomeLoans.reduce((s, l) => s + l.outstandingAmount, 0),
      totalPrincipalPaid: homeLoans.reduce((s, l) => s + (l.totalPrincipalPaid || 0), 0),
      totalInterestPaid: homeLoans.reduce((s, l) => s + (l.totalInterestPaid || 0), 0),
      totalChargesPaid: homeLoans.reduce((s, l) => s + (l.totalChargesPaid || 0), 0),
    };

    // Calculate total EMI from active taken loans
    const loanEmi = activeTaken.reduce((s, l) => s + (l.emiAmount || 0), 0);

    // Check if loan is paid for current month using lastPaidDate
    const now = new Date();
    const currentDay = now.getDate();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const isLoanPaidThisMonth = (loan: any): boolean => {
      if (!loan.lastPaidDate) return false;
      const [paidYear, paidMonth] = loan.lastPaidDate.split('-').map(Number);
      return paidYear === currentYear && paidMonth === currentMonth + 1;
    };

    // Build taken loans list with paid status for Dashboard
    const takenLoansList = activeTaken
      .filter(l => l.emiAmount && l.emiAmount > 0) // Only include loans with EMI
      .map(l => ({
        id: l.id,
        name: l.partyName,
        amount: l.emiAmount || 0,
        dueDay: l.dueDate ? new Date(l.dueDate).getDate() : 10,
        isPaid: isLoanPaidThisMonth(l),
        type: 'loan',
      }));

    // Get active fixed expenses
    const allFixedExpenses = await db.select().from(fixedExpenses);
    const activeFixedExpenses = allFixedExpenses.filter((e) => e.status === 'active');

    // Calculate monthly fixed expenses with paid/pending status
    const monthlyExpenses = activeFixedExpenses.filter((e) => e.frequency === 'monthly');

    // Check if monthly expense is paid for current month
    const isMonthlyExpensePaid = (expense: any): boolean => {
      if (!expense.lastPaidDate) return false;
      const [paidYear, paidMonth] = expense.lastPaidDate.split('-').map(Number);
      return paidYear === currentYear && paidMonth === currentMonth + 1;
    };

    // Build monthly expenses list with paid status
    const monthlyExpensesList = monthlyExpenses.map((e) => {
      const dueDay = e.dueDay || 1;
      const isPastDue = currentDay >= dueDay;
      const isPaid = isMonthlyExpensePaid(e);

      return {
        id: e.id,
        name: e.name,
        amount: e.amount,
        dueDay: dueDay,
        isPaid: isPaid,
        isPastDue: isPastDue,
        // If past due and not paid = pending, if past due and paid = paid, if not past due = upcoming
        status: isPastDue ? (isPaid ? 'paid' : 'pending') : 'upcoming',
      };
    });

    const monthlyFixedExpenses = monthlyExpenses.reduce((s, e) => s + e.amount, 0);

    // Calculate yearly fixed expenses (non-monthly ones, normalized to yearly amount)
    const yearlyFixedExpenses = activeFixedExpenses
      .filter((e) => e.frequency !== 'monthly')
      .reduce((s, e) => {
        if (e.frequency === 'yearly') return s + e.amount;
        if (e.frequency === 'half_yearly') return s + e.amount * 2;
        if (e.frequency === 'quarterly') return s + e.amount * 4;
        return s;
      }, 0);

    // Calculate upcoming non-monthly expenses by month
    const nonMonthlyExpenses = activeFixedExpenses.filter((e) => e.frequency !== 'monthly');
    const upcomingByMonth: Record<string, { total: number; expenses: { name: string; amount: number; isPaid: boolean }[] }> = {};

    for (const expense of nonMonthlyExpenses) {
      const upcoming = getUpcomingPaymentDates(expense, 12);
      for (const payment of upcoming) {
        if (!upcomingByMonth[payment.month]) {
          upcomingByMonth[payment.month] = { total: 0, expenses: [] };
        }
        upcomingByMonth[payment.month].expenses.push({
          name: payment.name,
          amount: payment.amount,
          isPaid: payment.isPaid,
        });
        if (!payment.isPaid) {
          upcomingByMonth[payment.month].total += payment.amount;
        }
      }
    }

    // Sort months and take next 6 months with payments
    // Filter out paid expenses from each month's expenses array
    const sortedMonths = Object.keys(upcomingByMonth).sort();
    const upcomingExpenses = sortedMonths
      .filter((m) => upcomingByMonth[m].total > 0)
      .slice(0, 6)
      .map((month) => ({
        month,
        total: upcomingByMonth[month].total,
        // Only include pending (unpaid) expenses
        expenses: upcomingByMonth[month].expenses.filter((e) => !e.isPaid),
      }));

    // Total monthly outflow = loan EMI + monthly fixed expenses
    const totalEmi = loanEmi + monthlyFixedExpenses;

    res.json({
      given: {
        total: givenLoans.length,
        active: activeGiven.length,
        totalPrincipal: givenLoans.reduce((s, l) => s + l.principalAmount, 0),
        outstanding: activeGiven.reduce((s, l) => s + l.outstandingAmount, 0),
      },
      taken: {
        total: takenLoans.length,
        active: activeTaken.length,
        totalPrincipal: takenLoans.reduce((s, l) => s + l.principalAmount, 0),
        outstanding: activeTaken.reduce((s, l) => s + l.outstandingAmount, 0),
        totalEmi: totalEmi,
        loanEmi: loanEmi,
        monthlyFixedExpenses: monthlyFixedExpenses,
      },
      homeLoans: homeLoanStats,
      fixedExpenses: {
        monthlyTotal: monthlyFixedExpenses,
        yearlyTotal: yearlyFixedExpenses,
        activeCount: activeFixedExpenses.length,
        upcomingByMonth: upcomingExpenses,
        monthlyExpensesList: monthlyExpensesList,
        takenLoansList: takenLoansList,
      },
      netPosition:
        activeGiven.reduce((s, l) => s + l.outstandingAmount, 0) -
        activeTaken.reduce((s, l) => s + l.outstandingAmount, 0),
    });
  } catch (error) {
    console.error('Error fetching loan summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// Get single loan with payments and disbursements
router.get('/:id', async (req, res) => {
  try {
    const loan = await db
      .select()
      .from(loans)
      .where(eq(loans.id, req.params.id))
      .limit(1);

    if (!loan[0]) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    const payments = await db
      .select()
      .from(loanPayments)
      .where(eq(loanPayments.loanId, req.params.id))
      .orderBy(desc(loanPayments.date));

    const disbursements = await db
      .select()
      .from(loanDisbursements)
      .where(eq(loanDisbursements.loanId, req.params.id))
      .orderBy(desc(loanDisbursements.date));

    // Calculate financial breakdown
    const financialSummary = {
      totalPrincipalPaid: loan[0].totalPrincipalPaid || payments.reduce((s, p) => s + (p.principalPaid || 0), 0),
      totalInterestPaid: loan[0].totalInterestPaid || payments.reduce((s, p) => s + (p.interestPaid || 0), 0),
      totalChargesPaid: loan[0].totalChargesPaid || payments.reduce((s, p) => s + (p.chargesPaid || 0), 0),
      totalDisbursed: loan[0].disbursedAmount || disbursements.reduce((s, d) => s + d.amount, 0),
      totalEmisPaid: payments.filter(p => p.transactionType === 'emi').length,
      preEmiInterestPaid: payments
        .filter(p => p.transactionType === 'pre_emi_interest')
        .reduce((s, p) => s + p.amount, 0),
    };

    res.json({
      ...loan[0],
      payments,
      disbursements,
      financialSummary,
    });
  } catch (error) {
    console.error('Error fetching loan:', error);
    res.status(500).json({ error: 'Failed to fetch loan' });
  }
});

// Create loan
router.post('/', async (req, res) => {
  try {
    const data = loanSchema.parse(req.body);
    const now = new Date().toISOString();

    const newLoan = {
      id: uuidv4(),
      ...data,
      status: 'active',
      outstandingAmount: data.principalAmount,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(loans).values(newLoan);
    res.status(201).json(newLoan);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating loan:', error);
    res.status(500).json({ error: 'Failed to create loan' });
  }
});

// Update loan
router.put('/:id', async (req, res) => {
  try {
    const data = loanSchema.partial().parse(req.body);
    const now = new Date().toISOString();

    await db
      .update(loans)
      .set({ ...data, updatedAt: now })
      .where(eq(loans.id, req.params.id));

    const updated = await db
      .select()
      .from(loans)
      .where(eq(loans.id, req.params.id))
      .limit(1);

    res.json(updated[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating loan:', error);
    res.status(500).json({ error: 'Failed to update loan' });
  }
});

// Add payment
router.post('/:id/payments', async (req, res) => {
  try {
    const data = paymentSchema.parse({ ...req.body, loanId: req.params.id });
    const now = new Date().toISOString();

    // Get current loan
    const loan = await db
      .select()
      .from(loans)
      .where(eq(loans.id, req.params.id))
      .limit(1);

    if (!loan[0]) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    // Calculate principal and interest if not provided
    const principalPaid = data.principalPaid ?? data.amount;
    const interestPaid = data.interestPaid ?? 0;

    const newPayment = {
      id: uuidv4(),
      loanId: data.loanId,
      date: data.date,
      transactionType: 'payment',
      amount: data.amount,
      principalPaid,
      interestPaid,
      chargesPaid: 0,
      notes: data.notes || null,
      createdAt: now,
    };

    await db.insert(loanPayments).values(newPayment);

    // Update outstanding amount
    const newOutstanding = Math.max(0, loan[0].outstandingAmount - principalPaid);
    const newStatus = newOutstanding <= 0 ? 'closed' : 'active';

    await db
      .update(loans)
      .set({
        outstandingAmount: newOutstanding,
        status: newStatus,
        updatedAt: now,
      })
      .where(eq(loans.id, req.params.id));

    res.status(201).json({
      payment: newPayment,
      newOutstanding,
      status: newStatus,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error adding payment:', error);
    res.status(500).json({ error: 'Failed to add payment' });
  }
});

// Delete payment
router.delete('/:id/payments/:paymentId', async (req, res) => {
  try {
    const { id: loanId, paymentId } = req.params;
    const now = new Date().toISOString();

    // Get payment
    const payment = await db
      .select()
      .from(loanPayments)
      .where(eq(loanPayments.id, paymentId))
      .limit(1);

    if (!payment[0]) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Get loan
    const loan = await db
      .select()
      .from(loans)
      .where(eq(loans.id, loanId))
      .limit(1);

    if (!loan[0]) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    // Delete payment
    await db.delete(loanPayments).where(eq(loanPayments.id, paymentId));

    // Update outstanding amount
    const principalPaid = payment[0].principalPaid || payment[0].amount;
    const newOutstanding = loan[0].outstandingAmount + principalPaid;

    await db
      .update(loans)
      .set({
        outstandingAmount: newOutstanding,
        status: 'active',
        updatedAt: now,
      })
      .where(eq(loans.id, loanId));

    res.json({ success: true, newOutstanding });
  } catch (error) {
    console.error('Error deleting payment:', error);
    res.status(500).json({ error: 'Failed to delete payment' });
  }
});

// Mark loan as paid for current month (sets lastPaidDate, does NOT change outstanding)
router.post('/:id/mark-paid', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    await db
      .update(loans)
      .set({ lastPaidDate: today, updatedAt: now })
      .where(eq(loans.id, req.params.id));

    const updated = await db
      .select()
      .from(loans)
      .where(eq(loans.id, req.params.id))
      .limit(1);

    res.json(updated[0]);
  } catch (error) {
    console.error('Error marking loan as paid:', error);
    res.status(500).json({ error: 'Failed to mark loan as paid' });
  }
});

// Mark loan as unpaid (clears lastPaidDate)
router.post('/:id/mark-unpaid', async (req, res) => {
  try {
    const now = new Date().toISOString();

    await db
      .update(loans)
      .set({ lastPaidDate: null, updatedAt: now })
      .where(eq(loans.id, req.params.id));

    const updated = await db
      .select()
      .from(loans)
      .where(eq(loans.id, req.params.id))
      .limit(1);

    res.json(updated[0]);
  } catch (error) {
    console.error('Error marking loan as unpaid:', error);
    res.status(500).json({ error: 'Failed to mark loan as unpaid' });
  }
});

// Close/reopen loan
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = z
      .object({
        status: z.enum(['active', 'closed', 'defaulted']),
      })
      .parse(req.body);

    const now = new Date().toISOString();

    await db
      .update(loans)
      .set({ status, updatedAt: now })
      .where(eq(loans.id, req.params.id));

    const updated = await db
      .select()
      .from(loans)
      .where(eq(loans.id, req.params.id))
      .limit(1);

    res.json(updated[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating loan status:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Delete loan
router.delete('/:id', async (req, res) => {
  try {
    // Delete payments first
    await db.delete(loanPayments).where(eq(loanPayments.loanId, req.params.id));
    // Delete disbursements
    await db.delete(loanDisbursements).where(eq(loanDisbursements.loanId, req.params.id));
    // Delete loan given details
    await db.delete(loanGivenDetails).where(eq(loanGivenDetails.loanId, req.params.id));
    // Delete loan
    await db.delete(loans).where(eq(loans.id, req.params.id));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting loan:', error);
    res.status(500).json({ error: 'Failed to delete loan' });
  }
});

// Upload home loan statement (Axis Bank)
router.post('/home-loan/upload', async (req, res) => {
  try {
    const { fileBuffer, existingLoanId } = req.body;

    if (!fileBuffer) {
      return res.status(400).json({ error: 'No file data provided' });
    }

    const buffer = Buffer.from(fileBuffer, 'base64');
    const data = await parseAxisHomeLoanStatement(buffer, existingLoanId);

    res.json({
      success: true,
      preview: {
        loan: data.loan,
        transactionCount: data.payments.length,
        disbursementCount: data.disbursements.length,
        summary: data.summary,
      },
    });
  } catch (error) {
    console.error('Error parsing home loan statement:', error);
    res.status(500).json({ error: 'Failed to parse statement' });
  }
});

// Import home loan data after preview confirmation
router.post('/home-loan/import', async (req, res) => {
  try {
    const { loan, payments, disbursements, merge, existingLoanId } = req.body as {
      loan: AxisHomeLoanData['loan'];
      payments: AxisHomeLoanData['payments'];
      disbursements: AxisHomeLoanData['disbursements'];
      merge?: boolean;
      existingLoanId?: string;
    };

    const now = new Date().toISOString();

    if (merge && existingLoanId) {
      // Merge with existing loan
      const existingLoan = await db
        .select()
        .from(loans)
        .where(eq(loans.id, existingLoanId))
        .limit(1);

      if (!existingLoan[0]) {
        return res.status(404).json({ error: 'Existing loan not found' });
      }

      // Get existing payments and disbursements
      const existingPayments = await db
        .select()
        .from(loanPayments)
        .where(eq(loanPayments.loanId, existingLoanId));

      const existingDisbursements = await db
        .select()
        .from(loanDisbursements)
        .where(eq(loanDisbursements.loanId, existingLoanId));

      // Deduplicate new payments
      const existingPaymentKeys = new Set(
        existingPayments.map(p => `${p.date}-${p.amount}-${p.transactionType}`)
      );
      const newPayments = payments.filter(
        p => !existingPaymentKeys.has(`${p.date}-${p.amount}-${p.transactionType}`)
      );

      // Deduplicate new disbursements
      const existingDisbursementKeys = new Set(
        existingDisbursements.map(d => `${d.date}-${d.amount}`)
      );
      const newDisbursements = disbursements.filter(
        d => !existingDisbursementKeys.has(`${d.date}-${d.amount}`)
      );

      // Insert new payments
      for (const payment of newPayments) {
        payment.loanId = existingLoanId;
        await db.insert(loanPayments).values(payment);
      }

      // Insert new disbursements
      for (const disbursement of newDisbursements) {
        disbursement.loanId = existingLoanId;
        await db.insert(loanDisbursements).values(disbursement);
      }

      // Update loan totals
      const allPayments = [...existingPayments, ...newPayments];
      const allDisbursements = [...existingDisbursements, ...newDisbursements];

      const totalPrincipalPaid = allPayments.reduce((s, p) => s + (p.principalPaid || 0), 0);
      const totalInterestPaid = allPayments.reduce((s, p) => s + (p.interestPaid || 0), 0);
      const totalChargesPaid = allPayments.reduce((s, p) => s + (p.chargesPaid || 0), 0);
      const totalDisbursed = allDisbursements.reduce((s, d) => s + d.amount, 0);

      await db
        .update(loans)
        .set({
          totalPrincipalPaid,
          totalInterestPaid,
          totalChargesPaid,
          disbursedAmount: totalDisbursed,
          outstandingAmount: totalDisbursed - totalPrincipalPaid,
          paidInstallments: allPayments.filter(p => p.transactionType === 'emi').length,
          updatedAt: now,
        })
        .where(eq(loans.id, existingLoanId));

      res.json({
        success: true,
        loanId: existingLoanId,
        newPayments: newPayments.length,
        newDisbursements: newDisbursements.length,
      });
    } else {
      // Create new loan - loan data comes from parser with all required fields
      await db.insert(loans).values(loan as typeof loans.$inferInsert);

      // Insert payments
      for (const payment of payments) {
        await db.insert(loanPayments).values(payment);
      }

      // Insert disbursements
      for (const disbursement of disbursements) {
        await db.insert(loanDisbursements).values(disbursement);
      }

      res.json({
        success: true,
        loanId: loan.id,
        payments: payments.length,
        disbursements: disbursements.length,
      });
    }
  } catch (error) {
    console.error('Error importing home loan data:', error);
    res.status(500).json({ error: 'Failed to import loan data' });
  }
});

// Get loan disbursements
router.get('/:id/disbursements', async (req, res) => {
  try {
    const disbursements = await db
      .select()
      .from(loanDisbursements)
      .where(eq(loanDisbursements.loanId, req.params.id))
      .orderBy(desc(loanDisbursements.date));

    res.json(disbursements);
  } catch (error) {
    console.error('Error fetching disbursements:', error);
    res.status(500).json({ error: 'Failed to fetch disbursements' });
  }
});

// Upload repayment schedule (Axis Bank)
router.post('/:id/schedule/upload', async (req, res) => {
  try {
    const { fileBuffer } = req.body;
    const loanId = req.params.id;

    if (!fileBuffer) {
      return res.status(400).json({ error: 'No file data provided' });
    }

    // Verify loan exists
    const loan = await db
      .select()
      .from(loans)
      .where(eq(loans.id, loanId))
      .limit(1);

    if (!loan[0]) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    const buffer = Buffer.from(fileBuffer, 'base64');
    const data = await parseAxisRepaymentSchedule(buffer, loanId);

    res.json({
      success: true,
      preview: {
        loanDetails: data.loanDetails,
        scheduleCount: data.schedule.length,
        summary: data.summary,
        sampleSchedule: data.schedule.slice(0, 5), // First 5 for preview
      },
    });
  } catch (error) {
    console.error('Error parsing repayment schedule:', error);
    res.status(500).json({ error: 'Failed to parse schedule' });
  }
});

// Import repayment schedule after preview confirmation
router.post('/:id/schedule/import', async (req, res) => {
  try {
    const { schedule, updateLoanDetails } = req.body;
    const loanId = req.params.id;
    const now = new Date().toISOString();

    // Clear existing schedule for this loan
    await db.delete(loanSchedule).where(eq(loanSchedule.loanId, loanId));

    // Insert new schedule
    for (const entry of schedule) {
      entry.loanId = loanId;
      await db.insert(loanSchedule).values(entry);
    }

    // Update loan details if provided
    if (updateLoanDetails) {
      await db
        .update(loans)
        .set({
          totalInstallments: schedule.length,
          maturityDate: schedule[schedule.length - 1]?.dueDate,
          emiAmount: schedule[Math.floor(schedule.length / 2)]?.installmentAmount,
          updatedAt: now,
        })
        .where(eq(loans.id, loanId));
    }

    res.json({
      success: true,
      imported: schedule.length,
    });
  } catch (error) {
    console.error('Error importing schedule:', error);
    res.status(500).json({ error: 'Failed to import schedule' });
  }
});

// Get repayment schedule for a loan
router.get('/:id/schedule', async (req, res) => {
  try {
    const { status, upcoming } = z
      .object({
        status: z.enum(['pending', 'paid', 'overdue', 'partial']).optional(),
        upcoming: z.string().optional(), // Number of months
      })
      .parse(req.query);

    let query = db
      .select()
      .from(loanSchedule)
      .where(eq(loanSchedule.loanId, req.params.id))
      .orderBy(loanSchedule.installmentNumber);

    let schedule = await query;

    // Filter by status if specified
    if (status) {
      schedule = schedule.filter(s => s.status === status);
    }

    // Filter for upcoming months if specified
    if (upcoming) {
      const months = parseInt(upcoming, 10);
      const today = new Date();
      const futureDate = new Date();
      futureDate.setMonth(futureDate.getMonth() + months);

      const todayStr = today.toISOString().split('T')[0];
      const futureDateStr = futureDate.toISOString().split('T')[0];

      schedule = schedule.filter(
        s => s.dueDate >= todayStr && s.dueDate <= futureDateStr
      );
    }

    // Calculate progress
    const allSchedule = await db
      .select()
      .from(loanSchedule)
      .where(eq(loanSchedule.loanId, req.params.id));

    const progress = calculateLoanProgress(allSchedule);

    res.json({
      schedule,
      progress,
    });
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

// Sync schedule with actual payments
router.post('/:id/schedule/sync', async (req, res) => {
  try {
    const loanId = req.params.id;
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    // Get schedule and payments
    const schedule = await db
      .select()
      .from(loanSchedule)
      .where(eq(loanSchedule.loanId, loanId))
      .orderBy(loanSchedule.installmentNumber);

    const payments = await db
      .select()
      .from(loanPayments)
      .where(eq(loanPayments.loanId, loanId))
      .orderBy(loanPayments.date);

    // Get EMI payments
    const emiPayments = payments.filter(p => p.transactionType === 'emi');
    let paymentIndex = 0;
    let updatedCount = 0;

    for (const installment of schedule) {
      let newStatus = installment.status;
      let actualPaymentDate = installment.actualPaymentDate;
      let actualAmountPaid = installment.actualAmountPaid;

      if (installment.dueDate <= today && installment.status !== 'paid') {
        // Check for matching payment
        if (paymentIndex < emiPayments.length) {
          const payment = emiPayments[paymentIndex];
          const dueDate = new Date(installment.dueDate);
          const paymentDate = new Date(payment.date);

          // Allow flexibility in matching (within 20 days)
          const daysDiff = Math.abs(
            (paymentDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
          );

          if (daysDiff <= 20) {
            newStatus = 'paid';
            actualPaymentDate = payment.date;
            actualAmountPaid = payment.amount;
            paymentIndex++;
          } else {
            newStatus = 'overdue';
          }
        } else {
          newStatus = 'overdue';
        }

        if (newStatus !== installment.status) {
          await db
            .update(loanSchedule)
            .set({
              status: newStatus,
              actualPaymentDate,
              actualAmountPaid,
            })
            .where(eq(loanSchedule.id, installment.id));
          updatedCount++;
        }
      }
    }

    res.json({
      success: true,
      updated: updatedCount,
    });
  } catch (error) {
    console.error('Error syncing schedule:', error);
    res.status(500).json({ error: 'Failed to sync schedule' });
  }
});

// Get next EMI details
router.get('/:id/next-emi', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const nextEmi = await db
      .select()
      .from(loanSchedule)
      .where(
        and(
          eq(loanSchedule.loanId, req.params.id),
          eq(loanSchedule.status, 'pending'),
          gte(loanSchedule.dueDate, today)
        )
      )
      .orderBy(loanSchedule.dueDate)
      .limit(1);

    if (!nextEmi[0]) {
      return res.json({ nextEmi: null, message: 'No pending EMIs' });
    }

    res.json({ nextEmi: nextEmi[0] });
  } catch (error) {
    console.error('Error fetching next EMI:', error);
    res.status(500).json({ error: 'Failed to fetch next EMI' });
  }
});

// Get overdue EMIs
router.get('/:id/overdue', async (req, res) => {
  try {
    const overdueEmis = await db
      .select()
      .from(loanSchedule)
      .where(
        and(
          eq(loanSchedule.loanId, req.params.id),
          eq(loanSchedule.status, 'overdue')
        )
      )
      .orderBy(loanSchedule.dueDate);

    const totalOverdue = overdueEmis.reduce(
      (sum, e) => sum + e.installmentAmount,
      0
    );

    res.json({
      overdueEmis,
      count: overdueEmis.length,
      totalOverdue,
    });
  } catch (error) {
    console.error('Error fetching overdue EMIs:', error);
    res.status(500).json({ error: 'Failed to fetch overdue EMIs' });
  }
});

// ============ Exchange Rate API ============

// Get current USD to INR exchange rate
router.get('/exchange-rate/usd-inr', async (_req, res) => {
  try {
    const rate = await fetchUsdToInrRate();
    res.json({
      from: 'USD',
      to: 'INR',
      rate,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching exchange rate:', error);
    res.status(500).json({ error: 'Failed to fetch exchange rate' });
  }
});

// ============ Loan Given Details API ============

// Get all details for a loan (with totals) - also syncs loan totals with currency conversion
router.get('/:id/given-details', async (req, res) => {
  try {
    const loanId = req.params.id;
    const details = await db
      .select()
      .from(loanGivenDetails)
      .where(eq(loanGivenDetails.loanId, loanId))
      .orderBy(desc(loanGivenDetails.date));

    // Calculate totals with currency conversion
    const totals = await calculateGivenDetailsTotals(details);

    // Also update the loan record to keep it in sync
    const now = new Date().toISOString();
    await db
      .update(loans)
      .set({
        principalAmount: totals.totalToGet,
        outstandingAmount: totals.netOutstanding > 0 ? totals.netOutstanding : 0,
        status: totals.netOutstanding <= 0 ? 'closed' : 'active',
        updatedAt: now,
      })
      .where(eq(loans.id, loanId));

    res.json({
      details,
      summary: {
        totalToGet: totals.totalToGet,
        totalToGive: totals.totalToGive,
        netAmount: totals.netOutstanding,
        count: details.length,
        exchangeRate: totals.exchangeRate,
      },
    });
  } catch (error) {
    console.error('Error fetching loan given details:', error);
    res.status(500).json({ error: 'Failed to fetch details' });
  }
});

// Helper function to calculate totals with currency conversion
async function calculateGivenDetailsTotals(details: any[]) {
  const exchangeRate = await fetchUsdToInrRate();

  let totalToGetINR = 0;
  let totalToGiveINR = 0;

  for (const d of details) {
    const currency = d.currency || 'INR';
    const toGet = d.toGet || 0;
    const toGive = d.toGive || 0;

    if (currency === 'USD') {
      totalToGetINR += toGet * exchangeRate;
      totalToGiveINR += toGive * exchangeRate;
    } else {
      totalToGetINR += toGet;
      totalToGiveINR += toGive;
    }
  }

  return {
    totalToGet: totalToGetINR,
    totalToGive: totalToGiveINR,
    netOutstanding: totalToGetINR - totalToGiveINR,
    exchangeRate,
  };
}

// Add a new detail entry
router.post('/:id/given-details', async (req, res) => {
  try {
    const data = loanGivenDetailSchema.parse(req.body);
    const now = new Date().toISOString();
    const loanId = req.params.id;

    // Verify loan exists and is type 'given'
    const loan = await db
      .select()
      .from(loans)
      .where(eq(loans.id, loanId))
      .limit(1);

    if (!loan[0]) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    const newDetail = {
      id: uuidv4(),
      loanId,
      particular: data.particular,
      toGet: data.toGet || 0,
      toGive: data.toGive || 0,
      currency: data.currency || 'INR',
      details: data.details || null,
      date: data.date,
      notes: data.notes || null,
      createdAt: now,
    };

    await db.insert(loanGivenDetails).values(newDetail);

    // Recalculate loan outstanding based on all details (with currency conversion)
    const allDetails = await db
      .select()
      .from(loanGivenDetails)
      .where(eq(loanGivenDetails.loanId, loanId));

    const totals = await calculateGivenDetailsTotals(allDetails);

    // Update loan principal and outstanding amounts (for 'given' type loans)
    // Store INR-converted totals
    await db
      .update(loans)
      .set({
        principalAmount: totals.totalToGet,
        outstandingAmount: totals.netOutstanding > 0 ? totals.netOutstanding : 0,
        status: totals.netOutstanding <= 0 ? 'closed' : 'active',
        updatedAt: now,
      })
      .where(eq(loans.id, loanId));

    res.status(201).json({
      detail: newDetail,
      summary: {
        totalToGet: totals.totalToGet,
        totalToGive: totals.totalToGive,
        netOutstanding: totals.netOutstanding,
        exchangeRate: totals.exchangeRate,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error adding loan given detail:', error);
    res.status(500).json({ error: 'Failed to add detail' });
  }
});

// Update a detail entry
router.put('/:id/given-details/:detailId', async (req, res) => {
  try {
    const data = loanGivenDetailSchema.partial().parse(req.body);
    const { id: loanId, detailId } = req.params;
    const now = new Date().toISOString();

    await db
      .update(loanGivenDetails)
      .set(data)
      .where(eq(loanGivenDetails.id, detailId));

    // Recalculate loan outstanding (with currency conversion)
    const allDetails = await db
      .select()
      .from(loanGivenDetails)
      .where(eq(loanGivenDetails.loanId, loanId));

    const totals = await calculateGivenDetailsTotals(allDetails);

    await db
      .update(loans)
      .set({
        principalAmount: totals.totalToGet,
        outstandingAmount: totals.netOutstanding > 0 ? totals.netOutstanding : 0,
        status: totals.netOutstanding <= 0 ? 'closed' : 'active',
        updatedAt: now,
      })
      .where(eq(loans.id, loanId));

    const updated = await db
      .select()
      .from(loanGivenDetails)
      .where(eq(loanGivenDetails.id, detailId))
      .limit(1);

    res.json({
      detail: updated[0],
      summary: {
        totalToGet: totals.totalToGet,
        totalToGive: totals.totalToGive,
        netOutstanding: totals.netOutstanding,
        exchangeRate: totals.exchangeRate,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating loan given detail:', error);
    res.status(500).json({ error: 'Failed to update detail' });
  }
});

// Delete a detail entry
router.delete('/:id/given-details/:detailId', async (req, res) => {
  try {
    const { id: loanId, detailId } = req.params;
    const now = new Date().toISOString();

    await db.delete(loanGivenDetails).where(eq(loanGivenDetails.id, detailId));

    // Recalculate loan outstanding (with currency conversion)
    const allDetails = await db
      .select()
      .from(loanGivenDetails)
      .where(eq(loanGivenDetails.loanId, loanId));

    const totals = await calculateGivenDetailsTotals(allDetails);

    await db
      .update(loans)
      .set({
        principalAmount: totals.totalToGet,
        outstandingAmount: totals.netOutstanding > 0 ? totals.netOutstanding : 0,
        status: totals.netOutstanding <= 0 ? 'closed' : 'active',
        updatedAt: now,
      })
      .where(eq(loans.id, loanId));

    res.json({
      success: true,
      summary: {
        totalToGet: totals.totalToGet,
        totalToGive: totals.totalToGive,
        netOutstanding: totals.netOutstanding,
        exchangeRate: totals.exchangeRate,
      },
    });
  } catch (error) {
    console.error('Error deleting loan given detail:', error);
    res.status(500).json({ error: 'Failed to delete detail' });
  }
});

export default router;

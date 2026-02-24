import { Router } from 'express';
import { z } from 'zod';
import { db, fixedExpenses, loans, loanSchedule, policies, recurringIncome } from '../db/index.js';
import { eq, and } from 'drizzle-orm';

const router = Router();

interface CalendarEvent {
  date: string;
  name: string;
  amount: number;
  type: 'expense' | 'emi' | 'premium' | 'income';
  category: string;
  sourceType: 'fixed_expense' | 'loan' | 'policy' | 'recurring_income';
  sourceId: string;
}

/**
 * Expand a recurring item into specific month occurrences for a given year.
 * Returns array of month numbers (1-12) when the event occurs.
 */
function expandFrequency(
  frequency: string,
  year: number,
  dueMonth?: number | null,
  startDate?: string | null,
  endDate?: string | null,
  referenceDate?: string | null,
): number[] {
  const months: number[] = [];

  // Parse active period boundaries
  const periodStart = startDate ? new Date(startDate) : null;
  const periodEnd = endDate ? new Date(endDate) : null;
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  // Skip entirely if outside active period
  if (periodStart && periodStart > yearEnd) return [];
  if (periodEnd && periodEnd < yearStart) return [];

  // Determine which months fall in the given year based on frequency
  switch (frequency) {
    case 'monthly': {
      for (let m = 1; m <= 12; m++) {
        months.push(m);
      }
      break;
    }
    case 'quarterly': {
      // Use referenceDate or startDate to determine quarter alignment
      const ref = referenceDate || startDate;
      const refMonth = ref ? new Date(ref).getMonth() + 1 : 1; // 1-indexed
      const startM = ((refMonth - 1) % 3) + 1; // first occurrence in quarter cycle
      for (let m = startM; m <= 12; m += 3) {
        months.push(m);
      }
      break;
    }
    case 'half_yearly': {
      const ref = referenceDate || startDate;
      const refMonth = ref ? new Date(ref).getMonth() + 1 : 1;
      const startM = ((refMonth - 1) % 6) + 1;
      for (let m = startM; m <= 12; m += 6) {
        months.push(m);
      }
      break;
    }
    case 'yearly': {
      const m = dueMonth || (referenceDate ? new Date(referenceDate).getMonth() + 1 : 1);
      months.push(m);
      break;
    }
    default:
      break;
  }

  // Filter months by active period
  return months.filter((m) => {
    const eventDate = new Date(year, m - 1, 1);
    if (periodStart && eventDate < new Date(periodStart.getFullYear(), periodStart.getMonth(), 1)) return false;
    if (periodEnd && eventDate > new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1)) return false;
    return true;
  });
}

/**
 * GET /api/calendar/events?year=2026
 * Aggregates all financial obligations for a given year.
 */
router.get('/events', async (req, res) => {
  try {
    const { year } = z
      .object({
        year: z.coerce.number().int().min(2000).max(2100),
      })
      .parse(req.query);

    const userId = req.userId!;
    const events: CalendarEvent[] = [];

    // 1. Fixed Expenses
    const allFixedExpenses = await db
      .select()
      .from(fixedExpenses)
      .where(and(eq(fixedExpenses.userId, userId), eq(fixedExpenses.status, 'active')));

    for (const exp of allFixedExpenses) {
      const months = expandFrequency(
        exp.frequency,
        year,
        exp.dueMonth,
        exp.startDate,
        exp.endDate,
      );

      for (const month of months) {
        const day = exp.dueDay || 1;
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        events.push({
          date: dateStr,
          name: exp.name,
          amount: exp.amount,
          type: 'expense',
          category: exp.category,
          sourceType: 'fixed_expense',
          sourceId: exp.id,
        });
      }
    }

    // 2. Loans (EMIs) — prefer loanSchedule if available
    const activeLoans = await db
      .select()
      .from(loans)
      .where(and(eq(loans.userId, userId), eq(loans.status, 'active')));

    for (const loan of activeLoans) {
      // Only include loans with EMIs (taken loans, home loans, etc.)
      if (!loan.emiAmount || loan.type === 'given') continue;

      // Try loanSchedule first
      const schedule = await db
        .select()
        .from(loanSchedule)
        .where(eq(loanSchedule.loanId, loan.id));

      if (schedule.length > 0) {
        // Use schedule rows that fall in the requested year
        for (const row of schedule) {
          const dueDate = new Date(row.dueDate);
          if (dueDate.getFullYear() === year) {
            events.push({
              date: row.dueDate,
              name: `${loan.partyName} EMI`,
              amount: row.installmentAmount,
              type: 'emi',
              category: loan.loanType || loan.type,
              sourceType: 'loan',
              sourceId: loan.id,
            });
          }
        }
      } else {
        // Generate monthly from emiStartDate to maturityDate
        const emiStart = loan.emiStartDate || loan.startDate;
        const emiEnd = loan.maturityDate;
        const emiDay = emiStart ? new Date(emiStart).getDate() : (loan.dueDate ? new Date(loan.dueDate).getDate() : 1);

        for (let m = 1; m <= 12; m++) {
          const eventDate = new Date(year, m - 1, emiDay);
          if (emiStart && eventDate < new Date(emiStart)) continue;
          if (emiEnd && eventDate > new Date(emiEnd)) continue;

          const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(emiDay).padStart(2, '0')}`;
          events.push({
            date: dateStr,
            name: `${loan.partyName} EMI`,
            amount: loan.emiAmount,
            type: 'emi',
            category: loan.loanType || loan.type,
            sourceType: 'loan',
            sourceId: loan.id,
          });
        }
      }
    }

    // 3. Insurance Policies — premiums
    const activePolicies = await db
      .select()
      .from(policies)
      .where(and(eq(policies.userId, userId), eq(policies.status, 'active')));

    for (const policy of activePolicies) {
      if (!policy.premiumAmount || !policy.premiumFrequency || policy.premiumFrequency === 'one_time') continue;

      const months = expandFrequency(
        policy.premiumFrequency,
        year,
        null,
        policy.startDate,
        policy.endDate,
        policy.nextPremiumDate,
      );

      for (const month of months) {
        // Use the day from nextPremiumDate if available, else 1
        const day = policy.nextPremiumDate ? new Date(policy.nextPremiumDate).getDate() : 1;
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        events.push({
          date: dateStr,
          name: policy.name,
          amount: policy.premiumAmount,
          type: 'premium',
          category: policy.type,
          sourceType: 'policy',
          sourceId: policy.id,
        });
      }
    }

    // 4. Recurring Income
    const activeIncome = await db
      .select()
      .from(recurringIncome)
      .where(and(eq(recurringIncome.userId, userId), eq(recurringIncome.status, 'active')));

    for (const income of activeIncome) {
      const months = expandFrequency(
        income.frequency,
        year,
        income.expectedMonth,
        income.startDate,
        income.endDate,
      );

      for (const month of months) {
        const day = income.expectedDay || 1;
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        events.push({
          date: dateStr,
          name: income.name,
          amount: income.amount,
          type: 'income',
          category: income.category,
          sourceType: 'recurring_income',
          sourceId: income.id,
        });
      }
    }

    // Calculate monthly totals
    const monthlyTotals: Record<string, { expenses: number; income: number }> = {};
    for (let m = 1; m <= 12; m++) {
      monthlyTotals[String(m)] = { expenses: 0, income: 0 };
    }

    for (const event of events) {
      const month = String(parseInt(event.date.split('-')[1], 10));
      if (event.type === 'income') {
        monthlyTotals[month].income += event.amount;
      } else {
        monthlyTotals[month].expenses += event.amount;
      }
    }

    res.json({ year, events, monthlyTotals });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

export default router;

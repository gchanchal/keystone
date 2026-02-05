import { db } from '../db/index.js';
import { bankTransactions, vyaparTransactions, categories, accounts } from '../db/index.js';
import { eq, and, between, sql, gte, lte, desc } from 'drizzle-orm';
import { format, startOfMonth, endOfMonth, parseISO, subMonths, addDays, addMonths } from 'date-fns';

export interface DashboardStats {
  totalBalance: number;
  monthlyIncome: number;
  monthlyExpense: number;
  netProfit: number;
  unreconciledCount: number;
}

export interface CashFlowData {
  month: string;
  income: number;
  expense: number;
}

export interface ExpenseBreakdown {
  category: string;
  amount: number;
  percentage: number;
  color: string;
}

export interface MonthlyPL {
  month: string;
  revenue: number;
  expenses: number;
  netProfit: number;
  items: Array<{
    category: string;
    type: 'income' | 'expense';
    amount: number;
  }>;
}

export async function getDashboardStats(month?: string, userId?: string): Promise<DashboardStats> {
  const now = month ? parseISO(month + '-01') : new Date();
  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd');

  // Get total balance from all accounts
  const accountsData = await db.select().from(accounts).where(
    userId
      ? and(eq(accounts.isActive, true), eq(accounts.userId, userId))
      : eq(accounts.isActive, true)
  );
  const totalBalance = accountsData.reduce((sum, acc) => sum + (acc.currentBalance || 0), 0);

  // Get monthly transactions
  const monthlyTxns = await db
    .select()
    .from(bankTransactions)
    .where(
      userId
        ? and(between(bankTransactions.date, monthStart, monthEnd), eq(bankTransactions.userId, userId))
        : between(bankTransactions.date, monthStart, monthEnd)
    );

  const monthlyIncome = monthlyTxns
    .filter(t => t.transactionType === 'credit')
    .reduce((sum, t) => sum + t.amount, 0);

  const monthlyExpense = monthlyTxns
    .filter(t => t.transactionType === 'debit')
    .reduce((sum, t) => sum + t.amount, 0);

  // Get unreconciled count
  const unreconciledBank = await db
    .select({ count: sql<number>`count(*)` })
    .from(bankTransactions)
    .where(
      userId
        ? and(eq(bankTransactions.isReconciled, false), eq(bankTransactions.userId, userId))
        : eq(bankTransactions.isReconciled, false)
    );

  const unreconciledVyapar = await db
    .select({ count: sql<number>`count(*)` })
    .from(vyaparTransactions)
    .where(
      userId
        ? and(eq(vyaparTransactions.isReconciled, false), eq(vyaparTransactions.userId, userId))
        : eq(vyaparTransactions.isReconciled, false)
    );

  const unreconciledCount =
    (unreconciledBank[0]?.count || 0) + (unreconciledVyapar[0]?.count || 0);

  return {
    totalBalance,
    monthlyIncome,
    monthlyExpense,
    netProfit: monthlyIncome - monthlyExpense,
    unreconciledCount,
  };
}

export async function getCashFlowData(months = 6, userId?: string): Promise<CashFlowData[]> {
  const result: CashFlowData[] = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const date = subMonths(now, i);
    const monthStart = format(startOfMonth(date), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(date), 'yyyy-MM-dd');
    const monthLabel = format(date, 'MMM yyyy');

    const txns = await db
      .select()
      .from(bankTransactions)
      .where(
        userId
          ? and(between(bankTransactions.date, monthStart, monthEnd), eq(bankTransactions.userId, userId))
          : between(bankTransactions.date, monthStart, monthEnd)
      );

    const income = txns
      .filter(t => t.transactionType === 'credit')
      .reduce((sum, t) => sum + t.amount, 0);

    const expense = txns
      .filter(t => t.transactionType === 'debit')
      .reduce((sum, t) => sum + t.amount, 0);

    result.push({ month: monthLabel, income, expense });
  }

  return result;
}

export async function getExpenseBreakdown(startDate: string, endDate: string, userId?: string): Promise<ExpenseBreakdown[]> {
  const txns = await db
    .select({
      amount: bankTransactions.amount,
      categoryId: bankTransactions.categoryId,
    })
    .from(bankTransactions)
    .where(
      userId
        ? and(
            eq(bankTransactions.transactionType, 'debit'),
            between(bankTransactions.date, startDate, endDate),
            eq(bankTransactions.userId, userId)
          )
        : and(
            eq(bankTransactions.transactionType, 'debit'),
            between(bankTransactions.date, startDate, endDate)
          )
    );

  const allCategories = await db.select().from(categories);
  const categoryMap = new Map(allCategories.map(c => [c.id, c]));

  // Group by category
  const categoryTotals = new Map<string, number>();
  let uncategorized = 0;

  for (const txn of txns) {
    if (txn.categoryId) {
      const current = categoryTotals.get(txn.categoryId) || 0;
      categoryTotals.set(txn.categoryId, current + txn.amount);
    } else {
      uncategorized += txn.amount;
    }
  }

  const totalExpense = txns.reduce((sum, t) => sum + t.amount, 0);

  const result: ExpenseBreakdown[] = [];

  for (const [categoryId, amount] of categoryTotals) {
    const category = categoryMap.get(categoryId);
    if (category) {
      result.push({
        category: category.name,
        amount,
        percentage: totalExpense > 0 ? (amount / totalExpense) * 100 : 0,
        color: category.color || '#6b7280',
      });
    }
  }

  if (uncategorized > 0) {
    result.push({
      category: 'Uncategorized',
      amount: uncategorized,
      percentage: totalExpense > 0 ? (uncategorized / totalExpense) * 100 : 0,
      color: '#9ca3af',
    });
  }

  // Sort by amount descending
  result.sort((a, b) => b.amount - a.amount);

  return result;
}

export async function getRecentTransactions(limit = 10, userId?: string) {
  if (userId) {
    return db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.userId, userId))
      .orderBy(desc(bankTransactions.date), desc(bankTransactions.createdAt))
      .limit(limit);
  }
  return db
    .select()
    .from(bankTransactions)
    .orderBy(desc(bankTransactions.date), desc(bankTransactions.createdAt))
    .limit(limit);
}

export async function getMonthlyPL(month: string, userId?: string): Promise<MonthlyPL> {
  const date = parseISO(month + '-01');
  const monthStart = format(startOfMonth(date), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(date), 'yyyy-MM-dd');
  const monthLabel = format(date, 'MMMM yyyy');

  const txns = await db
    .select()
    .from(bankTransactions)
    .where(
      userId
        ? and(between(bankTransactions.date, monthStart, monthEnd), eq(bankTransactions.userId, userId))
        : between(bankTransactions.date, monthStart, monthEnd)
    );

  const allCategories = await db.select().from(categories);
  const categoryMap = new Map(allCategories.map(c => [c.id, c]));

  // Group by category
  const incomeByCategory = new Map<string, number>();
  const expenseByCategory = new Map<string, number>();

  for (const txn of txns) {
    const categoryId = txn.categoryId || 'uncategorized';
    if (txn.transactionType === 'credit') {
      const current = incomeByCategory.get(categoryId) || 0;
      incomeByCategory.set(categoryId, current + txn.amount);
    } else {
      const current = expenseByCategory.get(categoryId) || 0;
      expenseByCategory.set(categoryId, current + txn.amount);
    }
  }

  const items: MonthlyPL['items'] = [];

  for (const [categoryId, amount] of incomeByCategory) {
    const category = categoryMap.get(categoryId);
    items.push({
      category: category?.name || 'Uncategorized',
      type: 'income',
      amount,
    });
  }

  for (const [categoryId, amount] of expenseByCategory) {
    const category = categoryMap.get(categoryId);
    items.push({
      category: category?.name || 'Uncategorized',
      type: 'expense',
      amount,
    });
  }

  const revenue = txns
    .filter(t => t.transactionType === 'credit')
    .reduce((sum, t) => sum + t.amount, 0);

  const expenses = txns
    .filter(t => t.transactionType === 'debit')
    .reduce((sum, t) => sum + t.amount, 0);

  return {
    month: monthLabel,
    revenue,
    expenses,
    netProfit: revenue - expenses,
    items,
  };
}

// Get transaction trends with configurable granularity (daily, weekly, monthly)
export async function getTransactionTrends(
  startDate: string,
  endDate: string,
  granularity: 'daily' | 'weekly' | 'monthly' = 'daily',
  userId?: string
) {
  const txns = await db
    .select()
    .from(bankTransactions)
    .where(
      userId
        ? and(between(bankTransactions.date, startDate, endDate), eq(bankTransactions.userId, userId))
        : between(bankTransactions.date, startDate, endDate)
    );

  // Group transactions by date
  const dateGroups = new Map<string, { income: number; expense: number; count: number }>();

  for (const txn of txns) {
    let groupKey: string;
    const txnDate = parseISO(txn.date);

    if (granularity === 'daily') {
      groupKey = txn.date;
    } else if (granularity === 'weekly') {
      // Get start of week (Monday)
      const day = txnDate.getDay();
      const diff = txnDate.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(txnDate);
      weekStart.setDate(diff);
      groupKey = format(weekStart, 'yyyy-MM-dd');
    } else {
      // Monthly
      groupKey = format(txnDate, 'yyyy-MM');
    }

    const current = dateGroups.get(groupKey) || { income: 0, expense: 0, count: 0 };
    if (txn.transactionType === 'credit') {
      current.income += txn.amount;
    } else {
      current.expense += txn.amount;
    }
    current.count++;
    dateGroups.set(groupKey, current);
  }

  // Convert to sorted array
  const result = Array.from(dateGroups.entries())
    .map(([date, data]) => ({
      date,
      label: granularity === 'monthly'
        ? format(parseISO(date + '-01'), 'MMM yyyy')
        : granularity === 'weekly'
        ? `Week of ${format(parseISO(date), 'MMM d')}`
        : format(parseISO(date), 'MMM d'),
      ...data,
      net: data.income - data.expense,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return result;
}

// Get category trends over time
export async function getCategoryTrends(
  startDate: string,
  endDate: string,
  granularity: 'daily' | 'weekly' | 'monthly' = 'monthly',
  type: 'expense' | 'income' | 'all' = 'expense',
  userId?: string
) {
  const whereConditions = [between(bankTransactions.date, startDate, endDate)];
  if (type !== 'all') {
    whereConditions.push(eq(bankTransactions.transactionType, type === 'expense' ? 'debit' : 'credit'));
  }
  if (userId) {
    whereConditions.push(eq(bankTransactions.userId, userId));
  }

  const txns = await db
    .select()
    .from(bankTransactions)
    .where(and(...whereConditions));

  const allCategories = await db.select().from(categories);
  const categoryMap = new Map(allCategories.map(c => [c.id, c]));

  // Group by period and category
  const periodCategoryGroups = new Map<string, Map<string, number>>();

  for (const txn of txns) {
    let periodKey: string;
    const txnDate = parseISO(txn.date);

    if (granularity === 'daily') {
      periodKey = txn.date;
    } else if (granularity === 'weekly') {
      const day = txnDate.getDay();
      const diff = txnDate.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(txnDate);
      weekStart.setDate(diff);
      periodKey = format(weekStart, 'yyyy-MM-dd');
    } else {
      periodKey = format(txnDate, 'yyyy-MM');
    }

    const categoryName = txn.categoryId
      ? (categoryMap.get(txn.categoryId)?.name || 'Unknown')
      : 'Uncategorized';

    if (!periodCategoryGroups.has(periodKey)) {
      periodCategoryGroups.set(periodKey, new Map());
    }
    const categoryGroup = periodCategoryGroups.get(periodKey)!;
    categoryGroup.set(categoryName, (categoryGroup.get(categoryName) || 0) + txn.amount);
  }

  // Get all unique categories
  const allCategoryNames = new Set<string>();
  for (const categoryGroup of periodCategoryGroups.values()) {
    for (const name of categoryGroup.keys()) {
      allCategoryNames.add(name);
    }
  }

  // Convert to array format suitable for stacked charts
  const result = Array.from(periodCategoryGroups.entries())
    .map(([period, categoryGroup]) => {
      const entry: Record<string, any> = {
        period,
        label: granularity === 'monthly'
          ? format(parseISO(period + '-01'), 'MMM yyyy')
          : granularity === 'weekly'
          ? `Week of ${format(parseISO(period), 'MMM d')}`
          : format(parseISO(period), 'MMM d'),
      };
      for (const catName of allCategoryNames) {
        entry[catName] = categoryGroup.get(catName) || 0;
      }
      return entry;
    })
    .sort((a, b) => a.period.localeCompare(b.period));

  return {
    data: result,
    categories: Array.from(allCategoryNames),
  };
}

// Get Vyapar transaction summary
export async function getVyaparSummary(startDate: string, endDate: string, userId?: string) {
  const txns = await db
    .select()
    .from(vyaparTransactions)
    .where(
      userId
        ? and(between(vyaparTransactions.date, startDate, endDate), eq(vyaparTransactions.userId, userId))
        : between(vyaparTransactions.date, startDate, endDate)
    );

  const summary = {
    // Income from Sales (payment received)
    sales: 0,
    salesCount: 0,
    salesReconciled: 0,
    salesReconciledCount: 0,
    salesUnreconciled: 0,
    salesUnreconciledCount: 0,

    // Pending (Sale Orders)
    saleOrders: 0,
    saleOrdersCount: 0,

    // Other inflows
    paymentIn: 0,
    paymentInCount: 0,

    // Expenses (only Expense type for P&L)
    expenses: 0,
    expensesCount: 0,
    expensesReconciled: 0,
    expensesReconciledCount: 0,
    expensesUnreconciled: 0,
    expensesUnreconciledCount: 0,

    // Other outflows
    purchases: 0,
    purchasesCount: 0,
    paymentOut: 0,
    paymentOutCount: 0,

    // Totals
    totalInflow: 0,     // Sales + Payment-In (actual money received)
    totalOutflow: 0,    // Purchases + Payment-Out + Expenses
    totalPending: 0,    // Sale Orders (pending payments)
  };

  for (const txn of txns) {
    switch (txn.transactionType) {
      case 'Sale':
        summary.sales += txn.amount;
        summary.salesCount++;
        summary.totalInflow += txn.amount;
        if (txn.isReconciled) {
          summary.salesReconciled += txn.amount;
          summary.salesReconciledCount++;
        } else {
          summary.salesUnreconciled += txn.amount;
          summary.salesUnreconciledCount++;
        }
        break;
      case 'Sale Order':
        summary.saleOrders += txn.amount;
        summary.saleOrdersCount++;
        summary.totalPending += txn.amount;
        break;
      case 'Payment-In':
        summary.paymentIn += txn.amount;
        summary.paymentInCount++;
        summary.totalInflow += txn.amount;
        break;
      case 'Purchase':
        summary.purchases += txn.amount;
        summary.purchasesCount++;
        summary.totalOutflow += txn.amount;
        break;
      case 'Payment-Out':
        summary.paymentOut += txn.amount;
        summary.paymentOutCount++;
        summary.totalOutflow += txn.amount;
        break;
      case 'Expense':
        summary.expenses += txn.amount;
        summary.expensesCount++;
        summary.totalOutflow += txn.amount;
        if (txn.isReconciled) {
          summary.expensesReconciled += txn.amount;
          summary.expensesReconciledCount++;
        } else {
          summary.expensesUnreconciled += txn.amount;
          summary.expensesUnreconciledCount++;
        }
        break;
    }
  }

  return summary;
}

// Get Vyapar transaction trends (for GearUp Mods dashboard)
export async function getVyaparTrends(
  startDate: string,
  endDate: string,
  granularity: 'daily' | 'weekly' | 'monthly' = 'daily',
  userId?: string
) {
  const txns = await db
    .select()
    .from(vyaparTransactions)
    .where(
      userId
        ? and(between(vyaparTransactions.date, startDate, endDate), eq(vyaparTransactions.userId, userId))
        : between(vyaparTransactions.date, startDate, endDate)
    );

  // Filter only Sale, Sale Order, and Expense
  const filteredTxns = txns.filter(t =>
    ['Sale', 'Sale Order', 'Expense'].includes(t.transactionType)
  );

  // Initialize all dates/periods in the range with zero values
  const dateGroups = new Map<string, { sale: number; saleOrder: number; expense: number; count: number }>();

  // Pre-fill all dates in range based on granularity
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  let current = start;

  while (current <= end) {
    let groupKey: string;
    if (granularity === 'daily') {
      groupKey = format(current, 'yyyy-MM-dd');
      current = addDays(current, 1);
    } else if (granularity === 'weekly') {
      const day = current.getDay();
      const diff = current.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(current);
      weekStart.setDate(diff);
      groupKey = format(weekStart, 'yyyy-MM-dd');
      current = addDays(current, 7);
    } else {
      groupKey = format(current, 'yyyy-MM');
      current = addMonths(current, 1);
    }
    if (!dateGroups.has(groupKey)) {
      dateGroups.set(groupKey, { sale: 0, saleOrder: 0, expense: 0, count: 0 });
    }
  }

  // Add transaction data
  for (const txn of filteredTxns) {
    let groupKey: string;
    const txnDate = parseISO(txn.date);

    if (granularity === 'daily') {
      groupKey = txn.date;
    } else if (granularity === 'weekly') {
      const day = txnDate.getDay();
      const diff = txnDate.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(txnDate);
      weekStart.setDate(diff);
      groupKey = format(weekStart, 'yyyy-MM-dd');
    } else {
      groupKey = format(txnDate, 'yyyy-MM');
    }

    const currentGroup = dateGroups.get(groupKey) || { sale: 0, saleOrder: 0, expense: 0, count: 0 };
    if (txn.transactionType === 'Sale') {
      currentGroup.sale += txn.amount;
    } else if (txn.transactionType === 'Sale Order') {
      currentGroup.saleOrder += txn.amount;
    } else if (txn.transactionType === 'Expense') {
      currentGroup.expense += txn.amount;
    }
    currentGroup.count++;
    dateGroups.set(groupKey, currentGroup);
  }

  // Convert to sorted array
  const result = Array.from(dateGroups.entries())
    .map(([date, data]) => ({
      date,
      label: granularity === 'monthly'
        ? format(parseISO(date + '-01'), 'MMM yyyy')
        : granularity === 'weekly'
        ? `Week of ${format(parseISO(date), 'MMM d')}`
        : format(parseISO(date), 'MMM d'),
      ...data,
      // Keep income/expense for backward compatibility
      income: data.sale + data.saleOrder,
      net: data.sale + data.saleOrder - data.expense,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return result;
}

export async function getGSTSummary(startDate: string, endDate: string, userId?: string) {
  const vyaparTxns = await db
    .select()
    .from(vyaparTransactions)
    .where(
      userId
        ? and(between(vyaparTransactions.date, startDate, endDate), eq(vyaparTransactions.userId, userId))
        : between(vyaparTransactions.date, startDate, endDate)
    );

  const sales = vyaparTxns
    .filter(t => t.transactionType === 'Sale' || t.transactionType === 'Sale Order')
    .reduce((sum, t) => sum + t.amount, 0);

  const purchases = vyaparTxns
    .filter(t => t.transactionType === 'Purchase')
    .reduce((sum, t) => sum + t.amount, 0);

  // Assuming 18% GST rate for simplification
  const gstRate = 0.18;
  const outputGST = (sales * gstRate) / (1 + gstRate);
  const inputGST = (purchases * gstRate) / (1 + gstRate);

  return {
    totalSales: sales,
    totalPurchases: purchases,
    outputGST,
    inputGST,
    netGSTLiability: outputGST - inputGST,
    transactionCount: vyaparTxns.length,
  };
}

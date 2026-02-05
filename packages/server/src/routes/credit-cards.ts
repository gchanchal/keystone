import { Router } from 'express';
import { z } from 'zod';
import { db, creditCardTransactions, creditCardStatements, cardHolders, accounts } from '../db/index.js';
import { eq, desc, and, gte, lte, sql, isNotNull, like, or } from 'drizzle-orm';

const router = Router();

// Get all credit card accounts
router.get('/', async (req, res) => {
  try {
    const creditCardAccounts = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.accountType, 'credit_card'), eq(accounts.userId, req.userId!)))
      .orderBy(desc(accounts.createdAt));

    res.json(creditCardAccounts);
  } catch (error) {
    console.error('Error fetching credit card accounts:', error);
    res.status(500).json({ error: 'Failed to fetch credit card accounts' });
  }
});

// Get credit cards dashboard summary
router.get('/summary', async (req, res) => {
  try {
    const { accountId } = z.object({
      accountId: z.string().optional(),
    }).parse(req.query);

    // Get all credit card accounts
    let accountsQuery = db
      .select()
      .from(accounts)
      .where(and(eq(accounts.accountType, 'credit_card'), eq(accounts.userId, req.userId!)));

    const ccAccounts = await accountsQuery;

    if (ccAccounts.length === 0) {
      return res.json({
        totalOutstanding: 0,
        totalAvailableLimit: 0,
        totalCreditLimit: 0,
        totalRewardPoints: 0,
        accounts: [],
        nextDueDate: null,
        nextDueAmount: 0,
      });
    }

    // Get latest statement for each account for current data
    const accountIds = accountId ? [accountId] : ccAccounts.map(a => a.id);

    const latestStatements = await db
      .select()
      .from(creditCardStatements)
      .where(
        accountIds.length === 1
          ? eq(creditCardStatements.accountId, accountIds[0])
          : sql`${creditCardStatements.accountId} IN ${accountIds}`
      )
      .orderBy(desc(creditCardStatements.statementDate));

    // Group by account and get latest
    const latestByAccount = new Map<string, typeof creditCardStatements.$inferSelect>();
    for (const stmt of latestStatements) {
      if (!latestByAccount.has(stmt.accountId)) {
        latestByAccount.set(stmt.accountId, stmt);
      }
    }

    // Calculate totals
    let totalOutstanding = 0;
    let totalAvailableLimit = 0;
    let totalCreditLimit = 0;
    let totalRewardPoints = 0;
    let nextDueDate: string | null = null;
    let nextDueAmount = 0;

    const accountSummaries = [];

    for (const account of ccAccounts) {
      const statement = latestByAccount.get(account.id);

      const outstanding = statement?.totalDue || Math.abs(account.currentBalance || 0);
      const creditLimit = statement?.creditLimit || 0;
      const availableLimit = statement?.availableLimit || (creditLimit - outstanding);
      const rewardPoints = statement?.rewardPointsBalance || 0;

      totalOutstanding += outstanding;
      totalAvailableLimit += availableLimit;
      totalCreditLimit += creditLimit;
      totalRewardPoints += rewardPoints;

      // Track next due date
      if (statement?.dueDate) {
        const dueDate = statement.dueDate;
        if (!nextDueDate || dueDate < nextDueDate) {
          nextDueDate = dueDate;
          nextDueAmount = statement.totalDue;
        }
      }

      // Get card holders for this account
      const holders = await db
        .select()
        .from(cardHolders)
        .where(eq(cardHolders.accountId, account.id));

      accountSummaries.push({
        ...account,
        outstanding,
        creditLimit,
        availableLimit,
        rewardPoints,
        dueDate: statement?.dueDate || null,
        minimumDue: statement?.minimumDue || 0,
        cardHolders: holders,
        latestStatement: statement || null,
      });
    }

    res.json({
      totalOutstanding,
      totalAvailableLimit,
      totalCreditLimit,
      totalRewardPoints,
      nextDueDate,
      nextDueAmount,
      accounts: accountSummaries,
    });
  } catch (error) {
    console.error('Error fetching credit cards summary:', error);
    res.status(500).json({ error: 'Failed to fetch credit cards summary' });
  }
});

// Get transactions for a credit card account
router.get('/:id/transactions', async (req, res) => {
  try {
    const accountId = req.params.id;
    const {
      startDate,
      endDate,
      cardHolder,
      category,
      emiOnly,
      search,
      limit = 100,
      offset = 0,
    } = z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      cardHolder: z.string().optional(),
      category: z.string().optional(),
      emiOnly: z.string().optional(),
      search: z.string().optional(),
      limit: z.coerce.number().optional(),
      offset: z.coerce.number().optional(),
    }).parse(req.query);

    // Build query conditions
    const conditions = [eq(creditCardTransactions.accountId, accountId)];

    if (startDate) {
      conditions.push(gte(creditCardTransactions.date, startDate));
    }
    if (endDate) {
      conditions.push(lte(creditCardTransactions.date, endDate));
    }
    if (cardHolder) {
      conditions.push(eq(creditCardTransactions.cardHolderName, cardHolder));
    }
    if (category) {
      conditions.push(eq(creditCardTransactions.piCategory, category));
    }
    if (emiOnly === 'true') {
      conditions.push(eq(creditCardTransactions.isEmi, true));
    }
    if (search) {
      conditions.push(like(creditCardTransactions.description, `%${search}%`));
    }

    const transactions = await db
      .select()
      .from(creditCardTransactions)
      .where(and(...conditions))
      .orderBy(desc(creditCardTransactions.date))
      .limit(limit)
      .offset(offset);

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(creditCardTransactions)
      .where(and(...conditions));

    const totalCount = countResult[0]?.count || 0;

    res.json({
      transactions,
      totalCount,
      hasMore: offset + transactions.length < totalCount,
    });
  } catch (error) {
    console.error('Error fetching credit card transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Get statement history for a credit card account
router.get('/:id/statements', async (req, res) => {
  try {
    const accountId = req.params.id;
    const { limit = 12 } = z.object({
      limit: z.coerce.number().optional(),
    }).parse(req.query);

    const statements = await db
      .select()
      .from(creditCardStatements)
      .where(eq(creditCardStatements.accountId, accountId))
      .orderBy(desc(creditCardStatements.statementDate))
      .limit(limit);

    res.json(statements);
  } catch (error) {
    console.error('Error fetching credit card statements:', error);
    res.status(500).json({ error: 'Failed to fetch statements' });
  }
});

// Get card holders for an account
router.get('/:id/card-holders', async (req, res) => {
  try {
    const accountId = req.params.id;

    const holders = await db
      .select()
      .from(cardHolders)
      .where(eq(cardHolders.accountId, accountId))
      .orderBy(desc(cardHolders.isPrimary));

    res.json(holders);
  } catch (error) {
    console.error('Error fetching card holders:', error);
    res.status(500).json({ error: 'Failed to fetch card holders' });
  }
});

// Get analytics data
router.get('/analytics', async (req, res) => {
  try {
    const {
      accountId,
      startDate,
      endDate,
    } = z.object({
      accountId: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).parse(req.query);

    // Build base conditions
    const baseConditions = [];
    if (accountId) {
      baseConditions.push(eq(creditCardTransactions.accountId, accountId));
    }
    if (startDate) {
      baseConditions.push(gte(creditCardTransactions.date, startDate));
    }
    if (endDate) {
      baseConditions.push(lte(creditCardTransactions.date, endDate));
    }
    // Only include debits for spend analysis
    baseConditions.push(eq(creditCardTransactions.transactionType, 'debit'));

    // Get spend by category
    const categorySpend = await db
      .select({
        category: creditCardTransactions.piCategory,
        total: sql<number>`sum(${creditCardTransactions.amount})`,
        count: sql<number>`count(*)`,
      })
      .from(creditCardTransactions)
      .where(and(...baseConditions))
      .groupBy(creditCardTransactions.piCategory)
      .orderBy(desc(sql`sum(${creditCardTransactions.amount})`));

    // Get spend by card holder
    const holderSpend = await db
      .select({
        cardHolder: creditCardTransactions.cardHolderName,
        total: sql<number>`sum(${creditCardTransactions.amount})`,
        count: sql<number>`count(*)`,
      })
      .from(creditCardTransactions)
      .where(and(...baseConditions, isNotNull(creditCardTransactions.cardHolderName)))
      .groupBy(creditCardTransactions.cardHolderName)
      .orderBy(desc(sql`sum(${creditCardTransactions.amount})`));

    // Get monthly trends
    const monthlyTrends = await db
      .select({
        month: sql<string>`strftime('%Y-%m', ${creditCardTransactions.date})`,
        spend: sql<number>`sum(case when ${creditCardTransactions.transactionType} = 'debit' then ${creditCardTransactions.amount} else 0 end)`,
        payments: sql<number>`sum(case when ${creditCardTransactions.transactionType} = 'credit' then ${creditCardTransactions.amount} else 0 end)`,
        transactionCount: sql<number>`count(*)`,
      })
      .from(creditCardTransactions)
      .where(
        accountId
          ? and(eq(creditCardTransactions.accountId, accountId), ...(startDate ? [gte(creditCardTransactions.date, startDate)] : []), ...(endDate ? [lte(creditCardTransactions.date, endDate)] : []))
          : and(...(startDate ? [gte(creditCardTransactions.date, startDate)] : []), ...(endDate ? [lte(creditCardTransactions.date, endDate)] : []))
      )
      .groupBy(sql`strftime('%Y-%m', ${creditCardTransactions.date})`)
      .orderBy(sql`strftime('%Y-%m', ${creditCardTransactions.date})`);

    // Get top merchants (by description prefix)
    const topMerchants = await db
      .select({
        merchant: creditCardTransactions.description,
        total: sql<number>`sum(${creditCardTransactions.amount})`,
        count: sql<number>`count(*)`,
      })
      .from(creditCardTransactions)
      .where(and(...baseConditions))
      .groupBy(creditCardTransactions.description)
      .orderBy(desc(sql`sum(${creditCardTransactions.amount})`))
      .limit(10);

    // Get EMI summary
    const emiSummary = await db
      .select({
        merchant: creditCardTransactions.description,
        emiTenure: creditCardTransactions.emiTenure,
        totalAmount: sql<number>`sum(${creditCardTransactions.amount})`,
        transactionCount: sql<number>`count(*)`,
      })
      .from(creditCardTransactions)
      .where(and(
        eq(creditCardTransactions.isEmi, true),
        ...(accountId ? [eq(creditCardTransactions.accountId, accountId)] : []),
        ...(startDate ? [gte(creditCardTransactions.date, startDate)] : []),
        ...(endDate ? [lte(creditCardTransactions.date, endDate)] : []),
      ))
      .groupBy(creditCardTransactions.description, creditCardTransactions.emiTenure)
      .orderBy(desc(sql`sum(${creditCardTransactions.amount})`));

    // Get reward points summary
    const rewardsSummary = await db
      .select({
        totalEarned: sql<number>`sum(case when ${creditCardTransactions.rewardPoints} > 0 then ${creditCardTransactions.rewardPoints} else 0 end)`,
        totalRedeemed: sql<number>`sum(case when ${creditCardTransactions.rewardPoints} < 0 then abs(${creditCardTransactions.rewardPoints}) else 0 end)`,
      })
      .from(creditCardTransactions)
      .where(
        accountId
          ? and(eq(creditCardTransactions.accountId, accountId), ...(startDate ? [gte(creditCardTransactions.date, startDate)] : []), ...(endDate ? [lte(creditCardTransactions.date, endDate)] : []))
          : and(...(startDate ? [gte(creditCardTransactions.date, startDate)] : []), ...(endDate ? [lte(creditCardTransactions.date, endDate)] : []))
      );

    // Calculate total spend
    const totalSpend = categorySpend.reduce((sum, c) => sum + (c.total || 0), 0);

    // Add percentages to category spend
    const categorySpendWithPercent = categorySpend.map(c => ({
      ...c,
      category: c.category || 'OTHER',
      percentage: totalSpend > 0 ? ((c.total || 0) / totalSpend * 100) : 0,
    }));

    res.json({
      categorySpend: categorySpendWithPercent,
      holderSpend,
      monthlyTrends,
      topMerchants,
      emiSummary,
      rewardsSummary: rewardsSummary[0] || { totalEarned: 0, totalRedeemed: 0 },
      totalSpend,
    });
  } catch (error) {
    console.error('Error fetching credit cards analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Update transaction category
router.patch('/:accountId/transactions/:id/category', async (req, res) => {
  try {
    const { id } = req.params;
    const { categoryId } = z.object({
      categoryId: z.string().nullable(),
    }).parse(req.body);

    const now = new Date().toISOString();

    await db
      .update(creditCardTransactions)
      .set({ categoryId, updatedAt: now })
      .where(eq(creditCardTransactions.id, id));

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating transaction category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

export default router;

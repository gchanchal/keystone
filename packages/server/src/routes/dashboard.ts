import { Router } from 'express';
import { z } from 'zod';
import {
  getDashboardStats,
  getCashFlowData,
  getExpenseBreakdown,
  getRecentTransactions,
  getTransactionTrends,
  getCategoryTrends,
  getVyaparSummary,
  getVyaparTrends,
} from '../services/report-service.js';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { getGearupDataUserId } from '../utils/gearup-auth.js';

const router = Router();

// Get dashboard data
router.get('/', async (req, res) => {
  try {
    const { month } = z
      .object({
        month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      })
      .parse(req.query);

    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
    const stats = await getDashboardStats(month, dataUserId);
    const cashFlow = await getCashFlowData(6, dataUserId);
    const recentTransactions = await getRecentTransactions(5, dataUserId);

    // Get expense breakdown for current month
    const now = month ? new Date(month + '-01') : new Date();
    const startDate = format(startOfMonth(now), 'yyyy-MM-dd');
    const endDate = format(endOfMonth(now), 'yyyy-MM-dd');
    const expenseBreakdown = await getExpenseBreakdown(startDate, endDate, dataUserId);

    res.json({
      stats,
      cashFlow,
      expenseBreakdown,
      recentTransactions,
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Get stats only
router.get('/stats', async (req, res) => {
  try {
    const { month } = z
      .object({
        month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      })
      .parse(req.query);

    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
    const stats = await getDashboardStats(month, dataUserId);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get cash flow chart data
router.get('/cash-flow', async (req, res) => {
  try {
    const { months } = z
      .object({
        months: z.string().optional(),
      })
      .parse(req.query);

    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
    const cashFlow = await getCashFlowData(months ? parseInt(months) : 6, dataUserId);
    res.json(cashFlow);
  } catch (error) {
    console.error('Error fetching cash flow:', error);
    res.status(500).json({ error: 'Failed to fetch cash flow data' });
  }
});

// Get expense breakdown
router.get('/expense-breakdown', async (req, res) => {
  try {
    const { startDate, endDate } = z
      .object({
        startDate: z.string(),
        endDate: z.string(),
      })
      .parse(req.query);

    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
    const breakdown = await getExpenseBreakdown(startDate, endDate, dataUserId);
    res.json(breakdown);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error fetching expense breakdown:', error);
    res.status(500).json({ error: 'Failed to fetch expense breakdown' });
  }
});

// Get recent transactions
router.get('/recent-transactions', async (req, res) => {
  try {
    const { limit } = z
      .object({
        limit: z.string().optional(),
      })
      .parse(req.query);

    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
    const transactions = await getRecentTransactions(limit ? parseInt(limit) : 10, dataUserId);
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching recent transactions:', error);
    res.status(500).json({ error: 'Failed to fetch recent transactions' });
  }
});

// Get transaction trends (daily/weekly/monthly)
router.get('/trends', async (req, res) => {
  try {
    const { startDate, endDate, granularity } = z
      .object({
        startDate: z.string(),
        endDate: z.string(),
        granularity: z.enum(['daily', 'weekly', 'monthly']).optional(),
      })
      .parse(req.query);

    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
    const trends = await getTransactionTrends(
      startDate,
      endDate,
      granularity || 'daily',
      dataUserId
    );
    res.json(trends);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error fetching trends:', error);
    res.status(500).json({ error: 'Failed to fetch trends' });
  }
});

// Get category trends over time
router.get('/category-trends', async (req, res) => {
  try {
    const { startDate, endDate, granularity, type } = z
      .object({
        startDate: z.string(),
        endDate: z.string(),
        granularity: z.enum(['daily', 'weekly', 'monthly']).optional(),
        type: z.enum(['expense', 'income', 'all']).optional(),
      })
      .parse(req.query);

    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
    const trends = await getCategoryTrends(
      startDate,
      endDate,
      granularity || 'monthly',
      type || 'expense',
      dataUserId
    );
    res.json(trends);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error fetching category trends:', error);
    res.status(500).json({ error: 'Failed to fetch category trends' });
  }
});

// Get Vyapar trends (for GearUp Mods dashboard)
router.get('/vyapar-trends', async (req, res) => {
  try {
    const { startDate, endDate, granularity } = z
      .object({
        startDate: z.string(),
        endDate: z.string(),
        granularity: z.enum(['daily', 'weekly', 'monthly']).optional(),
      })
      .parse(req.query);

    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
    const trends = await getVyaparTrends(
      startDate,
      endDate,
      granularity || 'daily',
      dataUserId
    );
    res.json(trends);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error fetching Vyapar trends:', error);
    res.status(500).json({ error: 'Failed to fetch Vyapar trends' });
  }
});

// Get Vyapar summary
router.get('/vyapar-summary', async (req, res) => {
  try {
    const { startDate, endDate } = z
      .object({
        startDate: z.string(),
        endDate: z.string(),
      })
      .parse(req.query);

    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
    const summary = await getVyaparSummary(startDate, endDate, dataUserId);
    res.json(summary);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error fetching Vyapar summary:', error);
    res.status(500).json({ error: 'Failed to fetch Vyapar summary' });
  }
});

export default router;

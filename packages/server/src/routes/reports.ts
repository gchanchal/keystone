import { Router } from 'express';
import { z } from 'zod';
import {
  getMonthlyPL,
  getExpenseBreakdown,
  getGSTSummary,
  getVyaparPL,
  getVyaparExpenseBreakdown,
} from '../services/report-service.js';
import {
  exportToCSV,
  exportToExcel,
  formatTransactionsForExport,
  formatPLReport,
} from '../services/export-service.js';
import { db, bankTransactions, vyaparTransactions, categories } from '../db/index.js';
import { between, eq, and, desc, sql } from 'drizzle-orm';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { getGearupDataUserId } from '../utils/gearup-auth.js';

const router = Router();

// Get P&L report (Vyapar-based, supports date range)
router.get('/pl', async (req, res) => {
  try {
    const { month, startDate, endDate, minAmount } = z
      .object({
        month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        minAmount: z.string().optional(),
      })
      .parse(req.query);

    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;

    // Support date range or fall back to single month
    let start: string;
    let end: string;
    if (startDate && endDate) {
      start = startDate;
      end = endDate;
    } else if (month) {
      const date = parseISO(month + '-01');
      start = format(startOfMonth(date), 'yyyy-MM-dd');
      end = format(endOfMonth(date), 'yyyy-MM-dd');
    } else {
      return res.status(400).json({ error: 'Either month or startDate/endDate required' });
    }

    const pl = await getVyaparPL(start, end, dataUserId, minAmount ? parseInt(minAmount) : undefined);
    res.json(pl);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error fetching P&L:', error);
    res.status(500).json({ error: 'Failed to fetch P&L report' });
  }
});

// Export P&L report
router.get('/pl/export', async (req, res) => {
  try {
    const { month, startDate, endDate, format: exportFormat } = z
      .object({
        month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        format: z.enum(['xlsx', 'csv']).default('xlsx'),
      })
      .parse(req.query);

    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;

    let start: string;
    let end: string;
    if (startDate && endDate) {
      start = startDate;
      end = endDate;
    } else if (month) {
      const date = parseISO(month + '-01');
      start = format(startOfMonth(date), 'yyyy-MM-dd');
      end = format(endOfMonth(date), 'yyyy-MM-dd');
    } else {
      return res.status(400).json({ error: 'Either month or startDate/endDate required' });
    }

    const pl = await getVyaparPL(start, end, dataUserId);

    if (exportFormat === 'xlsx') {
      const buffer = formatPLReport(pl);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="pl-report-${month}.xlsx"`);
      res.send(buffer);
    } else {
      // CSV format - simplified
      const data = {
        headers: ['Category', 'Type', 'Amount'],
        rows: pl.items.map(i => [i.category, i.type, i.amount]),
      };
      const csv = exportToCSV(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="pl-report-${month}.csv"`);
      res.send(csv);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error exporting P&L:', error);
    res.status(500).json({ error: 'Failed to export P&L report' });
  }
});

// Get GST summary
router.get('/gst', async (req, res) => {
  try {
    const { startDate, endDate } = z
      .object({
        startDate: z.string(),
        endDate: z.string(),
      })
      .parse(req.query);

    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
    const summary = await getGSTSummary(startDate, endDate, dataUserId);
    res.json(summary);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error fetching GST summary:', error);
    res.status(500).json({ error: 'Failed to fetch GST summary' });
  }
});

// Get category breakdown
router.get('/category-breakdown', async (req, res) => {
  try {
    const { startDate, endDate, type } = z
      .object({
        startDate: z.string(),
        endDate: z.string(),
        type: z.enum(['income', 'expense']).optional(),
      })
      .parse(req.query);

    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
    const breakdown = await getVyaparExpenseBreakdown(startDate, endDate, dataUserId);
    res.json(breakdown);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error fetching category breakdown:', error);
    res.status(500).json({ error: 'Failed to fetch category breakdown' });
  }
});

// Export transactions
router.get('/transactions/export', async (req, res) => {
  try {
    const { startDate, endDate, type, format: exportFormat, accountId } = z
      .object({
        startDate: z.string(),
        endDate: z.string(),
        type: z.enum(['bank', 'vyapar', 'all']).default('all'),
        format: z.enum(['xlsx', 'csv']).default('xlsx'),
        accountId: z.string().optional(),
      })
      .parse(req.query);

    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
    let transactions: any[] = [];
    const allCategories = await db.select().from(categories);
    const categoryMap = new Map(allCategories.map(c => [c.id, c.name]));

    if (type === 'bank' || type === 'all') {
      const conditions = [
        between(bankTransactions.date, startDate, endDate),
        eq(bankTransactions.userId, dataUserId),
      ];
      if (accountId) {
        conditions.push(eq(bankTransactions.accountId, accountId));
      }

      const bankTxns = await db
        .select()
        .from(bankTransactions)
        .where(and(...conditions))
        .orderBy(desc(bankTransactions.date));

      transactions.push(...bankTxns.map(t => ({ ...t, source: 'bank' })));
    }

    if (type === 'vyapar' || type === 'all') {
      const vyaparTxns = await db
        .select()
        .from(vyaparTransactions)
        .where(and(between(vyaparTransactions.date, startDate, endDate), eq(vyaparTransactions.userId, dataUserId)))
        .orderBy(desc(vyaparTransactions.date));

      transactions.push(
        ...vyaparTxns.map(t => ({
          ...t,
          narration: t.partyName || t.description,
          transactionType: ['Sale', 'Payment-In'].includes(t.transactionType)
            ? 'credit'
            : 'debit',
          source: 'vyapar',
        }))
      );
    }

    // Sort by date
    transactions.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    const exportData = formatTransactionsForExport(transactions, categoryMap);

    if (exportFormat === 'xlsx') {
      const buffer = exportToExcel(exportData, 'Transactions');
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="transactions-${startDate}-${endDate}.xlsx"`
      );
      res.send(buffer);
    } else {
      const csv = exportToCSV(exportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="transactions-${startDate}-${endDate}.csv"`
      );
      res.send(csv);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error exporting transactions:', error);
    res.status(500).json({ error: 'Failed to export transactions' });
  }
});

export default router;

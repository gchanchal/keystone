import { Router } from 'express';
import { z } from 'zod';
import { db, bankTransactions, vyaparTransactions } from '../db/index.js';
import { eq, and, between, sql } from 'drizzle-orm';
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

    // Get bank transactions
    const bankConditions = [between(bankTransactions.date, startDate, endDate), eq(bankTransactions.userId, req.userId!)];
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

    await manualMatch(bankTransactionId, vyaparTransactionId);

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

    // Get bank transactions
    const bankConditions = [between(bankTransactions.date, startDate, endDate), eq(bankTransactions.userId, req.userId!)];
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

export default router;

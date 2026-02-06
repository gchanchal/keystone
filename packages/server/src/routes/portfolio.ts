import { Router } from 'express';
import {
  calculatePortfolioSummary,
  captureSnapshot,
  getSnapshotHistory,
  getLatestSnapshot,
  createSeedSnapshot,
  getPerformanceData,
} from '../services/portfolio-service.js';

const router = Router();

/**
 * GET /api/portfolio/summary
 * Get current portfolio summary (calculated live, not from snapshot)
 */
router.get('/summary', async (req, res) => {
  try {
    const summary = await calculatePortfolioSummary(req.userId!);
    res.json(summary);
  } catch (error) {
    console.error('Error getting portfolio summary:', error);
    res.status(500).json({ error: 'Failed to get portfolio summary' });
  }
});

/**
 * GET /api/portfolio/snapshots
 * Get snapshot history
 * Query params: startDate, endDate, limit
 */
router.get('/snapshots', async (req, res) => {
  try {
    const { startDate, endDate, limit } = req.query;
    const snapshots = await getSnapshotHistory(
      req.userId!,
      startDate as string,
      endDate as string,
      limit ? parseInt(limit as string) : undefined
    );
    res.json(snapshots);
  } catch (error) {
    console.error('Error getting snapshots:', error);
    res.status(500).json({ error: 'Failed to get snapshots' });
  }
});

/**
 * GET /api/portfolio/snapshots/latest
 * Get the most recent snapshot
 */
router.get('/snapshots/latest', async (req, res) => {
  try {
    const snapshot = await getLatestSnapshot(req.userId!);
    if (!snapshot) {
      return res.status(404).json({ error: 'No snapshots found' });
    }
    res.json(snapshot);
  } catch (error) {
    console.error('Error getting latest snapshot:', error);
    res.status(500).json({ error: 'Failed to get latest snapshot' });
  }
});

/**
 * POST /api/portfolio/capture
 * Capture a new snapshot manually
 */
router.post('/capture', async (req, res) => {
  try {
    const { notes } = req.body;
    const snapshot = await captureSnapshot(req.userId!, true, notes);
    res.status(201).json(snapshot);
  } catch (error) {
    console.error('Error capturing snapshot:', error);
    res.status(500).json({ error: 'Failed to capture snapshot' });
  }
});

/**
 * POST /api/portfolio/seed
 * Create initial seed data for charts (10% less than current)
 */
router.post('/seed', async (req, res) => {
  try {
    // Check if seed already exists
    const existing = await getSnapshotHistory(req.userId!, undefined, undefined, 1);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Seed data already exists' });
    }

    const seedSnapshot = await createSeedSnapshot(req.userId!);
    res.status(201).json(seedSnapshot);
  } catch (error) {
    console.error('Error creating seed:', error);
    res.status(500).json({ error: 'Failed to create seed data' });
  }
});

/**
 * POST /api/portfolio/initialize
 * Initialize portfolio tracking: create seed + capture current snapshot
 */
router.post('/initialize', async (req, res) => {
  try {
    // Check if already initialized
    const existing = await getSnapshotHistory(req.userId!, undefined, undefined, 1);
    if (existing.length > 0) {
      return res.status(400).json({
        error: 'Portfolio tracking already initialized',
        snapshots: existing.length,
      });
    }

    // Create seed (yesterday's data at 10% less)
    const seedSnapshot = await createSeedSnapshot(req.userId!);

    // Capture current snapshot
    const currentSnapshot = await captureSnapshot(req.userId!, false, 'Initial capture');

    res.status(201).json({
      success: true,
      message: 'Portfolio tracking initialized',
      seedSnapshot,
      currentSnapshot,
    });
  } catch (error) {
    console.error('Error initializing portfolio:', error);
    res.status(500).json({ error: 'Failed to initialize portfolio tracking' });
  }
});

/**
 * GET /api/portfolio/performance
 * Get performance data for charts
 * Query params: period (daily|weekly|monthly|quarterly), limit
 */
router.get('/performance', async (req, res) => {
  try {
    const { period = 'daily', limit = '30' } = req.query;
    const data = await getPerformanceData(
      req.userId!,
      period as 'daily' | 'weekly' | 'monthly' | 'quarterly',
      parseInt(limit as string)
    );
    res.json(data);
  } catch (error) {
    console.error('Error getting performance data:', error);
    res.status(500).json({ error: 'Failed to get performance data' });
  }
});

/**
 * GET /api/portfolio/allocation
 * Get asset allocation breakdown for pie chart
 */
router.get('/allocation', async (req, res) => {
  try {
    const summary = await calculatePortfolioSummary(req.userId!);

    const allocation = [
      { name: 'US Stocks', value: summary.usStocksValue, color: '#10b981' },
      { name: 'India Stocks', value: summary.indiaStocksValue, color: '#6366f1' },
      { name: 'Mutual Funds', value: summary.mutualFundsValue, color: '#f59e0b' },
      { name: 'Fixed Deposits', value: summary.fdValue, color: '#8b5cf6' },
      { name: 'PPF', value: summary.ppfValue, color: '#ec4899' },
      { name: 'Gold', value: summary.goldValue, color: '#eab308' },
      { name: 'Crypto', value: summary.cryptoValue, color: '#14b8a6' },
      { name: 'Insurance', value: summary.policiesValue, color: '#0ea5e9' },
      { name: 'Real Estate', value: summary.realEstateValue, color: '#64748b' },
      { name: 'Vehicles', value: summary.vehiclesValue, color: '#f97316' },
      { name: 'Loans Given', value: summary.loansGivenValue, color: '#22c55e' },
      { name: 'Other', value: summary.otherInvestmentsValue + summary.otherAssetsValue, color: '#a855f7' },
    ].filter(item => item.value > 0);

    const liabilities = [
      { name: 'Home Loan', value: summary.homeLoanOutstanding, color: '#ef4444' },
      { name: 'Car Loan', value: summary.carLoanOutstanding, color: '#f97316' },
      { name: 'Personal Loan', value: summary.personalLoanOutstanding, color: '#eab308' },
      { name: 'Other Loans', value: summary.otherLoansOutstanding, color: '#a855f7' },
      { name: 'Credit Cards', value: summary.creditCardDues, color: '#ec4899' },
    ].filter(item => item.value > 0);

    res.json({
      assets: allocation,
      liabilities,
      summary: {
        totalAssets: summary.totalAssets,
        totalLiabilities: summary.totalLiabilities,
        netWorth: summary.netWorth,
      },
    });
  } catch (error) {
    console.error('Error getting allocation:', error);
    res.status(500).json({ error: 'Failed to get allocation' });
  }
});

export default router;

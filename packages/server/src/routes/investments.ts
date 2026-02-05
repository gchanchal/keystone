import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, investments, investmentHistory } from '../db/index.js';
import { eq, desc, sql, and } from 'drizzle-orm';

const router = Router();

// Yahoo Finance API for stock quotes
async function fetchStockPrice(symbol: string): Promise<{ price: number; currency: string } | null> {
  try {
    // Using Yahoo Finance v8 API
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
    );
    if (!response.ok) return null;

    const data = await response.json();
    if (data?.chart?.result?.[0]?.meta?.regularMarketPrice) {
      return {
        price: data.chart.result[0].meta.regularMarketPrice,
        currency: data.chart.result[0].meta.currency || 'USD',
      };
    }
    return null;
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error);
    return null;
  }
}

// Fetch live quote with day change info
async function fetchLiveQuote(symbol: string): Promise<{
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
} | null> {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`
    );
    if (!response.ok) return null;

    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (meta?.regularMarketPrice) {
      const price = meta.regularMarketPrice;
      const previousClose = meta.previousClose || meta.chartPreviousClose || price;
      const change = price - previousClose;
      const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

      return {
        price,
        change,
        changePercent,
        previousClose,
      };
    }
    return null;
  } catch (error) {
    console.error(`Error fetching live quote for ${symbol}:`, error);
    return null;
  }
}

const investmentSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['stocks', 'mutual_funds', 'fd', 'ppf', 'gold', 'crypto', 'real_estate', 'other']),
  symbol: z.string().optional(),
  platform: z.string().optional(),
  country: z.enum(['IN', 'US']).default('IN'), // IN = India (₹), US = United States ($)
  quantity: z.number().positive().default(1),
  purchasePrice: z.number().positive(),
  purchaseDate: z.string(),
  currentPrice: z.number().optional(),
  notes: z.string().optional(),
});

// Get all investments
router.get('/', async (_req, res) => {
  try {
    const allInvestments = await db
      .select()
      .from(investments)
      .where(eq(investments.isActive, true))
      .orderBy(desc(investments.createdAt));

    res.json(allInvestments);
  } catch (error) {
    console.error('Error fetching investments:', error);
    res.status(500).json({ error: 'Failed to fetch investments' });
  }
});

// Get investment summary
router.get('/summary', async (_req, res) => {
  try {
    const allInvestments = await db
      .select()
      .from(investments)
      .where(eq(investments.isActive, true));

    const totalInvested = allInvestments.reduce(
      (sum, inv) => sum + inv.purchasePrice * (inv.quantity || 1),
      0
    );

    const totalCurrentValue = allInvestments.reduce(
      (sum, inv) => sum + (inv.currentValue || inv.purchasePrice * (inv.quantity || 1)),
      0
    );

    const totalGain = totalCurrentValue - totalInvested;
    const totalGainPercent = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

    // Group by type
    const byType = allInvestments.reduce(
      (acc, inv) => {
        const type = inv.type;
        if (!acc[type]) {
          acc[type] = { invested: 0, current: 0, count: 0 };
        }
        acc[type].invested += inv.purchasePrice * (inv.quantity || 1);
        acc[type].current += inv.currentValue || inv.purchasePrice * (inv.quantity || 1);
        acc[type].count += 1;
        return acc;
      },
      {} as Record<string, { invested: number; current: number; count: number }>
    );

    res.json({
      totalInvested,
      totalCurrentValue,
      totalGain,
      totalGainPercent,
      byType,
      count: allInvestments.length,
    });
  } catch (error) {
    console.error('Error fetching investment summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// Get live quotes for US stocks (for real-time ticker)
router.get('/live-quotes', async (_req, res) => {
  try {
    // Get all active US stock investments with symbols
    const stockInvestments = await db
      .select()
      .from(investments)
      .where(and(
        eq(investments.isActive, true),
        eq(investments.type, 'stocks'),
        eq(investments.country, 'US')
      ));

    const quotes: Record<string, {
      symbol: string;
      price: number;
      change: number;
      changePercent: number;
      previousClose: number;
    }> = {};

    // Fetch quotes in parallel for better performance
    const symbolsToFetch = stockInvestments
      .filter(inv => inv.symbol)
      .map(inv => inv.symbol!);

    const uniqueSymbols = [...new Set(symbolsToFetch)];

    await Promise.all(
      uniqueSymbols.map(async (symbol) => {
        const quote = await fetchLiveQuote(symbol);
        if (quote) {
          quotes[symbol] = {
            symbol,
            ...quote,
          };
        }
      })
    );

    res.json(quotes);
  } catch (error) {
    console.error('Error fetching live quotes:', error);
    res.status(500).json({ error: 'Failed to fetch live quotes' });
  }
});

// Get single investment with history
router.get('/:id', async (req, res) => {
  try {
    const investment = await db
      .select()
      .from(investments)
      .where(eq(investments.id, req.params.id))
      .limit(1);

    if (!investment[0]) {
      return res.status(404).json({ error: 'Investment not found' });
    }

    const history = await db
      .select()
      .from(investmentHistory)
      .where(eq(investmentHistory.investmentId, req.params.id))
      .orderBy(desc(investmentHistory.date));

    res.json({
      ...investment[0],
      history,
    });
  } catch (error) {
    console.error('Error fetching investment:', error);
    res.status(500).json({ error: 'Failed to fetch investment' });
  }
});

// Create investment
router.post('/', async (req, res) => {
  try {
    const data = investmentSchema.parse(req.body);
    const now = new Date().toISOString();

    const currentValue = (data.currentPrice || data.purchasePrice) * data.quantity;

    const newInvestment = {
      id: uuidv4(),
      ...data,
      currentPrice: data.currentPrice || data.purchasePrice,
      currentValue,
      lastUpdated: now,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(investments).values(newInvestment);

    // Add initial history entry
    await db.insert(investmentHistory).values({
      id: uuidv4(),
      investmentId: newInvestment.id,
      date: data.purchaseDate,
      price: data.purchasePrice,
      value: data.purchasePrice * data.quantity,
      createdAt: now,
    });

    res.status(201).json(newInvestment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating investment:', error);
    res.status(500).json({ error: 'Failed to create investment' });
  }
});

// Update investment
router.put('/:id', async (req, res) => {
  try {
    const data = investmentSchema.partial().parse(req.body);
    const now = new Date().toISOString();

    // Get current investment to calculate new value
    const current = await db
      .select()
      .from(investments)
      .where(eq(investments.id, req.params.id))
      .limit(1);

    if (!current[0]) {
      return res.status(404).json({ error: 'Investment not found' });
    }

    const quantity = data.quantity ?? current[0].quantity ?? 1;
    const currentPrice = data.currentPrice ?? current[0].currentPrice ?? current[0].purchasePrice;
    const currentValue = currentPrice * quantity;

    await db
      .update(investments)
      .set({
        ...data,
        currentValue,
        lastUpdated: now,
        updatedAt: now,
      })
      .where(eq(investments.id, req.params.id));

    const updated = await db
      .select()
      .from(investments)
      .where(eq(investments.id, req.params.id))
      .limit(1);

    res.json(updated[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating investment:', error);
    res.status(500).json({ error: 'Failed to update investment' });
  }
});

// Update current price
router.patch('/:id/price', async (req, res) => {
  try {
    const { price } = z.object({ price: z.number().positive() }).parse(req.body);
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    const current = await db
      .select()
      .from(investments)
      .where(eq(investments.id, req.params.id))
      .limit(1);

    if (!current[0]) {
      return res.status(404).json({ error: 'Investment not found' });
    }

    const quantity = current[0].quantity || 1;
    const currentValue = price * quantity;

    await db
      .update(investments)
      .set({
        currentPrice: price,
        currentValue,
        lastUpdated: now,
        updatedAt: now,
      })
      .where(eq(investments.id, req.params.id));

    // Add history entry
    await db.insert(investmentHistory).values({
      id: uuidv4(),
      investmentId: req.params.id,
      date: today,
      price,
      value: currentValue,
      createdAt: now,
    });

    const updated = await db
      .select()
      .from(investments)
      .where(eq(investments.id, req.params.id))
      .limit(1);

    res.json(updated[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating price:', error);
    res.status(500).json({ error: 'Failed to update price' });
  }
});

// Delete investment (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const now = new Date().toISOString();

    await db
      .update(investments)
      .set({ isActive: false, updatedAt: now })
      .where(eq(investments.id, req.params.id));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting investment:', error);
    res.status(500).json({ error: 'Failed to delete investment' });
  }
});

// Sync prices for all US stocks with symbols
router.post('/sync-prices', async (_req, res) => {
  try {
    // Get all active US stock investments with symbols
    const stockInvestments = await db
      .select()
      .from(investments)
      .where(and(
        eq(investments.isActive, true),
        eq(investments.type, 'stocks'),
        eq(investments.country, 'US')
      ));

    const now = new Date().toISOString();
    const today = now.split('T')[0];
    let updated = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const investment of stockInvestments) {
      if (!investment.symbol) {
        errors.push(`No symbol for: ${investment.name}`);
        failed++;
        continue;
      }

      try {
        const priceData = await fetchStockPrice(investment.symbol);
        if (!priceData) {
          errors.push(`Could not fetch price for: ${investment.symbol}`);
          failed++;
          continue;
        }

        const quantity = investment.quantity || 1;
        const currentValue = priceData.price * quantity;

        // Update investment
        await db
          .update(investments)
          .set({
            currentPrice: priceData.price,
            currentValue,
            lastUpdated: now,
            updatedAt: now,
          })
          .where(eq(investments.id, investment.id));

        // Add history entry
        await db.insert(investmentHistory).values({
          id: uuidv4(),
          investmentId: investment.id,
          date: today,
          price: priceData.price,
          value: currentValue,
          createdAt: now,
        });

        updated++;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        errors.push(`Error updating ${investment.symbol}: ${error.message}`);
        failed++;
      }
    }

    res.json({
      success: true,
      updated,
      failed,
      total: stockInvestments.length,
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    console.error('Error syncing prices:', error);
    res.status(500).json({ error: 'Failed to sync prices' });
  }
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { db, mutualFundFolios, mutualFundHoldings, mutualFundTransactions } from '../db/index.js';
import { eq, desc, sql, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// MFAPI base URL for fetching live NAV
const MFAPI_BASE = 'https://api.mfapi.in/mf';

interface MFAPISearchResult {
  schemeCode?: number;
  schemeName?: string;
}

interface MFAPISchemeData {
  data?: Array<{ nav: string; date: string }>;
}

// ISIN to scheme code mapping (MFAPI uses scheme codes)
// We'll fetch this dynamically or use a search
async function getSchemeCodeFromISIN(isin: string): Promise<string | null> {
  try {
    // Search for the scheme by ISIN
    const response = await fetch(`${MFAPI_BASE}/search?q=${isin}`);
    if (!response.ok) return null;

    const data = await response.json() as MFAPISearchResult[];
    if (data && data.length > 0) {
      return data[0].schemeCode?.toString() || null;
    }
    return null;
  } catch (error) {
    console.error(`Error searching for ISIN ${isin}:`, error);
    return null;
  }
}

// Fetch latest NAV for a scheme with previous day's NAV for day change calculation
async function fetchLatestNAV(schemeCode: string): Promise<{ nav: number; date: string; previousNav?: number } | null> {
  try {
    // Fetch historical data to get latest and previous NAV
    const response = await fetch(`${MFAPI_BASE}/${schemeCode}`);
    if (!response.ok) return null;

    const data = await response.json() as MFAPISchemeData;
    if (data && data.data && data.data.length > 0) {
      const latest = data.data[0];
      const previous = data.data.length > 1 ? data.data[1] : null;
      return {
        nav: parseFloat(latest.nav),
        date: latest.date, // Format: DD-MM-YYYY
        previousNav: previous ? parseFloat(previous.nav) : undefined,
      };
    }
    return null;
  } catch (error) {
    console.error(`Error fetching NAV for scheme ${schemeCode}:`, error);
    return null;
  }
}

const router = Router();

// Get all mutual fund holdings with folio info
router.get('/holdings', async (_req, res) => {
  try {
    const holdings = await db
      .select({
        id: mutualFundHoldings.id,
        folioId: mutualFundHoldings.folioId,
        schemeName: mutualFundHoldings.schemeName,
        schemeCode: mutualFundHoldings.schemeCode,
        isin: mutualFundHoldings.isin,
        schemeType: mutualFundHoldings.schemeType,
        schemeCategory: mutualFundHoldings.schemeCategory,
        units: mutualFundHoldings.units,
        costValue: mutualFundHoldings.costValue,
        currentValue: mutualFundHoldings.currentValue,
        nav: mutualFundHoldings.nav,
        navDate: mutualFundHoldings.navDate,
        previousNav: mutualFundHoldings.previousNav,
        dayChange: mutualFundHoldings.dayChange,
        dayChangePercent: mutualFundHoldings.dayChangePercent,
        absoluteReturn: mutualFundHoldings.absoluteReturn,
        absoluteReturnPercent: mutualFundHoldings.absoluteReturnPercent,
        xirr: mutualFundHoldings.xirr,
        isActive: mutualFundHoldings.isActive,
        lastUpdated: mutualFundHoldings.lastUpdated,
        createdAt: mutualFundHoldings.createdAt,
        // Folio info
        folioNumber: mutualFundFolios.folioNumber,
        amcName: mutualFundFolios.amcName,
        registrar: mutualFundFolios.registrar,
      })
      .from(mutualFundHoldings)
      .innerJoin(mutualFundFolios, eq(mutualFundHoldings.folioId, mutualFundFolios.id))
      .where(eq(mutualFundHoldings.isActive, true))
      .orderBy(desc(mutualFundHoldings.currentValue));

    res.json(holdings);
  } catch (error) {
    console.error('Error fetching mutual fund holdings:', error);
    res.status(500).json({ error: 'Failed to fetch holdings' });
  }
});

// Get summary stats
router.get('/summary', async (_req, res) => {
  try {
    const result = await db
      .select({
        totalCostValue: sql<number>`COALESCE(SUM(${mutualFundHoldings.costValue}), 0)`,
        totalCurrentValue: sql<number>`COALESCE(SUM(${mutualFundHoldings.currentValue}), 0)`,
        totalDayChange: sql<number>`COALESCE(SUM(${mutualFundHoldings.dayChange}), 0)`,
        holdingsCount: sql<number>`COUNT(*)`,
      })
      .from(mutualFundHoldings)
      .where(eq(mutualFundHoldings.isActive, true));

    const folioCount = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${mutualFundFolios.id})` })
      .from(mutualFundFolios)
      .where(eq(mutualFundFolios.isActive, true));

    const summary = result[0];
    const totalAbsoluteReturn = summary.totalCurrentValue - summary.totalCostValue;
    const totalAbsoluteReturnPercent = summary.totalCostValue > 0
      ? (totalAbsoluteReturn / summary.totalCostValue) * 100
      : 0;

    // Group by AMC for allocation
    const byAmc = await db
      .select({
        amcName: mutualFundFolios.amcName,
        totalValue: sql<number>`COALESCE(SUM(${mutualFundHoldings.currentValue}), 0)`,
        totalCost: sql<number>`COALESCE(SUM(${mutualFundHoldings.costValue}), 0)`,
        holdingsCount: sql<number>`COUNT(*)`,
      })
      .from(mutualFundHoldings)
      .innerJoin(mutualFundFolios, eq(mutualFundHoldings.folioId, mutualFundFolios.id))
      .where(eq(mutualFundHoldings.isActive, true))
      .groupBy(mutualFundFolios.amcName)
      .orderBy(desc(sql`COALESCE(SUM(${mutualFundHoldings.currentValue}), 0)`));

    // Calculate day change percent
    const totalDayChangePercent = summary.totalCurrentValue > 0 && summary.totalDayChange !== 0
      ? (summary.totalDayChange / (summary.totalCurrentValue - summary.totalDayChange)) * 100
      : 0;

    res.json({
      totalCostValue: summary.totalCostValue,
      totalCurrentValue: summary.totalCurrentValue,
      totalAbsoluteReturn,
      totalAbsoluteReturnPercent,
      totalDayChange: summary.totalDayChange,
      totalDayChangePercent,
      holdingsCount: summary.holdingsCount,
      folioCount: folioCount[0].count,
      byAmc,
    });
  } catch (error) {
    console.error('Error fetching mutual fund summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// Get all folios
router.get('/folios', async (_req, res) => {
  try {
    const folios = await db
      .select()
      .from(mutualFundFolios)
      .where(eq(mutualFundFolios.isActive, true))
      .orderBy(mutualFundFolios.amcName);

    // Get holdings count for each folio
    const foliosWithCount = await Promise.all(
      folios.map(async (folio) => {
        const holdingsCount = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(mutualFundHoldings)
          .where(and(
            eq(mutualFundHoldings.folioId, folio.id),
            eq(mutualFundHoldings.isActive, true)
          ));

        const totalValue = await db
          .select({ total: sql<number>`COALESCE(SUM(${mutualFundHoldings.currentValue}), 0)` })
          .from(mutualFundHoldings)
          .where(and(
            eq(mutualFundHoldings.folioId, folio.id),
            eq(mutualFundHoldings.isActive, true)
          ));

        return {
          ...folio,
          holdingsCount: holdingsCount[0].count,
          totalValue: totalValue[0].total,
        };
      })
    );

    res.json(foliosWithCount);
  } catch (error) {
    console.error('Error fetching folios:', error);
    res.status(500).json({ error: 'Failed to fetch folios' });
  }
});

// Get holdings by folio
router.get('/folios/:folioId/holdings', async (req, res) => {
  try {
    const { folioId } = req.params;

    const holdings = await db
      .select()
      .from(mutualFundHoldings)
      .where(and(
        eq(mutualFundHoldings.folioId, folioId),
        eq(mutualFundHoldings.isActive, true)
      ))
      .orderBy(desc(mutualFundHoldings.currentValue));

    res.json(holdings);
  } catch (error) {
    console.error('Error fetching holdings for folio:', error);
    res.status(500).json({ error: 'Failed to fetch holdings' });
  }
});

// Update NAV for a holding
router.patch('/:id/nav', async (req, res) => {
  try {
    const { id } = req.params;
    const { nav, navDate } = z
      .object({
        nav: z.number(),
        navDate: z.string().optional(),
      })
      .parse(req.body);

    const now = new Date().toISOString();

    // Get current holding to calculate new value
    const holding = await db
      .select()
      .from(mutualFundHoldings)
      .where(eq(mutualFundHoldings.id, id))
      .limit(1);

    if (!holding[0]) {
      return res.status(404).json({ error: 'Holding not found' });
    }

    const currentValue = holding[0].units * nav;
    const absoluteReturn = currentValue - holding[0].costValue;
    const absoluteReturnPercent = holding[0].costValue > 0
      ? (absoluteReturn / holding[0].costValue) * 100
      : 0;

    await db
      .update(mutualFundHoldings)
      .set({
        nav,
        navDate: navDate || now.split('T')[0],
        currentValue,
        absoluteReturn,
        absoluteReturnPercent,
        lastUpdated: now,
        updatedAt: now,
      })
      .where(eq(mutualFundHoldings.id, id));

    const updated = await db
      .select()
      .from(mutualFundHoldings)
      .where(eq(mutualFundHoldings.id, id))
      .limit(1);

    res.json(updated[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating NAV:', error);
    res.status(500).json({ error: 'Failed to update NAV' });
  }
});

// Delete a holding (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const now = new Date().toISOString();

    await db
      .update(mutualFundHoldings)
      .set({
        isActive: false,
        updatedAt: now,
      })
      .where(eq(mutualFundHoldings.id, id));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting holding:', error);
    res.status(500).json({ error: 'Failed to delete holding' });
  }
});

// Sync NAV for all holdings from live API
router.post('/sync-nav', async (req, res) => {
  try {
    const holdings = await db
      .select()
      .from(mutualFundHoldings)
      .where(eq(mutualFundHoldings.isActive, true));

    const now = new Date().toISOString();
    let updated = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const holding of holdings) {
      try {
        // Try to get scheme code from ISIN
        let schemeCode: string | null = null;

        if (holding.isin) {
          schemeCode = await getSchemeCodeFromISIN(holding.isin);
        }

        // If no ISIN or search failed, try searching by scheme name
        if (!schemeCode && holding.schemeName) {
          // Extract key words from scheme name for search
          const searchTerm = holding.schemeName
            .split(' ')
            .slice(0, 4)
            .join(' ')
            .replace(/[^a-zA-Z0-9\s]/g, '');

          const response = await fetch(`${MFAPI_BASE}/search?q=${encodeURIComponent(searchTerm)}`);
          if (response.ok) {
            const data = await response.json() as MFAPISearchResult[];
            if (data && data.length > 0) {
              // Try to find best match
              const match = data.find((d: MFAPISearchResult) =>
                d.schemeName?.toLowerCase().includes('direct') === holding.schemeName.toLowerCase().includes('direct') &&
                d.schemeName?.toLowerCase().includes('growth') === holding.schemeName.toLowerCase().includes('growth')
              ) || data[0];
              schemeCode = match?.schemeCode?.toString() || null;
            }
          }
        }

        if (!schemeCode) {
          errors.push(`Could not find scheme code for: ${holding.schemeName.substring(0, 40)}...`);
          failed++;
          continue;
        }

        // Fetch latest NAV
        const navData = await fetchLatestNAV(schemeCode);
        if (!navData) {
          errors.push(`Could not fetch NAV for: ${holding.schemeName.substring(0, 40)}...`);
          failed++;
          continue;
        }

        // Calculate new values
        const currentValue = holding.units * navData.nav;
        const absoluteReturn = currentValue - holding.costValue;
        const absoluteReturnPercent = holding.costValue > 0
          ? (absoluteReturn / holding.costValue) * 100
          : 0;

        // Calculate day change (change in value based on NAV difference)
        let dayChange: number | null = null;
        let dayChangePercent: number | null = null;
        if (navData.previousNav) {
          const navDiff = navData.nav - navData.previousNav;
          dayChange = holding.units * navDiff;
          dayChangePercent = (navDiff / navData.previousNav) * 100;
        }

        // Update the holding
        await db
          .update(mutualFundHoldings)
          .set({
            nav: navData.nav,
            navDate: navData.date,
            previousNav: navData.previousNav || null,
            dayChange,
            dayChangePercent,
            currentValue,
            absoluteReturn,
            absoluteReturnPercent,
            lastUpdated: now,
            updatedAt: now,
          })
          .where(eq(mutualFundHoldings.id, holding.id));

        updated++;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error: any) {
        errors.push(`Error updating ${holding.schemeName.substring(0, 30)}...: ${error.message}`);
        failed++;
      }
    }

    res.json({
      success: true,
      updated,
      failed,
      total: holdings.length,
      errors: errors.slice(0, 10), // Return first 10 errors
    });
  } catch (error) {
    console.error('Error syncing NAV:', error);
    res.status(500).json({ error: 'Failed to sync NAV' });
  }
});

// Delete a folio and all its holdings (soft delete)
router.delete('/folios/:folioId', async (req, res) => {
  try {
    const { folioId } = req.params;
    const now = new Date().toISOString();

    // Soft delete all holdings in this folio
    await db
      .update(mutualFundHoldings)
      .set({
        isActive: false,
        updatedAt: now,
      })
      .where(eq(mutualFundHoldings.folioId, folioId));

    // Soft delete the folio
    await db
      .update(mutualFundFolios)
      .set({
        isActive: false,
        updatedAt: now,
      })
      .where(eq(mutualFundFolios.id, folioId));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting folio:', error);
    res.status(500).json({ error: 'Failed to delete folio' });
  }
});

export default router;

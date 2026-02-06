import { db, portfolioSnapshots, accounts, investments, mutualFundHoldings, mutualFundFolios, loans, loanGivenDetails, assets, creditCardStatements, policies } from '../db/index.js';
import { eq, and, desc, sql, isNull, or } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { PortfolioSnapshot, NewPortfolioSnapshot } from '../db/index.js';

// Cache for exchange rate
let exchangeRateCache: { rate: number; timestamp: number } | null = null;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

async function fetchUsdToInrRate(): Promise<number> {
  if (exchangeRateCache && Date.now() - exchangeRateCache.timestamp < CACHE_DURATION) {
    return exchangeRateCache.rate;
  }

  try {
    const response = await fetch('https://www.google.com/finance/quote/USD-INR');
    const html = await response.text();

    const rateMatch = html.match(/data-last-price="([\d.]+)"/);
    if (rateMatch && rateMatch[1]) {
      const rate = parseFloat(rateMatch[1]);
      exchangeRateCache = { rate, timestamp: Date.now() };
      return rate;
    }

    const altMatch = html.match(/<div[^>]*class="[^"]*YMlKec[^"]*"[^>]*>([\d.]+)<\/div>/);
    if (altMatch && altMatch[1]) {
      const rate = parseFloat(altMatch[1]);
      exchangeRateCache = { rate, timestamp: Date.now() };
      return rate;
    }

    return exchangeRateCache?.rate || 83.5;
  } catch (error) {
    console.error('Error fetching exchange rate:', error);
    return exchangeRateCache?.rate || 83.5;
  }
}

export interface PortfolioSummary {
  // Investments (Financial) - All values in INR
  usStocksValue: number; // Converted to INR
  usStocksValueUsd: number; // Original USD value
  indiaStocksValue: number;
  mutualFundsValue: number;
  fdValue: number;
  ppfValue: number;
  goldValue: number;
  cryptoValue: number;
  otherInvestmentsValue: number;
  policiesValue: number; // Insurance policies (premium paid)

  // Physical assets
  realEstateValue: number;
  vehiclesValue: number;
  otherAssetsValue: number;

  // Receivables
  loansGivenValue: number;

  // Liabilities
  homeLoanOutstanding: number;
  carLoanOutstanding: number;
  personalLoanOutstanding: number;
  otherLoansOutstanding: number;
  creditCardDues: number;

  // Aggregates
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  totalInvestments: number;
  totalPhysicalAssets: number;

  // Exchange rate used
  exchangeRate: number;
}

/**
 * Calculate current portfolio summary for a user
 * Note: Bank balance is NOT included - this tracks investments and assets only
 * All values are returned in INR (US stocks are converted using exchange rate)
 */
export async function calculatePortfolioSummary(userId: string): Promise<PortfolioSummary> {
  // Fetch exchange rate first
  const exchangeRate = await fetchUsdToInrRate();

  // 1. Investments by type and country
  const investmentsData = await db
    .select()
    .from(investments)
    .where(and(eq(investments.userId, userId), eq(investments.isActive, true)));

  let usStocksValueUsd = 0; // Keep USD value separate
  let indiaStocksValue = 0;
  let fdValue = 0;
  let ppfValue = 0;
  let goldValue = 0;
  let cryptoValue = 0;
  let otherInvestmentsValue = 0;

  for (const inv of investmentsData) {
    // Match Investments page calculation: currentValue, or fallback to purchasePrice * quantity
    const value = inv.currentValue || ((inv.quantity || 0) * (inv.purchasePrice || 0));

    switch (inv.type) {
      case 'stocks':
        if (inv.country === 'US') {
          usStocksValueUsd += value; // Store in USD
        } else {
          indiaStocksValue += value;
        }
        break;
      case 'fd':
        fdValue += value;
        break;
      case 'ppf':
        ppfValue += value;
        break;
      case 'gold':
        goldValue += value;
        break;
      case 'crypto':
        cryptoValue += value;
        break;
      default:
        otherInvestmentsValue += value;
    }
  }

  // Convert US stocks to INR
  const usStocksValue = usStocksValueUsd * exchangeRate;

  // 3. Mutual Funds - Sum of all holdings current value
  const mfFolios = await db
    .select()
    .from(mutualFundFolios)
    .where(eq(mutualFundFolios.userId, userId));

  const folioIds = mfFolios.map(f => f.id);
  let mutualFundsValue = 0;

  if (folioIds.length > 0) {
    const mfHoldings = await db
      .select()
      .from(mutualFundHoldings)
      .where(sql`${mutualFundHoldings.folioId} IN (${sql.join(folioIds.map(id => sql`${id}`), sql`, `)})`);
    mutualFundsValue = mfHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
  }

  // 4. Physical Assets
  const assetsData = await db
    .select()
    .from(assets)
    .where(and(eq(assets.userId, userId), eq(assets.status, 'owned')));

  let realEstateValue = 0;
  let vehiclesValue = 0;
  let otherAssetsValue = 0;

  for (const asset of assetsData) {
    const value = asset.currentValue || asset.purchaseValue || 0;
    switch (asset.type) {
      case 'house':
      case 'apartment':
      case 'land':
        realEstateValue += value;
        break;
      case 'vehicle':
        vehiclesValue += value;
        break;
      default:
        otherAssetsValue += value;
    }
  }

  // 5. Loans Given (money to receive)
  const loansGivenData = await db
    .select()
    .from(loans)
    .where(and(
      eq(loans.userId, userId),
      eq(loans.type, 'given'),
      eq(loans.status, 'active')
    ));

  let loansGivenValue = 0;
  for (const loan of loansGivenData) {
    // Get the latest loan_given_details entry
    const details = await db
      .select()
      .from(loanGivenDetails)
      .where(eq(loanGivenDetails.loanId, loan.id))
      .orderBy(desc(loanGivenDetails.date))
      .limit(1);

    if (details.length > 0) {
      loansGivenValue += details[0].toGet || 0;
    } else {
      loansGivenValue += loan.outstandingAmount || 0;
    }
  }

  // 6. Loans Taken (liabilities)
  const loansTakenData = await db
    .select()
    .from(loans)
    .where(and(
      eq(loans.userId, userId),
      sql`${loans.type} != 'given'`,
      eq(loans.status, 'active')
    ));

  let homeLoanOutstanding = 0;
  let carLoanOutstanding = 0;
  let personalLoanOutstanding = 0;
  let otherLoansOutstanding = 0;

  for (const loan of loansTakenData) {
    const outstanding = loan.outstandingAmount || 0;
    switch (loan.loanType) {
      case 'home':
        homeLoanOutstanding += outstanding;
        break;
      case 'car':
        carLoanOutstanding += outstanding;
        break;
      case 'personal':
        personalLoanOutstanding += outstanding;
        break;
      default:
        otherLoansOutstanding += outstanding;
    }
  }

  // 7. Credit Card Dues - Latest statements for each CC account
  const ccAccounts = await db
    .select()
    .from(accounts)
    .where(and(
      eq(accounts.userId, userId),
      eq(accounts.accountType, 'credit_card'),
      eq(accounts.isActive, true)
    ));

  let creditCardDues = 0;
  for (const ccAcc of ccAccounts) {
    const latestStatement = await db
      .select()
      .from(creditCardStatements)
      .where(eq(creditCardStatements.accountId, ccAcc.id))
      .orderBy(desc(creditCardStatements.statementDate))
      .limit(1);

    if (latestStatement.length > 0) {
      creditCardDues += latestStatement[0].totalDue || 0;
    }
  }

  // 8. Insurance Policies - use current/maturity value, not premium paid
  const policiesData = await db
    .select()
    .from(policies)
    .where(and(
      eq(policies.userId, userId),
      eq(policies.status, 'active')
    ));

  let policiesValue = 0;
  for (const policy of policiesData) {
    // Use maturity benefit if available, else premium + bonus as approximation
    // Term insurance (type='term') has no investment value
    if (policy.type === 'term') {
      continue; // Term insurance has no cash value
    }
    if (policy.maturityBenefit) {
      policiesValue += policy.maturityBenefit;
    } else {
      // Approximate current value as premium paid + bonus accrued
      policiesValue += (policy.totalPremiumPaid || 0) + (policy.bonusAccrued || 0);
    }
  }

  // Calculate aggregates (excluding bank balance - tracking investments only)
  const totalInvestments = usStocksValue + indiaStocksValue + mutualFundsValue +
    fdValue + ppfValue + goldValue + cryptoValue + otherInvestmentsValue + policiesValue;

  const totalPhysicalAssets = realEstateValue + vehiclesValue + otherAssetsValue;

  // Total assets = investments + physical assets + loans given (no bank balance)
  const totalAssets = totalInvestments + totalPhysicalAssets + loansGivenValue;

  const totalLiabilities = homeLoanOutstanding + carLoanOutstanding +
    personalLoanOutstanding + otherLoansOutstanding + creditCardDues;

  const netWorth = totalAssets - totalLiabilities;

  return {
    usStocksValue,
    usStocksValueUsd,
    indiaStocksValue,
    mutualFundsValue,
    fdValue,
    ppfValue,
    goldValue,
    cryptoValue,
    otherInvestmentsValue,
    policiesValue,
    realEstateValue,
    vehiclesValue,
    otherAssetsValue,
    loansGivenValue,
    homeLoanOutstanding,
    carLoanOutstanding,
    personalLoanOutstanding,
    otherLoansOutstanding,
    creditCardDues,
    totalAssets,
    totalLiabilities,
    netWorth,
    totalInvestments,
    totalPhysicalAssets,
    exchangeRate,
  };
}

/**
 * Capture a portfolio snapshot
 */
export async function captureSnapshot(
  userId: string,
  isManual: boolean = false,
  notes?: string
): Promise<PortfolioSnapshot> {
  const now = new Date();
  const snapshotDate = now.toISOString().split('T')[0];
  const snapshotTime = now.toISOString().split('T')[1].split('.')[0];

  const summary = await calculatePortfolioSummary(userId);

  // Get previous snapshot for day change calculation
  const prevSnapshot = await db
    .select()
    .from(portfolioSnapshots)
    .where(and(
      eq(portfolioSnapshots.userId, userId),
      sql`${portfolioSnapshots.snapshotDate} < ${snapshotDate}`
    ))
    .orderBy(desc(portfolioSnapshots.snapshotDate), desc(portfolioSnapshots.snapshotTime))
    .limit(1);

  let dayChangeAmount = 0;
  let dayChangePercent = 0;

  if (prevSnapshot.length > 0) {
    const prevNetWorth = prevSnapshot[0].netWorth || 0;
    dayChangeAmount = summary.netWorth - prevNetWorth;
    dayChangePercent = prevNetWorth !== 0 ? (dayChangeAmount / prevNetWorth) * 100 : 0;
  }

  const newSnapshot: NewPortfolioSnapshot = {
    id: uuidv4(),
    userId,
    snapshotDate,
    snapshotTime,
    ...summary,
    dayChangeAmount,
    dayChangePercent,
    isManualCapture: isManual,
    notes: notes || null,
    createdAt: now.toISOString(),
  };

  await db.insert(portfolioSnapshots).values(newSnapshot);

  return newSnapshot as PortfolioSnapshot;
}

/**
 * Get snapshot history for a user
 */
export async function getSnapshotHistory(
  userId: string,
  startDate?: string,
  endDate?: string,
  limit?: number
): Promise<PortfolioSnapshot[]> {
  let query = db
    .select()
    .from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.userId, userId))
    .orderBy(desc(portfolioSnapshots.snapshotDate), desc(portfolioSnapshots.snapshotTime));

  if (startDate && endDate) {
    query = db
      .select()
      .from(portfolioSnapshots)
      .where(and(
        eq(portfolioSnapshots.userId, userId),
        sql`${portfolioSnapshots.snapshotDate} >= ${startDate}`,
        sql`${portfolioSnapshots.snapshotDate} <= ${endDate}`
      ))
      .orderBy(desc(portfolioSnapshots.snapshotDate), desc(portfolioSnapshots.snapshotTime)) as typeof query;
  }

  if (limit) {
    query = query.limit(limit) as typeof query;
  }

  return query;
}

/**
 * Get the latest snapshot for a user
 */
export async function getLatestSnapshot(userId: string): Promise<PortfolioSnapshot | null> {
  const snapshots = await db
    .select()
    .from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.userId, userId))
    .orderBy(desc(portfolioSnapshots.snapshotDate), desc(portfolioSnapshots.snapshotTime))
    .limit(1);

  return snapshots[0] || null;
}

/**
 * Create initial seed snapshot with 10% less values (for chart visualization)
 */
export async function createSeedSnapshot(userId: string): Promise<PortfolioSnapshot> {
  const summary = await calculatePortfolioSummary(userId);

  // Create a snapshot dated yesterday with 10% less values
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const snapshotDate = yesterday.toISOString().split('T')[0];
  const snapshotTime = '21:30:00'; // US market close time in IST

  const seedSnapshot: NewPortfolioSnapshot = {
    id: uuidv4(),
    userId,
    snapshotDate,
    snapshotTime,
    usStocksValue: summary.usStocksValue * 0.9,
    indiaStocksValue: summary.indiaStocksValue * 0.9,
    mutualFundsValue: summary.mutualFundsValue * 0.9,
    fdValue: summary.fdValue * 0.9,
    ppfValue: summary.ppfValue * 0.9,
    goldValue: summary.goldValue * 0.9,
    cryptoValue: summary.cryptoValue * 0.9,
    otherInvestmentsValue: summary.otherInvestmentsValue * 0.9,
    policiesValue: summary.policiesValue * 0.9, // Insurance policies
    realEstateValue: summary.realEstateValue, // Physical assets don't change daily
    vehiclesValue: summary.vehiclesValue,
    otherAssetsValue: summary.otherAssetsValue,
    loansGivenValue: summary.loansGivenValue * 0.9,
    homeLoanOutstanding: summary.homeLoanOutstanding * 1.001, // Slightly more outstanding
    carLoanOutstanding: summary.carLoanOutstanding * 1.001,
    personalLoanOutstanding: summary.personalLoanOutstanding * 1.001,
    otherLoansOutstanding: summary.otherLoansOutstanding * 1.001,
    creditCardDues: summary.creditCardDues * 1.1, // Slightly more dues
    totalAssets: summary.totalAssets * 0.9,
    totalLiabilities: summary.totalLiabilities * 1.01,
    netWorth: summary.netWorth * 0.9,
    totalInvestments: summary.totalInvestments * 0.9,
    totalPhysicalAssets: summary.totalPhysicalAssets,
    dayChangeAmount: 0,
    dayChangePercent: 0,
    isManualCapture: false,
    notes: 'Initial seed data',
    createdAt: yesterday.toISOString(),
  };

  await db.insert(portfolioSnapshots).values(seedSnapshot);

  return seedSnapshot as PortfolioSnapshot;
}

/**
 * Get aggregated performance data for charts
 */
/**
 * Fetch historical stock prices from Yahoo Finance
 */
async function fetchHistoricalPrices(
  symbol: string,
  days: number = 30
): Promise<{ date: string; close: number }[]> {
  try {
    const endDate = Math.floor(Date.now() / 1000);
    const startDate = endDate - days * 24 * 60 * 60;

    // Yahoo Finance chart API
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${startDate}&period2=${endDate}&interval=1d`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch prices for ${symbol}: ${response.status}`);
      return [];
    }

    const data = await response.json() as {
      chart?: { result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: (number | null)[] }> };
      }> };
    };
    const result = data.chart?.result?.[0];

    if (!result || !result.timestamp || !result.indicators?.quote?.[0]?.close) {
      return [];
    }

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;

    const prices: { date: string; close: number }[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const closePrice = closes[i];
      if (closePrice !== null && closePrice !== undefined) {
        const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
        prices.push({ date, close: closePrice });
      }
    }

    return prices;
  } catch (error) {
    console.error(`Error fetching historical prices for ${symbol}:`, error);
    return [];
  }
}

/**
 * Get stock trends - historical performance based on current holdings
 * Assumes same quantity held for past 30 days, uses historical ticker prices
 */
export async function getStockTrends(
  userId: string,
  days: number = 30
): Promise<{
  labels: string[];
  totalValue: number[];
  usStocksValue: number[];
  indiaStocksValue: number[];
  stocks: Array<{
    symbol: string;
    name: string;
    country: string;
    quantity: number;
    values: number[];
  }>;
}> {
  // Fetch exchange rate
  const exchangeRate = await fetchUsdToInrRate();

  // Get user's stock holdings
  const stockHoldings = await db
    .select()
    .from(investments)
    .where(and(
      eq(investments.userId, userId),
      eq(investments.type, 'stocks'),
      eq(investments.isActive, true)
    ));

  if (stockHoldings.length === 0) {
    return {
      labels: [],
      totalValue: [],
      usStocksValue: [],
      indiaStocksValue: [],
      stocks: [],
    };
  }

  // Fetch historical prices for each stock
  const stockPricePromises = stockHoldings.map(async (stock) => {
    // Convert symbol for Yahoo Finance
    let yahooSymbol = stock.symbol || '';

    // For Indian stocks, add .NS (NSE) or .BO (BSE) suffix if not present
    if (stock.country === 'IN' && yahooSymbol && !yahooSymbol.includes('.')) {
      yahooSymbol = `${yahooSymbol}.NS`;
    }

    const prices = await fetchHistoricalPrices(yahooSymbol, days);

    return {
      stock,
      symbol: yahooSymbol,
      prices,
    };
  });

  const stockPrices = await Promise.all(stockPricePromises);

  // Build date range (last N days)
  const dates: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }

  // Calculate daily values for each stock
  const stockResults = stockPrices.map(({ stock, symbol, prices }) => {
    const quantity = stock.quantity || 0;
    const priceMap = new Map(prices.map(p => [p.date, p.close]));

    // Fill in values for each date (use last known price for missing dates)
    let lastKnownPrice = stock.currentPrice || stock.purchasePrice || 0;
    const values: number[] = [];

    for (const date of dates) {
      if (priceMap.has(date)) {
        lastKnownPrice = priceMap.get(date)!;
      }
      values.push(lastKnownPrice * quantity);
    }

    return {
      symbol: stock.symbol || '',
      name: stock.name || stock.symbol || '',
      country: stock.country || 'IN',
      quantity,
      values,
    };
  });

  // Calculate totals per day
  const totalValue: number[] = [];
  const usStocksValue: number[] = [];
  const indiaStocksValue: number[] = [];

  for (let i = 0; i < dates.length; i++) {
    let total = 0;
    let usTotal = 0;
    let indiaTotal = 0;

    for (const stock of stockResults) {
      const value = stock.values[i] || 0;
      if (stock.country === 'US') {
        // Convert to INR
        const inrValue = value * exchangeRate;
        usTotal += inrValue;
        total += inrValue;
      } else {
        indiaTotal += value;
        total += value;
      }
    }

    totalValue.push(total);
    usStocksValue.push(usTotal);
    indiaStocksValue.push(indiaTotal);
  }

  // Format labels (short date format)
  const labels = dates.map(d => {
    const date = new Date(d);
    return `${date.getDate()}/${date.getMonth() + 1}`;
  });

  return {
    labels,
    totalValue,
    usStocksValue,
    indiaStocksValue,
    stocks: stockResults,
  };
}

export async function getPerformanceData(
  userId: string,
  period: 'daily' | 'weekly' | 'monthly' | 'quarterly' = 'daily',
  limit: number = 30
): Promise<{
  labels: string[];
  netWorth: number[];
  totalInvestments: number[];
  totalLiabilities: number[];
  usStocksValue: number[];
  indiaStocksValue: number[];
  mutualFundsValue: number[];
}> {
  const snapshots = await getSnapshotHistory(userId, undefined, undefined, limit * 7); // Get extra for aggregation

  if (snapshots.length === 0) {
    return {
      labels: [],
      netWorth: [],
      totalInvestments: [],
      totalLiabilities: [],
      usStocksValue: [],
      indiaStocksValue: [],
      mutualFundsValue: [],
    };
  }

  // Group by period
  const grouped = new Map<string, PortfolioSnapshot[]>();

  for (const snapshot of snapshots) {
    let key: string;
    const date = new Date(snapshot.snapshotDate);

    switch (period) {
      case 'weekly':
        // Get week start (Monday)
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay() + 1);
        key = weekStart.toISOString().split('T')[0];
        break;
      case 'monthly':
        key = snapshot.snapshotDate.substring(0, 7); // YYYY-MM
        break;
      case 'quarterly':
        const quarter = Math.floor(date.getMonth() / 3) + 1;
        key = `${date.getFullYear()}-Q${quarter}`;
        break;
      default:
        key = snapshot.snapshotDate;
    }

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(snapshot);
  }

  // Get latest snapshot for each period
  const aggregated: { label: string; snapshot: PortfolioSnapshot }[] = [];
  for (const [label, snaps] of grouped) {
    // Sort by date desc and take the latest
    snaps.sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
    aggregated.push({ label, snapshot: snaps[0] });
  }

  // Sort by date asc and limit
  aggregated.sort((a, b) => a.label.localeCompare(b.label));
  const limited = aggregated.slice(-limit);

  return {
    labels: limited.map(d => d.label),
    netWorth: limited.map(d => d.snapshot.netWorth || 0),
    totalInvestments: limited.map(d => d.snapshot.totalInvestments || 0),
    totalLiabilities: limited.map(d => d.snapshot.totalLiabilities || 0),
    usStocksValue: limited.map(d => d.snapshot.usStocksValue || 0),
    indiaStocksValue: limited.map(d => d.snapshot.indiaStocksValue || 0),
    mutualFundsValue: limited.map(d => d.snapshot.mutualFundsValue || 0),
  };
}

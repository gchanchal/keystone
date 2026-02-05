import { v4 as uuidv4 } from 'uuid';
import type { NewInvestment } from '../db/index.js';

export interface ParsedETradeHolding {
  symbol: string;
  name: string;
  quantity: number;
  purchasePrice: number;
  currentPrice: number;
  currentValue: number;
  dayGain: number;
  totalGain: number;
  totalGainPercent: number;
}

export interface ParsedETradePortfolio {
  accountName: string;
  netAccountValue: number;
  totalGain: number;
  totalGainPercent: number;
  holdings: ParsedETradeHolding[];
}

function parseNumber(value: string | undefined): number {
  if (!value || value === '') return 0;
  // Remove commas and parse
  return parseFloat(value.replace(/,/g, '')) || 0;
}

export function parseETradePortfolio(csvContent: string): ParsedETradePortfolio {
  const lines = csvContent.split('\n').map(line => line.trim());

  let accountName = '';
  let netAccountValue = 0;
  let totalGain = 0;
  let totalGainPercent = 0;
  const holdings: ParsedETradeHolding[] = [];

  let inAccountSummary = false;
  let inPositions = false;
  let positionHeaderFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect sections
    if (line === 'Account Summary') {
      inAccountSummary = true;
      continue;
    }

    if (line.includes('View Summary - All Positions')) {
      inAccountSummary = false;
      inPositions = true;
      continue;
    }

    // Parse Account Summary
    if (inAccountSummary && line.startsWith('"')) {
      // Parse the account info line
      // Format: "Individual Brokerage -8509",588703.23,378744.83,196.15,...
      const parts = line.split(',');
      accountName = parts[0].replace(/"/g, '').trim();
      netAccountValue = parseNumber(parts[1]);
      totalGain = parseNumber(parts[2]);
      totalGainPercent = parseNumber(parts[3]);
      inAccountSummary = false;
      continue;
    }

    // Parse positions
    if (inPositions) {
      // Skip filter info lines
      if (line.startsWith('Filters') || line.startsWith('Symbol,Security')) {
        continue;
      }

      // Look for position header
      if (line === 'Symbol,Last Price $,Change $,Change %,Quantity,Price Paid $,Day\'s Gain $,Total Gain $,Total Gain %,Value $') {
        positionHeaderFound = true;
        continue;
      }

      if (positionHeaderFound && line) {
        // Parse position line
        const parts = line.split(',');
        const symbol = parts[0];

        // Skip empty lines, CASH, TOTAL rows
        if (!symbol || symbol === 'CASH' || symbol === 'TOTAL' || symbol === '') {
          continue;
        }

        // Skip if it looks like metadata
        if (symbol.startsWith('Generated') || symbol.startsWith('Filters')) {
          continue;
        }

        const lastPrice = parseNumber(parts[1]);
        const changeAmount = parseNumber(parts[2]);
        const changePercent = parseNumber(parts[3]);
        const quantity = parseNumber(parts[4]);
        const pricePaid = parseNumber(parts[5]);
        const dayGain = parseNumber(parts[6]);
        const holdingTotalGain = parseNumber(parts[7]);
        const holdingTotalGainPercent = parseNumber(parts[8]);
        const value = parseNumber(parts[9]);

        if (symbol && quantity > 0) {
          holdings.push({
            symbol,
            name: symbol, // ETrade CSV doesn't include full name
            quantity,
            purchasePrice: pricePaid / quantity, // Per share cost
            currentPrice: lastPrice,
            currentValue: value,
            dayGain,
            totalGain: holdingTotalGain,
            totalGainPercent: holdingTotalGainPercent,
          });
        }
      }
    }
  }

  console.log('Parsed ETrade portfolio:', accountName);
  console.log('Holdings:', holdings.length);
  console.log('Net value:', netAccountValue);

  return {
    accountName,
    netAccountValue,
    totalGain,
    totalGainPercent,
    holdings,
  };
}

export function convertToDBInvestments(
  parsed: ParsedETradePortfolio,
  uploadId: string
): NewInvestment[] {
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  return parsed.holdings.map(h => ({
    id: uuidv4(),
    name: h.name,
    type: 'stocks',
    symbol: h.symbol,
    platform: 'ETrade',
    country: 'US', // ETrade is US investment
    quantity: h.quantity,
    purchasePrice: h.purchasePrice,
    purchaseDate: today, // We don't have actual purchase date from CSV
    currentPrice: h.currentPrice,
    currentValue: h.currentValue,
    lastUpdated: now,
    notes: `Imported from ETrade. Total Gain: ${h.totalGainPercent.toFixed(2)}%`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));
}

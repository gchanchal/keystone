/**
 * HDFC Infinia Credit Card Statement Parser
 * Specialized parser for HDFC Infinia card statements with support for:
 * - Multiple card holders (main + add-on)
 * - EMI transactions
 * - Reward points tracking
 * - Purchase Indicator (PI) categories
 * - Statement metadata extraction
 */

import pdfParse from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import type { NewCreditCardTransaction, NewCreditCardStatement } from '../db/index.js';

export interface ParsedHDFCInfiniaTransaction {
  date: string;
  time: string;
  description: string;
  merchantLocation: string;
  amount: number;
  transactionType: 'credit' | 'debit';
  isEmi: boolean;
  emiTenure?: number;
  rewardPoints: number;
  piCategory: string;
  cardHolderName: string;
}

export interface CardHolderInfo {
  name: string;
  isPrimary: boolean;
  cardLastFour?: string;
}

export interface HDFCInfiniaStatementData {
  cardNumber: string;
  primaryHolder: string;
  statementDate: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  dueDate: string;
  totalDue: number;
  minimumDue: number;
  creditLimit: number;
  availableLimit: number;
  rewardPointsBalance: number;
  rewardPointsEarned: number;
  rewardPointsRedeemed: number;
  cashbackEarned: number;
  openingBalance: number;
  closingBalance: number;
  totalCredits: number;
  totalDebits: number;
  financeCharges: number;
  cardHolders: CardHolderInfo[];
  transactions: ParsedHDFCInfiniaTransaction[];
}

// Date patterns
const DATE_PATTERN = /(\d{2})\/(\d{2})\/(\d{4})/;
const TIME_PATTERN = /(\d{2}):(\d{2})/;
const AMOUNT_PATTERN = /[\d,]+\.\d{2}/;

// Card holder detection patterns - look for all-caps names followed by transaction sections
const CARD_HOLDER_PATTERN = /^([A-Z][A-Z\s]+[A-Z])$/m;

// EMI detection patterns
const EMI_PATTERNS = [
  /EMI\s*(\d+)\s*OF\s*(\d+)/i,
  /(\d+)\s*\/\s*(\d+)\s*EMI/i,
  /EMI\s*#?\s*(\d+)/i,
];

function parseDate(dateStr: string): string {
  const match = dateStr.match(DATE_PATTERN);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}

function parseAmount(amountStr: string): number {
  if (!amountStr) return 0;
  const cleaned = amountStr.replace(/[,\s]/g, '');
  return parseFloat(cleaned) || 0;
}

function extractTime(text: string): string {
  const match = text.match(TIME_PATTERN);
  return match ? match[0] : '';
}

function extractMerchantLocation(description: string): string {
  // Common location patterns in credit card descriptions
  // e.g., "AMAZON INDIA BANGALORE IN" or "SWIGGY BANGALORE"
  const locationPatterns = [
    /\b(BANGALORE|BENGALURU|MUMBAI|DELHI|CHENNAI|HYDERABAD|PUNE|KOLKATA|GURGAON|NOIDA|AHMEDABAD|JAIPUR)\b/i,
    /\s([A-Z]{2,3})\s*$/,  // State/country code at end
    /\s(IN|IND|INDIA)\s*$/i,
  ];

  for (const pattern of locationPatterns) {
    const match = description.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }
  return '';
}

function detectEmi(description: string): { isEmi: boolean; tenure?: number; currentInstallment?: number } {
  for (const pattern of EMI_PATTERNS) {
    const match = description.match(pattern);
    if (match) {
      const current = parseInt(match[1], 10);
      const total = match[2] ? parseInt(match[2], 10) : undefined;
      return { isEmi: true, tenure: total, currentInstallment: current };
    }
  }
  return { isEmi: false };
}

function extractPICategory(text: string): string {
  // HDFC uses Purchase Indicator codes
  // Common PI categories: TRAVEL, DINING, SHOPPING, FUEL, GROCERIES, etc.
  const piPatterns = [
    { pattern: /\b(FLIGHT|AIRLINE|AIRWAYS|AVIATION|IRCTC|RAILWAY|TRAIN)\b/i, category: 'TRAVEL' },
    { pattern: /\b(RESTAURANT|CAFE|SWIGGY|ZOMATO|FOOD|DINING|DOMINO|PIZZA|MCDONALD|KFC|STARBUCKS)\b/i, category: 'DINING' },
    { pattern: /\b(AMAZON|FLIPKART|MYNTRA|AJIO|SHOPPING|MALL|RETAIL)\b/i, category: 'SHOPPING' },
    { pattern: /\b(PETROL|DIESEL|FUEL|IOCL|HPCL|BPCL|SHELL|RELIANCE PETRO)\b/i, category: 'FUEL' },
    { pattern: /\b(GROCERY|BIGBASKET|DMART|MORE|RELIANCE FRESH|GROFERS|BLINKIT)\b/i, category: 'GROCERIES' },
    { pattern: /\b(NETFLIX|PRIME|HOTSTAR|SPOTIFY|YOUTUBE|SUBSCRIPTION)\b/i, category: 'ENTERTAINMENT' },
    { pattern: /\b(HOSPITAL|CLINIC|PHARMACY|MEDICAL|HEALTH|APOLLO|FORTIS)\b/i, category: 'HEALTHCARE' },
    { pattern: /\b(EDUCATION|SCHOOL|COLLEGE|UNIVERSITY|COURSE|TRAINING)\b/i, category: 'EDUCATION' },
    { pattern: /\b(UTILITY|ELECTRICITY|WATER|GAS|BILL PAYMENT)\b/i, category: 'UTILITIES' },
    { pattern: /\b(INSURANCE|LIC|ICICI PRUDENTIAL|HDFC LIFE|PREMIUM)\b/i, category: 'INSURANCE' },
    { pattern: /\b(RENT|HOUSING|PROPERTY)\b/i, category: 'RENT' },
    { pattern: /\b(EMI|LOAN)\b/i, category: 'EMI' },
  ];

  for (const { pattern, category } of piPatterns) {
    if (pattern.test(text)) {
      return category;
    }
  }
  return 'OTHER';
}

function parseStatementHeader(text: string): Partial<HDFCInfiniaStatementData> {
  const result: Partial<HDFCInfiniaStatementData> = {
    cardHolders: [],
    transactions: [],
  };

  // The PDF extracts with labels on separate lines from values in a columnar format:
  // Credit Card No.
  // Alternate Account Number
  // Statement Date
  // Billing Period
  // 437546XXXXXX8810        <- card number
  // 0001015710000108816     <- alternate account
  // 23 Jan, 2026            <- statement date
  // 24 Dec, 2025 - 23 Jan, 2026  <- billing period

  // Extract card number - directly match the pattern anywhere in text
  const cardNumMatch = text.match(/(\d{6}X+\d{4})/i);
  if (cardNumMatch) {
    result.cardNumber = cardNumMatch[1];
  }

  // Extract statement date - look for date pattern after "Statement Date" (across multiple lines)
  // Find context around Statement Date and extract the date value
  const stmtDateContext = text.match(/Statement\s*Date[\s\S]*?(\d{1,2}\s+[A-Za-z]{3},?\s+\d{4})/i);
  if (stmtDateContext) {
    result.statementDate = parseDateText(stmtDateContext[1]);
  }

  // Extract billing period - look for date range pattern after "Billing Period"
  const billingContext = text.match(/Billing\s*Period[\s\S]*?(\d{1,2}\s+[A-Za-z]{3},?\s+\d{4})\s*[-–]\s*(\d{1,2}\s+[A-Za-z]{3},?\s+\d{4})/i);
  if (billingContext) {
    result.billingPeriodStart = parseDateText(billingContext[1]);
    result.billingPeriodEnd = parseDateText(billingContext[2]);
  }

  // Extract due date - appears after "DUE DATE" label on next line: "12 Feb, 2026"
  const dueDateMatch = text.match(/DUE\s*DATE\s*\n(\d{1,2}\s+[A-Za-z]+,?\s+\d{4})/i) ||
                       text.match(/DUE\s*DATE[\s\S]*?(\d{1,2}\s+[A-Za-z]+,?\s+\d{4})/i);
  if (dueDateMatch) {
    result.dueDate = parseDateText(dueDateMatch[1]);
  }

  // Extract total amount due - "TOTAL AMOUNT DUE" followed by newline then "C3,30,058.00"
  const totalDueMatch = text.match(/TOTAL\s*AMOUNT\s*DUE\s*\n[C₹]?\s*([\d,]+\.\d{2})/i) ||
                        text.match(/TOTAL\s*AMOUNT\s*DUE[\s\S]*?[C₹]\s*([\d,]+\.\d{2})/i);
  if (totalDueMatch) {
    result.totalDue = parseAmount(totalDueMatch[1]);
  }

  // Extract minimum amount due - "MINIMUM DUE" followed by newline then "C16,510.00"
  const minDueMatch = text.match(/MINIMUM\s*DUE\s*\n[C₹]?\s*([\d,]+\.\d{2})/i) ||
                      text.match(/MINIMUM\s*DUE[\s\S]*?[C₹]\s*([\d,]+\.\d{2})/i);
  if (minDueMatch) {
    result.minimumDue = parseAmount(minDueMatch[1]);
  }

  // Extract credit limit from line: "TOTAL CREDIT LIMIT" ... "C8,00,000C4,58,268C3,20,000"
  // The pattern appears as continuous text: C8,00,000C4,58,268C3,20,000
  const creditLimitMatch = text.match(/TOTAL\s*CREDIT\s*LIMIT[\s\S]*?[C₹]\s*([\d,]+)[C₹]([\d,]+)[C₹]([\d,]+)/i);
  if (creditLimitMatch) {
    result.creditLimit = parseAmount(creditLimitMatch[1]);      // Total credit limit: 8,00,000
    result.availableLimit = parseAmount(creditLimitMatch[2]);   // Available credit: 4,58,268
    // creditLimitMatch[3] is available cash limit: 3,20,000
  } else {
    // Fallback: try individual patterns
    const creditMatch = text.match(/TOTAL\s*CREDIT\s*LIMIT[\s\S]*?[C₹]\s*([\d,]+)/i);
    if (creditMatch) {
      result.creditLimit = parseAmount(creditMatch[1]);
    }
  }

  // Extract reward points - format:
  // "Reward Points"
  // "1,48,893"              <- current balance (on its own line)
  // "REDEEM REWARDS"
  // Then later: "Opening BalanceFeature + Bonus Reward"
  // "Points Earned"
  // "DisbursedAdjusted/Lapsed"
  // "1,65,10214,13029,674665"  <- values all concatenated

  // Current balance appears right after "Reward Points" label
  const rewardBalanceMatch = text.match(/Reward\s*Points\s*\n([\d,]+)/i);
  if (rewardBalanceMatch) {
    result.rewardPointsBalance = parseInt(rewardBalanceMatch[1].replace(/,/g, ''), 10);
  }

  // The values row looks like: "1,65,10214,13029,674665" (concatenated without spaces)
  // These are: Opening Balance, Feature + Bonus Reward, Points Earned, Disbursed, Adjusted/Lapsed
  // Actually the format shows: "1,65,10214,13029,674665" which is:
  // 1,65,102 (opening) 14,130 (earned) 29,674 (bonus/disbursed) 665 (adjusted)
  const rewardDetailsMatch = text.match(/([\d,]+)([\d,]+)([\d,]+)([\d]+)\s*\nPOINTS/i) ||
                             text.match(/Adjusted\/Lapsed\s*\n([\d,]+)/i);
  if (rewardDetailsMatch && rewardDetailsMatch.length >= 4) {
    // Parse the concatenated values - they don't have separators
    // This needs more careful parsing since values are concatenated
  }

  // Extract opening balance from "PREVIOUS STATEMENT DUES" section
  // Format: "C2,61,320.79C2,81,337.20C3,50,074.10C0.00" (concatenated)
  const balanceRowMatch = text.match(/FINANCE\s*CHARGES\s*\n[C₹]?([\d,]+\.\d{2})[C₹]([\d,]+\.\d{2})[C₹]([\d,]+\.\d{2})[C₹]([\d,]+\.\d{2})/i);
  if (balanceRowMatch) {
    result.openingBalance = parseAmount(balanceRowMatch[1]); // Previous statement dues: 2,61,320.79
    // balanceRowMatch[2] is payments received: 2,81,337.20
    // balanceRowMatch[3] is purchases/debit: 3,50,074.10
    result.financeCharges = parseAmount(balanceRowMatch[4]); // Finance charges: 0.00
  }

  return result;
}

// Parse date in format "23 Jan, 2026" or "24 Dec, 2025" to ISO format
function parseDateText(dateStr: string): string {
  if (!dateStr) return '';

  const months: Record<string, string> = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
    'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
    'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  };

  // Match patterns like "23 Jan, 2026" or "23 Jan 2026"
  const match = dateStr.match(/(\d{1,2})\s+([A-Za-z]{3}),?\s+(\d{4})/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = months[match[2].toLowerCase()] || '01';
    const year = match[3];
    return `${year}-${month}-${day}`;
  }

  // Fallback to DD/MM/YYYY format
  const ddmmMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (ddmmMatch) {
    return `${ddmmMatch[3]}-${ddmmMatch[2]}-${ddmmMatch[1]}`;
  }

  return dateStr;
}

function extractCardHolders(text: string): CardHolderInfo[] {
  const holders: CardHolderInfo[] = [];

  // HDFC Infinia statements show card holder names in specific locations:
  // 1. In the address block: "SHWETA SHUKLA CHANCHAL\n194 RAINBOW RESIDENCY..."
  // 2. Before transaction sections: "SHWETA S CHANCHAL" followed by transactions
  // 3. "GAURAV CHANCHAL" as another card holder section

  // Common false positives to skip - these are headers/labels, not names
  const skipPatterns = new Set([
    'TOTAL AMOUNT DUE', 'TOTAL AMOUNT', 'MINIMUM DUE', 'DUE DATE', 'CREDIT LIMIT',
    'TOTAL CREDIT LIMIT', 'AVAILABLE CREDIT LIMIT', 'AVAILABLE CASH LIMIT',
    'DOMESTIC TRANSACTIONS', 'INTERNATIONAL TRANSACTIONS', 'REWARD POINTS',
    'OPENING BALANCE', 'CLOSING BALANCE', 'PAYMENT RECEIVED', 'HDFC BANK',
    'REDEEM REWARDS', 'POINTS EXPIRING', 'IMPORTANT INFORMATION', 'OVER LIMIT',
    'CURRENT DUES', 'MINIMUM DUES', 'PREVIOUS STATEMENT DUES', 'FINANCE CHARGES',
    'CONVERT TO EMI', 'MODIFY ON', 'CARD CONTROL', 'PURCHASE INDICATOR',
    'BILLING PERIOD', 'STATEMENT DATE', 'TRANSACTION DESCRIPTION', 'DATE TIME',
    'OPPOSITE', 'WIPRO OFFICE', 'AVAILABLE CREDIT LIMITAVAILABLE CASH LIMIT',
  ]);

  // Look for card holder names that appear right before transaction rows
  // Pattern: A line with just a name (2-4 words, all caps) followed by transaction date lines
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and lines that are too short or too long
    if (!line || line.length < 6 || line.length > 50) continue;

    // Check if this line could be a card holder name
    // Must be 2-4 words, all uppercase letters and spaces only
    if (!/^[A-Z][A-Z\s]+[A-Z]$/.test(line)) continue;

    // Must have 2-4 words (first, middle initial optional, last)
    const words = line.split(/\s+/).filter(w => w.length > 0);
    if (words.length < 2 || words.length > 4) continue;

    // Skip known false positives
    if (skipPatterns.has(line)) continue;

    // Check if next non-empty line looks like a transaction (starts with date DD/MM/YYYY)
    let nextIdx = i + 1;
    while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++;

    if (nextIdx < lines.length) {
      const nextLine = lines[nextIdx].trim();
      // If followed by a transaction date, this is a card holder name
      if (/^\d{2}\/\d{2}\/\d{4}/.test(nextLine)) {
        const name = line;
        if (!holders.find(h => h.name === name)) {
          holders.push({ name, isPrimary: holders.length === 0 });
        }
      }
    }
  }

  // Also extract the primary card holder from the address block
  // Pattern: "Email : xxx@xxx.com\nCredit Card No." with name appearing before email
  const addressMatch = text.match(/([A-Z][A-Z\s]+[A-Z])\n[\dA-Z\s]+\n.*\nEmail\s*:/i);
  if (addressMatch) {
    const name = addressMatch[1].trim();
    if (!skipPatterns.has(name) && !holders.find(h => h.name === name)) {
      // This is the main account holder - insert at beginning
      holders.unshift({ name, isPrimary: true });
      // Mark any existing holders as non-primary
      for (let i = 1; i < holders.length; i++) {
        holders[i].isPrimary = false;
      }
    }
  }

  return holders;
}

function parseTransactionLines(text: string, cardHolders: CardHolderInfo[]): ParsedHDFCInfiniaTransaction[] {
  const transactions: ParsedHDFCInfiniaTransaction[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  let currentHolder = cardHolders.length > 0 ? cardHolders[0].name : '';

  // Track which holder's section we're in
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line is a card holder name (section header)
    const holderMatch = cardHolders.find(h => line.toUpperCase() === h.name.toUpperCase());
    if (holderMatch) {
      currentHolder = holderMatch.name;
      continue;
    }

    // Try to parse as a transaction line
    // HDFC format typically: DD/MM/YYYY| HH:MM DESCRIPTION AMOUNT [+/-]REWARD_POINTS
    const dateMatch = line.match(/^(\d{2}\/\d{2}\/\d{4})/);
    if (!dateMatch) continue;

    // Extract components
    const date = parseDate(dateMatch[1]);
    const time = extractTime(line);

    // Find amounts - typically one or two at the end
    const amounts = line.match(/[\d,]+\.\d{2}/g);
    if (!amounts || amounts.length === 0) continue;

    // Last amount is the transaction amount
    const amount = parseAmount(amounts[amounts.length - 1]);
    if (amount === 0) continue;

    // Extract description (between date/time and amount)
    const dateEndIndex = line.indexOf(dateMatch[1]) + dateMatch[1].length;
    const amountIndex = line.lastIndexOf(amounts[amounts.length - 1]);
    let description = line.substring(dateEndIndex, amountIndex).trim();

    // Remove time from description if present
    if (time) {
      description = description.replace(time, '').trim();
    }
    // Remove leading pipe or other separators
    description = description.replace(/^[|\s]+/, '').trim();

    // Determine if credit or debit
    // Credits usually have "CR" suffix or "+" prefix, or are payments/refunds
    // The + sign may appear with spaces: "+  C 2,61,321.00"
    const hasPlus = /\+\s*C?\s*[\d,]+\.\d{2}/.test(line) || /\)\+\s/.test(line);
    const isCredit = /\bCR\b/i.test(line) || hasPlus ||
                     /PAYMENT\s*(RECEIVED)?/i.test(description) ||
                     /AUTOPAY/i.test(description) ||
                     /THANK\s*YOU/i.test(description) ||
                     /NEFT.*CREDIT/i.test(description) ||
                     /IMPS.*CREDIT/i.test(description) ||
                     /UPI.*CREDIT/i.test(description) ||
                     /REVERSAL/i.test(description) ||
                     /CASHBACK/i.test(description) ||
                     /REFUND/i.test(description);

    // Extract reward points (usually shown with + or - before number at end)
    let rewardPoints = 0;
    const rewardMatch = line.match(/([+-])\s*(\d+)\s*$/);
    if (rewardMatch) {
      const sign = rewardMatch[1] === '+' ? 1 : -1;
      rewardPoints = sign * parseInt(rewardMatch[2], 10);
      // Remove reward points from description if included
      description = description.replace(/([+-])\s*\d+\s*$/, '').trim();
    }

    // Detect EMI
    const emiInfo = detectEmi(description);

    // Extract PI category
    const piCategory = extractPICategory(description);

    // Extract merchant location
    const merchantLocation = extractMerchantLocation(description);

    transactions.push({
      date,
      time,
      description,
      merchantLocation,
      amount,
      transactionType: isCredit ? 'credit' : 'debit',
      isEmi: emiInfo.isEmi,
      emiTenure: emiInfo.tenure,
      rewardPoints,
      piCategory,
      cardHolderName: currentHolder,
    });
  }

  return transactions;
}

export async function parseHDFCInfiniaStatement(buffer: Buffer): Promise<HDFCInfiniaStatementData> {
  const data = await pdfParse(buffer);
  const text = data.text;

  // Extract header information
  const headerData = parseStatementHeader(text);

  // Extract card holders
  const cardHolders = extractCardHolders(text);
  if (cardHolders.length === 0) {
    // If no card holders detected, create a default one
    cardHolders.push({ name: 'PRIMARY', isPrimary: true });
  }

  // Parse transactions
  const transactions = parseTransactionLines(text, cardHolders);

  // Determine primary holder from header or first transaction
  let primaryHolder = cardHolders.find(h => h.isPrimary)?.name || '';
  if (!primaryHolder && cardHolders.length > 0) {
    primaryHolder = cardHolders[0].name;
    cardHolders[0].isPrimary = true;
  }

  // Calculate totals if not extracted from header
  const totalDebits = headerData.totalDebits ||
    transactions.filter(t => t.transactionType === 'debit').reduce((sum, t) => sum + t.amount, 0);
  const totalCredits = headerData.totalCredits ||
    transactions.filter(t => t.transactionType === 'credit').reduce((sum, t) => sum + t.amount, 0);

  return {
    cardNumber: headerData.cardNumber || '',
    primaryHolder,
    statementDate: headerData.statementDate || new Date().toISOString().split('T')[0],
    billingPeriodStart: headerData.billingPeriodStart || '',
    billingPeriodEnd: headerData.billingPeriodEnd || '',
    dueDate: headerData.dueDate || '',
    totalDue: headerData.totalDue || 0,
    minimumDue: headerData.minimumDue || 0,
    creditLimit: headerData.creditLimit || 0,
    availableLimit: headerData.availableLimit || 0,
    rewardPointsBalance: headerData.rewardPointsBalance || 0,
    rewardPointsEarned: headerData.rewardPointsEarned || 0,
    rewardPointsRedeemed: headerData.rewardPointsRedeemed || 0,
    cashbackEarned: headerData.cashbackEarned || 0,
    openingBalance: headerData.openingBalance || 0,
    closingBalance: headerData.closingBalance || 0,
    totalCredits,
    totalDebits,
    financeCharges: headerData.financeCharges || 0,
    cardHolders,
    transactions,
  };
}

export function convertToDBTransactions(
  parsed: ParsedHDFCInfiniaTransaction[],
  accountId: string,
  uploadId: string,
  statementId?: string
): NewCreditCardTransaction[] {
  const now = new Date().toISOString();

  return parsed.map(t => ({
    id: uuidv4(),
    accountId,
    date: t.date,
    description: t.description,
    amount: t.amount,
    transactionType: t.transactionType,
    categoryId: null,
    notes: null,
    isReconciled: false,
    reconciledWithId: null,
    uploadId,
    cardHolderName: t.cardHolderName,
    isEmi: t.isEmi,
    emiTenure: t.emiTenure || null,
    rewardPoints: t.rewardPoints,
    merchantLocation: t.merchantLocation,
    transactionTime: t.time,
    piCategory: t.piCategory,
    statementId: statementId || null,
    createdAt: now,
    updatedAt: now,
  }));
}

export function convertToDBStatement(
  data: HDFCInfiniaStatementData,
  accountId: string,
  uploadId: string
) {
  const now = new Date().toISOString();

  return {
    id: uuidv4(),
    accountId,
    statementDate: data.statementDate,
    billingPeriodStart: data.billingPeriodStart,
    billingPeriodEnd: data.billingPeriodEnd,
    dueDate: data.dueDate,
    totalDue: data.totalDue,
    minimumDue: data.minimumDue,
    creditLimit: data.creditLimit || null,
    availableLimit: data.availableLimit || null,
    rewardPointsBalance: data.rewardPointsBalance || null,
    rewardPointsEarned: data.rewardPointsEarned || null,
    rewardPointsRedeemed: data.rewardPointsRedeemed || null,
    cashbackEarned: data.cashbackEarned || null,
    openingBalance: data.openingBalance || null,
    closingBalance: data.closingBalance || null,
    totalCredits: data.totalCredits || null,
    totalDebits: data.totalDebits || null,
    financeCharges: data.financeCharges || null,
    uploadId,
    createdAt: now,
  };
}

export function convertToDBCardHolders(
  holders: CardHolderInfo[],
  accountId: string
): Array<{ id: string; accountId: string; name: string; isPrimary: boolean; cardLastFour: string | null; createdAt: string }> {
  const now = new Date().toISOString();

  return holders.map(h => ({
    id: uuidv4(),
    accountId,
    name: h.name,
    isPrimary: h.isPrimary,
    cardLastFour: h.cardLastFour || null,
    createdAt: now,
  }));
}

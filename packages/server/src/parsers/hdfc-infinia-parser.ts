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

  // Extract card number (last 4 digits typically shown)
  const cardNumMatch = text.match(/Card\s*(?:No|Number)?[:\s]*\*+(\d{4})/i);
  if (cardNumMatch) {
    result.cardNumber = cardNumMatch[1];
  }

  // Extract statement date
  const stmtDateMatch = text.match(/Statement\s*Date[:\s]*(\d{2}\/\d{2}\/\d{4})/i);
  if (stmtDateMatch) {
    result.statementDate = parseDate(stmtDateMatch[1]);
  }

  // Extract billing period
  const billingMatch = text.match(/(?:Billing\s*Period|Statement\s*Period)[:\s]*(\d{2}\/\d{2}\/\d{4})\s*(?:to|-)\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (billingMatch) {
    result.billingPeriodStart = parseDate(billingMatch[1]);
    result.billingPeriodEnd = parseDate(billingMatch[2]);
  }

  // Extract due date
  const dueDateMatch = text.match(/(?:Payment\s*)?Due\s*Date[:\s]*(\d{2}\/\d{2}\/\d{4})/i);
  if (dueDateMatch) {
    result.dueDate = parseDate(dueDateMatch[1]);
  }

  // Extract total amount due
  const totalDueMatch = text.match(/Total\s*(?:Amount\s*)?Due[:\s]*(?:Rs\.?|INR)?\s*([\d,]+\.\d{2})/i);
  if (totalDueMatch) {
    result.totalDue = parseAmount(totalDueMatch[1]);
  }

  // Extract minimum amount due
  const minDueMatch = text.match(/Minimum\s*(?:Amount\s*)?Due[:\s]*(?:Rs\.?|INR)?\s*([\d,]+\.\d{2})/i);
  if (minDueMatch) {
    result.minimumDue = parseAmount(minDueMatch[1]);
  }

  // Extract credit limit
  const creditLimitMatch = text.match(/(?:Total\s*)?Credit\s*Limit[:\s]*(?:Rs\.?|INR)?\s*([\d,]+(?:\.\d{2})?)/i);
  if (creditLimitMatch) {
    result.creditLimit = parseAmount(creditLimitMatch[1]);
  }

  // Extract available limit
  const availLimitMatch = text.match(/Available\s*(?:Credit\s*)?Limit[:\s]*(?:Rs\.?|INR)?\s*([\d,]+(?:\.\d{2})?)/i);
  if (availLimitMatch) {
    result.availableLimit = parseAmount(availLimitMatch[1]);
  }

  // Extract reward points
  const rewardBalanceMatch = text.match(/(?:Reward\s*)?Points?\s*(?:Balance|Available)[:\s]*([\d,]+)/i);
  if (rewardBalanceMatch) {
    result.rewardPointsBalance = parseInt(rewardBalanceMatch[1].replace(/,/g, ''), 10);
  }

  const rewardEarnedMatch = text.match(/Points?\s*Earned[:\s]*([\d,]+)/i);
  if (rewardEarnedMatch) {
    result.rewardPointsEarned = parseInt(rewardEarnedMatch[1].replace(/,/g, ''), 10);
  }

  const rewardRedeemedMatch = text.match(/Points?\s*Redeemed[:\s]*([\d,]+)/i);
  if (rewardRedeemedMatch) {
    result.rewardPointsRedeemed = parseInt(rewardRedeemedMatch[1].replace(/,/g, ''), 10);
  }

  // Extract opening/closing balance
  const openingMatch = text.match(/Opening\s*Balance[:\s]*(?:Rs\.?|INR)?\s*([\d,]+\.\d{2})/i);
  if (openingMatch) {
    result.openingBalance = parseAmount(openingMatch[1]);
  }

  const closingMatch = text.match(/Closing\s*Balance[:\s]*(?:Rs\.?|INR)?\s*([\d,]+\.\d{2})/i);
  if (closingMatch) {
    result.closingBalance = parseAmount(closingMatch[1]);
  }

  return result;
}

function extractCardHolders(text: string): CardHolderInfo[] {
  const holders: CardHolderInfo[] = [];
  const lines = text.split('\n');

  // Look for patterns that indicate card holder names
  // HDFC statements typically show "TRANSACTIONS FOR CARD xxxx" followed by holder name
  // or "Primary Card" / "Add-On Card" sections

  const holderPatterns = [
    /(?:PRIMARY\s+CARD|MAIN\s+CARD)[:\s]*([A-Z][A-Z\s]+[A-Z])/i,
    /(?:ADD[-\s]?ON\s+CARD)[:\s]*([A-Z][A-Z\s]+[A-Z])/i,
    /CARD\s+(?:HOLDER|MEMBER)[:\s]*([A-Z][A-Z\s]+[A-Z])/i,
    /^([A-Z]{2,}(?:\s+[A-Z]{1,2})?(?:\s+[A-Z]{2,})+)$/gm, // All caps names like "GAURAV CHANCHAL"
  ];

  // First look for explicit primary/add-on designations
  const primaryMatch = text.match(/(?:PRIMARY\s+CARD|MAIN\s+CARD)[:\s]*([A-Z][A-Z\s]+[A-Z])/i);

  if (primaryMatch) {
    holders.push({ name: primaryMatch[1].trim(), isPrimary: true });
  }

  // Find add-on card holders
  const addOnPattern = /(?:ADD[-\s]?ON\s+CARD)[:\s]*([A-Z][A-Z\s]+[A-Z])/gi;
  let addOnMatch;
  while ((addOnMatch = addOnPattern.exec(text)) !== null) {
    const name = addOnMatch[1].trim();
    if (!holders.find(h => h.name === name)) {
      holders.push({ name, isPrimary: false });
    }
  }

  // If no explicit designations found, look for transaction section headers
  // Pattern: "Domestic Transactions" followed by a name in all caps
  const sectionPattern = /(?:Domestic|International)\s+Transactions\s*\n+([A-Z][A-Z\s]+[A-Z])\s*\n/gi;
  let sectionMatch;
  while ((sectionMatch = sectionPattern.exec(text)) !== null) {
    const name = sectionMatch[1].trim();
    // Skip generic headers
    if (name === 'DATE' || name === 'DESCRIPTION' || name.length < 4) continue;
    if (!holders.find(h => h.name === name)) {
      holders.push({ name, isPrimary: holders.length === 0 });
    }
  }

  // Fallback: look for names that appear before transaction blocks
  if (holders.length === 0) {
    // Look for all-caps names (2+ words, each 2+ chars) that aren't common headers
    const namePattern = /^([A-Z]{2,}(?:\s+[A-Z]{1,2})?(?:\s+[A-Z]{2,})+)$/gm;
    let nameMatch;
    const skipNames = new Set(['TRANSACTION DATE', 'REWARD POINTS', 'CREDIT LIMIT', 'TOTAL DUE',
      'MINIMUM DUE', 'STATEMENT DATE', 'DOMESTIC TRANSACTIONS', 'INTERNATIONAL TRANSACTIONS',
      'OPENING BALANCE', 'CLOSING BALANCE', 'PAYMENT RECEIVED', 'HDFC BANK']);

    while ((nameMatch = namePattern.exec(text)) !== null) {
      const name = nameMatch[1].trim();
      if (name.length > 5 && !skipNames.has(name) && !holders.find(h => h.name === name)) {
        // Verify it looks like a person's name (not all single chars, has spaces)
        if (name.includes(' ') && !/^[A-Z]\s+[A-Z]\s+[A-Z]$/.test(name)) {
          holders.push({ name, isPrimary: holders.length === 0 });
        }
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
    // Credits usually have "CR" suffix or "+" prefix
    const isCredit = /\bCR\b/i.test(line) || /\+\s*[\d,]+\.\d{2}/.test(line) ||
                     /PAYMENT\s+RECEIVED/i.test(description) ||
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

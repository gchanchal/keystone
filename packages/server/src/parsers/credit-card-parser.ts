import * as XLSX from 'xlsx';
import pdfParse from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import type { NewCreditCardTransaction } from '../db/index.js';
import {
  parseHDFCInfiniaStatement,
  type ParsedHDFCInfiniaTransaction,
  type HDFCInfiniaStatementData,
} from './hdfc-infinia-parser.js';
import {
  parseICICICreditCardStatement,
  type ICICICCStatementData,
} from './icici-cc-parser.js';

export interface ParsedCreditCardTransaction {
  date: string;
  description: string;
  amount: number;
  transactionType: 'credit' | 'debit';
  // Optional fields from Infinia parser
  cardHolderName?: string;
  isEmi?: boolean;
  emiTenure?: number;
  rewardPoints?: number;
  merchantLocation?: string;
  transactionTime?: string;
  piCategory?: string;
}

// Re-export Infinia types
export type { ParsedHDFCInfiniaTransaction, HDFCInfiniaStatementData };

function parseDate(dateStr: string): string {
  if (!dateStr) return '';

  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  // Try DD-MMM-YYYY or DD MMM YYYY format
  const match = dateStr.match(/(\d{1,2})[-\s]?([a-zA-Z]{3})[-\s]?(\d{2,4})/i);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = monthMap[match[2].toLowerCase()] || '01';
    let year = match[3];
    if (year.length === 2) {
      year = parseInt(year) > 50 ? '19' + year : '20' + year;
    }
    return `${year}-${month}-${day}`;
  }

  // Try DD/MM/YYYY format
  const parts = dateStr.split(/[-\/]/);
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    let year = parts[2];
    if (year.length === 2) {
      year = parseInt(year) > 50 ? '19' + year : '20' + year;
    }
    return `${year}-${month}-${day}`;
  }

  return dateStr;
}

function parseAmount(amountStr: string | number | undefined): number {
  if (amountStr === undefined || amountStr === null || amountStr === '') return 0;
  if (typeof amountStr === 'number') return Math.abs(amountStr);
  return Math.abs(parseFloat(String(amountStr).replace(/[,₹Rs\.CR DR]/gi, '').trim()) || 0);
}

// HDFC Credit Card Statement Parser
async function parseHDFCCreditCard(buffer: Buffer, isPDF: boolean): Promise<ParsedCreditCardTransaction[]> {
  const transactions: ParsedCreditCardTransaction[] = [];

  if (isPDF) {
    const data = await pdfParse(buffer);
    const lines = data.text.split('\n').map(l => l.trim()).filter(l => l);

    const datePattern = /^(\d{1,2}[-\/][a-zA-Z]{3}[-\/]\d{2,4}|\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/;

    for (const line of lines) {
      const dateMatch = line.match(datePattern);
      if (!dateMatch) continue;

      // Look for amount at end of line
      const amounts = line.match(/[\d,]+\.\d{2}/g);
      if (!amounts || amounts.length === 0) continue;

      const amount = parseAmount(amounts[amounts.length - 1]);
      if (amount === 0) continue;

      // Extract description
      const dateEndIndex = dateMatch[0].length;
      const lastAmountIndex = line.lastIndexOf(amounts[amounts.length - 1]);
      const description = line.substring(dateEndIndex, lastAmountIndex).trim();

      // Determine if credit or debit (CR suffix means credit/payment)
      const isCredit = line.toUpperCase().includes(' CR');

      transactions.push({
        date: parseDate(dateMatch[0]),
        description,
        amount,
        transactionType: isCredit ? 'credit' : 'debit',
      });
    }
  } else {
    // Excel format
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    for (const row of rows) {
      const dateKey = Object.keys(row).find(k => k.toLowerCase().includes('date'));
      const descKey = Object.keys(row).find(k =>
        k.toLowerCase().includes('description') || k.toLowerCase().includes('particulars')
      );
      const amountKey = Object.keys(row).find(k => k.toLowerCase().includes('amount'));
      const typeKey = Object.keys(row).find(k =>
        k.toLowerCase().includes('type') || k.toLowerCase().includes('cr/dr')
      );

      const dateVal = dateKey ? String(row[dateKey] || '') : '';
      if (!dateVal) continue;

      const amount = parseAmount(amountKey ? row[amountKey] as string | number : 0);
      if (amount === 0) continue;

      const typeVal = typeKey ? String(row[typeKey] || '').toUpperCase() : '';
      const isCredit = typeVal.includes('CR');

      transactions.push({
        date: parseDate(dateVal),
        description: descKey ? String(row[descKey] || '').trim() : '',
        amount,
        transactionType: isCredit ? 'credit' : 'debit',
      });
    }
  }

  return transactions;
}

// Generic Credit Card Parser (supports ICICI, SBI, Axis)
async function parseGenericCreditCard(buffer: Buffer, isPDF: boolean): Promise<ParsedCreditCardTransaction[]> {
  // Use same logic as HDFC for now - can be extended for specific bank formats
  return parseHDFCCreditCard(buffer, isPDF);
}

// Auto-detect and parse credit card statement
export async function parseCreditCardStatement(
  buffer: Buffer,
  mimeType: string,
  bankHint?: string
): Promise<ParsedCreditCardTransaction[]> {
  const isPDF = mimeType === 'application/pdf';

  // Try to detect bank from content if not provided
  let bank = bankHint?.toLowerCase() || '';
  let isInfinia = false;

  if (isPDF) {
    const data = await pdfParse(buffer);
    const text = data.text.toLowerCase();

    if (!bank) {
      if (text.includes('hdfc bank')) bank = 'hdfc';
      else if (text.includes('icici')) bank = 'icici';
      else if (text.includes('state bank of india') || text.includes('sbi card')) bank = 'sbi';
      else if (text.includes('axis bank')) bank = 'axis';
    }

    // Check for Infinia
    isInfinia = text.includes('infinia') ||
      (text.includes('diners club') && text.includes('hdfc')) ||
      (text.includes('reward points') && text.includes('hdfc') && text.includes('credit card'));
  }

  // Route to HDFC Infinia parser for Infinia cards
  if ((bank === 'hdfc' || bank === 'hdfc_infinia') && isPDF && isInfinia) {
    const statementData = await parseHDFCInfiniaStatement(buffer);
    // Convert Infinia transactions to standard format
    return statementData.transactions.map(t => ({
      date: t.date,
      description: t.description,
      amount: t.amount,
      transactionType: t.transactionType,
      cardHolderName: t.cardHolderName,
      isEmi: t.isEmi,
      emiTenure: t.emiTenure,
      rewardPoints: t.rewardPoints,
      merchantLocation: t.merchantLocation,
      transactionTime: t.time,
      piCategory: t.piCategory,
    }));
  }

  // Route to ICICI dedicated parser for PDFs
  if (bank === 'icici' && isPDF) {
    const iciciData = await parseICICICreditCardStatement(buffer);
    return iciciData.transactions.map(t => ({
      date: t.date,
      description: t.description,
      amount: t.amount,
      transactionType: t.transactionType,
      isEmi: t.isEmi,
      rewardPoints: t.rewardPoints,
      merchantLocation: t.merchantLocation || undefined,
    }));
  }

  switch (bank) {
    case 'hdfc':
      return parseHDFCCreditCard(buffer, isPDF);
    case 'icici':
    case 'sbi':
    case 'axis':
    default:
      return parseGenericCreditCard(buffer, isPDF);
  }
}

// Parse ICICI credit card statement with full metadata
export async function parseICICICreditCard(
  buffer: Buffer
): Promise<ICICICCStatementData> {
  return parseICICICreditCardStatement(buffer);
}

// Re-export ICICI types
export type { ICICICCStatementData };

// Parse HDFC Infinia statement with full metadata
export async function parseHDFCInfiniaCreditCard(
  buffer: Buffer
): Promise<HDFCInfiniaStatementData> {
  return parseHDFCInfiniaStatement(buffer);
}

export function convertToDBTransactions(
  parsed: ParsedCreditCardTransaction[],
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
    // HDFC Infinia fields
    cardHolderName: t.cardHolderName || null,
    isEmi: t.isEmi || false,
    emiTenure: t.emiTenure || null,
    rewardPoints: t.rewardPoints || 0,
    merchantLocation: t.merchantLocation || null,
    transactionTime: t.transactionTime || null,
    piCategory: t.piCategory || null,
    statementId: statementId || null,
    createdAt: now,
    updatedAt: now,
  }));
}

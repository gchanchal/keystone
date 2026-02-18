/**
 * ICICI Credit Card Statement PDF Parser
 * Uses `pdftotext -layout` for clean columnar extraction.
 * Handles multi-line transaction descriptions, CR credits, EMI details,
 * and statement metadata extraction.
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface ParsedICICICCTransaction {
  date: string;
  serialNumber: string;
  description: string;
  rewardPoints: number;
  amount: number;
  transactionType: 'credit' | 'debit';
  isEmi: boolean;
  merchantLocation: string | null;
}

export interface ICICICCStatementMetadata {
  cardNumber: string | null;
  statementDate: string | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  dueDate: string | null;
  totalDue: number | null;
  minimumDue: number | null;
  previousBalance: number | null;
  purchasesCharges: number | null;
  paymentsCredits: number | null;
  creditLimit: number | null;
  availableCredit: number | null;
  cashLimit: number | null;
  rewardPointsEarned: number | null;
}

export interface ICICICCEMIDetail {
  transactionType: string;
  creationDate: string | null;
  finishDate: string | null;
  installments: number | null;
  emiLoanAmount: number | null;
  pendingInstallments: number | null;
  outstandingAmount: number | null;
  monthlyInstallment: number | null;
}

export interface ICICICCStatementData {
  metadata: ICICICCStatementMetadata;
  transactions: ParsedICICICCTransaction[];
  emiDetails: ICICICCEMIDetail[];
}

const DATE_PATTERN = /^\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{10,12})\s+(.+)/;
const AMOUNT_PATTERN = /([\d,]+\.\d{2})\s*(CR)?\s*$/;
const ICICI_DATE = /(\d{2})\/(\d{2})\/(\d{4})/;

function parseICICIDate(dateStr: string): string {
  const match = dateStr.match(ICICI_DATE);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}

function parseAmount(amountStr: string): number {
  return parseFloat(amountStr.replace(/,/g, '')) || 0;
}

function extractTextWithPdftotext(buffer: Buffer): string {
  const tempFile = path.join(os.tmpdir(), `icici-cc-${Date.now()}.pdf`);
  try {
    fs.writeFileSync(tempFile, buffer);
    const result = execSync(`pdftotext -layout "${tempFile}" -`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    });
    return result;
  } finally {
    try { fs.unlinkSync(tempFile); } catch {}
  }
}

function extractMetadata(text: string): ICICICCStatementMetadata {
  const meta: ICICICCStatementMetadata = {
    cardNumber: null,
    statementDate: null,
    billingPeriodStart: null,
    billingPeriodEnd: null,
    dueDate: null,
    totalDue: null,
    minimumDue: null,
    previousBalance: null,
    purchasesCharges: null,
    paymentsCredits: null,
    creditLimit: null,
    availableCredit: null,
    cashLimit: null,
    rewardPointsEarned: null,
  };

  // Card number: 4315XXXXXXXX3000
  const cardMatch = text.match(/(\d{4}X{4,8}\d{4})/);
  if (cardMatch) meta.cardNumber = cardMatch[1];

  // Statement date
  const stmtDateMatch = text.match(/Statement\s+Date\s*[:\s]*(\d{2}\/\d{2}\/\d{4})/i);
  if (stmtDateMatch) meta.statementDate = parseICICIDate(stmtDateMatch[1]);

  // Payment due date
  const dueDateMatch = text.match(/Payment\s+Due\s+Date\s*[:\s]*(\d{2}\/\d{2}\/\d{4})/i);
  if (dueDateMatch) meta.dueDate = parseICICIDate(dueDateMatch[1]);

  // Statement period - look for two dates near "Statement Period" or "From ... To"
  const periodMatch = text.match(/(?:Statement\s+Period|From)\s*[:\s]*(\d{2}\/\d{2}\/\d{4})\s*(?:to|-)\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (periodMatch) {
    meta.billingPeriodStart = parseICICIDate(periodMatch[1]);
    meta.billingPeriodEnd = parseICICIDate(periodMatch[2]);
  } else {
    // Try extracting from statement date context - the billing period end is often the statement date
    if (meta.statementDate) {
      meta.billingPeriodEnd = meta.statementDate;
    }
  }

  // Total Amount Due
  const totalDueMatch = text.match(/Total\s+Amount\s+Due\s*[:\s]*[`₹Rs.]*\s*([\d,]+\.\d{2})/i);
  if (totalDueMatch) meta.totalDue = parseAmount(totalDueMatch[1]);

  // Minimum Amount Due
  const minDueMatch = text.match(/Minimum\s+Amount\s+Due\s*[:\s]*[`₹Rs.]*\s*([\d,]+\.\d{2})/i);
  if (minDueMatch) meta.minimumDue = parseAmount(minDueMatch[1]);

  // Previous Balance / Opening Balance
  const prevBalMatch = text.match(/(?:Previous|Opening)\s+Balance\s*[:\s]*[`₹Rs.]*\s*([\d,]+\.\d{2})/i);
  if (prevBalMatch) meta.previousBalance = parseAmount(prevBalMatch[1]);

  // Purchases / Charges
  const purchMatch = text.match(/(?:Purchases|Charges)\s*[:\s]*[`₹Rs.]*\s*([\d,]+\.\d{2})/i);
  if (purchMatch) meta.purchasesCharges = parseAmount(purchMatch[1]);

  // Payments / Credits
  const payMatch = text.match(/(?:Payments|Credits)\s*[\/:]*\s*(?:Credits?)?\s*[:\s]*[`₹Rs.]*\s*([\d,]+\.\d{2})/i);
  if (payMatch) meta.paymentsCredits = parseAmount(payMatch[1]);

  // Credit Limit
  const creditLimitMatch = text.match(/Credit\s+Limit\s*[:\s]*[`₹Rs.]*\s*([\d,]+\.\d{2})/i);
  if (creditLimitMatch) meta.creditLimit = parseAmount(creditLimitMatch[1]);

  // Available Credit
  const availCreditMatch = text.match(/Available\s+Credit\s*[:\s]*[`₹Rs.]*\s*([\d,]+\.\d{2})/i);
  if (availCreditMatch) meta.availableCredit = parseAmount(availCreditMatch[1]);

  // Cash Limit
  const cashLimitMatch = text.match(/Cash\s+Limit\s*[:\s]*[`₹Rs.]*\s*([\d,]+\.\d{2})/i);
  if (cashLimitMatch) meta.cashLimit = parseAmount(cashLimitMatch[1]);

  // Reward Points Earned (total in statement)
  const rewardMatch = text.match(/(?:Total\s+)?Reward\s+Points?\s+(?:Earned|this\s+statement)\s*[:\s]*(\d+)/i);
  if (rewardMatch) meta.rewardPointsEarned = parseInt(rewardMatch[1], 10);

  return meta;
}

function extractEMIDetails(text: string): ICICICCEMIDetail[] {
  const emiDetails: ICICICCEMIDetail[] = [];

  // Find EMI section
  const emiSectionMatch = text.match(/Transaction\/LoanType[\s\S]*?(?=\n\s*\n\s*\n|\n\s*Page|\n\s*Note|\n\s*\*|$)/i);
  if (!emiSectionMatch) return emiDetails;

  const emiLines = emiSectionMatch[0].split('\n').slice(1); // Skip header
  for (const line of emiLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Transaction') || trimmed === 'conversions') continue;

    // Parse EMI line: type, creation date, finish date, installments, amount, pending, outstanding, monthly
    const emiMatch = trimmed.match(
      /(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+([\d,]+\.\d{2})\s+(\d+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/
    );
    if (emiMatch) {
      emiDetails.push({
        transactionType: emiMatch[1].trim(),
        creationDate: parseICICIDate(emiMatch[2]),
        finishDate: parseICICIDate(emiMatch[3]),
        installments: parseInt(emiMatch[4], 10),
        emiLoanAmount: parseAmount(emiMatch[5]),
        pendingInstallments: parseInt(emiMatch[6], 10),
        outstandingAmount: parseAmount(emiMatch[7]),
        monthlyInstallment: parseAmount(emiMatch[8]),
      });
    }
  }

  return emiDetails;
}

function extractTransactions(text: string): ParsedICICICCTransaction[] {
  const transactions: ParsedICICICCTransaction[] = [];
  const lines = text.split('\n');

  let currentTransaction: {
    date: string;
    serialNumber: string;
    descParts: string[];
    rewardPoints: number;
    amount: number;
    isCredit: boolean;
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match a transaction line: date + serial number + rest
    const txnMatch = line.match(DATE_PATTERN);
    if (txnMatch) {
      // Flush previous transaction
      if (currentTransaction) {
        transactions.push(finishTransaction(currentTransaction));
      }

      const [, dateStr, serialNo, rest] = txnMatch;

      // Extract amount from the end of the rest portion
      const amtMatch = rest.match(AMOUNT_PATTERN);
      if (amtMatch) {
        const amount = parseAmount(amtMatch[1]);
        const isCredit = !!amtMatch[2]; // CR suffix

        // Extract reward points - look for an integer before the amount
        // The description is between serial number and reward points/amount
        const beforeAmount = rest.substring(0, rest.lastIndexOf(amtMatch[1])).trim();

        let rewardPoints = 0;
        let description = beforeAmount;

        // Reward points are typically right before the amount, as an integer (possibly negative)
        const rpMatch = beforeAmount.match(/(-?\d+)\s*$/);
        if (rpMatch) {
          rewardPoints = parseInt(rpMatch[1], 10);
          description = beforeAmount.substring(0, beforeAmount.lastIndexOf(rpMatch[1])).trim();
        }

        currentTransaction = {
          date: dateStr,
          serialNumber: serialNo,
          descParts: [description],
          rewardPoints,
          amount,
          isCredit,
        };
      } else {
        // No amount on this line - might be part of header or malformed
        currentTransaction = null;
      }
    } else if (currentTransaction) {
      // Continuation line - check if it has meaningful content (not a new section header)
      const trimmed = line.trim();
      if (
        trimmed &&
        !trimmed.match(/^Date\s+Ser/i) &&
        !trimmed.match(/^Transaction\/LoanType/i) &&
        !trimmed.match(/^Page\s+\d/i) &&
        !trimmed.match(/^\d{2}\/\d{2}\/\d{4}/) && // Not a new date line
        !trimmed.match(/^Total\s/i) &&
        !trimmed.match(/^Note\s/i) &&
        !trimmed.match(/^Domestic\s+Transactions/i) &&
        !trimmed.match(/^International\s+Transactions/i) &&
        !trimmed.match(/^Reward\s+Points/i) &&
        trimmed.length < 120 // Reasonable continuation line length
      ) {
        // Check if this looks like a description continuation (no amount pattern at end)
        const hasAmount = trimmed.match(AMOUNT_PATTERN);
        if (!hasAmount) {
          currentTransaction.descParts.push(trimmed);
        } else {
          // Has an amount - probably start of something else, flush current
          transactions.push(finishTransaction(currentTransaction));
          currentTransaction = null;
        }
      } else if (!trimmed) {
        // Empty line - may or may not end the transaction
        // Don't flush yet, multi-line descriptions can span blank lines
      } else {
        // Line doesn't look like a continuation - flush current transaction
        transactions.push(finishTransaction(currentTransaction));
        currentTransaction = null;
      }
    }
  }

  // Flush last transaction
  if (currentTransaction) {
    transactions.push(finishTransaction(currentTransaction));
  }

  return transactions;
}

function finishTransaction(txn: {
  date: string;
  serialNumber: string;
  descParts: string[];
  rewardPoints: number;
  amount: number;
  isCredit: boolean;
}): ParsedICICICCTransaction {
  const fullDescription = txn.descParts.join(' ').replace(/\s+/g, ' ').trim();

  // Extract merchant location from description (e.g., "AMAZON PAY IN E COMMERC BANGALORE IN")
  let merchantLocation: string | null = null;
  const locMatch = fullDescription.match(/\b([A-Z]{2,})\s+(IN|US|GB|SG|AU|AE|JP|DE|FR|CA)\s*$/);
  if (locMatch) {
    merchantLocation = `${locMatch[1]}, ${locMatch[2]}`;
  }

  // Detect EMI transactions
  const isEmi = /(?:amortization|instalment|emi)/i.test(fullDescription);

  return {
    date: parseICICIDate(txn.date),
    serialNumber: txn.serialNumber,
    description: fullDescription,
    rewardPoints: txn.rewardPoints,
    amount: txn.amount,
    transactionType: txn.isCredit ? 'credit' : 'debit',
    isEmi,
    merchantLocation,
  };
}

export async function parseICICICreditCardStatement(buffer: Buffer): Promise<ICICICCStatementData> {
  const text = extractTextWithPdftotext(buffer);

  const metadata = extractMetadata(text);
  const transactions = extractTransactions(text);
  const emiDetails = extractEMIDetails(text);

  // If we couldn't extract billing period start from text, infer from transactions
  if (!metadata.billingPeriodStart && transactions.length > 0) {
    const sortedDates = transactions.map(t => t.date).sort();
    metadata.billingPeriodStart = sortedDates[0];
  }

  console.log(`[ICICI CC Parser] Extracted ${transactions.length} transactions, ${emiDetails.length} EMI details`);
  console.log(`[ICICI CC Parser] Card: ${metadata.cardNumber}, Due: ${metadata.totalDue}, Min Due: ${metadata.minimumDue}`);

  return {
    metadata,
    transactions,
    emiDetails,
  };
}

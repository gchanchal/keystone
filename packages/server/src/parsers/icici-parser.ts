import { v4 as uuidv4 } from 'uuid';
import type { NewBankTransaction } from '../db/index.js';

export interface ParsedICICITransaction {
  date: string;
  description: string;
  reference: string | null;
  amount: number;
  transactionType: 'credit' | 'debit';
  balance: number | null;
}

/**
 * Parse ICICI Bank PDF statement
 * Format: Statement of Transactions in Saving Account
 *
 * PDF text structure (after extraction):
 * - Line 1: S.No concatenated with date: "108.01.2026" = S.No 1 + date 08.01.2026
 * - Line 2+: Description (may span multiple lines)
 * - Amount line: "5000.006160.16" = withdrawal/deposit + balance (concatenated)
 */
export async function parseICICIStatement(buffer: Buffer): Promise<ParsedICICITransaction[]> {
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(buffer);
  const text = data.text;

  const transactions: ParsedICICITransaction[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  // Debug: log first 30 lines
  console.log('ICICI PDF lines (first 30):');
  lines.slice(0, 30).forEach((l, i) => console.log(`  ${i}: "${l}"`));

  // Pattern for S.No + Date line: S.No (1-3 digits) directly followed by date DD.MM.YYYY
  // Example: "108.01.2026" = S.No 1 + 08.01.2026
  const snoDatePattern = /^(\d{1,3})(\d{2}\.\d{2}\.\d{4})$/;

  // Pattern for amount line: two amounts concatenated (amount + balance)
  // Example: "5000.006160.16" = 5000.00 (withdrawal) + 6160.16 (balance)
  // Or: "444489.00449649.16" = 444489.00 (deposit) + 449649.16 (balance)
  const amountPattern = /^([\d,]+\.\d{2})([\d,]+\.\d{2})$/;

  // Find all transaction start lines (S.No + Date)
  interface TxnStart {
    index: number;
    sno: number;
    date: string;
  }
  const txnStarts: TxnStart[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(snoDatePattern);
    if (match) {
      txnStarts.push({
        index: i,
        sno: parseInt(match[1]),
        date: match[2],
      });
    }
  }

  console.log(`Found ${txnStarts.length} ICICI transaction start lines`);

  // Process each transaction
  for (let t = 0; t < txnStarts.length; t++) {
    const txn = txnStarts[t];
    const nextTxnIndex = t < txnStarts.length - 1 ? txnStarts[t + 1].index : lines.length;

    // Collect lines between this transaction start and the next
    const txnLines: string[] = [];
    for (let i = txn.index + 1; i < nextTxnIndex; i++) {
      const line = lines[i];
      // Skip footer/header lines
      if (line.includes('Statement of Transactions') ||
          line.includes('Your Base Branch') ||
          line.includes('ICICI BANK LIMITED') ||
          line.includes('Sincerly') ||
          line.includes('Team ICICI') ||
          line.includes('Legends') ||
          line.includes('Never share your OTP') ||
          line.match(/^www\./) ||
          line.match(/^Dial your Bank/)) {
        continue;
      }
      txnLines.push(line);
    }

    // Find the amount line (last line that matches amount pattern)
    let amountLine: string | null = null;
    let amountLineIndex = -1;
    for (let i = txnLines.length - 1; i >= 0; i--) {
      if (txnLines[i].match(amountPattern)) {
        amountLine = txnLines[i];
        amountLineIndex = i;
        break;
      }
    }

    if (!amountLine) {
      console.log(`ICICI: No amount line found for transaction ${txn.sno}`);
      continue;
    }

    // Parse amounts
    const amtMatch = amountLine.match(amountPattern);
    if (!amtMatch) continue;

    const amount1 = parseFloat(amtMatch[1].replace(/,/g, ''));
    const balance = parseFloat(amtMatch[2].replace(/,/g, ''));

    // Description is everything before the amount line
    const descriptionParts = txnLines.slice(0, amountLineIndex);
    const description = descriptionParts.join(' ').trim();

    // Parse date (DD.MM.YYYY -> YYYY-MM-DD)
    const [day, month, year] = txn.date.split('.');
    const isoDate = `${year}-${month}-${day}`;

    // Determine transaction type from description
    const descUpper = description.toUpperCase();
    let transactionType: 'credit' | 'debit' = 'debit';

    // Credit patterns (money coming in)
    if (descUpper.startsWith('INF/') ||      // Internal Fund Transfer incoming
        descUpper.startsWith('INFT/') ||
        descUpper.includes('/SALARY') ||
        descUpper.includes('SALARY/') ||
        descUpper.startsWith('UPI/') ||      // UPI credit (will be corrected by balance check)
        descUpper.includes('NEFT CR') ||
        descUpper.includes('RTGS CR') ||
        descUpper.includes('/CR/') ||
        descUpper.includes(' CR ')) {
      transactionType = 'credit';
    }

    // Debit patterns (money going out)
    if (descUpper.startsWith('CMS/') ||      // Auto-debit
        descUpper.startsWith('BIL/') ||      // Bill payment
        descUpper.startsWith('ACH D/') ||    // ACH Debit
        descUpper.includes('/DR/') ||
        descUpper.includes(' DR ') ||
        (descUpper.startsWith('RTGS/') && !descUpper.includes('CR')) ||
        (descUpper.startsWith('NEFT/') && descUpper.includes('Home loan'))) {
      transactionType = 'debit';
    }

    // Extract reference
    let reference: string | null = null;
    const refPatterns = [
      /\/(\d{12,})(?:\/|$)/,
      /INFT\/(\d+)\//,
      /UPI\/[^\/]+\/[^\/]+\/[^\/]+\/(\d+)\//,
      /CMS\/(\d+)\//,
    ];

    for (const pattern of refPatterns) {
      const refMatch = description.match(pattern);
      if (refMatch) {
        reference = refMatch[1];
        break;
      }
    }

    transactions.push({
      date: isoDate,
      description,
      reference,
      amount: amount1,
      transactionType,
      balance,
    });

    console.log(`ICICI: Parsed txn ${txn.sno}: ${isoDate} ${description.substring(0, 30)}... ${transactionType} ${amount1} bal:${balance}`);
  }

  // Validate and fix using balance continuity
  // Balance should: increase for credits, decrease for debits
  for (let i = 1; i < transactions.length; i++) {
    const prev = transactions[i - 1];
    const curr = transactions[i];

    if (prev.balance !== null && curr.balance !== null) {
      const balanceDiff = curr.balance - prev.balance;

      // If balance increased, it's credit; if decreased, it's debit
      const expectedType: 'credit' | 'debit' = balanceDiff > 0 ? 'credit' : 'debit';
      const expectedAmount = Math.abs(balanceDiff);

      // Fix transaction type if wrong
      if (curr.transactionType !== expectedType) {
        console.log(`ICICI: Fixing type for "${curr.description.substring(0, 30)}..." from ${curr.transactionType} to ${expectedType}`);
        curr.transactionType = expectedType;
      }

      // Fix amount if significantly different from balance change
      if (Math.abs(curr.amount - expectedAmount) > 1 && expectedAmount > 0) {
        console.log(`ICICI: Fixing amount ${curr.amount} -> ${expectedAmount}`);
        curr.amount = expectedAmount;
      }
    }
  }

  console.log(`Parsed ${transactions.length} ICICI transactions total`);
  return transactions;
}

export function convertToDBTransactions(
  parsed: ParsedICICITransaction[],
  accountId: string,
  uploadId: string
): NewBankTransaction[] {
  const now = new Date().toISOString();

  return parsed.map(t => ({
    id: uuidv4(),
    accountId,
    date: t.date,
    valueDate: null,
    narration: t.description,
    reference: t.reference,
    transactionType: t.transactionType,
    amount: t.amount,
    balance: t.balance,
    categoryId: null,
    notes: null,
    isReconciled: false,
    reconciledWithId: null,
    reconciledWithType: null,
    uploadId,
    createdAt: now,
    updatedAt: now,
  }));
}

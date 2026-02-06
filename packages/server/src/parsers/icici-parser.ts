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

export interface ICICIAccountMetadata {
  accountNumber: string | null;
  accountType: string | null;
  accountHolderName: string | null;
  address: string | null;
  bankName: string;
  branch: string | null;
  branchAddress: string | null;
  ifscCode: string | null;
  currency: string;
  statementPeriod: {
    from: string | null;
    to: string | null;
  };
  openingBalance: number | null;
  closingBalance: number | null;
}

export interface ICICIStatementData {
  metadata: ICICIAccountMetadata;
  transactions: ParsedICICITransaction[];
}

/**
 * Extract account metadata from ICICI statement
 */
function extractICICIMetadata(text: string): ICICIAccountMetadata {
  const metadata: ICICIAccountMetadata = {
    accountNumber: null,
    accountType: null,
    accountHolderName: null,
    address: null,
    bankName: 'ICICI Bank',
    branch: null,
    branchAddress: null,
    ifscCode: null,
    currency: 'INR',
    statementPeriod: { from: null, to: null },
    openingBalance: null,
    closingBalance: null,
  };

  // Account number - "Saving Account no. 625401529611"
  const accMatch = text.match(/(?:Saving|Current|Salary)\s+Account\s+no\.\s*(\d+)/i);
  if (accMatch) {
    metadata.accountNumber = accMatch[1];
  }

  // Account type
  const typeMatch = text.match(/(Saving|Current|Salary)\s+Account\s+no\./i);
  if (typeMatch) {
    metadata.accountType = typeMatch[1].toLowerCase();
    if (metadata.accountType === 'saving') metadata.accountType = 'savings';
  }

  // Statement period - "for the period November 7, 2025 - February 7, 2026"
  const periodMatch = text.match(/for\s+the\s+period\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s*[-–]\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
  if (periodMatch) {
    metadata.statementPeriod.from = parseICICIDate(periodMatch[1]);
    metadata.statementPeriod.to = parseICICIDate(periodMatch[2]);
  }

  // Account holder name - appears before "Your Base Branch"
  // Format: "GAURAV CHANCHAL Your Base Branch: ICICI BANK LIMITED,"
  const nameMatch = text.match(/\n([A-Z][A-Z\s]+?)\s+Your\s+Base\s+Branch/);
  if (nameMatch) {
    metadata.accountHolderName = nameMatch[1].trim();
  }

  // ICICI statement has customer address and branch address interleaved:
  // Line 3: "FF2,AJANTHA MEADOWS 3RD,CROSS, BRANCH, 100/1, MARUTHI KRUPA, BULL"
  //         ^-- customer address --^         ^-- branch address --^
  // Line 5: "AKSHAY NAGAR MAIN,ROAD DLF, BENGALURU BANGALORE URBAN"
  //         ^-- customer address --^     ^-- branch location --^
  // Line 7: "KARNATAKA - INDIA - 560068" (customer pincode)

  const lines = text.split('\n');
  const customerAddrParts: string[] = [];
  let branchAddr = '';

  for (let i = 0; i < lines.length && i < 15; i++) {
    const line = lines[i].trim();

    // Line with "BRANCH," - split customer and branch parts
    if (line.includes('BRANCH,')) {
      const parts = line.split(/\s*BRANCH,\s*/);
      if (parts[0]) {
        customerAddrParts.push(parts[0].trim().replace(/,\s*$/, ''));
      }
      if (parts[1]) {
        branchAddr = parts[1].trim();
      }
      continue;
    }

    // Line with customer area (before BENGALURU/BANGALORE URBAN)
    if (line.match(/NAGAR.*(?:BENGALURU|BANGALORE)/i)) {
      const parts = line.split(/\s+(?:BENGALURU|BANGALORE)/i);
      if (parts[0]) {
        customerAddrParts.push(parts[0].trim().replace(/,\s*$/, ''));
      }
      continue;
    }

    // Customer state-country-pincode line (KARNATAKA - INDIA - 560068)
    if (line.match(/^[A-Z]+\s*[-–]\s*INDIA\s*[-–]\s*\d{6}$/i)) {
      customerAddrParts.push(line.trim());
      break;
    }
  }

  if (customerAddrParts.length > 0) {
    metadata.address = customerAddrParts.join(', ')
      .replace(/,\s*,/g, ',')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Branch location from the split
  if (branchAddr) {
    metadata.branch = branchAddr.replace(/,\s*$/, '');
  }

  return metadata;
}

/**
 * Parse ICICI date format "November 7, 2025" to ISO date
 */
function parseICICIDate(dateStr: string): string | null {
  if (!dateStr) return null;

  const months: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
  };

  const match = dateStr.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (match) {
    const month = months[match[1].toLowerCase()];
    if (month) {
      const day = match[2].padStart(2, '0');
      return `${match[3]}-${month}-${day}`;
    }
  }
  return null;
}

/**
 * Parse ICICI statement with full metadata
 * @param password - Optional password for encrypted PDFs
 */
export async function parseICICIStatementFull(buffer: Buffer, password?: string): Promise<ICICIStatementData> {
  const pdfParse = (await import('pdf-parse')).default;
  // Note: pdf-parse types don't include password, but pdfjs supports it
  const options = password ? { password } : {};
  const data = await pdfParse(buffer, options as any);
  const text = data.text;

  const metadata = extractICICIMetadata(text);
  const transactions = await parseICICIStatement(buffer, password);

  // Set opening/closing balance from transactions
  if (transactions.length > 0) {
    const first = transactions[0];
    const last = transactions[transactions.length - 1];

    // Opening balance = first transaction balance ± first transaction amount
    if (first.balance !== null) {
      if (first.transactionType === 'credit') {
        metadata.openingBalance = first.balance - first.amount;
      } else {
        metadata.openingBalance = first.balance + first.amount;
      }
    }
    metadata.closingBalance = last.balance;
  }

  return { metadata, transactions };
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
export async function parseICICIStatement(buffer: Buffer, password?: string): Promise<ParsedICICITransaction[]> {
  const pdfParse = (await import('pdf-parse')).default;
  // Note: pdf-parse types don't include password, but pdfjs supports it
  const options = password ? { password } : {};
  const data = await pdfParse(buffer, options as any);
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

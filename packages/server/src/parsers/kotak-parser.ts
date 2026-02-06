import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import type { NewBankTransaction } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ParsedKotakTransaction {
  date: string;
  description: string;
  reference: string | null;
  amount: number;
  transactionType: 'credit' | 'debit';
  balance: number | null;
  shownBalance?: number | null;
  sweepAdjustment?: number;
  suspicious?: boolean;
  suspiciousReason?: string;
  amountCorrected?: boolean;
  originalAmount?: number;
}

export interface KotakAccountMetadata {
  accountNumber: string | null;
  accountType: string | null;
  accountHolderName: string | null;
  bankName: string;
  branch: string | null;
  ifscCode: string | null;
  micrCode: string | null;
  currency: string;
  statementPeriod: {
    from: string | null;
    to: string | null;
  };
  openingBalance: number | null;
  closingBalance: number | null;
}

export interface KotakStatementData {
  metadata: KotakAccountMetadata;
  transactions: ParsedKotakTransaction[];
  sweepTransactions: ParsedKotakTransaction[];
  sweepBalance: number;
  actualBalance: number;
}

/**
 * Parse Kotak statement and return full data including metadata and sweep handling
 * @param password - Optional password for encrypted PDFs
 */
export async function parseKotakStatementFull(buffer: Buffer, password?: string): Promise<KotakStatementData> {
  const fs = await import('fs');
  const os = await import('os');
  const tempFile = path.join(os.tmpdir(), `kotak-${Date.now()}.pdf`);

  try {
    fs.writeFileSync(tempFile, buffer);

    const pythonScript = path.join(__dirname, 'kotak_pdf_parser.py');
    const venvPython = path.join(process.cwd(), '..', '..', '.venv', 'bin', 'python3');
    const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';

    // Pass password as second argument if provided
    const passwordArg = password ? ` "${password}"` : '';
    const result = execSync(`${pythonCmd} "${pythonScript}" "${tempFile}"${passwordArg}`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    });

    const parsed = JSON.parse(result);

    if (parsed.success) {
      console.log(`Parsed ${parsed.count} Kotak transactions, ${parsed.sweepCount} sweep transactions`);

      const transactions = (parsed.transactions || []).map((t: any) => ({
        date: t.date,
        description: t.description || '',
        reference: t.reference || null,
        amount: t.amount,
        transactionType: t.transactionType,
        balance: t.balance,
        shownBalance: t.shownBalance,
        sweepAdjustment: t.sweepAdjustment,
        suspicious: t.suspicious,
        suspiciousReason: t.suspiciousReason,
        amountCorrected: t.amountCorrected,
        originalAmount: t.originalAmount,
      }));

      const sweepTransactions = (parsed.sweepTransactions || []).map((t: any) => ({
        date: t.date,
        description: t.description || '',
        reference: t.reference || null,
        amount: t.amount,
        transactionType: t.transactionType,
        balance: t.balance,
        isSweep: true,
        sweepType: t.sweepType,
        sweepAccountNumber: t.sweepAccountNumber,
      }));

      return {
        metadata: parsed.metadata || {
          accountNumber: null,
          accountType: null,
          accountHolderName: null,
          bankName: 'Kotak Mahindra Bank',
          branch: null,
          ifscCode: null,
          micrCode: null,
          currency: 'INR',
          statementPeriod: { from: null, to: null },
          openingBalance: null,
          closingBalance: null,
        },
        transactions,
        sweepTransactions,
        sweepBalance: parsed.sweepBalance || 0,
        actualBalance: parsed.actualBalance || 0,
      };
    }

    throw new Error(parsed.error || 'Unknown parsing error');
  } finally {
    try {
      fs.unlinkSync(tempFile);
    } catch {}
  }
}

export async function parseKotakStatement(buffer: Buffer): Promise<ParsedKotakTransaction[]> {
  // Write buffer to temp file
  const fs = await import('fs');
  const os = await import('os');
  const tempFile = path.join(os.tmpdir(), `kotak-${Date.now()}.pdf`);

  try {
    fs.writeFileSync(tempFile, buffer);

    // Try Python parser first (more accurate)
    try {
      const pythonScript = path.join(__dirname, 'kotak_pdf_parser.py');
      const venvPython = path.join(process.cwd(), '..', '..', '.venv', 'bin', 'python3');

      // Check if venv exists, otherwise use system python
      const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';

      const result = execSync(`${pythonCmd} "${pythonScript}" "${tempFile}"`, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
      });

      const parsed = JSON.parse(result);

      if (parsed.success && parsed.transactions) {
        console.log(`Parsed ${parsed.count} Kotak transactions using Python parser`);
        return parsed.transactions.map((t: any) => ({
          date: t.date,
          description: t.description || '',
          reference: t.reference || null,
          amount: t.amount,
          transactionType: t.transactionType,
          balance: t.balance,
          shownBalance: t.shownBalance,
          sweepAdjustment: t.sweepAdjustment,
          suspicious: t.suspicious,
          suspiciousReason: t.suspiciousReason,
          amountCorrected: t.amountCorrected,
          originalAmount: t.originalAmount,
        }));
      }
    } catch (pythonError: any) {
      console.error('Python parser failed, falling back to JS parser:', pythonError.message);
    }

    // Fallback to JavaScript parser
    return parseKotakStatementJS(buffer);

  } finally {
    // Clean up temp file
    try {
      const fs = await import('fs');
      fs.unlinkSync(tempFile);
    } catch {}
  }
}

// Original JavaScript parser as fallback
async function parseKotakStatementJS(buffer: Buffer): Promise<ParsedKotakTransaction[]> {
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(buffer);
  const fullText = data.text.replace(/\n/g, ' ');

  const transactions: ParsedKotakTransaction[] = [];

  // Find all dates with row numbers pattern: row#DD MMM YYYY
  const dateMatches = [...fullText.matchAll(/(\d{1,2})(\d{2}\s+[A-Za-z]{3}\s+\d{4})/g)];

  console.log('Found', dateMatches.length, 'potential Kotak transactions (JS parser)');

  for (let i = 0; i < dateMatches.length; i++) {
    const match = dateMatches[i];
    const dateStr = match[2].trim();
    const startIdx = match.index! + match[0].length;
    let endIdx = fullText.length;
    if (i < dateMatches.length - 1) {
      endIdx = dateMatches[i + 1].index!;
    }

    let content = fullText.substring(startIdx, endIdx).trim();

    // Skip non-transaction content
    if (content.includes('Opening Balance')) continue;
    if (content.includes('Current Account Transactions')) continue;
    if (content.includes('#DateDescription')) continue;

    // Find all amounts in Indian format
    const amountMatches = [...content.matchAll(/(\d{1,2},\d{2},\d{2},\d{3}\.\d{2}|\d{1,2},\d{2},\d{3}\.\d{2}|\d{1,2},\d{3}\.\d{2}|\d{1,3}\.\d{2})/g)];

    if (amountMatches.length < 2) continue;

    // Last amount is balance, second-to-last is transaction amount
    const balanceMatch = amountMatches[amountMatches.length - 1];
    const amountMatch = amountMatches[amountMatches.length - 2];

    const balance = parseIndianAmount(balanceMatch[1]);
    const amount = parseIndianAmount(amountMatch[1]);

    if (!amount || amount <= 0) continue;

    // Description is everything before the amount position
    const amountPos = amountMatch.index!;
    let description = content.substring(0, amountPos).trim();

    // Extract reference
    let reference: string | null = null;
    const refPatterns = [
      /(UPI-\d{8,})$/,
      /(NEFTINW-\d+)$/,
      /(KMBT\d{12,})$/,
      /(\d{12,})$/,
    ];

    for (const pattern of refPatterns) {
      const refMatch = description.match(pattern);
      if (refMatch) {
        reference = refMatch[1];
        description = description.substring(0, description.lastIndexOf(reference)).trim();
        break;
      }
    }

    description = description.replace(/^[\s\/-]+|[\s\/-]+$/g, '').trim();

    // Determine credit/debit
    const descLower = description.toLowerCase();
    const isCredit = descLower.includes('received') ||
                     descLower.includes('neft in') ||
                     descLower.includes('cashfree') ||
                     descLower.includes('razorpay') ||
                     (reference && reference.includes('NEFTINW'));

    if (amount > 0 && amount < 100000000) {
      transactions.push({
        date: parseKotakDate(dateStr),
        description,
        reference,
        amount,
        transactionType: isCredit ? 'credit' : 'debit',
        balance,
      });
    }
  }

  // Validate with balance continuity
  for (let i = 1; i < transactions.length; i++) {
    const prev = transactions[i - 1];
    const curr = transactions[i];

    if (prev.balance && curr.balance) {
      const expectedAmount = Math.abs(prev.balance - curr.balance);
      const reportedAmount = curr.amount;

      if (Math.abs(expectedAmount - reportedAmount) > 1 && expectedAmount > 0) {
        const ratio = reportedAmount / expectedAmount;

        if ((ratio >= 9.5 && ratio <= 10.5) || (ratio >= 95 && ratio <= 105)) {
          console.log(`Fixing amount: ${reportedAmount} -> ${expectedAmount}`);
          curr.originalAmount = curr.amount;
          curr.amount = expectedAmount;
          curr.amountCorrected = true;
        }
      }

      // Fix transaction type
      const balanceDecreased = prev.balance > curr.balance;
      if (balanceDecreased && curr.transactionType === 'credit') {
        curr.transactionType = 'debit';
      } else if (!balanceDecreased && curr.transactionType === 'debit') {
        curr.transactionType = 'credit';
      }
    }

    // Flag suspicious amounts
    const amountStr = String(Math.round(curr.amount));
    if (amountStr.length >= 4 && amountStr[0] === amountStr[1]) {
      curr.suspicious = true;
      curr.suspiciousReason = `Possible parsing error - first digits repeat (${amountStr.slice(0,2)})`;
    }
  }

  console.log('Parsed', transactions.length, 'Kotak transactions');
  return transactions;
}

function parseKotakDate(dateStr: string): string {
  if (!dateStr) return '';

  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const match = dateStr.match(/(\d{1,2})\s*([a-zA-Z]{3})\s*(\d{4})/i);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = monthMap[match[2].toLowerCase()] || '01';
    const year = match[3];
    return `${year}-${month}-${day}`;
  }

  return dateStr;
}

function parseIndianAmount(amountStr: string): number {
  if (!amountStr) return 0;
  const cleaned = amountStr.replace(/,/g, '').trim();
  return parseFloat(cleaned) || 0;
}

export function convertToDBTransactions(
  parsed: ParsedKotakTransaction[],
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

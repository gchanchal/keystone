import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import type { NewBankTransaction } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ParsedHDFCTransaction {
  date: string;
  valueDate: string | null;
  description: string;
  reference: string | null;
  amount: number;
  transactionType: 'credit' | 'debit';
  balance: number | null;
}

export interface HDFCAccountMetadata {
  accountNumber: string | null;
  accountType: string | null;
  accountStatus: string | null;
  accountHolderName: string | null;
  address: string | null;
  bankName: string;
  branch: string | null;
  ifscCode: string | null;
  micrCode: string | null;
  currency: string;
  customerId: string | null;
  email: string | null;
  statementPeriod: {
    from: string | null;
    to: string | null;
  };
  openingBalance: number | null;
  closingBalance: number | null;
}

export interface HDFCStatementData {
  metadata: HDFCAccountMetadata;
  transactions: ParsedHDFCTransaction[];
  actualBalance: number;
}

/**
 * Parse HDFC PDF statement and return full data including metadata
 * @param password - Optional password for encrypted PDFs
 */
export async function parseHDFCPDFStatementFull(buffer: Buffer, password?: string): Promise<HDFCStatementData> {
  const fs = await import('fs');
  const os = await import('os');
  const tempFile = path.join(os.tmpdir(), `hdfc-pdf-${Date.now()}.pdf`);

  try {
    fs.writeFileSync(tempFile, buffer);

    const pythonScript = path.join(__dirname, 'hdfc_pdf_parser.py');
    const venvPython = path.join(process.cwd(), '..', '..', '.venv', 'bin', 'python3');
    const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';

    // Pass password as second argument if provided
    const passwordArg = password ? ` "${password}"` : '';
    const result = execSync(`${pythonCmd} "${pythonScript}" "${tempFile}"${passwordArg}`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large statements
      timeout: 120000, // 2 minutes for large PDFs
    });

    const parsed = JSON.parse(result);

    if (parsed.success) {
      console.log(`Parsed ${parsed.count} HDFC PDF transactions`);

      const transactions = (parsed.transactions || [])
        .filter((t: any) => t.date) // Filter out transactions with null dates
        .map((t: any) => ({
          date: t.date,
          valueDate: t.valueDate || null,
          description: t.description || '',
          reference: t.reference || null,
          amount: t.amount,
          transactionType: t.transactionType as 'credit' | 'debit',
          balance: t.balance,
        }));

      return {
        metadata: {
          accountNumber: parsed.metadata?.accountNumber || null,
          accountType: parsed.metadata?.accountType || null,
          accountStatus: parsed.metadata?.accountStatus || null,
          accountHolderName: parsed.metadata?.accountHolderName || null,
          address: parsed.metadata?.address || null,
          bankName: 'HDFC Bank',
          branch: parsed.metadata?.branch || null,
          ifscCode: parsed.metadata?.ifscCode || null,
          micrCode: parsed.metadata?.micrCode || null,
          currency: parsed.metadata?.currency || 'INR',
          customerId: parsed.metadata?.customerId || null,
          email: parsed.metadata?.email || null,
          statementPeriod: {
            from: parsed.metadata?.statementPeriod?.from || null,
            to: parsed.metadata?.statementPeriod?.to || null,
          },
          openingBalance: parsed.metadata?.openingBalance || null,
          closingBalance: parsed.metadata?.closingBalance || null,
        },
        transactions,
        actualBalance: parsed.metadata?.closingBalance || 0,
      };
    }

    throw new Error(parsed.error || 'Unknown parsing error');
  } finally {
    try {
      fs.unlinkSync(tempFile);
    } catch {}
  }
}

/**
 * Simple parse function that just returns transactions
 */
export async function parseHDFCPDFStatement(buffer: Buffer, password?: string): Promise<ParsedHDFCTransaction[]> {
  const data = await parseHDFCPDFStatementFull(buffer, password);
  return data.transactions;
}

export function convertToDBTransactions(
  parsed: ParsedHDFCTransaction[],
  accountId: string,
  uploadId: string,
  userId: string
): NewBankTransaction[] {
  const now = new Date().toISOString();

  return parsed.map(t => ({
    id: uuidv4(),
    userId,
    accountId,
    date: t.date,
    valueDate: t.valueDate,
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

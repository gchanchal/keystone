import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import type { NewBankTransaction } from '../db/index.js';

export interface ParsedHDFCTransaction {
  date: string;
  valueDate: string | null;
  narration: string;
  reference: string | null;
  amount: number;
  transactionType: 'credit' | 'debit';
  balance: number | null;
}

function parseHDFCDate(dateStr: string | number): string {
  if (!dateStr) return '';

  const str = String(dateStr).trim();

  // Handle DD/MM/YY or DD/MM/YYYY format
  const parts = str.split('/');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    let year = parts[2];
    if (year.length === 2) {
      year = parseInt(year) > 50 ? '19' + year : '20' + year;
    }
    return `${year}-${month}-${day}`;
  }

  return str;
}

function parseAmount(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  return parseFloat(String(value).replace(/,/g, '')) || 0;
}

export function parseHDFCStatement(buffer: Buffer): ParsedHDFCTransaction[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to raw array format to handle merged cells and complex layouts
  const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const transactions: ParsedHDFCTransaction[] = [];

  // Find the header row by looking for "Date", "Narration" pattern
  let headerRowIndex = -1;
  let colMapping: { date: number; narration: number; ref: number; valueDate: number; withdrawal: number; deposit: number; balance: number } = {
    date: -1,
    narration: -1,
    ref: -1,
    valueDate: -1,
    withdrawal: -1,
    deposit: -1,
    balance: -1,
  };

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    const rowStr = row.map((c: any) => String(c).toLowerCase()).join(' ');

    // Look for header row containing "date" and "narration"
    if (rowStr.includes('date') && rowStr.includes('narration')) {
      headerRowIndex = i;

      // Map column indices
      row.forEach((cell: any, idx: number) => {
        const cellStr = String(cell).toLowerCase().trim();
        if (cellStr === 'date') colMapping.date = idx;
        else if (cellStr.includes('narration')) colMapping.narration = idx;
        else if (cellStr.includes('chq') || cellStr.includes('ref')) colMapping.ref = idx;
        else if (cellStr.includes('value')) colMapping.valueDate = idx;
        else if (cellStr.includes('withdrawal')) colMapping.withdrawal = idx;
        else if (cellStr.includes('deposit')) colMapping.deposit = idx;
        else if (cellStr.includes('balance') || cellStr.includes('closing')) colMapping.balance = idx;
      });

      break;
    }
  }

  if (headerRowIndex === -1) {
    console.error('Could not find header row in HDFC statement');
    return [];
  }

  console.log('Header found at row:', headerRowIndex);
  console.log('Column mapping:', colMapping);

  // Process transaction rows starting after header
  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const row = rawData[i];

    // Skip empty rows
    if (!row || row.length === 0) continue;

    // Check for end markers
    const firstCell = String(row[0] || '').toLowerCase();
    if (firstCell.includes('statement summary') || firstCell.includes('---')) {
      break;
    }

    // Skip separator rows (********)
    if (firstCell.includes('*****')) continue;

    // Get values from mapped columns
    const dateVal = row[colMapping.date];
    const narration = row[colMapping.narration];
    const reference = colMapping.ref >= 0 ? row[colMapping.ref] : null;
    const valueDateVal = colMapping.valueDate >= 0 ? row[colMapping.valueDate] : null;
    const withdrawal = parseAmount(colMapping.withdrawal >= 0 ? row[colMapping.withdrawal] : null);
    const deposit = parseAmount(colMapping.deposit >= 0 ? row[colMapping.deposit] : null);
    const balance = parseAmount(colMapping.balance >= 0 ? row[colMapping.balance] : null);

    // Validate required fields
    if (!dateVal || !narration) continue;

    const dateStr = String(dateVal).trim();
    const narrationStr = String(narration).trim();

    // Skip if date doesn't look like a date (DD/MM/YY format)
    if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(dateStr)) continue;

    // Skip if no amount
    if (withdrawal === 0 && deposit === 0) continue;

    const transaction: ParsedHDFCTransaction = {
      date: parseHDFCDate(dateStr),
      valueDate: valueDateVal ? parseHDFCDate(valueDateVal) : null,
      narration: narrationStr,
      reference: reference ? String(reference).trim() || null : null,
      amount: withdrawal > 0 ? withdrawal : deposit,
      transactionType: withdrawal > 0 ? 'debit' : 'credit',
      balance: balance || null,
    };

    transactions.push(transaction);
  }

  console.log('Parsed', transactions.length, 'transactions');
  return transactions;
}

export function convertToDBTransactions(
  parsed: ParsedHDFCTransaction[],
  accountId: string,
  uploadId: string
): NewBankTransaction[] {
  const now = new Date().toISOString();

  return parsed.map(t => ({
    id: uuidv4(),
    accountId,
    date: t.date,
    valueDate: t.valueDate,
    narration: t.narration,
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

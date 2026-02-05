import * as XLSX from 'xlsx';
import { format } from 'date-fns';

export interface ExportData {
  headers: string[];
  rows: (string | number | null)[][];
}

export function exportToCSV(data: ExportData): string {
  const escape = (val: string | number | null): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = data.headers.map(escape).join(',');
  const dataLines = data.rows.map(row => row.map(escape).join(','));

  return [headerLine, ...dataLines].join('\n');
}

export function exportToExcel(data: ExportData, sheetName = 'Data'): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([data.headers, ...data.rows]);

  // Auto-width columns
  const colWidths = data.headers.map((header, i) => {
    const maxDataWidth = Math.max(
      header.length,
      ...data.rows.map(row => String(row[i] || '').length)
    );
    return { wch: Math.min(maxDataWidth + 2, 50) };
  });
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

export function formatTransactionsForExport(
  transactions: Array<{
    date: string;
    narration?: string;
    description?: string;
    transactionType: string;
    amount: number;
    balance?: number | null;
    categoryId?: string | null;
    isReconciled?: boolean;
  }>,
  categories?: Map<string, string>
): ExportData {
  const headers = [
    'Date',
    'Description',
    'Type',
    'Amount',
    'Balance',
    'Category',
    'Reconciled',
  ];

  const rows = transactions.map(t => [
    t.date,
    t.narration || t.description || '',
    t.transactionType,
    t.amount,
    t.balance ?? '',
    categories?.get(t.categoryId || '') || '',
    t.isReconciled ? 'Yes' : 'No',
  ]);

  return { headers, rows };
}

export function formatReconciliationReport(
  matches: Array<{
    bankDate: string;
    bankNarration: string;
    bankAmount: number;
    vyaparDate: string;
    vyaparParty: string;
    vyaparAmount: number;
    confidence: number;
  }>,
  unmatchedBank: Array<{
    date: string;
    narration: string;
    amount: number;
  }>,
  unmatchedVyapar: Array<{
    date: string;
    partyName: string;
    amount: number;
  }>
): Buffer {
  const wb = XLSX.utils.book_new();

  // Matched transactions sheet
  const matchedHeaders = [
    'Bank Date',
    'Bank Narration',
    'Bank Amount',
    'Vyapar Date',
    'Vyapar Party',
    'Vyapar Amount',
    'Match Confidence',
  ];
  const matchedRows = matches.map(m => [
    m.bankDate,
    m.bankNarration,
    m.bankAmount,
    m.vyaparDate,
    m.vyaparParty,
    m.vyaparAmount,
    `${m.confidence}%`,
  ]);
  const matchedWs = XLSX.utils.aoa_to_sheet([matchedHeaders, ...matchedRows]);
  XLSX.utils.book_append_sheet(wb, matchedWs, 'Matched');

  // Unmatched bank transactions sheet
  const unmatchedBankHeaders = ['Date', 'Narration', 'Amount'];
  const unmatchedBankRows = unmatchedBank.map(t => [t.date, t.narration, t.amount]);
  const unmatchedBankWs = XLSX.utils.aoa_to_sheet([unmatchedBankHeaders, ...unmatchedBankRows]);
  XLSX.utils.book_append_sheet(wb, unmatchedBankWs, 'Unmatched Bank');

  // Unmatched vyapar transactions sheet
  const unmatchedVyaparHeaders = ['Date', 'Party Name', 'Amount'];
  const unmatchedVyaparRows = unmatchedVyapar.map(t => [t.date, t.partyName || '', t.amount]);
  const unmatchedVyaparWs = XLSX.utils.aoa_to_sheet([unmatchedVyaparHeaders, ...unmatchedVyaparRows]);
  XLSX.utils.book_append_sheet(wb, unmatchedVyaparWs, 'Unmatched Vyapar');

  // Summary sheet
  const summaryData = [
    ['Reconciliation Report'],
    [`Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`],
    [],
    ['Summary'],
    ['Matched Transactions', matches.length],
    ['Unmatched Bank Transactions', unmatchedBank.length],
    ['Unmatched Vyapar Transactions', unmatchedVyapar.length],
    [],
    ['Matched Amount (Bank)', matches.reduce((s, m) => s + m.bankAmount, 0)],
    ['Unmatched Amount (Bank)', unmatchedBank.reduce((s, t) => s + t.amount, 0)],
    ['Unmatched Amount (Vyapar)', unmatchedVyapar.reduce((s, t) => s + t.amount, 0)],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

export function formatPLReport(pl: {
  month: string;
  revenue: number;
  expenses: number;
  netProfit: number;
  items: Array<{
    category: string;
    type: 'income' | 'expense';
    amount: number;
  }>;
}): Buffer {
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryData = [
    ['Profit & Loss Statement'],
    [pl.month],
    [],
    ['Summary'],
    ['Total Revenue', pl.revenue],
    ['Total Expenses', pl.expenses],
    ['Net Profit', pl.netProfit],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  // Income breakdown
  const incomeItems = pl.items.filter(i => i.type === 'income');
  const incomeData = [
    ['Income Breakdown'],
    ['Category', 'Amount'],
    ...incomeItems.map(i => [i.category, i.amount]),
    [],
    ['Total', pl.revenue],
  ];
  const incomeWs = XLSX.utils.aoa_to_sheet(incomeData);
  XLSX.utils.book_append_sheet(wb, incomeWs, 'Income');

  // Expense breakdown
  const expenseItems = pl.items.filter(i => i.type === 'expense');
  const expenseData = [
    ['Expense Breakdown'],
    ['Category', 'Amount'],
    ...expenseItems.map(i => [i.category, i.amount]),
    [],
    ['Total', pl.expenses],
  ];
  const expenseWs = XLSX.utils.aoa_to_sheet(expenseData);
  XLSX.utils.book_append_sheet(wb, expenseWs, 'Expenses');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

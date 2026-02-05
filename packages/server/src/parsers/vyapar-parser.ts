import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import type { NewVyaparTransaction, NewVyaparItemDetail } from '../db/index.js';

export interface ParsedVyaparTransaction {
  date: string;
  invoiceNumber: string | null;
  transactionType: string;
  partyName: string | null;
  categoryName: string | null;
  paymentType: string | null;
  amount: number;
  balance: number | null;
  description: string | null;
}

export interface ParsedVyaparItemDetail {
  date: string;
  invoiceNumber: string | null;
  partyName: string | null;
  itemName: string;
  itemCode: string | null;
  category: string | null;
  challanOrderNo: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
  discountPercent: number | null;
  discount: number | null;
  taxPercent: number | null;
  tax: number | null;
  transactionType: string;
  amount: number;
}

function parseVyaparDate(dateStr: string | number): string {
  if (!dateStr) return '';

  // Handle Excel serial date number
  if (typeof dateStr === 'number') {
    const date = XLSX.SSF.parse_date_code(dateStr);
    return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
  }

  // Handle DD/MM/YYYY or DD-MM-YYYY format
  const parts = String(dateStr).split(/[-\/]/);
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    let year = parts[2];
    if (year.length === 2) {
      year = parseInt(year) > 50 ? '19' + year : '20' + year;
    }
    return `${year}-${month}-${day}`;
  }

  return String(dateStr);
}

function parseAmount(value: string | number | undefined): number {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return Math.abs(value);
  return Math.abs(parseFloat(String(value).replace(/[,₹Rs\.]/g, '')) || 0);
}

export function parseVyaparReport(buffer: Buffer): ParsedVyaparTransaction[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to raw array format to handle the exact Vyapar structure
  const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const transactions: ParsedVyaparTransaction[] = [];

  // Find the header row by looking for "Date" and "Type" columns
  let headerRowIndex = -1;
  let colMapping = {
    date: -1,
    reference: -1,
    partyName: -1,
    categoryName: -1,
    type: -1,
    total: -1,
    paymentType: -1,
    paid: -1,
    received: -1,
    balance: -1,
    paymentStatus: -1,
    description: -1,
  };

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    const rowStr = row.map((c: any) => String(c).toLowerCase()).join(' ');

    // Look for header row containing "date" and "type"
    if (rowStr.includes('date') && rowStr.includes('type')) {
      headerRowIndex = i;

      // Map column indices
      row.forEach((cell: any, idx: number) => {
        const cellStr = String(cell).toLowerCase().trim();
        if (cellStr === 'date') colMapping.date = idx;
        else if (cellStr.includes('reference') || cellStr === 'ref no') colMapping.reference = idx;
        else if (cellStr.includes('party')) colMapping.partyName = idx;
        else if (cellStr.includes('category')) colMapping.categoryName = idx;
        else if (cellStr === 'type') colMapping.type = idx;
        else if (cellStr === 'total') colMapping.total = idx;
        else if (cellStr.includes('payment type')) colMapping.paymentType = idx;
        else if (cellStr === 'paid') colMapping.paid = idx;
        else if (cellStr === 'received') colMapping.received = idx;
        else if (cellStr === 'balance') colMapping.balance = idx;
        else if (cellStr.includes('payment status')) colMapping.paymentStatus = idx;
        else if (cellStr.includes('description')) colMapping.description = idx;
      });

      break;
    }
  }

  if (headerRowIndex === -1) {
    console.error('Could not find header row in Vyapar report');
    return [];
  }

  console.log('Vyapar header found at row:', headerRowIndex);
  console.log('Column mapping:', colMapping);

  // Process transaction rows starting after header
  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const row = rawData[i];

    // Skip empty rows
    if (!row || row.length === 0) continue;

    // Get values from mapped columns
    const dateVal = colMapping.date >= 0 ? row[colMapping.date] : null;
    const reference = colMapping.reference >= 0 ? row[colMapping.reference] : null;
    const partyName = colMapping.partyName >= 0 ? row[colMapping.partyName] : null;
    const categoryName = colMapping.categoryName >= 0 ? row[colMapping.categoryName] : null;
    const transactionType = colMapping.type >= 0 ? row[colMapping.type] : null;
    const total = colMapping.total >= 0 ? parseAmount(row[colMapping.total]) : 0;
    const paymentType = colMapping.paymentType >= 0 ? row[colMapping.paymentType] : null;
    const paid = colMapping.paid >= 0 ? parseAmount(row[colMapping.paid]) : 0;
    const received = colMapping.received >= 0 ? parseAmount(row[colMapping.received]) : 0;
    const balance = colMapping.balance >= 0 ? parseAmount(row[colMapping.balance]) : null;
    const description = colMapping.description >= 0 ? row[colMapping.description] : null;

    // Validate required fields
    if (!dateVal) continue;

    const dateStr = String(dateVal).trim();

    // Skip if date doesn't look like a date (DD/MM/YYYY format)
    if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(dateStr)) continue;

    // Calculate amount: use total, or received - paid
    const amount = total > 0 ? total : (received > 0 ? received : paid);
    if (amount === 0) continue;

    const transaction: ParsedVyaparTransaction = {
      date: parseVyaparDate(dateStr),
      invoiceNumber: reference ? String(reference).trim() || null : null,
      transactionType: transactionType ? String(transactionType).trim() : 'Unknown',
      partyName: partyName ? String(partyName).trim() || null : null,
      categoryName: categoryName ? String(categoryName).trim() || null : null,
      paymentType: paymentType ? String(paymentType).trim() || null : null,
      amount,
      balance: balance,
      description: description ? String(description).trim() || null : null,
    };

    transactions.push(transaction);
  }

  console.log('Parsed', transactions.length, 'Vyapar transactions');
  return transactions;
}

export function convertToDBTransactions(
  parsed: ParsedVyaparTransaction[],
  uploadId: string
): NewVyaparTransaction[] {
  const now = new Date().toISOString();

  return parsed.map(t => ({
    id: uuidv4(),
    date: t.date,
    invoiceNumber: t.invoiceNumber,
    transactionType: t.transactionType,
    partyName: t.partyName,
    categoryName: t.categoryName,
    paymentType: t.paymentType,
    amount: t.amount,
    balance: t.balance,
    description: t.description,
    isReconciled: false,
    reconciledWithId: null,
    uploadId,
    createdAt: now,
    updatedAt: now,
  }));
}

// Parse Item Details sheet from Vyapar report
export function parseVyaparItemDetails(buffer: Buffer): ParsedVyaparItemDetail[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  // Find "Item Details" sheet (case-insensitive)
  const itemDetailsSheetName = workbook.SheetNames.find(
    name => name.toLowerCase().includes('item') && name.toLowerCase().includes('detail')
  );

  if (!itemDetailsSheetName) {
    console.log('No Item Details sheet found in Vyapar report');
    return [];
  }

  const sheet = workbook.Sheets[itemDetailsSheetName];
  const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const items: ParsedVyaparItemDetail[] = [];

  // Find header row
  let headerRowIndex = -1;
  let colMapping = {
    date: -1,
    invoiceNo: -1,
    partyName: -1,
    itemName: -1,
    itemCode: -1,
    category: -1,
    challanOrderNo: -1,
    quantity: -1,
    unit: -1,
    unitPrice: -1,
    discountPercent: -1,
    discount: -1,
    taxPercent: -1,
    tax: -1,
    transactionType: -1,
    amount: -1,
  };

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    const rowStr = row.map((c: any) => String(c).toLowerCase()).join(' ');

    // Look for header row containing "date" and "item name"
    if (rowStr.includes('date') && (rowStr.includes('item name') || rowStr.includes('item'))) {
      headerRowIndex = i;

      row.forEach((cell: any, idx: number) => {
        const cellStr = String(cell).toLowerCase().trim();
        if (cellStr === 'date') colMapping.date = idx;
        else if (cellStr.includes('invoice') || cellStr === 'inv no' || cellStr === 'invoice no.') colMapping.invoiceNo = idx;
        else if (cellStr.includes('party')) colMapping.partyName = idx;
        else if (cellStr === 'item name' || cellStr === 'item') colMapping.itemName = idx;
        else if (cellStr === 'item code' || cellStr === 'code') colMapping.itemCode = idx;
        else if (cellStr === 'category') colMapping.category = idx;
        else if (cellStr.includes('challan') || cellStr.includes('order no')) colMapping.challanOrderNo = idx;
        else if (cellStr === 'quantity' || cellStr === 'qty') colMapping.quantity = idx;
        else if (cellStr === 'unit') colMapping.unit = idx;
        else if (cellStr.includes('unit price') || cellStr === 'unitprice' || cellStr === 'price/unit') colMapping.unitPrice = idx;
        else if (cellStr.includes('discount %') || cellStr === 'discount(%)') colMapping.discountPercent = idx;
        else if (cellStr === 'discount' && !cellStr.includes('%')) colMapping.discount = idx;
        else if (cellStr.includes('tax %') || cellStr === 'tax(%)' || cellStr.includes('tax percent')) colMapping.taxPercent = idx;
        else if (cellStr === 'tax' && !cellStr.includes('%')) colMapping.tax = idx;
        else if (cellStr === 'transaction type' || cellStr === 'type') colMapping.transactionType = idx;
        else if (cellStr === 'amount' || cellStr === 'total') colMapping.amount = idx;
      });

      break;
    }
  }

  if (headerRowIndex === -1) {
    console.error('Could not find header row in Item Details sheet');
    return [];
  }

  console.log('Item Details header found at row:', headerRowIndex);
  console.log('Item Details column mapping:', colMapping);

  // Process rows
  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const row = rawData[i];

    if (!row || row.length === 0) continue;

    const dateVal = colMapping.date >= 0 ? row[colMapping.date] : null;
    const itemName = colMapping.itemName >= 0 ? row[colMapping.itemName] : null;
    const amount = colMapping.amount >= 0 ? parseAmount(row[colMapping.amount]) : 0;

    // Skip rows without date or item name
    if (!dateVal || !itemName) continue;

    const dateStr = String(dateVal).trim();
    // Skip if date doesn't look like a date
    if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(dateStr) && typeof dateVal !== 'number') continue;

    const item: ParsedVyaparItemDetail = {
      date: parseVyaparDate(dateVal),
      invoiceNumber: colMapping.invoiceNo >= 0 && row[colMapping.invoiceNo] ? String(row[colMapping.invoiceNo]).trim() || null : null,
      partyName: colMapping.partyName >= 0 && row[colMapping.partyName] ? String(row[colMapping.partyName]).trim() || null : null,
      itemName: String(itemName).trim(),
      itemCode: colMapping.itemCode >= 0 && row[colMapping.itemCode] ? String(row[colMapping.itemCode]).trim() || null : null,
      category: colMapping.category >= 0 && row[colMapping.category] ? String(row[colMapping.category]).trim() || null : null,
      challanOrderNo: colMapping.challanOrderNo >= 0 && row[colMapping.challanOrderNo] ? String(row[colMapping.challanOrderNo]).trim() || null : null,
      quantity: colMapping.quantity >= 0 ? parseAmount(row[colMapping.quantity]) || 1 : 1,
      unit: colMapping.unit >= 0 && row[colMapping.unit] ? String(row[colMapping.unit]).trim() || null : null,
      unitPrice: colMapping.unitPrice >= 0 ? parseAmount(row[colMapping.unitPrice]) || null : null,
      discountPercent: colMapping.discountPercent >= 0 ? parseAmount(row[colMapping.discountPercent]) || null : null,
      discount: colMapping.discount >= 0 ? parseAmount(row[colMapping.discount]) || null : null,
      taxPercent: colMapping.taxPercent >= 0 ? parseAmount(row[colMapping.taxPercent]) || null : null,
      tax: colMapping.tax >= 0 ? parseAmount(row[colMapping.tax]) || null : null,
      transactionType: colMapping.transactionType >= 0 && row[colMapping.transactionType] ? String(row[colMapping.transactionType]).trim() : 'Unknown',
      amount,
    };

    items.push(item);
  }

  console.log('Parsed', items.length, 'Vyapar item details');
  return items;
}

export function convertToDBItemDetails(
  parsed: ParsedVyaparItemDetail[],
  uploadId: string
): NewVyaparItemDetail[] {
  const now = new Date().toISOString();

  return parsed.map(item => ({
    id: uuidv4(),
    date: item.date,
    invoiceNumber: item.invoiceNumber,
    partyName: item.partyName,
    itemName: item.itemName,
    itemCode: item.itemCode,
    category: item.category,
    challanOrderNo: item.challanOrderNo,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.unitPrice,
    discountPercent: item.discountPercent,
    discount: item.discount,
    taxPercent: item.taxPercent,
    tax: item.tax,
    transactionType: item.transactionType,
    amount: item.amount,
    uploadId,
    createdAt: now,
  }));
}

/**
 * Template Extractor for Excel and CSV files
 * Extracts structure and suggests field mappings for learning
 */

import * as XLSX from 'xlsx';
import { SYSTEM_FIELDS, SystemFieldKey } from '../db/schema/templates.js';

export interface ExtractedField {
  index: number;
  name: string;
  type: 'text' | 'date' | 'amount' | 'number' | 'unknown';
  sampleValues: string[];
}

export interface ExtractionResult {
  fields: {
    headers: string[];
    columns: ExtractedField[];
    sampleRows: any[][];
    rowCount: number;
    headerRowIndex: number;
  };
  suggestedMappings: Record<string, { source: string; format?: string }>;
  detectionPatterns: {
    textPatterns: string[];
    filenamePatterns: string[];
  };
}

/**
 * Detect the type of a value
 */
function detectValueType(value: any): 'date' | 'amount' | 'number' | 'text' | 'unknown' {
  if (value === null || value === undefined || value === '') {
    return 'unknown';
  }

  const str = String(value).trim();

  // Check for date patterns
  const datePatterns = [
    /^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/, // DD/MM/YYYY or MM/DD/YYYY
    /^\d{2,4}[-\/]\d{1,2}[-\/]\d{1,2}$/, // YYYY/MM/DD
    /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/, // DD-MMM-YYYY
    /^[A-Za-z]{3}\s+\d{1,2},?\s+\d{4}$/, // Jan 15, 2024
  ];
  if (datePatterns.some(p => p.test(str))) {
    return 'date';
  }

  // Check for amount patterns (with currency symbols, commas)
  const amountPatterns = [
    /^[₹$€£]?\s*-?\d{1,3}(,\d{3})*(\.\d{1,2})?$/, // ₹1,234.56
    /^-?\d{1,3}(,\d{3})*(\.\d{1,2})?\s*(cr|dr|CR|DR)?$/, // 1,234.56 CR
    /^\(?[₹$€£]?\s*\d{1,3}(,\d{3})*(\.\d{1,2})?\)?$/, // (1,234.56) for negatives
  ];
  if (amountPatterns.some(p => p.test(str))) {
    return 'amount';
  }

  // Check for plain numbers
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    return 'number';
  }

  return 'text';
}

/**
 * Detect date format from a sample date string
 */
function detectDateFormat(dateStr: string): string {
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) return 'DD/MM/YYYY';
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(dateStr)) return 'DD/MM/YY';
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(dateStr)) return 'DD-MM-YYYY';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(dateStr)) return 'YYYY-MM-DD';
  if (/^\d{1,2}-[A-Za-z]{3}-\d{4}$/i.test(dateStr)) return 'DD-MMM-YYYY';
  if (/^\d{1,2}-[A-Za-z]{3}-\d{2}$/i.test(dateStr)) return 'DD-MMM-YY';
  return 'auto';
}

/**
 * Suggest system field mapping based on header name
 */
function suggestMapping(header: string, fieldType: string): SystemFieldKey | null {
  const headerLower = header.toLowerCase().trim();

  // Date mappings
  const datePatterns = [
    { patterns: ['date', 'txn date', 'transaction date', 'posting date', 'trans date'], field: 'date' },
    { patterns: ['value date', 'val date', 'value dt'], field: 'valueDate' },
  ];

  // Amount mappings
  const amountPatterns = [
    { patterns: ['withdrawal', 'debit', 'dr', 'debit amount', 'withdrawal amt', 'dr amt'], field: 'withdrawal' },
    { patterns: ['deposit', 'credit', 'cr', 'credit amount', 'deposit amt', 'cr amt'], field: 'deposit' },
    { patterns: ['amount', 'txn amount', 'transaction amount', 'amt'], field: 'amount' },
    { patterns: ['balance', 'closing balance', 'running balance', 'bal', 'closing bal'], field: 'balance' },
  ];

  // Text mappings
  const textPatterns = [
    { patterns: ['narration', 'description', 'particulars', 'remarks', 'details', 'transaction details'], field: 'narration' },
    { patterns: ['reference', 'ref', 'cheque no', 'chq no', 'ref no', 'reference no', 'utr', 'transaction id'], field: 'reference' },
    { patterns: ['type', 'transaction type', 'txn type', 'trans type'], field: 'transactionType' },
    { patterns: ['category', 'cat'], field: 'category' },
    { patterns: ['merchant', 'merchant name', 'vendor'], field: 'merchant' },
    { patterns: ['card', 'card number', 'card no', 'last 4 digits'], field: 'cardNumber' },
  ];

  const allPatterns = [...datePatterns, ...amountPatterns, ...textPatterns];

  for (const { patterns, field } of allPatterns) {
    for (const pattern of patterns) {
      if (headerLower === pattern || headerLower.includes(pattern)) {
        return field as SystemFieldKey;
      }
    }
  }

  return null;
}

/**
 * Find the header row in Excel data
 */
function findHeaderRow(data: any[][]): { headerRowIndex: number; headers: string[] } {
  // Look for row with mostly text values that look like headers
  for (let i = 0; i < Math.min(15, data.length); i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    // Count non-empty cells
    const nonEmpty = row.filter(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
    if (nonEmpty.length < 3) continue;

    // Check if row has header-like values
    const textCells = nonEmpty.filter(cell => typeof cell === 'string' && isNaN(parseFloat(cell)));
    const headerKeywords = ['date', 'amount', 'balance', 'narration', 'description', 'debit', 'credit', 'reference', 'particulars'];

    const hasHeaderKeywords = nonEmpty.some(cell => {
      const cellStr = String(cell).toLowerCase();
      return headerKeywords.some(kw => cellStr.includes(kw));
    });

    // If row has header keywords or is mostly text, consider it a header
    if (hasHeaderKeywords || textCells.length >= nonEmpty.length * 0.6) {
      return {
        headerRowIndex: i,
        headers: row.map(cell => String(cell || '').trim()),
      };
    }
  }

  // Default to first row
  return {
    headerRowIndex: 0,
    headers: data[0]?.map(cell => String(cell || '').trim()) || [],
  };
}

/**
 * Extract text patterns for detection
 */
function extractTextPatterns(data: any[][], headers: string[]): string[] {
  const patterns: string[] = [];

  // Check first 10 rows for bank/institution identifiers
  const textContent = data.slice(0, 10)
    .flat()
    .filter(cell => typeof cell === 'string')
    .join(' ')
    .toLowerCase();

  // Common bank patterns
  const bankPatterns = [
    'hdfc bank', 'icici bank', 'sbi', 'axis bank', 'kotak mahindra',
    'yes bank', 'idfc first', 'federal bank', 'karnataka bank',
  ];

  for (const bank of bankPatterns) {
    if (textContent.includes(bank)) {
      patterns.push(bank);
    }
  }

  // Add significant headers as patterns
  const significantHeaders = headers.filter(h =>
    h.length > 3 && !['date', 'amount', 'balance'].includes(h.toLowerCase())
  );
  patterns.push(...significantHeaders.slice(0, 3));

  return [...new Set(patterns)];
}

/**
 * Extract template structure from Excel file
 */
export async function extractTemplateFromExcel(buffer: Buffer): Promise<ExtractionResult> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  // Get the first sheet (or sheet with transaction data)
  let sheetName = workbook.SheetNames[0];
  for (const name of workbook.SheetNames) {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('transaction') || lowerName.includes('statement')) {
      sheetName = name;
      break;
    }
  }

  const sheet = workbook.Sheets[sheetName];
  const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (data.length === 0) {
    throw new Error('Empty spreadsheet');
  }

  // Find header row
  const { headerRowIndex, headers } = findHeaderRow(data);

  // Get data rows (after header)
  const dataRows = data.slice(headerRowIndex + 1).filter(row =>
    row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '')
  );

  if (dataRows.length === 0) {
    throw new Error('No data rows found');
  }

  // Analyze each column
  const columns: ExtractedField[] = [];
  const suggestedMappings: Record<string, { source: string; format?: string }> = {};

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (!header) continue;

    // Get sample values
    const sampleValues = dataRows
      .slice(0, 10)
      .map(row => row[i])
      .filter(v => v !== null && v !== undefined && String(v).trim() !== '')
      .map(v => String(v));

    // Detect column type from values
    const types = sampleValues.map(v => detectValueType(v));
    const typeCount: Record<string, number> = {};
    for (const t of types) {
      typeCount[t] = (typeCount[t] || 0) + 1;
    }

    // Get most common type
    let detectedType: ExtractedField['type'] = 'unknown';
    let maxCount = 0;
    for (const [t, count] of Object.entries(typeCount)) {
      if (count > maxCount && t !== 'unknown') {
        maxCount = count;
        detectedType = t as ExtractedField['type'];
      }
    }

    const field: ExtractedField = {
      index: i,
      name: header,
      type: detectedType,
      sampleValues: sampleValues.slice(0, 5),
    };

    columns.push(field);

    // Suggest mapping
    const suggestedField = suggestMapping(header, detectedType);
    if (suggestedField) {
      const mapping: { source: string; format?: string } = { source: `col_${i}` };

      // Add date format if applicable
      if (suggestedField === 'date' || suggestedField === 'valueDate') {
        const sampleDate = sampleValues.find(v => detectValueType(v) === 'date');
        if (sampleDate) {
          mapping.format = detectDateFormat(sampleDate);
        }
      }

      suggestedMappings[suggestedField] = mapping;
    }
  }

  // Extract text patterns for detection
  const textPatterns = extractTextPatterns(data, headers);

  return {
    fields: {
      headers,
      columns,
      sampleRows: dataRows.slice(0, 5),
      rowCount: dataRows.length,
      headerRowIndex,
    },
    suggestedMappings,
    detectionPatterns: {
      textPatterns,
      filenamePatterns: [],
    },
  };
}

/**
 * Extract template structure from CSV file
 */
export async function extractTemplateFromCSV(buffer: Buffer): Promise<ExtractionResult> {
  // Parse CSV as Excel (xlsx handles CSV too)
  const content = buffer.toString('utf-8');
  const workbook = XLSX.read(content, { type: 'string' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (data.length === 0) {
    throw new Error('Empty CSV file');
  }

  // Find header row
  const { headerRowIndex, headers } = findHeaderRow(data);

  // Get data rows (after header)
  const dataRows = data.slice(headerRowIndex + 1).filter(row =>
    row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '')
  );

  if (dataRows.length === 0) {
    throw new Error('No data rows found');
  }

  // Analyze columns (same as Excel)
  const columns: ExtractedField[] = [];
  const suggestedMappings: Record<string, { source: string; format?: string }> = {};

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (!header) continue;

    const sampleValues = dataRows
      .slice(0, 10)
      .map(row => row[i])
      .filter(v => v !== null && v !== undefined && String(v).trim() !== '')
      .map(v => String(v));

    const types = sampleValues.map(v => detectValueType(v));
    const typeCount: Record<string, number> = {};
    for (const t of types) {
      typeCount[t] = (typeCount[t] || 0) + 1;
    }

    let detectedType: ExtractedField['type'] = 'unknown';
    let maxCount = 0;
    for (const [t, count] of Object.entries(typeCount)) {
      if (count > maxCount && t !== 'unknown') {
        maxCount = count;
        detectedType = t as ExtractedField['type'];
      }
    }

    const field: ExtractedField = {
      index: i,
      name: header,
      type: detectedType,
      sampleValues: sampleValues.slice(0, 5),
    };

    columns.push(field);

    const suggestedField = suggestMapping(header, detectedType);
    if (suggestedField) {
      const mapping: { source: string; format?: string } = { source: `col_${i}` };
      if (suggestedField === 'date' || suggestedField === 'valueDate') {
        const sampleDate = sampleValues.find(v => detectValueType(v) === 'date');
        if (sampleDate) {
          mapping.format = detectDateFormat(sampleDate);
        }
      }
      suggestedMappings[suggestedField] = mapping;
    }
  }

  const textPatterns = extractTextPatterns(data, headers);

  return {
    fields: {
      headers,
      columns,
      sampleRows: dataRows.slice(0, 5),
      rowCount: dataRows.length,
      headerRowIndex,
    },
    suggestedMappings,
    detectionPatterns: {
      textPatterns,
      filenamePatterns: [],
    },
  };
}

/**
 * Template Parser
 * Parses files using learned template mappings
 */

import * as XLSX from 'xlsx';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { LearnedTemplate } from '../db/schema/templates.js';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(customParseFormat);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ParsedTransaction {
  date: string;
  valueDate?: string;
  narration: string;
  reference?: string;
  withdrawal?: number;
  deposit?: number;
  amount?: number;
  balance?: number;
  transactionType?: string;
  category?: string;
  merchant?: string;
  cardNumber?: string;
  rawData?: Record<string, any>;
}

export interface TemplateParseResult {
  success: boolean;
  transactions: ParsedTransaction[];
  errors: string[];
  rowsProcessed: number;
  rowsSkipped: number;
}

/**
 * Parse date string according to format
 */
function parseDate(value: any, format?: string): string | null {
  if (!value) return null;

  const str = String(value).trim();
  if (!str) return null;

  // Try specified format first
  if (format && format !== 'auto') {
    const formatMap: Record<string, string> = {
      'DD/MM/YYYY': 'DD/MM/YYYY',
      'DD-MM-YYYY': 'DD-MM-YYYY',
      'DD/MM/YY': 'DD/MM/YY',
      'DD-MM-YY': 'DD-MM-YY',
      'YYYY-MM-DD': 'YYYY-MM-DD',
      'MM/DD/YYYY': 'MM/DD/YYYY',
      'DD-MMM-YYYY': 'DD-MMM-YYYY',
      'DD-MMM-YY': 'DD-MMM-YY',
    };

    const dayjsFormat = formatMap[format];
    if (dayjsFormat) {
      const parsed = dayjs(str, dayjsFormat);
      if (parsed.isValid()) {
        return parsed.format('YYYY-MM-DD');
      }
    }
  }

  // Try common formats
  const formats = [
    'DD/MM/YYYY', 'DD-MM-YYYY', 'DD/MM/YY', 'DD-MM-YY',
    'YYYY-MM-DD', 'MM/DD/YYYY', 'DD-MMM-YYYY', 'DD-MMM-YY',
    'D/M/YYYY', 'D-M-YYYY',
  ];

  for (const fmt of formats) {
    const parsed = dayjs(str, fmt, true);
    if (parsed.isValid()) {
      return parsed.format('YYYY-MM-DD');
    }
  }

  // Try native Date parsing as fallback
  const nativeDate = new Date(str);
  if (!isNaN(nativeDate.getTime())) {
    return dayjs(nativeDate).format('YYYY-MM-DD');
  }

  return null;
}

/**
 * Parse amount string to number
 */
function parseAmount(value: any): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // If already a number
  if (typeof value === 'number') {
    return value;
  }

  let str = String(value).trim();
  if (!str) return null;

  // Check for DR/CR suffix (Indian banking)
  const isDebit = /\s*(dr|DR|Dr)\s*$/.test(str);
  const isCredit = /\s*(cr|CR|Cr)\s*$/.test(str);
  str = str.replace(/\s*(dr|DR|Dr|cr|CR|Cr)\s*$/g, '');

  // Check for negative in parentheses: (1,234.56)
  const isNegative = str.startsWith('(') && str.endsWith(')');
  if (isNegative) {
    str = str.slice(1, -1);
  }

  // Remove currency symbols and spaces
  str = str.replace(/[₹$€£\s]/g, '');

  // Remove commas
  str = str.replace(/,/g, '');

  // Handle minus sign
  const hasMinusSign = str.startsWith('-');
  if (hasMinusSign) {
    str = str.slice(1);
  }

  const num = parseFloat(str);
  if (isNaN(num)) {
    return null;
  }

  // Apply sign
  let result = num;
  if (isNegative || hasMinusSign || isDebit) {
    result = -Math.abs(num);
  } else if (isCredit) {
    result = Math.abs(num);
  }

  return result;
}

/**
 * Get column value from row by source
 */
function getColumnValue(row: any[], source: string): any {
  // Source format: "col_0", "col_1", etc.
  const match = source.match(/^col_(\d+)$/);
  if (match) {
    const index = parseInt(match[1], 10);
    return row[index];
  }
  return null;
}

/**
 * Parse Excel file using template
 */
async function parseExcelWithTemplate(
  buffer: Buffer,
  template: LearnedTemplate
): Promise<TemplateParseResult> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const mappings = JSON.parse(template.fieldMappings);
  const sampleHeaders = template.sampleHeaders ? JSON.parse(template.sampleHeaders) : [];

  // Find header row (match with sample headers)
  let headerRowIndex = 0;
  if (sampleHeaders.length > 0) {
    for (let i = 0; i < Math.min(15, data.length); i++) {
      const row = data[i];
      const rowStr = row.map((c: any) => String(c || '').toLowerCase().trim());
      const headerStr = sampleHeaders.map((h: string) => h.toLowerCase().trim());

      // Check if this row matches sample headers
      const matches = headerStr.filter((h: string) => rowStr.includes(h)).length;
      if (matches >= Math.min(3, headerStr.length * 0.5)) {
        headerRowIndex = i;
        break;
      }
    }
  }

  const transactions: ParsedTransaction[] = [];
  const errors: string[] = [];
  let rowsSkipped = 0;

  // Process data rows
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];

    // Skip empty rows
    if (!row.some((cell: any) => cell !== null && cell !== undefined && String(cell).trim() !== '')) {
      rowsSkipped++;
      continue;
    }

    try {
      const txn: ParsedTransaction = {
        date: '',
        narration: '',
        rawData: {},
      };

      // Extract fields according to mappings
      for (const [field, mapping] of Object.entries(mappings)) {
        const { source, format } = mapping as { source: string; format?: string };
        const value = getColumnValue(row, source);

        // Store raw value
        txn.rawData![field] = value;

        switch (field) {
          case 'date':
            const parsedDate = parseDate(value, format);
            if (parsedDate) {
              txn.date = parsedDate;
            }
            break;

          case 'valueDate':
            const parsedValueDate = parseDate(value, format);
            if (parsedValueDate) {
              txn.valueDate = parsedValueDate;
            }
            break;

          case 'narration':
            txn.narration = String(value || '').trim();
            break;

          case 'reference':
            txn.reference = value ? String(value).trim() : undefined;
            break;

          case 'withdrawal':
            const withdrawal = parseAmount(value);
            if (withdrawal !== null && withdrawal !== 0) {
              txn.withdrawal = Math.abs(withdrawal);
            }
            break;

          case 'deposit':
            const deposit = parseAmount(value);
            if (deposit !== null && deposit !== 0) {
              txn.deposit = Math.abs(deposit);
            }
            break;

          case 'amount':
            const amount = parseAmount(value);
            if (amount !== null) {
              txn.amount = amount;
            }
            break;

          case 'balance':
            const balance = parseAmount(value);
            if (balance !== null) {
              txn.balance = balance;
            }
            break;

          case 'transactionType':
            txn.transactionType = value ? String(value).trim() : undefined;
            break;

          case 'category':
            txn.category = value ? String(value).trim() : undefined;
            break;

          case 'merchant':
            txn.merchant = value ? String(value).trim() : undefined;
            break;

          case 'cardNumber':
            txn.cardNumber = value ? String(value).trim() : undefined;
            break;
        }
      }

      // Validate required fields
      if (!txn.date) {
        errors.push(`Row ${i + 1}: Missing or invalid date`);
        rowsSkipped++;
        continue;
      }

      if (!txn.narration && !txn.merchant) {
        errors.push(`Row ${i + 1}: Missing narration/description`);
        rowsSkipped++;
        continue;
      }

      // Need at least one amount field
      if (txn.withdrawal === undefined && txn.deposit === undefined && txn.amount === undefined) {
        errors.push(`Row ${i + 1}: Missing amount`);
        rowsSkipped++;
        continue;
      }

      transactions.push(txn);
    } catch (err: any) {
      errors.push(`Row ${i + 1}: ${err.message}`);
      rowsSkipped++;
    }
  }

  return {
    success: transactions.length > 0,
    transactions,
    errors,
    rowsProcessed: data.length - headerRowIndex - 1,
    rowsSkipped,
  };
}

/**
 * Parse PDF file using template
 */
async function parsePDFWithTemplate(
  filePath: string,
  template: LearnedTemplate,
  password?: string
): Promise<TemplateParseResult> {
  const scriptPath = path.join(__dirname, 'template_parser.py');

  // Check if script exists
  if (!fs.existsSync(scriptPath)) {
    throw new Error('PDF parser script not found');
  }

  const mappings = JSON.parse(template.fieldMappings);

  try {
    const args = password
      ? `"${filePath}" '${JSON.stringify(mappings)}' "${password}"`
      : `"${filePath}" '${JSON.stringify(mappings)}'`;

    const result = execSync(`python3 "${scriptPath}" ${args}`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120000,
    });

    const parsed = JSON.parse(result.trim());

    if (parsed.error) {
      throw new Error(parsed.error);
    }

    return {
      success: parsed.transactions.length > 0,
      transactions: parsed.transactions,
      errors: parsed.errors || [],
      rowsProcessed: parsed.rows_processed || 0,
      rowsSkipped: parsed.rows_skipped || 0,
    };
  } catch (error: any) {
    throw new Error(`Failed to parse PDF: ${error.message}`);
  }
}

/**
 * Parse file using learned template
 */
export async function parseWithTemplate(
  buffer: Buffer,
  template: LearnedTemplate,
  filePath?: string,
  password?: string
): Promise<TemplateParseResult> {
  const fileType = template.fileType;

  if (fileType === 'pdf') {
    if (!filePath) {
      // Create temp file
      const tempPath = path.join(os.tmpdir(), `parse-${Date.now()}.pdf`);
      fs.writeFileSync(tempPath, buffer);
      try {
        return await parsePDFWithTemplate(tempPath, template, password);
      } finally {
        fs.unlinkSync(tempPath);
      }
    }
    return parsePDFWithTemplate(filePath, template, password);
  }

  if (fileType === 'xlsx' || fileType === 'xls' || fileType === 'csv') {
    return parseExcelWithTemplate(buffer, template);
  }

  throw new Error(`Unsupported file type: ${fileType}`);
}

/**
 * Check if a file matches a template's detection patterns
 */
export function matchesTemplate(
  content: string,
  filename: string,
  template: LearnedTemplate
): { matched: boolean; confidence: number } {
  const patterns = JSON.parse(template.detectionPatterns);
  let score = 0;

  // Check text patterns
  if (patterns.textPatterns && content) {
    const contentLower = content.toLowerCase();
    for (const pattern of patterns.textPatterns) {
      if (contentLower.includes(pattern.toLowerCase())) {
        score += 10;
      }
    }
  }

  // Check filename patterns
  if (patterns.filenamePatterns && filename) {
    const filenameLower = filename.toLowerCase();
    for (const pattern of patterns.filenamePatterns) {
      if (filenameLower.includes(pattern.toLowerCase())) {
        score += 5;
      }
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(filename)) {
          score += 8;
        }
      } catch {
        // Invalid regex, skip
      }
    }
  }

  return {
    matched: score >= 10,
    confidence: Math.min(score / 30, 1), // Normalize to 0-1
  };
}

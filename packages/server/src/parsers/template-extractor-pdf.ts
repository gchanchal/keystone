/**
 * PDF Template Extractor
 * Uses Python pdfplumber to extract structure from PDFs
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { ExtractionResult, ExtractedField } from './template-extractor.js';
import { SystemFieldKey } from '../db/schema/templates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Suggest system field mapping based on header name
 */
function suggestMapping(header: string): SystemFieldKey | null {
  const headerLower = header.toLowerCase().trim();

  const mappings: { patterns: string[]; field: SystemFieldKey }[] = [
    { patterns: ['date', 'txn date', 'transaction date', 'posting date', 'trans date'], field: 'date' },
    { patterns: ['value date', 'val date', 'value dt'], field: 'valueDate' },
    { patterns: ['withdrawal', 'debit', 'dr', 'debit amount', 'withdrawal amt', 'dr amt'], field: 'withdrawal' },
    { patterns: ['deposit', 'credit', 'cr', 'credit amount', 'deposit amt', 'cr amt'], field: 'deposit' },
    { patterns: ['amount', 'txn amount', 'transaction amount', 'amt'], field: 'amount' },
    { patterns: ['balance', 'closing balance', 'running balance', 'bal', 'closing bal'], field: 'balance' },
    { patterns: ['narration', 'description', 'particulars', 'remarks', 'details'], field: 'narration' },
    { patterns: ['reference', 'ref', 'cheque no', 'chq no', 'ref no', 'utr'], field: 'reference' },
    { patterns: ['type', 'transaction type', 'txn type'], field: 'transactionType' },
  ];

  for (const { patterns, field } of mappings) {
    for (const pattern of patterns) {
      if (headerLower === pattern || headerLower.includes(pattern)) {
        return field;
      }
    }
  }

  return null;
}

/**
 * Detect date format from sample
 */
function detectDateFormat(dateStr: string): string {
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) return 'DD/MM/YYYY';
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(dateStr)) return 'DD/MM/YY';
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(dateStr)) return 'DD-MM-YYYY';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(dateStr)) return 'YYYY-MM-DD';
  if (/^\d{1,2}-[A-Za-z]{3}-\d{4}$/i.test(dateStr)) return 'DD-MMM-YYYY';
  return 'auto';
}

/**
 * Extract template structure from PDF file
 */
export async function extractTemplateFromPDF(filePath: string, password?: string): Promise<ExtractionResult> {
  const scriptPath = path.join(__dirname, 'template_extractor.py');

  // Check if script exists
  if (!fs.existsSync(scriptPath)) {
    throw new Error('PDF extractor script not found');
  }

  try {
    const args = password
      ? `"${filePath}" "${password}"`
      : `"${filePath}"`;

    const result = execSync(`python3 "${scriptPath}" ${args}`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB
      timeout: 60000, // 60 seconds
    });

    const parsed = JSON.parse(result.trim());

    if (parsed.error) {
      throw new Error(parsed.error);
    }

    // Transform Python output to ExtractionResult format
    const headers = parsed.headers || [];
    const columns: ExtractedField[] = headers.map((header: string, index: number) => ({
      index,
      name: header,
      type: parsed.column_types?.[index] || 'unknown',
      sampleValues: (parsed.sample_rows || []).map((row: any[]) =>
        row[index] !== null && row[index] !== undefined ? String(row[index]) : ''
      ).filter((v: string) => v !== '').slice(0, 5),
    }));

    // Generate suggested mappings
    const suggestedMappings: Record<string, { source: string; format?: string }> = {};
    for (let i = 0; i < headers.length; i++) {
      const suggestedField = suggestMapping(headers[i]);
      if (suggestedField) {
        const mapping: { source: string; format?: string } = { source: `col_${i}` };

        // Add date format if applicable
        if (suggestedField === 'date' || suggestedField === 'valueDate') {
          const sampleDate = columns[i]?.sampleValues?.find((v: string) =>
            /^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/.test(v)
          );
          if (sampleDate) {
            mapping.format = detectDateFormat(sampleDate);
          }
        }

        suggestedMappings[suggestedField] = mapping;
      }
    }

    return {
      fields: {
        headers,
        columns,
        sampleRows: parsed.sample_rows || [],
        rowCount: parsed.row_count || 0,
        headerRowIndex: parsed.header_row_index || 0,
      },
      suggestedMappings,
      detectionPatterns: {
        textPatterns: parsed.text_patterns || [],
        filenamePatterns: [],
      },
    };
  } catch (error: any) {
    console.error('[PDF Extractor] Error:', error.message);

    if (error.message?.includes('password')) {
      throw new Error('PDF is password protected. Please provide the correct password.');
    }

    throw new Error(`Failed to extract PDF structure: ${error.message}`);
  }
}

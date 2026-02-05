import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_VENV = path.join(__dirname, '../../../../.venv/bin/python');

export interface CAMSHolding {
  folioNumber: string;
  amcName: string;
  schemeName: string;
  isin: string;
  units: number;
  costValue: number;
  currentValue: number;
  nav: number;
  navDate: string;
  registrar: string;
  absoluteReturn: number;
  absoluteReturnPercent: number;
}

export interface CAMSParseResult {
  investorName: string;
  email: string | null;
  panNumber: string | null;
  statementDate: string;
  holdings: CAMSHolding[];
  totalCostValue: number;
  totalCurrentValue: number;
  totalAbsoluteReturn: number;
  totalAbsoluteReturnPercent: number;
}

async function extractTextWithPyMuPDF(filePath: string, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const pythonCode = `
import fitz  # PyMuPDF
import sys
import json

try:
    doc = fitz.open("${filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")
    if doc.is_encrypted:
        if not doc.authenticate("${password.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"):
            print(json.dumps({"error": "Invalid password"}))
            sys.exit(1)

    text = ""
    for page in doc:
        text += page.get_text()

    print(text)
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`;

    const python = spawn(PYTHON_VENV, ['-c', pythonCode]);

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        // Check if it's a JSON error
        try {
          const error = JSON.parse(stdout);
          reject(new Error(error.error || 'Failed to extract text'));
        } catch {
          reject(new Error(stderr || 'Failed to extract text'));
        }
        return;
      }

      // Check for JSON error in stdout
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.error) {
          reject(new Error(parsed.error));
          return;
        }
      } catch {
        // Not JSON, treat as text content
      }

      resolve(stdout);
    });
  });
}

// AMC name mapping from scheme codes
const amcMapping: Record<string, string> = {
  'ICICI': 'ICICI Prudential',
  'Kotak': 'Kotak Mahindra',
  'Mirae': 'Mirae Asset',
  'Motilal': 'Motilal Oswal',
  'NIPPON': 'Nippon India',
  'Parag Parikh': 'Parag Parikh',
  'SBI': 'SBI Mutual Fund',
  'HDFC': 'HDFC Mutual Fund',
  'Axis': 'Axis Mutual Fund',
  'Aditya Birla': 'Aditya Birla',
  'DSP': 'DSP Mutual Fund',
  'UTI': 'UTI Mutual Fund',
  'Franklin': 'Franklin Templeton',
  'Tata': 'Tata Mutual Fund',
  'Canara': 'Canara Robeco',
  'Sundaram': 'Sundaram',
  'PGIM': 'PGIM India',
  'Invesco': 'Invesco India',
  'HSBC': 'HSBC Mutual Fund',
  'Edelweiss': 'Edelweiss',
  'Quantum': 'Quantum',
  'Quant': 'Quant Mutual Fund',
};

function detectAmc(schemeName: string): string {
  const schemeUpper = schemeName.toUpperCase();
  for (const [key, value] of Object.entries(amcMapping)) {
    if (schemeUpper.includes(key.toUpperCase())) {
      return value;
    }
  }
  return 'Other';
}

export async function parseCAMSStatement(filePath: string, password: string): Promise<CAMSParseResult> {
  console.log('Parsing CAMS statement...');

  const text = await extractTextWithPyMuPDF(filePath, password);

  // Extract investor details
  let investorName = '';
  let email: string | null = null;
  let panNumber: string | null = null;
  let statementDate = '';

  // Look for email
  const emailMatch = text.match(/Email\s+Id:\s*([\w.-]+@[\w.-]+\.\w+)/i);
  if (emailMatch) {
    email = emailMatch[1];
  }

  // Look for investor name (line after email id)
  const nameMatch = text.match(/Email\s+Id:.*?\n([A-Z][A-Za-z\s]+)\n/);
  if (nameMatch) {
    investorName = nameMatch[1].trim();
  }

  // Look for statement date
  const dateMatch = text.match(/As\s+on\s+(\d{2}-[A-Za-z]{3}-\d{4})/i);
  if (dateMatch) {
    statementDate = dateMatch[1];
  }

  // Parse holdings using the CAMS format:
  // Format: FolioNo  MarketValue
  //         SchemeCode - SchemeName
  //         UnitBalance NavDate NAV Registrar
  //         ISIN
  //         CostValue

  const holdings: CAMSHolding[] = [];

  // Split text into lines for processing
  const lines = text.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Look for folio number pattern: digits/digits OR just digits on its own line
    // Format:
    // Line 1: 6663373/29 or 10139258 (folio - with or without slash)
    // Line 2: 73,642.85 (market value)
    // Lines 3+: Scheme name
    // Next: Units + Date
    // Next: NAV
    // Next: Registrar (CAMS/KFINTECH)
    // Next: ISIN
    // Next: Cost Value

    // Match folio: either digits/digits or just 7+ digits (to avoid matching small numbers)
    const folioMatch = line.match(/^(\d+\/\d+|\d{7,})$/);

    if (folioMatch) {
      const folioNumber = folioMatch[1];

      // Next line should be market value
      i++;
      let marketValue = 0;
      if (i < lines.length) {
        const valueLine = lines[i].trim();
        const valueMatch = valueLine.match(/^([\d,]+\.\d+)$/);
        if (valueMatch) {
          marketValue = parseFloat(valueMatch[1].replace(/,/g, ''));
          i++;
        }
      }

      // Collect scheme name lines until we hit units + date pattern
      let schemeName = '';
      while (i < lines.length) {
        const nextLine = lines[i].trim();

        // Check if this line contains unit balance info (digits + date pattern)
        if (nextLine.match(/^[\d,]+\.\d+\s+\d{2}-[A-Za-z]{3}-\d{4}/)) {
          break;
        }

        // Check for just a number (could be units alone or NAV)
        if (nextLine.match(/^[\d,]+\.\d+$/) && schemeName.length > 0) {
          // Could be that units and date are on separate lines - check next line
          if (i + 1 < lines.length && lines[i + 1].trim().match(/^\d{2}-[A-Za-z]{3}-\d{4}/)) {
            break;
          }
        }

        // Check for next folio (indicates we went too far)
        if (nextLine.match(/^(\d+\/\d+|\d{7,})$/)) {
          i--; // Go back to process this line
          break;
        }

        // Skip empty lines
        if (nextLine.length === 0) {
          i++;
          continue;
        }

        // This is part of the scheme name
        schemeName += (schemeName ? ' ' : '') + nextLine;
        i++;
      }

      // Clean up scheme name - remove scheme code prefix
      schemeName = schemeName.replace(/^[A-Z0-9]+\s*-\s*/, '').trim();

      // Parse units and date: "587.873 03-Feb-2026" (on same line) or separate lines
      let units = 0;
      let navDate = '';

      if (i < lines.length) {
        const balanceLine = lines[i].trim();

        // Try pattern: units + date on same line
        const unitsDateMatch = balanceLine.match(/^([\d,]+\.\d+)\s+(\d{2}-[A-Za-z]{3}-\d{4})$/);
        if (unitsDateMatch) {
          units = parseFloat(unitsDateMatch[1].replace(/,/g, ''));
          navDate = unitsDateMatch[2];
          i++;
        } else {
          // Could be just units on this line
          const justUnitsMatch = balanceLine.match(/^([\d,]+\.\d+)$/);
          if (justUnitsMatch) {
            units = parseFloat(justUnitsMatch[1].replace(/,/g, ''));
            i++;
            // Check for date on next line
            if (i < lines.length) {
              const dateMatch = lines[i].trim().match(/^(\d{2}-[A-Za-z]{3}-\d{4})$/);
              if (dateMatch) {
                navDate = dateMatch[1];
                i++;
              }
            }
          }
        }
      }

      // Parse NAV (should be just a number)
      let nav = 0;
      if (i < lines.length) {
        const navLine = lines[i].trim();
        const navMatch = navLine.match(/^([\d,]+\.?\d*)$/);
        if (navMatch) {
          nav = parseFloat(navMatch[1].replace(/,/g, ''));
          i++;
        }
      }

      // Parse Registrar
      let registrar = 'CAMS';
      if (i < lines.length) {
        const regLine = lines[i].trim().toUpperCase();
        if (regLine === 'CAMS' || regLine === 'KFINTECH') {
          registrar = regLine;
          i++;
        }
      }

      // Parse ISIN line
      let isin = '';
      if (i < lines.length) {
        const isinLine = lines[i].trim();
        if (isinLine.startsWith('INF')) {
          isin = isinLine;
          i++;
        }
      }

      // Parse cost value line
      let costValue = 0;
      if (i < lines.length) {
        const costLine = lines[i].trim();
        const costMatch = costLine.match(/^([\d,]+\.\d+)$/);
        if (costMatch) {
          costValue = parseFloat(costMatch[1].replace(/,/g, ''));
          i++;
        }
      }

      // Detect AMC from scheme name
      const amcName = detectAmc(schemeName);

      // Calculate returns
      const absoluteReturn = marketValue - costValue;
      const absoluteReturnPercent = costValue > 0 ? (absoluteReturn / costValue) * 100 : 0;

      if (schemeName && units > 0) {
        holdings.push({
          folioNumber,
          amcName,
          schemeName: schemeName.replace(/\s*\(Non-Demat\)\s*/gi, '').trim(),
          isin,
          units,
          costValue,
          currentValue: marketValue,
          nav,
          navDate,
          registrar,
          absoluteReturn,
          absoluteReturnPercent,
        });
      }
    } else {
      i++;
    }
  }

  // Calculate totals
  const totalCostValue = holdings.reduce((sum, h) => sum + h.costValue, 0);
  const totalCurrentValue = holdings.reduce((sum, h) => sum + h.currentValue, 0);
  const totalAbsoluteReturn = totalCurrentValue - totalCostValue;
  const totalAbsoluteReturnPercent = totalCostValue > 0 ? (totalAbsoluteReturn / totalCostValue) * 100 : 0;

  console.log(`Parsed ${holdings.length} mutual fund holdings`);
  console.log(`Total Cost: ${totalCostValue}, Total Value: ${totalCurrentValue}`);

  return {
    investorName,
    email,
    panNumber,
    statementDate,
    holdings,
    totalCostValue,
    totalCurrentValue,
    totalAbsoluteReturn,
    totalAbsoluteReturnPercent,
  };
}

export function isCAMSStatement(text: string): boolean {
  // Check for CAMS-specific identifiers
  const camsIndicators = [
    /CAMS/i,
    /Consolidated\s+Account\s+(Statement|Summary)/i,
    /MFCentral/i,
    /Computer\s+Age\s+Management\s+Services/i,
    /Registrar[:\s]*(CAMS|KFINTECH)/i,
  ];

  return camsIndicators.some(pattern => pattern.test(text));
}

export function detectCAMSFile(filename: string): boolean {
  // CAMS files typically have patterns like:
  // AFXXXXXX8N_06112025-04022026_CP203994260_04022026082347047.pdf
  // or similar PAN-based naming
  const patterns = [
    /^[A-Z]{2}[A-Z0-9]+_\d{8}-\d{8}_/i,
    /^[A-Z]{5}[0-9]{4}[A-Z]_/i, // PAN format
    /CAMS/i,
    /CAS_/i, // Consolidated Account Statement
  ];

  return patterns.some(pattern => pattern.test(filename));
}

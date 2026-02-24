import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

interface ExtractedPolicyData {
  name: string;
  type: 'life' | 'term' | 'health' | 'vehicle' | 'home' | 'travel' | 'other';
  provider: string;
  policyNumber: string;
  policyHolder: string;
  sumAssured: number | null;
  coverageAmount: number | null;
  premiumAmount: number | null;
  premiumFrequency: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'one_time';
  startDate: string | null;
  endDate: string | null;
  policyTerm: number | null;
  nextPremiumDate: string | null;
  rawText: string;
}

// Month name to number mapping
const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  january: '01', february: '02', march: '03', april: '04', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

// Parse premium frequency from text
function parsePremiumFrequency(text: string): ExtractedPolicyData['premiumFrequency'] {
  // Look near "Premium Payment Frequency" first for context-specific match
  const freqMatch = text.match(/Premium\s*Payment\s*Frequency[:\s]*(\w+)/i);
  if (freqMatch) {
    const freq = freqMatch[1].toLowerCase();
    if (freq === 'monthly') return 'monthly';
    if (freq === 'quarterly') return 'quarterly';
    if (freq.includes('half') || freq.includes('semi')) return 'half_yearly';
    if (freq === 'annual' || freq === 'yearly') return 'yearly';
    if (freq === 'single' || freq.includes('one')) return 'one_time';
  }

  const lowerText = text.toLowerCase();
  if (lowerText.includes('premium payment\nfrequency') && lowerText.includes('annual')) return 'yearly';
  if (lowerText.includes('monthly')) return 'monthly';
  if (lowerText.includes('quarterly')) return 'quarterly';
  if (lowerText.includes('half yearly') || lowerText.includes('half-yearly') || lowerText.includes('semi-annual')) return 'half_yearly';
  if (lowerText.includes('annual') || lowerText.includes('yearly')) return 'yearly';
  if (lowerText.includes('one time') || lowerText.includes('single')) return 'one_time';
  return 'yearly'; // default
}

// Parse policy type from text
function parsePolicyType(text: string): ExtractedPolicyData['type'] {
  const lowerText = text.toLowerCase();
  if (lowerText.includes('term plan') || lowerText.includes('term insurance') || lowerText.includes('term life') || lowerText.includes('iprotect')) return 'term';
  if (lowerText.includes('health') || lowerText.includes('medical') || lowerText.includes('mediclaim') || lowerText.includes('advantedge')) return 'health';
  if (lowerText.includes('vehicle') || lowerText.includes('motor') || lowerText.includes('car insurance') || lowerText.includes('bike')) return 'vehicle';
  if (lowerText.includes('home insurance') || lowerText.includes('property insurance')) return 'home';
  if (lowerText.includes('travel')) return 'travel';
  if (lowerText.includes('life') || lowerText.includes('endowment') || lowerText.includes('ulip') || lowerText.includes('platinum') || lowerText.includes('jeevan')) return 'life';
  return 'other';
}

// Parse a date string that could be DD/MM/YYYY, DD-MM-YYYY, or DD-Mon-YYYY
function parseAnyDate(dateStr: string): string | null {
  // DD/MM/YYYY or DD-MM-YYYY (numeric)
  const numericMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (numericMatch) {
    const [, day, month, year] = numericMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // DD-Mon-YYYY or DD Mon YYYY (e.g., 11-Dec-2025, 11 Dec 2025)
  const monthNameMatch = dateStr.match(/(\d{1,2})[\/\-\s]([A-Za-z]+)[\/\-\s,]*(\d{4})/);
  if (monthNameMatch) {
    const [, day, monthName, year] = monthNameMatch;
    const monthNum = MONTH_MAP[monthName.toLowerCase()];
    if (monthNum) {
      return `${year}-${monthNum}-${day.padStart(2, '0')}`;
    }
  }

  // Mon DD, YYYY (e.g., Dec 11, 2025)
  const usFormatMatch = dateStr.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (usFormatMatch) {
    const [, monthName, day, year] = usFormatMatch;
    const monthNum = MONTH_MAP[monthName.toLowerCase()];
    if (monthNum) {
      return `${year}-${monthNum}-${day.padStart(2, '0')}`;
    }
  }

  // YYYY-MM-DD (ISO)
  const isoMatch = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return null;
}

// Extract amount from text (handles Indian number format)
// Includes sanity check: amount must be between 100 and 10 crore
function extractAmount(text: string, patterns: RegExp[], maxAmount = 10_00_00_000): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const amountStr = match[1].replace(/[Rs.,₹\s`]/gi, '').replace(/-$/, '');
      const amount = parseFloat(amountStr);
      if (!isNaN(amount) && amount >= 100 && amount <= maxAmount) return amount;
    }
  }
  return null;
}

// Extract date from text with support for multiple date formats
function extractDate(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return parseAnyDate(match[1]);
    }
  }
  return null;
}

// Extract policy number (supports alphanumeric with slashes, hyphens)
function extractPolicyNumber(text: string): string {
  const patterns = [
    /Policy\s*No\.?[:\s]+([A-Za-z0-9\/\-]+(?:\/[A-Za-z0-9]+)*)/i,
    /Policy\s*Number[:\s]+([A-Za-z0-9\/\-]+(?:\/[A-Za-z0-9]+)*)/i,
    /Certificate\s*No\.?[:\s]+([A-Za-z0-9\/\-]+)/i,
    // Fallback: just digits
    /Policy\s*No\.?[:\s]+(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return '';
}

// Extract provider name — ordered longest-first to prevent "LIC" matching inside "POLICYALL"
function extractProvider(text: string): string {
  // Provider patterns: [search term, display name]
  // Ordered from most specific to least specific to avoid false positives
  const providers: [string, RegExp][] = [
    ['ICICI Lombard', /ICICI\s*Lombard[\s\w]*(General\s*Insurance)?/i],
    ['ICICI Prudential', /ICICI\s*Pru(?:dential|life)[\s\w]*/i],
    ['Star Health', /Star\s*Health[\s\w]*/i],
    ['Care Health', /Care\s*Health[\s\w]*/i],
    ['Niva Bupa', /Niva\s*Bupa[\s\w]*/i],
    ['Aditya Birla', /Aditya\s*Birla[\s\w]*/i],
    ['PNB MetLife', /PNB\s*MetLife[\s\w]*/i],
    ['Kotak Life', /Kotak[\s\w]*(?:Life|Insurance|Mahindra)/i],
    ['HDFC Life', /HDFC[\s\w]*(?:Life|Insurance|Ergo)/i],
    ['SBI Life', /SBI[\s\w]*(?:Life|Insurance)/i],
    ['Max Life', /Max[\s\w]*(?:Life|Insurance|Bupa)/i],
    ['Bajaj Allianz', /Bajaj[\s\w]*(?:Allianz|Life|Insurance)/i],
    ['Tata AIA', /Tata[\s\w]*(?:AIA|Life|Insurance)/i],
    ['Reliance', /Reliance[\s\w]*(?:Life|Insurance|General|Nippon)/i],
    ['LIC', /\bLIC\b[\s\w]*(?:of India)?/i],
  ];

  for (const [name, regex] of providers) {
    // Use word boundary search to avoid matching "LIC" inside "POLICYALL"
    const searchRegex = new RegExp(`\\b${name.replace(/\s+/g, '\\s*')}\\b`, 'i');
    if (searchRegex.test(text)) {
      const match = text.match(regex);
      if (match) return match[0].trim().replace(/\s+/g, ' ');
      return name;
    }
  }
  return '';
}

// Extract policy holder / proposer name
function extractPolicyHolder(text: string): string {
  const patterns = [
    // "Proposer Name" is common in Indian policy documents
    /Proposer\s*Name[:\s]+(?:Mr\.?|Mrs\.?|Ms\.?|Miss\.?)?\s*([A-Z][A-Za-z\s]+?)(?:\n|Address|Contact|Email|F-|[0-9])/i,
    /Policy\s*holder(?:'s)?\s*(?:Name)?[:\s]+(?:Mr\.?|Mrs\.?|Ms\.?|Miss\.?)?\s*([A-Z][A-Za-z\s]+?)(?:\n|Address|Contact|Email)/i,
    /Life\s*Assured[:\s]+(?:Mr\.?|Mrs\.?|Ms\.?|Miss\.?)?\s*([A-Z][A-Za-z\s]+?)(?:\n|Policy|Address|Client)/i,
    /Name\s*of\s*(?:the\s*)?(?:Life\s*Assured|Insured|Policyholder)[:\s]+(?:Mr\.?|Mrs\.?|Ms\.?|Miss\.?)?\s*([A-Z][A-Za-z\s]+?)(?:\n|Policy|Receipt|Address)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const name = match[1].trim().replace(/\s+/g, ' ');
      // Skip if it looks like a field label, not a name
      if (name.length > 2 && name.length < 60 && !name.match(/^(SPOUSE|SELF|CHILD|PARENT|Address|Contact)/i)) {
        return name;
      }
    }
  }
  return '';
}

// Extract plan/policy name
function extractPlanName(text: string, provider: string): string {
  const patterns = [
    // "Product name" (ICICI Lombard style)
    /Product\s*name[:\s]+([^\n\r]+)/i,
    // "Plan Name" followed by actual plan name (not internal code)
    /Plan\s*Name[:\s]+([A-Za-z][A-Za-z\s]+(?:Plan|Plus|Premium|Platinum|Gold|Silver|Classic|Smart|Protect|Shield|Care|AdvantEdge|Advantage|Secure))/i,
    // Provider + product name pattern
    ...(provider ? [new RegExp(`${provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\-]+([A-Za-z][A-Za-z\\s]+(?:Plan|Plus|Premium|Platinum|Gold|Silver|Classic|Smart|Protect|Shield|Care|AdvantEdge|Advantage|Secure))`, 'i')] : []),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let name = match[1].trim();
      // Clean up: remove amounts, codes, and trailing noise
      name = name.replace(/Rs\.?\s*[\d,]+\/?-?/g, '').replace(/\s+/g, ' ').trim();
      if (name.length > 2 && name.length < 80) return name;
    }
  }

  return provider ? `${provider} Policy` : 'Insurance Policy';
}

export async function extractPolicyFromPdf(
  filePath: string,
  password?: string
): Promise<{ success: boolean; data?: ExtractedPolicyData; error?: string; needsPassword?: boolean }> {
  try {
    let text = '';

    if (password) {
      // Use Python with PyPDF2 for password-protected PDFs
      const pythonScript = `
import sys
from PyPDF2 import PdfReader

reader = PdfReader('${filePath.replace(/'/g, "\\'")}')
if reader.is_encrypted:
    if not reader.decrypt('${password.replace(/'/g, "\\'")}'):
        print("DECRYPTION_FAILED", file=sys.stderr)
        sys.exit(1)

for page in reader.pages:
    print(page.extract_text())
`;

      // Check if venv exists, if not create it
      const venvPath = '/tmp/pdfenv';
      if (!fs.existsSync(venvPath)) {
        await execAsync(`python3 -m venv ${venvPath}`);
        await execAsync(`source ${venvPath}/bin/activate && pip install PyPDF2 pycryptodome --quiet`);
      }

      try {
        const { stdout } = await execAsync(
          `source ${venvPath}/bin/activate && python3 -c "${pythonScript.replace(/"/g, '\\"')}"`,
          { maxBuffer: 10 * 1024 * 1024 }
        );
        text = stdout;
      } catch (error: any) {
        if (error.stderr?.includes('DECRYPTION_FAILED')) {
          return { success: false, error: 'Invalid password', needsPassword: true };
        }
        throw error;
      }
    } else {
      // Try pdf-parse first for non-encrypted PDFs
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        text = pdfData.text;
      } catch (error: any) {
        // If pdf-parse fails (possibly encrypted), check if password is needed
        if (error.message?.includes('encrypted') || error.message?.includes('password')) {
          return { success: false, error: 'PDF is password protected', needsPassword: true };
        }

        // Try Python fallback
        const venvPath = '/tmp/pdfenv';
        if (!fs.existsSync(venvPath)) {
          await execAsync(`python3 -m venv ${venvPath}`);
          await execAsync(`source ${venvPath}/bin/activate && pip install PyPDF2 pycryptodome --quiet`);
        }

        const pythonScript = `
from PyPDF2 import PdfReader
import sys

reader = PdfReader('${filePath.replace(/'/g, "\\'")}')
if reader.is_encrypted:
    print("NEEDS_PASSWORD", file=sys.stderr)
    sys.exit(1)

for page in reader.pages:
    print(page.extract_text())
`;

        try {
          const { stdout } = await execAsync(
            `source ${venvPath}/bin/activate && python3 -c "${pythonScript.replace(/"/g, '\\"')}"`,
            { maxBuffer: 10 * 1024 * 1024 }
          );
          text = stdout;
        } catch (pyError: any) {
          if (pyError.stderr?.includes('NEEDS_PASSWORD')) {
            return { success: false, error: 'PDF is password protected', needsPassword: true };
          }
          throw pyError;
        }
      }
    }

    if (!text || text.trim().length === 0) {
      return { success: false, error: 'Could not extract text from PDF' };
    }

    // Parse the extracted text
    const provider = extractProvider(text);
    const policyType = parsePolicyType(text);
    const premiumFrequency = parsePremiumFrequency(text);

    // Date patterns: support DD/MM/YYYY, DD-MM-YYYY, DD-Mon-YYYY, Mon DD YYYY
    const DATE_PATTERN = '(\\d{1,2}[\\/-]\\w{3,9}[\\/-]\\d{4}|\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{4}|\\w{3,9}\\s+\\d{1,2},?\\s*\\d{4})';

    const data: ExtractedPolicyData = {
      name: extractPlanName(text, provider),
      type: policyType,
      provider: provider,
      policyNumber: extractPolicyNumber(text),
      policyHolder: extractPolicyHolder(text),
      sumAssured: extractAmount(text, [
        /Sum\s*Assured[:\s(₹)]+(?:Rs\.?|₹)?\s*([\d,]+)/i,
        /(?:Life\s*)?Cover(?:age)?\s*(?:Amount)?[:\s(₹)]+(?:Rs\.?|₹)?\s*([\d,]+)/i,
      ]),
      coverageAmount: extractAmount(text, [
        /Annual\s*Sum\s*Insured[:\s(₹)]+(?:Rs\.?|₹)?\s*([\d,]+)/i,
        /(?:Health|Medical)\s*Cover(?:age)?[:\s(₹)]+(?:Rs\.?|₹)?\s*([\d,]+)/i,
        /Sum\s*Insured[:\s(₹)]+(?:Rs\.?|₹)?\s*([\d,]+)/i,
      ]),
      premiumAmount: extractAmount(text, [
        /Basic\s*Premium[:\s]+(?:Rs\.?|₹)?\s*([\d,]+)/i,
        /Total\s*Premium\s*(?:Paid)?[:\s]+(?:Rs\.?|₹|`)?\s*([\d,]+)/i,
        /Premium\s*Amount[:\s]+(?:Rs\.?|₹)?\s*([\d,]+)/i,
      ]),
      premiumFrequency,
      startDate: extractDate(text, [
        new RegExp(`(?:Policy\\s*)?(?:Start|Commencement)\\s*Date[:\\s]+${DATE_PATTERN}`, 'i'),
        new RegExp(`Date\\s*of\\s*(?:Issue|Commencement)[:\\s]+${DATE_PATTERN}`, 'i'),
        new RegExp(`Period\\s*of\\s*Insurance[:\\s]+From[:\\s]+\\d{2}:\\d{2}\\s*hrs\\s*${DATE_PATTERN}`, 'i'),
      ]),
      endDate: extractDate(text, [
        new RegExp(`(?:Maturity|End)\\s*Date[:\\s]+${DATE_PATTERN}`, 'i'),
        new RegExp(`Policy\\s*End\\s*Date[:\\s]+${DATE_PATTERN}`, 'i'),
        new RegExp(`To\\s*\\d{2}:\\d{2}\\s*hrs\\s*${DATE_PATTERN}`, 'i'),
      ]),
      policyTerm: (() => {
        const match = text.match(/Policy\s*Tenure[:\s]+(\d+)/i) || text.match(/Policy\s*Term[:\s]+(\d+)/i);
        return match ? parseInt(match[1]) : null;
      })(),
      nextPremiumDate: extractDate(text, [
        new RegExp(`Next\\s*(?:Due|Premium)\\s*Date[:\\s]+${DATE_PATTERN}`, 'i'),
      ]),
      rawText: text,
    };

    return { success: true, data };
  } catch (error: any) {
    console.error('Error extracting policy from PDF:', error);
    return { success: false, error: error.message || 'Failed to extract policy data' };
  }
}

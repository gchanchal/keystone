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

// Parse premium frequency from text
function parsePremiumFrequency(text: string): ExtractedPolicyData['premiumFrequency'] {
  const lowerText = text.toLowerCase();
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
  if (lowerText.includes('term plan') || lowerText.includes('term insurance') || lowerText.includes('term life')) return 'term';
  if (lowerText.includes('health') || lowerText.includes('medical') || lowerText.includes('mediclaim')) return 'health';
  if (lowerText.includes('vehicle') || lowerText.includes('motor') || lowerText.includes('car insurance') || lowerText.includes('bike')) return 'vehicle';
  if (lowerText.includes('home insurance') || lowerText.includes('property insurance')) return 'home';
  if (lowerText.includes('travel')) return 'travel';
  if (lowerText.includes('life') || lowerText.includes('endowment') || lowerText.includes('ulip') || lowerText.includes('platinum')) return 'life';
  return 'other';
}

// Extract amount from text (handles Indian number format)
function extractAmount(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Remove Rs., ₹, commas, and spaces
      const amountStr = match[1].replace(/[Rs.,₹\s/-]/gi, '');
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) return amount;
    }
  }
  return null;
}

// Extract date from text
function extractDate(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Try to parse and format the date
      const dateStr = match[1];
      // Handle DD/MM/YYYY format
      const ddmmyyyy = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      if (ddmmyyyy) {
        const [, day, month, year] = ddmmyyyy;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
      return dateStr;
    }
  }
  return null;
}

// Extract policy number
function extractPolicyNumber(text: string): string {
  // Look for patterns like "Policy No: 12345" or "Policy Number: 12345"
  const patterns = [
    /Policy\s*No[.:]?\s*(\d+)/i,
    /Policy\s*Number[.:]?\s*(\d+)/i,
    /Certificate\s*No[.:]?\s*(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return '';
}

// Extract provider name
function extractProvider(text: string): string {
  const providers = [
    'Kotak', 'LIC', 'HDFC', 'ICICI', 'SBI', 'Max', 'Bajaj', 'Tata', 'Reliance',
    'Star Health', 'Care Health', 'Niva Bupa', 'Aditya Birla', 'PNB MetLife'
  ];

  for (const provider of providers) {
    if (text.toLowerCase().includes(provider.toLowerCase())) {
      // Try to extract full name
      const regex = new RegExp(`(${provider}[\\s\\w]*(?:Life|Insurance|Health|General)?)`, 'i');
      const match = text.match(regex);
      if (match) return match[1].trim();
      return provider;
    }
  }
  return '';
}

// Extract policy holder name
function extractPolicyHolder(text: string): string {
  const patterns = [
    /(?:Life\s*assured|Policy\s*holder|Policy\s*owner|Name)[:\s]+(?:Mr\.?|Mrs\.?|Ms\.?|Miss\.?)?\s*([A-Za-z\s]+?)(?:\n|Policy|Address|Client)/i,
    /Name\s*of\s*(?:the\s*)?(?:Life\s*assured|Insured)[:\s]+([A-Za-z\s]+?)(?:\n|Policy|Receipt)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim().replace(/\s+/g, ' ');
    }
  }
  return '';
}

// Extract plan/policy name
function extractPlanName(text: string, provider: string): string {
  // Common patterns for plan names
  const patterns = [
    /Plan\s*(?:Name|Component)[:\s]+([^\n\r]+)/i,
    /Product\s*Name[:\s]+([^\n\r]+)/i,
    new RegExp(`(${provider}[\\s\\w]+(?:Plan|Plus|Premium|Platinum|Gold|Silver|Classic))`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim().replace(/Rs\.?\s*[\d,]+\/?-?/g, '').trim();
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

    const data: ExtractedPolicyData = {
      name: extractPlanName(text, provider),
      type: policyType,
      provider: provider,
      policyNumber: extractPolicyNumber(text),
      policyHolder: extractPolicyHolder(text),
      sumAssured: extractAmount(text, [
        /Sum\s*Assured[:\s]+(?:Rs\.?|₹)?\s*([\d,]+)/i,
        /(?:Life\s*)?Cover[:\s]+(?:Rs\.?|₹)?\s*([\d,]+)/i,
      ]),
      coverageAmount: extractAmount(text, [
        /Coverage[:\s]+(?:Rs\.?|₹)?\s*([\d,]+)/i,
        /(?:Health|Medical)\s*Cover[:\s]+(?:Rs\.?|₹)?\s*([\d,]+)/i,
      ]),
      premiumAmount: extractAmount(text, [
        /(?:Total\s*)?Premium\s*(?:Paid|Amount)?[:\s]+(?:Rs\.?|₹)?\s*([\d,]+)/i,
        /(?:Rs\.?|₹)\s*([\d,]+)\/?-?\s*(?:towards|via)/i,
      ]),
      premiumFrequency,
      startDate: extractDate(text, [
        /(?:Policy\s*)?(?:Start|Commencement)\s*Date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
        /Date\s*of\s*(?:Issue|Commencement)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
      ]),
      endDate: extractDate(text, [
        /(?:Maturity|End)\s*Date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
      ]),
      policyTerm: (() => {
        const match = text.match(/Policy\s*Term[:\s]+(\d+)/i);
        return match ? parseInt(match[1]) : null;
      })(),
      nextPremiumDate: extractDate(text, [
        /Next\s*(?:Due|Premium)\s*Date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
      ]),
      rawText: text,
    };

    return { success: true, data };
  } catch (error: any) {
    console.error('Error extracting policy from PDF:', error);
    return { success: false, error: error.message || 'Failed to extract policy data' };
  }
}

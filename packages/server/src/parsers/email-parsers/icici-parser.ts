import type { BankEmailParser, EmailParseResult, ParsedEmailTransaction } from './types.js';

// ICICI Bank email patterns
const ICICI_PATTERNS = {
  // Debit: "INR X debited from Acct XX1234 on DD-MMM-YY"
  debit: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?debited\s+from\s+(?:Acct|Account|a\/c)\s*[xX*]*(\d{4})\s+on\s+(\d{2}[-\/]?\w{3}[-\/]?\d{2,4})/i,

  // Credit: "INR X credited to Acct XX1234 on DD-MMM-YY"
  credit: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?credited\s+to\s+(?:Acct|Account|a\/c)\s*[xX*]*(\d{4})\s+on\s+(\d{2}[-\/]?\w{3}[-\/]?\d{2,4})/i,

  // Alternative debit: "Your ICICI Bank Account XX1234 has been debited with INR X"
  altDebit: /(?:ICICI\s+Bank\s+)?(?:Account|Acct|a\/c)\s*[xX*]*(\d{4})\s+(?:has been\s+)?debited\s+(?:with\s+)?(?:INR|Rs\.?)\s*([\d,]+(?:\.\d{2})?)/i,

  // Alternative credit: "Your ICICI Bank Account XX1234 has been credited with INR X"
  altCredit: /(?:ICICI\s+Bank\s+)?(?:Account|Acct|a\/c)\s*[xX*]*(\d{4})\s+(?:has been\s+)?credited\s+(?:with\s+)?(?:INR|Rs\.?)\s*([\d,]+(?:\.\d{2})?)/i,

  // Credit card transaction: "Rs X spent on ICICI Credit Card XX1234"
  ccSpent: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?(?:spent|charged)\s+(?:on|to)\s+(?:ICICI\s+)?(?:Bank\s+)?(?:Credit\s+)?Card\s*[xX*]*(\d{4})/i,

  // Balance pattern
  balance: /(?:Avl(?:\.)?|Available)\s*(?:Bal(?:ance)?)?[:\s]*(?:INR|Rs\.?)\s*([\d,]+(?:\.\d{2})?)/i,

  // Reference/Transaction ID
  reference: /(?:Ref(?:\.|erence)?(?:\s*No\.?)?|Transaction\s*(?:ID|No)|Txn\s*ID)[:\s]*(\w+)/i,

  // Info/Description pattern
  info: /(?:Info|Desc(?:ription)?|Particulars)[:\s]*([^\n]+)/i,

  // Date pattern (DD-MMM-YY or DD-MMM-YYYY)
  datePattern: /(\d{2})[-\/]?(\w{3})[-\/]?(\d{2,4})/,
};

function parseAmount(amountStr: string): number {
  return parseFloat(amountStr.replace(/,/g, ''));
}

function parseDate(dateStr: string): string {
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const match = dateStr.match(ICICI_PATTERNS.datePattern);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = months[match[2].toLowerCase()] || match[2];
    let year = match[3];
    if (year.length === 2) {
      year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
    }
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}

function extractBalance(body: string): number | undefined {
  const match = body.match(ICICI_PATTERNS.balance);
  return match ? parseAmount(match[1]) : undefined;
}

function extractReference(body: string): string | undefined {
  const match = body.match(ICICI_PATTERNS.reference);
  return match ? match[1].trim() : undefined;
}

function extractInfo(body: string): string | undefined {
  const match = body.match(ICICI_PATTERNS.info);
  if (match) {
    let info = match[1].trim();
    info = info.replace(/\.$/, '').trim();
    return info || undefined;
  }
  return undefined;
}

export const iciciParser: BankEmailParser = {
  name: 'ICICI',
  senders: [
    'alerts@icicibank.com',
    'noreply@icicibank.com',
    'transact@icicibank.com',
  ],
  type: 'both',

  parse(body: string, subject: string): EmailParseResult {
    const fullText = `${subject}\n${body}`;

    // Try debit pattern
    let match = fullText.match(ICICI_PATTERNS.debit);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'debit',
        accountLastFour: match[2],
        merchantOrDescription: extractInfo(body) || 'Bank Debit',
        date: parseDate(match[3]),
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'ICICI',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try credit pattern
    match = fullText.match(ICICI_PATTERNS.credit);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'credit',
        accountLastFour: match[2],
        merchantOrDescription: extractInfo(body) || 'Bank Credit',
        date: parseDate(match[3]),
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'ICICI',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try alternative debit pattern
    match = fullText.match(ICICI_PATTERNS.altDebit);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[2]),
        transactionType: 'debit',
        accountLastFour: match[1],
        merchantOrDescription: extractInfo(body) || 'Bank Debit',
        date: new Date().toISOString().split('T')[0],
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'ICICI',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try alternative credit pattern
    match = fullText.match(ICICI_PATTERNS.altCredit);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[2]),
        transactionType: 'credit',
        accountLastFour: match[1],
        merchantOrDescription: extractInfo(body) || 'Bank Credit',
        date: new Date().toISOString().split('T')[0],
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'ICICI',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try credit card pattern
    match = fullText.match(ICICI_PATTERNS.ccSpent);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'debit',
        accountLastFour: match[2],
        merchantOrDescription: extractInfo(body) || 'Card Transaction',
        date: new Date().toISOString().split('T')[0],
        reference: extractReference(body),
        bank: 'ICICI',
        sourceType: 'credit_card',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    return {
      success: false,
      error: 'No matching ICICI transaction pattern found',
    };
  },
};

export default iciciParser;

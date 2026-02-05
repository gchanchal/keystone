import type { BankEmailParser, EmailParseResult, ParsedEmailTransaction } from './types.js';

// Axis Bank email patterns
const AXIS_PATTERNS = {
  // Credit card from email body: "Transaction Amount: INR X" + "Merchant Name: XXX" + "Axis Bank Credit Card No. XXXX" + "Date & Time: DD-MM-YYYY"
  ccBodyFormat: /Transaction Amount:\s*(?:INR|Rs\.?)\s*([\d,]+(?:\.\d{2})?)/i,
  ccMerchant: /Merchant Name:\s*(.+?)(?:\s*Axis|\s*Date|\s*$)/i,
  ccCardNo: /Axis Bank (?:Credit|Debit) Card No\.\s*[xX*]*(\d{4})/i,
  ccDateTime: /Date & Time:\s*(\d{2}-\d{2}-\d{4})/i,

  // Subject pattern: "INR X spent on credit card no. XXXXX"
  ccSubject: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d{2})?)\s*spent\s+on\s+credit\s*card\s*(?:no\.?)?\s*[xX*]*(\d{4})/i,

  // Bank debit: "INR X debited from A/C XX1234 on DD-MMM-YY"
  bankDebit: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?debited\s+from\s+(?:A\/C|Account|a\/c)\s*[xX*]*(\d{4})\s+on\s+(\d{2}[-\/]?\w{3}[-\/]?\d{2,4})/i,

  // Bank credit: "INR X credited to A/C XX1234 on DD-MMM-YY"
  bankCredit: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?credited\s+to\s+(?:A\/C|Account|a\/c)\s*[xX*]*(\d{4})\s+on\s+(\d{2}[-\/]?\w{3}[-\/]?\d{2,4})/i,

  // Loan credit: "Payment of INR X has been credited to your Loan account no. XXXXX on DD-MM-YYYY"
  loanCredit: /Payment of (?:INR|Rs\.?)\s*([\d,]+(?:\.\d{2})?)\s*has been credited to your Loan account no\.\s*[xX*]*(\d{4})\s+on\s+(\d{2}-\d{2}-\d{4})/i,

  // Card transaction: "Rs.X spent on Axis Bank Card ending 1234 at MERCHANT"
  cardSpent: /(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?spent\s+on\s+Axis\s*Bank\s*(?:Debit|Credit)?\s*Card\s*(?:ending|xx|[xX*]*)\s*(\d{4})\s+at\s+(.+?)(?:\s+on\s+(\d{2}[-\/]?\w{3}[-\/]?\d{2,4}))?/i,

  // Credit card spent simple: "INR X spent on credit card no. XX1234"
  ccSpentSimple: /(?:INR|Rs\.?)\s*([\d,]+(?:\.\d{2})?)\s*spent\s+on\s+credit\s*card\s*(?:no\.?|ending)?\s*[xX*]*(\d{4})/i,

  // Credit card debited: "Rs.X debited via Credit Card **1234"
  ccDebited: /(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?debited\s+(?:via|from|on)\s+(?:Credit\s*Card|CC)\s*\*{0,2}(\d{4})/i,

  // Alternative card pattern: "Axis Bank Card XX1234 charged for Rs X"
  altCardSpent: /Axis\s*Bank\s*(?:Debit|Credit)?\s*Card\s*[xX*]*(\d{4})\s+(?:has been\s+)?(?:charged|debited)\s+(?:for|with)\s+(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)/i,

  // Alternative bank debit: "Your Axis Bank A/C XX1234 debited for Rs X"
  altDebit: /Axis\s*Bank\s*(?:A\/C|Account|a\/c)\s*[xX*]*(\d{4})\s+(?:has been\s+)?debited\s+(?:for|with)?\s*(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)/i,

  // Alternative bank credit: "Your Axis Bank A/C XX1234 credited with Rs X"
  altCredit: /Axis\s*Bank\s*(?:A\/C|Account|a\/c)\s*[xX*]*(\d{4})\s+(?:has been\s+)?credited\s+(?:for|with)?\s*(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)/i,

  // Card refund: "Rs X refunded to Axis Bank Card XX1234"
  cardRefund: /(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?refunded\s+to\s+Axis\s*Bank\s*(?:Debit|Credit)?\s*Card\s*[xX*]*(\d{4})/i,

  // Balance pattern
  balance: /(?:Avl(?:\.)?|Available|A\/c)\s*(?:Bal(?:ance)?)?[:\s]*(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)/i,

  // Reference pattern
  reference: /(?:Ref(?:\.|erence)?(?:\s*No\.?)?|Transaction\s*(?:ID|No)|Txn\s*(?:ID|No))[:\s]*(\w+)/i,

  // Info pattern
  info: /(?:Info|Desc(?:ription)?|Particulars|Remarks)[:\s]*([^\n]+)/i,

  // Date pattern (DD-MMM-YY or DD-MMM-YYYY or DD-MM-YYYY)
  datePattern: /(\d{2})[-\/]?(\w{3}|\d{2})[-\/]?(\d{2,4})/,
};

function parseAmount(amountStr: string): number {
  return parseFloat(amountStr.replace(/,/g, ''));
}

function parseDate(dateStr: string): string {
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const match = dateStr.match(AXIS_PATTERNS.datePattern);
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

// Parse DD-MM-YYYY format to YYYY-MM-DD
function parseDateDDMMYYYY(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}

function extractBalance(body: string): number | undefined {
  const match = body.match(AXIS_PATTERNS.balance);
  return match ? parseAmount(match[1]) : undefined;
}

function extractReference(body: string): string | undefined {
  const match = body.match(AXIS_PATTERNS.reference);
  return match ? match[1].trim() : undefined;
}

function extractInfo(body: string): string | undefined {
  const match = body.match(AXIS_PATTERNS.info);
  if (match) {
    let info = match[1].trim();
    info = info.replace(/\.$/, '').replace(/\s+on\s+\d+.*/i, '').trim();
    return info || undefined;
  }
  return undefined;
}

export const axisParser: BankEmailParser = {
  name: 'Axis',
  senders: [
    'alerts@axisbank.com',
    'noreply@axisbank.com',
    'transaction.alerts@axisbank.com',
  ],
  type: 'both',

  parse(body: string, subject: string): EmailParseResult {
    const fullText = `${subject}\n${body}`;

    // Try to parse from detailed body format (Axis CC emails)
    // Format: "Transaction Amount: INR X", "Merchant Name: XXX", "Axis Bank Credit Card No. XXXX", "Date & Time: DD-MM-YYYY"
    const amountMatch = body.match(AXIS_PATTERNS.ccBodyFormat);
    const merchantMatch = body.match(AXIS_PATTERNS.ccMerchant);
    const cardMatch = body.match(AXIS_PATTERNS.ccCardNo);
    const dateMatch = body.match(AXIS_PATTERNS.ccDateTime);

    if (amountMatch && cardMatch) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(amountMatch[1]),
        transactionType: 'debit',
        accountLastFour: cardMatch[1],
        merchantOrDescription: merchantMatch ? merchantMatch[1].trim() : 'Card Transaction',
        date: dateMatch ? parseDateDDMMYYYY(dateMatch[1]) : new Date().toISOString().split('T')[0],
        reference: extractReference(body),
        bank: 'Axis',
        sourceType: 'credit_card',
      };
      return { success: true, transaction, rawPatternMatch: amountMatch[0] };
    }

    // Try loan credit pattern: "Payment of INR X has been credited to your Loan account no. XXXXX on DD-MM-YYYY"
    let match = fullText.match(AXIS_PATTERNS.loanCredit);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'credit',
        accountLastFour: match[2],
        merchantOrDescription: 'Loan Payment',
        date: parseDateDDMMYYYY(match[3]),
        reference: extractReference(body),
        bank: 'Axis',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try credit card from subject: "INR X spent on credit card no. XXXXX"
    match = subject.match(AXIS_PATTERNS.ccSubject);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'debit',
        accountLastFour: match[2],
        merchantOrDescription: merchantMatch ? merchantMatch[1].trim() : extractInfo(body) || 'Card Transaction',
        date: dateMatch ? parseDateDDMMYYYY(dateMatch[1]) : new Date().toISOString().split('T')[0],
        reference: extractReference(body),
        bank: 'Axis',
        sourceType: 'credit_card',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try bank debit pattern
    match = fullText.match(AXIS_PATTERNS.bankDebit);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'debit',
        accountLastFour: match[2],
        merchantOrDescription: extractInfo(body) || 'Bank Debit',
        date: parseDate(match[3]),
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'Axis',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try bank credit pattern
    match = fullText.match(AXIS_PATTERNS.bankCredit);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'credit',
        accountLastFour: match[2],
        merchantOrDescription: extractInfo(body) || 'Bank Credit',
        date: parseDate(match[3]),
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'Axis',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try card spent pattern
    match = fullText.match(AXIS_PATTERNS.cardSpent);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'debit',
        accountLastFour: match[2],
        merchantOrDescription: match[3].trim(),
        date: match[4] ? parseDate(match[4]) : new Date().toISOString().split('T')[0],
        reference: extractReference(body),
        bank: 'Axis',
        sourceType: 'credit_card',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try credit card spent simple: "INR X spent on credit card no. XX1234"
    match = fullText.match(AXIS_PATTERNS.ccSpentSimple);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'debit',
        accountLastFour: match[2],
        merchantOrDescription: extractInfo(body) || 'Card Transaction',
        date: new Date().toISOString().split('T')[0],
        reference: extractReference(body),
        bank: 'Axis',
        sourceType: 'credit_card',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try credit card debited: "Rs.X debited via Credit Card **1234"
    match = fullText.match(AXIS_PATTERNS.ccDebited);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'debit',
        accountLastFour: match[2],
        merchantOrDescription: extractInfo(body) || 'Card Transaction',
        date: new Date().toISOString().split('T')[0],
        reference: extractReference(body),
        bank: 'Axis',
        sourceType: 'credit_card',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try alternative card pattern
    match = fullText.match(AXIS_PATTERNS.altCardSpent);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[2]),
        transactionType: 'debit',
        accountLastFour: match[1],
        merchantOrDescription: extractInfo(body) || 'Card Transaction',
        date: new Date().toISOString().split('T')[0],
        reference: extractReference(body),
        bank: 'Axis',
        sourceType: 'credit_card',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try alternative debit pattern
    match = fullText.match(AXIS_PATTERNS.altDebit);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[2]),
        transactionType: 'debit',
        accountLastFour: match[1],
        merchantOrDescription: extractInfo(body) || 'Bank Debit',
        date: new Date().toISOString().split('T')[0],
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'Axis',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try alternative credit pattern
    match = fullText.match(AXIS_PATTERNS.altCredit);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[2]),
        transactionType: 'credit',
        accountLastFour: match[1],
        merchantOrDescription: extractInfo(body) || 'Bank Credit',
        date: new Date().toISOString().split('T')[0],
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'Axis',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try card refund pattern
    match = fullText.match(AXIS_PATTERNS.cardRefund);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'credit',
        accountLastFour: match[2],
        merchantOrDescription: 'Refund',
        date: new Date().toISOString().split('T')[0],
        reference: extractReference(body),
        bank: 'Axis',
        sourceType: 'credit_card',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    return {
      success: false,
      error: 'No matching Axis transaction pattern found',
    };
  },
};

export default axisParser;

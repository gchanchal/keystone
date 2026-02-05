import type { BankEmailParser, EmailParseResult, ParsedEmailTransaction } from './types.js';

// Kotak Bank email patterns
const KOTAK_PATTERNS = {
  // Transaction pattern: "Transaction of Rs X done using Kotak Card/Account ending XXXX"
  transaction: /(?:Transaction|Txn)\s+of\s+(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)\s+(?:done|made)\s+(?:using|from|on)\s+Kotak\s+(?:Mahindra\s+)?(?:Bank\s+)?(?:Card|Account|a\/c)\s*(?:ending|xx|[xX*]*)\s*(\d{4})/i,

  // Debit pattern: "Rs X debited from your Kotak Account XX1234"
  debit: /(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?debited\s+from\s+(?:your\s+)?Kotak\s*(?:Mahindra\s+)?(?:Bank\s+)?(?:Account|a\/c)\s*[xX*]*(\d{4})/i,

  // Credit pattern: "Rs X credited to your Kotak Account XX1234"
  credit: /(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?credited\s+to\s+(?:your\s+)?Kotak\s*(?:Mahindra\s+)?(?:Bank\s+)?(?:Account|a\/c)\s*[xX*]*(\d{4})/i,

  // Alternative transaction: "Your Kotak Bank Account XX1234 debited/credited for Rs X"
  altTransaction: /Kotak\s*(?:Mahindra\s+)?(?:Bank\s+)?(?:Account|a\/c)\s*[xX*]*(\d{4})\s+(?:has been\s+)?(debited|credited)\s+(?:with|for)?\s*(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)/i,

  // Card transaction: "Rs X spent on your Kotak Debit/Credit Card XX1234"
  cardTransaction: /(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?(?:spent|charged)\s+(?:on|to)\s+(?:your\s+)?Kotak\s*(?:Mahindra\s+)?(?:Bank\s+)?(?:Debit|Credit)?\s*Card\s*[xX*]*(\d{4})/i,

  // Balance pattern
  balance: /(?:Avl(?:\.)?|Available|Remaining)\s*(?:Bal(?:ance)?)?[:\s]*(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)/i,

  // Reference pattern
  reference: /(?:Ref(?:\.|erence)?(?:\s*No\.?)?|Transaction\s*(?:ID|No)|Txn\s*(?:ID|No))[:\s]*(\w+)/i,

  // Info/Description pattern
  info: /(?:Info|Desc(?:ription)?|Particulars|at\s+)[:\s]*([^\n\.]+)/i,

  // Date pattern
  date: /(?:on|dated?)\s+(\d{2}[-\/]\d{2}[-\/]\d{2,4}|\d{2}[-\/]?\w{3}[-\/]?\d{2,4})/i,
};

function parseAmount(amountStr: string): number {
  return parseFloat(amountStr.replace(/,/g, ''));
}

function parseDate(dateStr: string): string {
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  // Try DD-MM-YYYY format first
  let match = dateStr.match(/(\d{2})[-\/](\d{2})[-\/](\d{2,4})/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    let year = match[3];
    if (year.length === 2) {
      year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
    }
    return `${year}-${month}-${day}`;
  }

  // Try DD-MMM-YYYY format
  match = dateStr.match(/(\d{2})[-\/]?(\w{3})[-\/]?(\d{2,4})/);
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
  const match = body.match(KOTAK_PATTERNS.balance);
  return match ? parseAmount(match[1]) : undefined;
}

function extractReference(body: string): string | undefined {
  const match = body.match(KOTAK_PATTERNS.reference);
  return match ? match[1].trim() : undefined;
}

function extractInfo(body: string): string | undefined {
  const match = body.match(KOTAK_PATTERNS.info);
  if (match) {
    let info = match[1].trim();
    info = info.replace(/\.$/, '').replace(/\s+on\s+\d+.*/i, '').trim();
    return info || undefined;
  }
  return undefined;
}

function extractDate(body: string): string {
  const match = body.match(KOTAK_PATTERNS.date);
  if (match) {
    return parseDate(match[1]);
  }
  return new Date().toISOString().split('T')[0];
}

export const kotakParser: BankEmailParser = {
  name: 'Kotak',
  senders: [
    'alerts@kotak.com',
    'alerts@kotak.bank',
    'noreply@kotak.com',
    'alerts@kotakmahindrabank.com',
  ],
  type: 'both',

  parse(body: string, subject: string): EmailParseResult {
    const fullText = `${subject}\n${body}`;

    // Try main transaction pattern
    let match = fullText.match(KOTAK_PATTERNS.transaction);
    if (match) {
      const isDebit = /debited|spent|withdrawn|charged/i.test(fullText);
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: isDebit ? 'debit' : 'credit',
        accountLastFour: match[2],
        merchantOrDescription: extractInfo(body) || 'Transaction',
        date: extractDate(body),
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'Kotak',
        sourceType: /card/i.test(match[0]) ? 'credit_card' : 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try debit pattern
    match = fullText.match(KOTAK_PATTERNS.debit);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'debit',
        accountLastFour: match[2],
        merchantOrDescription: extractInfo(body) || 'Bank Debit',
        date: extractDate(body),
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'Kotak',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try credit pattern
    match = fullText.match(KOTAK_PATTERNS.credit);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'credit',
        accountLastFour: match[2],
        merchantOrDescription: extractInfo(body) || 'Bank Credit',
        date: extractDate(body),
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'Kotak',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try alternative pattern
    match = fullText.match(KOTAK_PATTERNS.altTransaction);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[3]),
        transactionType: match[2].toLowerCase() as 'debit' | 'credit',
        accountLastFour: match[1],
        merchantOrDescription: extractInfo(body) || `Bank ${match[2]}`,
        date: extractDate(body),
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'Kotak',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try card transaction pattern
    match = fullText.match(KOTAK_PATTERNS.cardTransaction);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'debit',
        accountLastFour: match[2],
        merchantOrDescription: extractInfo(body) || 'Card Transaction',
        date: extractDate(body),
        reference: extractReference(body),
        bank: 'Kotak',
        sourceType: 'credit_card',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    return {
      success: false,
      error: 'No matching Kotak transaction pattern found',
    };
  },
};

export default kotakParser;

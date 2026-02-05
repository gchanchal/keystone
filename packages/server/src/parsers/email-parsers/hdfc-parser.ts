import type { BankEmailParser, EmailParseResult, ParsedEmailTransaction } from './types.js';

// HDFC Bank email patterns
const HDFC_PATTERNS = {
  // Bank account debit: "Rs.X debited from a/c **1234 on DD-MM-YY"
  bankDebit: /Rs\.?\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?debited\s+from\s+(?:a\/c|account)\s*\*{0,2}(\d{4})\s+on\s+(\d{2}[-\/]\d{2}[-\/]\d{2,4})/i,

  // Bank account credit: "Rs.X credited to a/c **1234 on DD-MM-YY"
  bankCredit: /Rs\.?\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?credited\s+to\s+(?:a\/c|account)\s*\*{0,2}(\d{4})\s+on\s+(\d{2}[-\/]\d{2}[-\/]\d{2,4})/i,

  // Credit card spent: "Rs.X spent on HDFC Bank Card x1234 at MERCHANT on DD-MM-YY"
  ccSpent: /Rs\.?\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?spent\s+on\s+HDFC\s*Bank\s*Card\s*x?(\d{4})\s+at\s+(.+?)\s+on\s+(\d{2}[-\/]\d{2}[-\/]\d{2,4})/i,

  // Credit card refund: "Rs.X refunded to HDFC Card x1234"
  ccRefund: /Rs\.?\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?refunded\s+to\s+HDFC\s*(?:Bank)?\s*Card\s*x?(\d{4})/i,

  // Alternative debit pattern: "INR X debited from your account XX1234"
  altDebit: /INR\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?debited\s+from\s+(?:your\s+)?(?:a\/c|account)\s*[xX*]*(\d{4})/i,

  // Alternative credit pattern: "INR X credited to your account XX1234"
  altCredit: /INR\s*([\d,]+(?:\.\d{2})?)\s*(?:has been\s+)?credited\s+to\s+(?:your\s+)?(?:a\/c|account)\s*[xX*]*(\d{4})/i,

  // Balance pattern: "Avl Bal: Rs.X" or "Available Balance: Rs.X"
  balance: /(?:Avl(?:\.)?|Available)\s*Bal(?:ance)?[:\s]*Rs\.?\s*([\d,]+(?:\.\d{2})?)/i,

  // Reference pattern
  reference: /(?:Ref(?:\.|erence)?(?:\s*No\.?)?|Transaction\s*ID)[:\s]*(\w+)/i,

  // Merchant/Info pattern from body
  merchant: /(?:Info|Merchant|at)[:\s]*([^\n]+)/i,
};

function parseAmount(amountStr: string): number {
  return parseFloat(amountStr.replace(/,/g, ''));
}

function parseDate(dateStr: string): string {
  // Convert DD-MM-YY or DD/MM/YY to YYYY-MM-DD
  const parts = dateStr.split(/[-\/]/);
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    let year = parts[2];
    if (year.length === 2) {
      year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
    }
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}

function extractBalance(body: string): number | undefined {
  const match = body.match(HDFC_PATTERNS.balance);
  return match ? parseAmount(match[1]) : undefined;
}

function extractReference(body: string): string | undefined {
  const match = body.match(HDFC_PATTERNS.reference);
  return match ? match[1].trim() : undefined;
}

export const hdfcParser: BankEmailParser = {
  name: 'HDFC',
  senders: [
    'alerts@hdfcbank.net',
    'noreply@hdfcbank.net',
    'alerts@hdfcbank.com',
    'noreply@hdfcbank.com',
  ],
  type: 'both',

  parse(body: string, subject: string): EmailParseResult {
    const fullText = `${subject}\n${body}`;

    // Try bank debit pattern
    let match = fullText.match(HDFC_PATTERNS.bankDebit);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'debit',
        accountLastFour: match[2],
        merchantOrDescription: extractMerchant(body) || 'Bank Debit',
        date: parseDate(match[3]),
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'HDFC',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try bank credit pattern
    match = fullText.match(HDFC_PATTERNS.bankCredit);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'credit',
        accountLastFour: match[2],
        merchantOrDescription: extractMerchant(body) || 'Bank Credit',
        date: parseDate(match[3]),
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'HDFC',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try credit card spent pattern
    match = fullText.match(HDFC_PATTERNS.ccSpent);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'debit',
        accountLastFour: match[2],
        merchantOrDescription: match[3].trim(),
        date: parseDate(match[4]),
        reference: extractReference(body),
        bank: 'HDFC',
        sourceType: 'credit_card',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try credit card refund pattern
    match = fullText.match(HDFC_PATTERNS.ccRefund);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'credit',
        accountLastFour: match[2],
        merchantOrDescription: 'Refund',
        date: new Date().toISOString().split('T')[0], // Use today if no date in email
        reference: extractReference(body),
        bank: 'HDFC',
        sourceType: 'credit_card',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try alternative debit pattern
    match = fullText.match(HDFC_PATTERNS.altDebit);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'debit',
        accountLastFour: match[2],
        merchantOrDescription: extractMerchant(body) || 'Bank Debit',
        date: new Date().toISOString().split('T')[0],
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'HDFC',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    // Try alternative credit pattern
    match = fullText.match(HDFC_PATTERNS.altCredit);
    if (match) {
      const transaction: ParsedEmailTransaction = {
        amount: parseAmount(match[1]),
        transactionType: 'credit',
        accountLastFour: match[2],
        merchantOrDescription: extractMerchant(body) || 'Bank Credit',
        date: new Date().toISOString().split('T')[0],
        balance: extractBalance(body),
        reference: extractReference(body),
        bank: 'HDFC',
        sourceType: 'bank',
      };
      return { success: true, transaction, rawPatternMatch: match[0] };
    }

    return {
      success: false,
      error: 'No matching HDFC transaction pattern found',
    };
  },
};

function extractMerchant(body: string): string | undefined {
  const match = body.match(HDFC_PATTERNS.merchant);
  if (match) {
    // Clean up merchant string
    let merchant = match[1].trim();
    // Remove trailing periods, "VIA" suffixes, etc.
    merchant = merchant.replace(/\s*VIA\s+.+$/i, '').replace(/\.$/, '').trim();
    return merchant || undefined;
  }
  return undefined;
}

export default hdfcParser;

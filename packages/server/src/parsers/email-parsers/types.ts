export interface ParsedEmailTransaction {
  amount: number;
  transactionType: 'credit' | 'debit';
  accountLastFour: string;
  merchantOrDescription: string;
  date: string;
  time?: string;
  balance?: number;
  reference?: string;
  bank: string;
  sourceType: 'bank' | 'credit_card';
}

export interface EmailParseResult {
  success: boolean;
  transaction?: ParsedEmailTransaction;
  error?: string;
  rawPatternMatch?: string;
}

export interface BankEmailParser {
  name: string;
  senders: string[];
  type: 'bank' | 'credit_card' | 'both';
  parse(body: string, subject: string): EmailParseResult;
}

export type SupportedBank = 'HDFC' | 'ICICI' | 'Kotak' | 'Axis';

export const BANK_EMAIL_SENDERS: Record<SupportedBank, string[]> = {
  HDFC: [
    'alerts@hdfcbank.net',
    'noreply@hdfcbank.net',
    'alerts@hdfcbank.com',
    'noreply@hdfcbank.com',
  ],
  ICICI: [
    'alerts@icicibank.com',
    'noreply@icicibank.com',
    'transact@icicibank.com',
  ],
  Kotak: [
    'alerts@kotak.com',
    'alerts@kotak.bank',
    'noreply@kotak.com',
    'alerts@kotakmahindrabank.com',
  ],
  Axis: [
    'alerts@axisbank.com',
    'noreply@axisbank.com',
    'transaction.alerts@axisbank.com',
  ],
};

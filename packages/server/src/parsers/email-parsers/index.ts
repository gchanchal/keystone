import type { BankEmailParser, EmailParseResult, SupportedBank } from './types.js';
import { BANK_EMAIL_SENDERS } from './types.js';
import { hdfcParser } from './hdfc-parser.js';
import { iciciParser } from './icici-parser.js';
import { kotakParser } from './kotak-parser.js';
import { axisParser } from './axis-parser.js';

// Export all types
export * from './types.js';

// All available parsers
const parsers: BankEmailParser[] = [
  hdfcParser,
  iciciParser,
  kotakParser,
  axisParser,
];

/**
 * Get the parser for a specific sender email address
 */
export function getParserForSender(senderEmail: string): BankEmailParser | null {
  const normalizedSender = senderEmail.toLowerCase().trim();

  // Extract email from format "Name <email@domain.com>"
  const emailMatch = normalizedSender.match(/<([^>]+)>/) || [null, normalizedSender];
  const email = emailMatch[1] || normalizedSender;

  for (const parser of parsers) {
    if (parser.senders.some(s => email.includes(s.toLowerCase()))) {
      return parser;
    }
  }

  return null;
}

/**
 * Detect bank name from sender email address
 */
export function detectBankFromSender(senderEmail: string): SupportedBank | null {
  const normalizedSender = senderEmail.toLowerCase().trim();

  // Extract email from format "Name <email@domain.com>"
  const emailMatch = normalizedSender.match(/<([^>]+)>/) || [null, normalizedSender];
  const email = emailMatch[1] || normalizedSender;

  for (const [bank, senders] of Object.entries(BANK_EMAIL_SENDERS)) {
    if (senders.some(s => email.includes(s.toLowerCase()))) {
      return bank as SupportedBank;
    }
  }

  return null;
}

/**
 * Parse a transaction email using auto-detected parser
 */
export function parseTransactionEmail(
  senderEmail: string,
  body: string,
  subject: string
): EmailParseResult {
  const parser = getParserForSender(senderEmail);

  if (!parser) {
    return {
      success: false,
      error: `No parser available for sender: ${senderEmail}`,
    };
  }

  return parser.parse(body, subject);
}

/**
 * Get all bank sender email addresses for Gmail search query
 */
export function getAllBankSenders(): string[] {
  const allSenders: string[] = [];
  for (const senders of Object.values(BANK_EMAIL_SENDERS)) {
    allSenders.push(...senders);
  }
  return allSenders;
}

/**
 * Build a Gmail search query for transaction alert emails
 */
export function buildGmailSearchQuery(options?: {
  after?: string;  // YYYY-MM-DD format
  before?: string; // YYYY-MM-DD format
  banks?: SupportedBank[];
}): string {
  const { after, before, banks } = options || {};

  // Get senders to search for
  let senders: string[];
  if (banks && banks.length > 0) {
    senders = banks.flatMap(bank => BANK_EMAIL_SENDERS[bank]);
  } else {
    senders = getAllBankSenders();
  }

  // Build from: query (OR'd together)
  const fromQuery = senders.map(s => `from:${s}`).join(' OR ');

  // Build date filters
  const dateFilters: string[] = [];
  if (after) {
    // Gmail uses YYYY/MM/DD format
    const formattedAfter = after.replace(/-/g, '/');
    dateFilters.push(`after:${formattedAfter}`);
  }
  if (before) {
    const formattedBefore = before.replace(/-/g, '/');
    dateFilters.push(`before:${formattedBefore}`);
  }

  // Combine query parts
  const queryParts = [`(${fromQuery})`];
  if (dateFilters.length > 0) {
    queryParts.push(...dateFilters);
  }

  return queryParts.join(' ');
}

/**
 * Get supported banks list
 */
export function getSupportedBanks(): SupportedBank[] {
  return Object.keys(BANK_EMAIL_SENDERS) as SupportedBank[];
}

/**
 * Get parser by bank name
 */
export function getParserByBank(bank: SupportedBank): BankEmailParser | null {
  return parsers.find(p => p.name === bank) || null;
}

// Export individual parsers for direct use if needed
export { hdfcParser, iciciParser, kotakParser, axisParser };

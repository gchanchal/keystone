import { v4 as uuidv4 } from 'uuid';
import { db, gmailSyncState, processedEmails, accounts, bankTransactions, creditCardTransactions } from '../db/index.js';
import { eq, and, like } from 'drizzle-orm';
import type { GmailSyncState, NewGmailSyncState, NewProcessedEmail, ProcessedEmail } from '../db/index.js';
import * as gmailService from './gmail-service.js';
import { parseTransactionEmail, buildGmailSearchQuery, detectBankFromSender } from '../parsers/email-parsers/index.js';
import type { ParsedEmailTransaction, SupportedBank } from '../parsers/email-parsers/types.js';

export interface SyncOptions {
  syncType: 'historical' | 'incremental';
  afterDate?: string; // YYYY-MM-DD
  beforeDate?: string; // YYYY-MM-DD
  banks?: SupportedBank[];
  maxEmails?: number;
}

export interface SyncResult {
  syncId: string;
  status: 'completed' | 'failed';
  processedCount: number;
  matchedCount: number;
  newTransactions: number;
  duplicates: number;
  errors: number;
  errorMessage?: string;
}

/**
 * Main sync orchestrator - fetches and processes Gmail transaction emails
 */
export async function syncGmailTransactions(
  connectionId: string,
  options: SyncOptions
): Promise<SyncResult> {
  const now = new Date().toISOString();

  // Create sync state record
  const syncState: NewGmailSyncState = {
    id: uuidv4(),
    connectionId,
    syncType: options.syncType,
    status: 'in_progress',
    processedCount: 0,
    matchedCount: 0,
    startedAt: now,
    createdAt: now,
  };

  await db.insert(gmailSyncState).values(syncState);

  const result: SyncResult = {
    syncId: syncState.id,
    status: 'completed',
    processedCount: 0,
    matchedCount: 0,
    newTransactions: 0,
    duplicates: 0,
    errors: 0,
  };

  try {
    // Build search query
    const searchQuery = buildGmailSearchQuery({
      after: options.afterDate,
      before: options.beforeDate,
      banks: options.banks,
    });

    // Fetch emails with pagination
    let pageToken: string | undefined;
    let totalFetched = 0;
    const maxEmails = options.maxEmails || 500;

    do {
      const searchResult = await gmailService.searchTransactionEmails(connectionId, {
        query: searchQuery,
        maxResults: Math.min(100, maxEmails - totalFetched),
        pageToken,
      });

      const messages = searchResult.messages;
      pageToken = searchResult.nextPageToken || undefined;

      // Process each message
      for (const message of messages) {
        if (!message.id) continue;

        try {
          const processResult = await processEmail(connectionId, message.id);
          result.processedCount++;

          if (processResult.status === 'success') {
            result.matchedCount++;
            if (processResult.isNew) {
              result.newTransactions++;
            } else {
              result.duplicates++;
            }
          } else if (processResult.status === 'failed') {
            result.errors++;
          }
          // 'skipped' status doesn't count as error
        } catch (err) {
          console.error(`Error processing email ${message.id}:`, err);
          result.errors++;
        }

        totalFetched++;
        if (totalFetched >= maxEmails) break;
      }
    } while (pageToken && totalFetched < maxEmails);

    // Update sync state
    await db
      .update(gmailSyncState)
      .set({
        status: 'completed',
        processedCount: result.processedCount,
        matchedCount: result.matchedCount,
        completedAt: new Date().toISOString(),
      })
      .where(eq(gmailSyncState.id, syncState.id));

    // Update connection's last sync time
    await gmailService.updateLastSyncTime(connectionId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    result.status = 'failed';
    result.errorMessage = errorMessage;

    await db
      .update(gmailSyncState)
      .set({
        status: 'failed',
        errorMessage,
        completedAt: new Date().toISOString(),
      })
      .where(eq(gmailSyncState.id, syncState.id));
  }

  return result;
}

interface ProcessEmailResult {
  status: 'success' | 'failed' | 'skipped';
  isNew?: boolean;
  transactionId?: string;
  error?: string;
}

/**
 * Process a single email message
 */
async function processEmail(
  connectionId: string,
  messageId: string
): Promise<ProcessEmailResult> {
  // Check if already processed
  const existing = await db
    .select()
    .from(processedEmails)
    .where(eq(processedEmails.gmailMessageId, messageId))
    .limit(1);

  if (existing.length > 0) {
    return { status: 'skipped' };
  }

  // Fetch email content
  const email = await gmailService.fetchEmailContent(connectionId, messageId);
  const now = new Date().toISOString();

  // Detect bank from sender
  const bankName = detectBankFromSender(email.from);

  // Base processed email data
  const baseEmailData = {
    id: uuidv4(),
    connectionId,
    gmailMessageId: messageId,
    threadId: email.threadId || null,
    fromAddress: email.from,
    subject: email.subject || null,
    receivedAt: email.date || now,
    bankName: bankName || null,
    rawContent: email.body.substring(0, 10000), // Limit stored content
    createdAt: now,
  };

  // Parse the email
  const parseResult = parseTransactionEmail(email.from, email.body, email.subject);

  if (!parseResult.success || !parseResult.transaction) {
    await db.insert(processedEmails).values({
      ...baseEmailData,
      parseStatus: 'failed',
      transactionId: null,
      transactionType: null,
      errorMessage: parseResult.error || null,
    });
    return { status: 'failed', error: parseResult.error };
  }

  const parsed = parseResult.transaction;

  // Find matching account
  const account = await findAccountByLastFour(
    parsed.accountLastFour,
    parsed.sourceType,
    parsed.bank
  );

  if (!account) {
    const errorMsg = `No matching account found for last 4 digits: ${parsed.accountLastFour}`;
    await db.insert(processedEmails).values({
      ...baseEmailData,
      parseStatus: 'failed',
      transactionId: null,
      transactionType: null,
      errorMessage: errorMsg,
    });
    return { status: 'failed', error: errorMsg };
  }

  // Check for duplicate transaction
  const isDuplicate = await isDuplicateTransaction(parsed, account.id);

  if (isDuplicate) {
    await db.insert(processedEmails).values({
      ...baseEmailData,
      parseStatus: 'success',
      transactionId: null,
      transactionType: parsed.sourceType,
      errorMessage: 'Duplicate transaction',
    });
    return { status: 'success', isNew: false };
  }

  // Save the transaction
  const transactionId = await saveTransaction(parsed, account.id);

  // Save processed email record
  await db.insert(processedEmails).values({
    ...baseEmailData,
    parseStatus: 'success',
    transactionId,
    transactionType: parsed.sourceType,
    errorMessage: null,
  });

  return { status: 'success', isNew: true, transactionId };
}

/**
 * Find account by last 4 digits of account number
 */
async function findAccountByLastFour(
  lastFour: string,
  sourceType: 'bank' | 'credit_card',
  bankName: string
): Promise<{ id: string; accountNumber: string | null } | null> {
  // Determine account type based on source
  const accountTypes = sourceType === 'credit_card'
    ? ['credit_card']
    : ['savings', 'current'];

  // Build conditions
  const conditions = [
    like(accounts.accountNumber, `%${lastFour}`),
    eq(accounts.isActive, true),
  ];

  // Try to match bank name
  const bankNameNormalized = bankName.toLowerCase();

  const results = await db
    .select({ id: accounts.id, accountNumber: accounts.accountNumber, bankName: accounts.bankName, accountType: accounts.accountType })
    .from(accounts)
    .where(and(...conditions));

  // Filter by account type and bank name
  const filtered = results.filter(acc => {
    const typeMatch = accountTypes.includes(acc.accountType);
    const bankMatch = acc.bankName.toLowerCase().includes(bankNameNormalized) ||
                      bankNameNormalized.includes(acc.bankName.toLowerCase());
    return typeMatch && bankMatch;
  });

  if (filtered.length > 0) {
    return filtered[0];
  }

  // Fallback: just match by last 4 digits and account type
  const fallback = results.filter(acc => accountTypes.includes(acc.accountType));
  return fallback.length > 0 ? fallback[0] : null;
}

/**
 * Check if a transaction already exists (duplicate detection)
 */
async function isDuplicateTransaction(
  parsed: ParsedEmailTransaction,
  accountId: string
): Promise<boolean> {
  if (parsed.sourceType === 'credit_card') {
    // Check credit card transactions
    const existing = await db
      .select()
      .from(creditCardTransactions)
      .where(
        and(
          eq(creditCardTransactions.accountId, accountId),
          eq(creditCardTransactions.date, parsed.date),
          eq(creditCardTransactions.amount, parsed.amount),
          eq(creditCardTransactions.transactionType, parsed.transactionType)
        )
      )
      .limit(1);

    return existing.length > 0;
  } else {
    // Check bank transactions
    const existing = await db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.accountId, accountId),
          eq(bankTransactions.date, parsed.date),
          eq(bankTransactions.amount, parsed.amount),
          eq(bankTransactions.transactionType, parsed.transactionType)
        )
      )
      .limit(1);

    return existing.length > 0;
  }
}

/**
 * Save transaction to database
 */
async function saveTransaction(
  parsed: ParsedEmailTransaction,
  accountId: string
): Promise<string> {
  const now = new Date().toISOString();
  const id = uuidv4();
  const gmailNote = `[Gmail Sync] ${parsed.bank}`;

  if (parsed.sourceType === 'credit_card') {
    await db.insert(creditCardTransactions).values({
      id,
      accountId,
      date: parsed.date,
      description: parsed.merchantOrDescription,
      amount: parsed.amount,
      transactionType: parsed.transactionType,
      notes: gmailNote,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db.insert(bankTransactions).values({
      id,
      accountId,
      date: parsed.date,
      narration: parsed.merchantOrDescription,
      transactionType: parsed.transactionType,
      amount: parsed.amount,
      notes: gmailNote,
      createdAt: now,
      updatedAt: now,
    });
  }

  return id;
}

/**
 * Get sync history for a connection
 */
export async function getSyncHistory(
  connectionId: string,
  limit = 10
): Promise<GmailSyncState[]> {
  return db
    .select()
    .from(gmailSyncState)
    .where(eq(gmailSyncState.connectionId, connectionId))
    .orderBy(gmailSyncState.createdAt)
    .limit(limit);
}

/**
 * Get processed emails for a connection
 */
export async function getProcessedEmails(
  connectionId: string,
  options?: {
    status?: 'success' | 'failed' | 'skipped';
    limit?: number;
    offset?: number;
  }
): Promise<ProcessedEmail[]> {
  const conditions = [eq(processedEmails.connectionId, connectionId)];

  if (options?.status) {
    conditions.push(eq(processedEmails.parseStatus, options.status));
  }

  const limitVal = options?.limit || 50;
  const offsetVal = options?.offset || 0;

  return db
    .select()
    .from(processedEmails)
    .where(and(...conditions))
    .orderBy(processedEmails.createdAt)
    .limit(limitVal)
    .offset(offsetVal);
}

/**
 * Get sync state by ID
 */
export async function getSyncState(syncId: string): Promise<GmailSyncState | null> {
  const results = await db
    .select()
    .from(gmailSyncState)
    .where(eq(gmailSyncState.id, syncId))
    .limit(1);

  return results[0] || null;
}

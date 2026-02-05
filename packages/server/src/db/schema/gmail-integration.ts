import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// OAuth tokens and connection state
export const gmailConnections = sqliteTable('gmail_connections', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  tokenExpiry: text('token_expiry').notNull(),
  scope: text('scope'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  lastSyncAt: text('last_sync_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Sync history and state
export const gmailSyncState = sqliteTable('gmail_sync_state', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id').notNull(),
  syncType: text('sync_type').notNull(), // 'historical' | 'incremental'
  status: text('status').notNull(), // 'pending' | 'in_progress' | 'completed' | 'failed'
  lastHistoryId: text('last_history_id'),
  processedCount: integer('processed_count').default(0),
  matchedCount: integer('matched_count').default(0),
  errorMessage: text('error_message'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
});

// Processed emails tracking (deduplication)
export const processedEmails = sqliteTable('processed_emails', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id').notNull(),
  gmailMessageId: text('gmail_message_id').notNull().unique(),
  threadId: text('thread_id'),
  fromAddress: text('from_address').notNull(),
  subject: text('subject'),
  receivedAt: text('received_at').notNull(),
  bankName: text('bank_name'),
  parseStatus: text('parse_status').notNull(), // 'success' | 'failed' | 'skipped'
  transactionId: text('transaction_id'),
  transactionType: text('transaction_type'), // 'bank' | 'credit_card'
  rawContent: text('raw_content'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
});

export type GmailConnection = typeof gmailConnections.$inferSelect;
export type NewGmailConnection = typeof gmailConnections.$inferInsert;

export type GmailSyncState = typeof gmailSyncState.$inferSelect;
export type NewGmailSyncState = typeof gmailSyncState.$inferInsert;

export type ProcessedEmail = typeof processedEmails.$inferSelect;
export type NewProcessedEmail = typeof processedEmails.$inferInsert;

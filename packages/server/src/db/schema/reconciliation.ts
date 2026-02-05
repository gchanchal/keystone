import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Junction table for many-to-many reconciliation matches
export const reconciliationMatches = sqliteTable('reconciliation_matches', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  matchGroupId: text('match_group_id').notNull(), // Groups multiple transactions together
  bankTransactionId: text('bank_transaction_id'), // Can be null if only vyapar in this entry
  vyaparTransactionId: text('vyapar_transaction_id'), // Can be null if only bank in this entry
  createdAt: text('created_at').notNull(),
});

export type ReconciliationMatchRecord = typeof reconciliationMatches.$inferSelect;
export type NewReconciliationMatchRecord = typeof reconciliationMatches.$inferInsert;

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const uploads = sqliteTable('uploads', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  uploadType: text('upload_type').notNull(), // bank_statement, vyapar_report, credit_card_statement
  bankName: text('bank_name'),
  accountId: text('account_id'),
  status: text('status').default('pending'), // pending, processing, completed, failed
  transactionCount: integer('transaction_count').default(0),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
  processedAt: text('processed_at'),
});

export type Upload = typeof uploads.$inferSelect;
export type NewUpload = typeof uploads.$inferInsert;

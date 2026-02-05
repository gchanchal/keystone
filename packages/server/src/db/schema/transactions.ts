import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

export const bankTransactions = sqliteTable('bank_transactions', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  accountId: text('account_id').notNull(),
  date: text('date').notNull(),
  valueDate: text('value_date'),
  narration: text('narration').notNull(),
  reference: text('reference'),
  transactionType: text('transaction_type').notNull(), // credit, debit
  amount: real('amount').notNull(),
  balance: real('balance'),
  categoryId: text('category_id'),
  notes: text('notes'),
  isReconciled: integer('is_reconciled', { mode: 'boolean' }).default(false),
  reconciledWithId: text('reconciled_with_id'),
  reconciledWithType: text('reconciled_with_type'), // vyapar, credit_card
  uploadId: text('upload_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type BankTransaction = typeof bankTransactions.$inferSelect;
export type NewBankTransaction = typeof bankTransactions.$inferInsert;

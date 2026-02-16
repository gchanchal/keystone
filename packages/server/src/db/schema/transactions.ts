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
  // Business accounting fields (ASG Technologies)
  bizType: text('biz_type'), // SALARY, PETROL, PORTER, HELPER, VENDOR, SALES_INCOME, OTHER
  bizDescription: text('biz_description'), // User-editable enriched description
  vendorName: text('vendor_name'), // Normalized vendor name extracted from narration
  needsInvoice: integer('needs_invoice', { mode: 'boolean' }).default(false),
  invoiceFileId: text('invoice_file_id'),
  gstAmount: real('gst_amount'), // Total GST (CGST + SGST or IGST)
  cgstAmount: real('cgst_amount'), // Central GST
  sgstAmount: real('sgst_amount'), // State GST
  igstAmount: real('igst_amount'), // Integrated GST (interstate)
  gstType: text('gst_type'), // 'input' (purchases) or 'output' (sales)
  purpose: text('purpose'), // 'business', 'personal', or null (null = business)
  updatedByEmail: text('updated_by_email'), // Email of user who last updated (for team tracking)
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type BankTransaction = typeof bankTransactions.$inferSelect;
export type NewBankTransaction = typeof bankTransactions.$inferInsert;

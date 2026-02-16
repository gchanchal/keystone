import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

export const vyaparTransactions = sqliteTable('vyapar_transactions', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  date: text('date').notNull(),
  invoiceNumber: text('invoice_number'),
  transactionType: text('transaction_type').notNull(), // Sale, Payment-In, Sale Order, Purchase, Payment-Out, Expense
  partyName: text('party_name'),
  categoryName: text('category_name'),
  paymentType: text('payment_type'),
  amount: real('amount').notNull(),
  balance: real('balance'),
  description: text('description'),
  isReconciled: integer('is_reconciled', { mode: 'boolean' }).default(false),
  reconciledWithId: text('reconciled_with_id'),
  // Fingerprint of matched bank transaction - survives account deletion for auto-restore
  matchedBankDate: text('matched_bank_date'),
  matchedBankAmount: real('matched_bank_amount'),
  matchedBankNarration: text('matched_bank_narration'),
  matchedBankAccountId: text('matched_bank_account_id'),
  uploadId: text('upload_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Item details from Vyapar - links to transactions via invoice number
export const vyaparItemDetails = sqliteTable('vyapar_item_details', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  date: text('date').notNull(),
  invoiceNumber: text('invoice_number'),
  partyName: text('party_name'),
  itemName: text('item_name').notNull(),
  itemCode: text('item_code'),
  category: text('category'), // Service, Bykology Accessories, etc.
  challanOrderNo: text('challan_order_no'),
  quantity: real('quantity').default(1),
  unit: text('unit'),
  unitPrice: real('unit_price'),
  discountPercent: real('discount_percent'),
  discount: real('discount'),
  taxPercent: real('tax_percent'),
  tax: real('tax'),
  transactionType: text('transaction_type').notNull(), // Sale, Expense, Purchase, etc.
  amount: real('amount').notNull(),
  uploadId: text('upload_id'),
  createdAt: text('created_at').notNull(),
});

// Notes on Vyapar transactions for reconciliation tracking
export const vyaparTransactionNotes = sqliteTable('vyapar_transaction_notes', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id').notNull(), // Vyapar transaction ID
  userId: text('user_id').notNull(),
  note: text('note').notNull(),
  createdByEmail: text('created_by_email'),
  createdAt: text('created_at').notNull(),
});

export type VyaparTransaction = typeof vyaparTransactions.$inferSelect;
export type NewVyaparTransaction = typeof vyaparTransactions.$inferInsert;
export type VyaparItemDetail = typeof vyaparItemDetails.$inferSelect;
export type NewVyaparItemDetail = typeof vyaparItemDetails.$inferInsert;
export type VyaparTransactionNote = typeof vyaparTransactionNotes.$inferSelect;
export type NewVyaparTransactionNote = typeof vyaparTransactionNotes.$inferInsert;

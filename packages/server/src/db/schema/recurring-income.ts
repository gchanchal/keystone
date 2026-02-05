import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

export const recurringIncome = sqliteTable('recurring_income', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  name: text('name').notNull(), // e.g., "Salary - Company Name"
  category: text('category').notNull(), // salary, rental, dividend, interest, freelance, other

  // Amount details
  amount: real('amount').notNull(),
  currency: text('currency').default('INR'),

  // Frequency and timing
  frequency: text('frequency').notNull(), // monthly, quarterly, half_yearly, yearly
  expectedDay: integer('expected_day'), // Day of month (1-31) when income is expected
  expectedMonth: integer('expected_month'), // Month (1-12) for yearly income

  // Source info
  source: text('source'), // Where the income comes from (e.g., "ABC Company", "Tenant Name")
  accountNumber: text('account_number'), // Account/reference number if any

  // For whom (family member tracking)
  forWhom: text('for_whom'), // e.g., "Self", "Spouse", "Family"

  // Dates
  startDate: text('start_date'),
  endDate: text('end_date'), // When the income ends (e.g., rental contract end)

  // Receipt tracking
  lastReceivedDate: text('last_received_date'),
  nextExpectedDate: text('next_expected_date'),

  // Status
  status: text('status').default('active'), // active, paused, completed

  // Auto-credit info
  autoCredit: integer('auto_credit').default(0), // 0 = false, 1 = true (e.g., salary auto-credited)
  creditAccount: text('credit_account'), // Which account receives this

  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Track actual income received
export const incomeReceipts = sqliteTable('income_receipts', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  incomeId: text('income_id').notNull(),
  receiptDate: text('receipt_date').notNull(),
  amount: real('amount').notNull(),
  forPeriod: text('for_period'), // e.g., "Jan 2024", "Q1 2024"
  paymentMode: text('payment_mode'), // cash, bank_transfer, cheque, upi
  referenceNumber: text('reference_number'),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
});

export type RecurringIncome = typeof recurringIncome.$inferSelect;
export type NewRecurringIncome = typeof recurringIncome.$inferInsert;
export type IncomeReceipt = typeof incomeReceipts.$inferSelect;
export type NewIncomeReceipt = typeof incomeReceipts.$inferInsert;

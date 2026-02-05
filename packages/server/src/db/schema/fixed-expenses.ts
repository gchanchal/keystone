import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

export const fixedExpenses = sqliteTable('fixed_expenses', {
  id: text('id').primaryKey(),
  name: text('name').notNull(), // e.g., "School Fees - Ryan International"
  category: text('category').notNull(), // rent, school_fees, utilities, subscription, insurance, other

  // Amount details
  amount: real('amount').notNull(),
  currency: text('currency').default('INR'),

  // Frequency and timing
  frequency: text('frequency').notNull(), // monthly, quarterly, half_yearly, yearly
  dueDay: integer('due_day'), // Day of month (1-31) when payment is due
  dueMonth: integer('due_month'), // Month (1-12) for yearly expenses

  // Beneficiary info
  beneficiary: text('beneficiary'), // Who the payment goes to (e.g., "Ryan International School")
  accountNumber: text('account_number'), // Account/reference number if any

  // For whom (family member tracking)
  forWhom: text('for_whom'), // e.g., "Kid 1", "Kid 2", "Family"

  // Dates
  startDate: text('start_date'),
  endDate: text('end_date'), // When the expense ends (e.g., school fees till graduation)

  // Payment tracking
  lastPaidDate: text('last_paid_date'),
  nextDueDate: text('next_due_date'),

  // Status
  status: text('status').default('active'), // active, paused, completed

  // Auto-pay info
  autoPayEnabled: integer('auto_pay_enabled').default(0), // 0 = false, 1 = true
  autoPayAccount: text('auto_pay_account'), // Which account pays this

  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Track actual payments made for fixed expenses
export const fixedExpensePayments = sqliteTable('fixed_expense_payments', {
  id: text('id').primaryKey(),
  expenseId: text('expense_id').notNull(),
  paymentDate: text('payment_date').notNull(),
  amount: real('amount').notNull(),
  forPeriod: text('for_period'), // e.g., "Jan 2024", "Q1 2024"
  paymentMode: text('payment_mode'), // cash, bank_transfer, cheque, upi
  referenceNumber: text('reference_number'),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
});

export type FixedExpense = typeof fixedExpenses.$inferSelect;
export type NewFixedExpense = typeof fixedExpenses.$inferInsert;
export type FixedExpensePayment = typeof fixedExpensePayments.$inferSelect;
export type NewFixedExpensePayment = typeof fixedExpensePayments.$inferInsert;

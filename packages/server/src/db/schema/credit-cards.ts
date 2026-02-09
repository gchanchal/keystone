import { sqliteTable, text, real, integer, index } from 'drizzle-orm/sqlite-core';

export const creditCardTransactions = sqliteTable('credit_card_transactions', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  accountId: text('account_id').notNull(),
  date: text('date').notNull(),
  description: text('description').notNull(),
  amount: real('amount').notNull(),
  transactionType: text('transaction_type').notNull(), // debit, credit
  categoryId: text('category_id'),
  notes: text('notes'),
  isReconciled: integer('is_reconciled', { mode: 'boolean' }).default(false),
  reconciledWithId: text('reconciled_with_id'),
  uploadId: text('upload_id'),
  // HDFC Infinia specific fields
  cardHolderName: text('card_holder_name'),
  isEmi: integer('is_emi', { mode: 'boolean' }).default(false),
  emiTenure: integer('emi_tenure'),
  rewardPoints: integer('reward_points').default(0),
  merchantLocation: text('merchant_location'),
  transactionTime: text('transaction_time'),
  piCategory: text('pi_category'), // HDFC's Purchase Indicator category
  statementId: text('statement_id'),
  source: text('source').default('statement'), // 'gmail' or 'statement'
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type CreditCardTransaction = typeof creditCardTransactions.$inferSelect;
export type NewCreditCardTransaction = typeof creditCardTransactions.$inferInsert;

// Credit Card Statements - billing cycle metadata
export const creditCardStatements = sqliteTable('credit_card_statements', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  accountId: text('account_id').notNull(),
  statementDate: text('statement_date').notNull(),
  billingPeriodStart: text('billing_period_start').notNull(),
  billingPeriodEnd: text('billing_period_end').notNull(),
  dueDate: text('due_date').notNull(),
  totalDue: real('total_due').notNull(),
  minimumDue: real('minimum_due').notNull(),
  creditLimit: real('credit_limit'),
  availableLimit: real('available_limit'),
  rewardPointsBalance: integer('reward_points_balance'),
  rewardPointsEarned: integer('reward_points_earned'),
  rewardPointsRedeemed: integer('reward_points_redeemed'),
  cashbackEarned: real('cashback_earned'),
  openingBalance: real('opening_balance'),
  closingBalance: real('closing_balance'),
  totalCredits: real('total_credits'),
  totalDebits: real('total_debits'),
  financeCharges: real('finance_charges'),
  uploadId: text('upload_id'),
  createdAt: text('created_at').notNull(),
});

export type CreditCardStatement = typeof creditCardStatements.$inferSelect;
export type NewCreditCardStatement = typeof creditCardStatements.$inferInsert;

// Card Holders - track main and add-on card holders
export const cardHolders = sqliteTable('card_holders', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  isPrimary: integer('is_primary', { mode: 'boolean' }).default(false),
  cardLastFour: text('card_last_four'),
  createdAt: text('created_at').notNull(),
});

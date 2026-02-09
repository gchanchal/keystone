import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  name: text('name').notNull(),
  bankName: text('bank_name').notNull(),
  accountNumber: text('account_number'),
  accountType: text('account_type').notNull(), // savings, current, credit_card, loan
  currency: text('currency').default('INR'),
  openingBalance: real('opening_balance').default(0),
  currentBalance: real('current_balance').default(0),
  // Sweep balance: money in linked FD via auto-sweep (still part of actual balance)
  sweepBalance: real('sweep_balance').default(0),
  // Linked FD account number for sweep transfers
  linkedFdAccount: text('linked_fd_account'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  // Additional bank account metadata
  ifscCode: text('ifsc_code'),
  branchName: text('branch_name'),
  accountHolderName: text('account_holder_name'),
  address: text('address'), // Account holder's address from statement
  accountStatus: text('account_status'), // Individual, Joint, Corporate, etc.
  // Credit card specific fields
  cardName: text('card_name'), // e.g., "Regalia", "Infinia", "Amazon Pay"
  cardNetwork: text('card_network'), // Visa, Mastercard, RuPay, Amex, Diners
  cardHolderName: text('card_holder_name'), // Name on the card
  cardImage: text('card_image'), // Custom card image URL (optional)
  // GearUp Mods business account flag (exclusive to g.chanchal@gmail.com)
  isGearupBusiness: integer('is_gearup_business', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

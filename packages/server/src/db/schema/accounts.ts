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
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  // Credit card specific fields
  cardName: text('card_name'), // e.g., "Regalia", "Infinia", "Amazon Pay"
  cardNetwork: text('card_network'), // Visa, Mastercard, RuPay, Amex, Diners
  cardHolderName: text('card_holder_name'), // Name on the card
  cardImage: text('card_image'), // Custom card image URL (optional)
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

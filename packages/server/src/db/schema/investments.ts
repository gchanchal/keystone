import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

export const investments = sqliteTable('investments', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  name: text('name').notNull(),
  type: text('type').notNull(), // stocks, mutual_funds, fd, ppf, gold, crypto, real_estate, other
  symbol: text('symbol'),
  platform: text('platform'),
  country: text('country').default('IN'), // IN = India (₹), US = United States ($)
  quantity: real('quantity').default(1),
  purchasePrice: real('purchase_price').notNull(),
  purchaseDate: text('purchase_date').notNull(),
  currentPrice: real('current_price'),
  currentValue: real('current_value'),
  lastUpdated: text('last_updated'),
  notes: text('notes'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const investmentHistory = sqliteTable('investment_history', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  investmentId: text('investment_id').notNull(),
  date: text('date').notNull(),
  price: real('price').notNull(),
  value: real('value').notNull(),
  createdAt: text('created_at').notNull(),
});

export type Investment = typeof investments.$inferSelect;
export type NewInvestment = typeof investments.$inferInsert;
export type InvestmentHistory = typeof investmentHistory.$inferSelect;
export type NewInvestmentHistory = typeof investmentHistory.$inferInsert;

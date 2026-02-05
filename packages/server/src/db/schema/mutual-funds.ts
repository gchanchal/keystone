import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

// Mutual Fund Folios (one folio per AMC)
export const mutualFundFolios = sqliteTable('mutual_fund_folios', {
  id: text('id').primaryKey(),
  folioNumber: text('folio_number').notNull(),
  amcName: text('amc_name').notNull(), // e.g., "ICICI Prudential", "SBI Mutual Fund"
  panNumber: text('pan_number'),
  investorName: text('investor_name'),
  email: text('email'),
  mobile: text('mobile'),
  registrar: text('registrar'), // CAMS, KFINTECH
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Mutual Fund Holdings (schemes within a folio)
export const mutualFundHoldings = sqliteTable('mutual_fund_holdings', {
  id: text('id').primaryKey(),
  folioId: text('folio_id').notNull(),
  schemeName: text('scheme_name').notNull(),
  schemeCode: text('scheme_code'),
  isin: text('isin'),
  schemeType: text('scheme_type'), // Equity, Debt, Hybrid, etc.
  schemeCategory: text('scheme_category'), // Large Cap, Mid Cap, Liquid, etc.
  units: real('units').notNull(),
  costValue: real('cost_value').notNull(),
  currentValue: real('current_value'),
  nav: real('nav'),
  navDate: text('nav_date'),
  previousNav: real('previous_nav'),
  dayChange: real('day_change'),
  dayChangePercent: real('day_change_percent'),
  purchaseDate: text('purchase_date'),
  avgPurchasePrice: real('avg_purchase_price'),
  absoluteReturn: real('absolute_return'),
  absoluteReturnPercent: real('absolute_return_percent'),
  xirr: real('xirr'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  lastUpdated: text('last_updated'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Mutual Fund Transactions (SIP, Redemption, Switch, Dividend)
export const mutualFundTransactions = sqliteTable('mutual_fund_transactions', {
  id: text('id').primaryKey(),
  holdingId: text('holding_id').notNull(),
  folioId: text('folio_id').notNull(),
  date: text('date').notNull(),
  transactionType: text('transaction_type').notNull(), // Purchase, Redemption, Switch-In, Switch-Out, Dividend Reinvested
  units: real('units'),
  nav: real('nav'),
  amount: real('amount').notNull(),
  stampDuty: real('stamp_duty'),
  stt: real('stt'),
  load: real('load'),
  description: text('description'),
  createdAt: text('created_at').notNull(),
});

// NAV History for tracking scheme performance
export const mutualFundNavHistory = sqliteTable('mutual_fund_nav_history', {
  id: text('id').primaryKey(),
  holdingId: text('holding_id').notNull(),
  date: text('date').notNull(),
  nav: real('nav').notNull(),
  createdAt: text('created_at').notNull(),
});

export type MutualFundFolio = typeof mutualFundFolios.$inferSelect;
export type NewMutualFundFolio = typeof mutualFundFolios.$inferInsert;
export type MutualFundHolding = typeof mutualFundHoldings.$inferSelect;
export type NewMutualFundHolding = typeof mutualFundHoldings.$inferInsert;
export type MutualFundTransaction = typeof mutualFundTransactions.$inferSelect;
export type NewMutualFundTransaction = typeof mutualFundTransactions.$inferInsert;

import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

/**
 * Portfolio Snapshots - Daily tracking of net worth and portfolio components
 * Captured at US market close (4 PM ET / 9:30 PM IST)
 */
export const portfolioSnapshots = sqliteTable('portfolio_snapshots', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),

  // Snapshot timing
  snapshotDate: text('snapshot_date').notNull(), // YYYY-MM-DD
  snapshotTime: text('snapshot_time').notNull(), // HH:MM:SS

  // Assets - Bank Accounts
  bankBalance: real('bank_balance').default(0), // Sum of savings/current accounts

  // Assets - Investments
  usStocksValue: real('us_stocks_value').default(0), // US market stocks
  indiaStocksValue: real('india_stocks_value').default(0), // Indian market stocks
  mutualFundsValue: real('mutual_funds_value').default(0), // All MF holdings
  fdValue: real('fd_value').default(0), // Fixed deposits
  ppfValue: real('ppf_value').default(0), // PPF
  goldValue: real('gold_value').default(0), // Gold investments
  cryptoValue: real('crypto_value').default(0), // Crypto
  otherInvestmentsValue: real('other_investments_value').default(0), // Other investments

  // Assets - Physical
  realEstateValue: real('real_estate_value').default(0), // Property value
  vehiclesValue: real('vehicles_value').default(0), // Vehicles
  otherAssetsValue: real('other_assets_value').default(0), // Other physical assets

  // Assets - Receivables
  loansGivenValue: real('loans_given_value').default(0), // Money to receive from others

  // Liabilities
  homeLoanOutstanding: real('home_loan_outstanding').default(0),
  carLoanOutstanding: real('car_loan_outstanding').default(0),
  personalLoanOutstanding: real('personal_loan_outstanding').default(0),
  otherLoansOutstanding: real('other_loans_outstanding').default(0),
  creditCardDues: real('credit_card_dues').default(0),

  // Aggregates
  totalAssets: real('total_assets').default(0),
  totalLiabilities: real('total_liabilities').default(0),
  netWorth: real('net_worth').default(0),

  // Investments subtotals
  totalInvestments: real('total_investments').default(0), // All financial investments
  totalPhysicalAssets: real('total_physical_assets').default(0), // Real estate + vehicles + others

  // Performance tracking (vs previous snapshot)
  dayChangeAmount: real('day_change_amount').default(0),
  dayChangePercent: real('day_change_percent').default(0),

  // Metadata
  isManualCapture: integer('is_manual_capture', { mode: 'boolean' }).default(false),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
});

export type PortfolioSnapshot = typeof portfolioSnapshots.$inferSelect;
export type NewPortfolioSnapshot = typeof portfolioSnapshots.$inferInsert;

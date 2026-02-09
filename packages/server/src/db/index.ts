import Database, { Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

import * as usersSchema from './schema/users.js';
import * as accountsSchema from './schema/accounts.js';
import * as transactionsSchema from './schema/transactions.js';
import * as vyaparSchema from './schema/vyapar.js';
import * as creditCardsSchema from './schema/credit-cards.js';
import * as investmentsSchema from './schema/investments.js';
import * as loansSchema from './schema/loans.js';
import * as uploadsSchema from './schema/uploads.js';
import * as categoriesSchema from './schema/categories.js';
import * as reconciliationSchema from './schema/reconciliation.js';
import * as mutualFundsSchema from './schema/mutual-funds.js';
import * as assetsSchema from './schema/assets.js';
import * as fixedExpensesSchema from './schema/fixed-expenses.js';
import * as recurringIncomeSchema from './schema/recurring-income.js';
import * as gmailIntegrationSchema from './schema/gmail-integration.js';
import * as portfolioSnapshotsSchema from './schema/portfolio-snapshots.js';
import * as templatesSchema from './schema/templates.js';
import * as businessInvoicesSchema from './schema/business-invoices.js';
import * as enrichmentRulesSchema from './schema/enrichment-rules.js';
import * as reconciliationRulesSchema from './schema/reconciliation-rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use DATABASE_PATH env var for production (Railway volume), fallback to local data folder
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../../data/keystone.db');

// Ensure data directory exists
import fs from 'fs';
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const sqlite: DatabaseType = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, {
  schema: {
    ...usersSchema,
    ...accountsSchema,
    ...transactionsSchema,
    ...vyaparSchema,
    ...creditCardsSchema,
    ...investmentsSchema,
    ...loansSchema,
    ...uploadsSchema,
    ...categoriesSchema,
    ...reconciliationSchema,
    ...mutualFundsSchema,
    ...assetsSchema,
    ...fixedExpensesSchema,
    ...recurringIncomeSchema,
    ...gmailIntegrationSchema,
    ...portfolioSnapshotsSchema,
    ...templatesSchema,
    ...businessInvoicesSchema,
    ...enrichmentRulesSchema,
    ...reconciliationRulesSchema,
  },
});

// Initialize tables
export function initializeDatabase() {
  sqlite.exec(`
    -- Users table for authentication
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      picture TEXT,
      google_id TEXT NOT NULL UNIQUE,
      is_active INTEGER DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      account_number TEXT,
      account_type TEXT NOT NULL,
      currency TEXT DEFAULT 'INR',
      opening_balance REAL DEFAULT 0,
      current_balance REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bank_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      date TEXT NOT NULL,
      value_date TEXT,
      narration TEXT NOT NULL,
      reference TEXT,
      transaction_type TEXT NOT NULL,
      amount REAL NOT NULL,
      balance REAL,
      category_id TEXT,
      notes TEXT,
      is_reconciled INTEGER DEFAULT 0,
      reconciled_with_id TEXT,
      reconciled_with_type TEXT,
      upload_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vyapar_transactions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      invoice_number TEXT,
      transaction_type TEXT NOT NULL,
      party_name TEXT,
      category_name TEXT,
      payment_type TEXT,
      amount REAL NOT NULL,
      balance REAL,
      description TEXT,
      is_reconciled INTEGER DEFAULT 0,
      reconciled_with_id TEXT,
      upload_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vyapar_item_details (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      invoice_number TEXT,
      party_name TEXT,
      item_name TEXT NOT NULL,
      item_code TEXT,
      category TEXT,
      challan_order_no TEXT,
      quantity REAL DEFAULT 1,
      unit TEXT,
      unit_price REAL,
      discount_percent REAL,
      discount REAL,
      tax_percent REAL,
      tax REAL,
      transaction_type TEXT NOT NULL,
      amount REAL NOT NULL,
      upload_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS credit_card_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      transaction_type TEXT NOT NULL,
      category_id TEXT,
      notes TEXT,
      is_reconciled INTEGER DEFAULT 0,
      reconciled_with_id TEXT,
      upload_id TEXT,
      card_holder_name TEXT,
      is_emi INTEGER DEFAULT 0,
      emi_tenure INTEGER,
      reward_points INTEGER DEFAULT 0,
      merchant_location TEXT,
      transaction_time TEXT,
      pi_category TEXT,
      statement_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS credit_card_statements (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      statement_date TEXT NOT NULL,
      billing_period_start TEXT NOT NULL,
      billing_period_end TEXT NOT NULL,
      due_date TEXT NOT NULL,
      total_due REAL NOT NULL,
      minimum_due REAL NOT NULL,
      credit_limit REAL,
      available_limit REAL,
      reward_points_balance INTEGER,
      reward_points_earned INTEGER,
      reward_points_redeemed INTEGER,
      cashback_earned REAL,
      opening_balance REAL,
      closing_balance REAL,
      total_credits REAL,
      total_debits REAL,
      finance_charges REAL,
      upload_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_holders (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_primary INTEGER DEFAULT 0,
      card_last_four TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS investments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      symbol TEXT,
      platform TEXT,
      quantity REAL DEFAULT 1,
      purchase_price REAL NOT NULL,
      purchase_date TEXT NOT NULL,
      current_price REAL,
      current_value REAL,
      last_updated TEXT,
      notes TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS investment_history (
      id TEXT PRIMARY KEY,
      investment_id TEXT NOT NULL,
      date TEXT NOT NULL,
      price REAL NOT NULL,
      value REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      loan_type TEXT,
      party_name TEXT NOT NULL,
      borrower_name TEXT,
      co_borrower_name TEXT,
      agreement_number TEXT,
      application_number TEXT,
      sanctioned_amount REAL,
      disbursed_amount REAL,
      principal_amount REAL NOT NULL,
      outstanding_amount REAL NOT NULL,
      interest_rate REAL DEFAULT 0,
      interest_type TEXT,
      emi_amount REAL,
      emi_start_date TEXT,
      total_installments INTEGER,
      paid_installments INTEGER DEFAULT 0,
      pending_installments INTEGER,
      total_principal_paid REAL DEFAULT 0,
      total_interest_paid REAL DEFAULT 0,
      total_charges_paid REAL DEFAULT 0,
      start_date TEXT NOT NULL,
      disbursal_date TEXT,
      due_date TEXT,
      maturity_date TEXT,
      property_address TEXT,
      property_type TEXT,
      repayment_bank TEXT,
      repayment_mode TEXT,
      status TEXT DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loan_payments (
      id TEXT PRIMARY KEY,
      loan_id TEXT NOT NULL,
      date TEXT NOT NULL,
      value_date TEXT,
      transaction_type TEXT NOT NULL,
      particulars TEXT,
      installment_number INTEGER,
      amount REAL NOT NULL,
      principal_paid REAL DEFAULT 0,
      interest_paid REAL DEFAULT 0,
      charges_paid REAL DEFAULT 0,
      disbursement_amount REAL,
      reference_number TEXT,
      payment_mode TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loan_disbursements (
      id TEXT PRIMARY KEY,
      loan_id TEXT NOT NULL,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      purpose TEXT,
      reference_number TEXT,
      running_total REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loan_schedule (
      id TEXT PRIMARY KEY,
      loan_id TEXT NOT NULL,
      installment_number INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      opening_principal REAL NOT NULL,
      installment_amount REAL NOT NULL,
      principal_amount REAL NOT NULL,
      interest_amount REAL NOT NULL,
      closing_principal REAL NOT NULL,
      interest_rate REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      actual_payment_date TEXT,
      actual_amount_paid REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loan_given_details (
      id TEXT PRIMARY KEY,
      loan_id TEXT NOT NULL,
      particular TEXT NOT NULL,
      to_get REAL DEFAULT 0,
      to_give REAL DEFAULT 0,
      currency TEXT DEFAULT 'INR',
      details TEXT,
      date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      upload_type TEXT NOT NULL,
      bank_name TEXT,
      account_id TEXT,
      status TEXT DEFAULT 'pending',
      transaction_count INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      icon TEXT,
      color TEXT,
      parent_id TEXT,
      is_system INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reconciliation_matches (
      id TEXT PRIMARY KEY,
      match_group_id TEXT NOT NULL,
      bank_transaction_id TEXT,
      vyapar_transaction_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bank_transactions_account ON bank_transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(date);
    CREATE INDEX IF NOT EXISTS idx_bank_transactions_reconciled ON bank_transactions(is_reconciled);
    CREATE INDEX IF NOT EXISTS idx_vyapar_transactions_date ON vyapar_transactions(date);
    CREATE INDEX IF NOT EXISTS idx_vyapar_transactions_reconciled ON vyapar_transactions(is_reconciled);
    CREATE INDEX IF NOT EXISTS idx_vyapar_item_details_date ON vyapar_item_details(date);
    CREATE INDEX IF NOT EXISTS idx_vyapar_item_details_category ON vyapar_item_details(category);
    CREATE INDEX IF NOT EXISTS idx_vyapar_item_details_transaction_type ON vyapar_item_details(transaction_type);
    CREATE INDEX IF NOT EXISTS idx_credit_card_transactions_account ON credit_card_transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_investments_type ON investments(type);
    CREATE INDEX IF NOT EXISTS idx_loans_type ON loans(type);
    CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
    CREATE INDEX IF NOT EXISTS idx_loans_loan_type ON loans(loan_type);
    CREATE INDEX IF NOT EXISTS idx_loan_payments_loan_id ON loan_payments(loan_id);
    CREATE INDEX IF NOT EXISTS idx_loan_payments_date ON loan_payments(date);
    CREATE INDEX IF NOT EXISTS idx_loan_disbursements_loan_id ON loan_disbursements(loan_id);
    CREATE INDEX IF NOT EXISTS idx_loan_schedule_loan_id ON loan_schedule(loan_id);
    CREATE INDEX IF NOT EXISTS idx_loan_schedule_due_date ON loan_schedule(due_date);
    CREATE INDEX IF NOT EXISTS idx_loan_schedule_status ON loan_schedule(status);
    CREATE INDEX IF NOT EXISTS idx_loan_given_details_loan_id ON loan_given_details(loan_id);
    CREATE INDEX IF NOT EXISTS idx_loan_given_details_date ON loan_given_details(date);
    CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_group ON reconciliation_matches(match_group_id);
    CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_bank ON reconciliation_matches(bank_transaction_id);
    CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_vyapar ON reconciliation_matches(vyapar_transaction_id);

    CREATE TABLE IF NOT EXISTS mutual_fund_folios (
      id TEXT PRIMARY KEY,
      folio_number TEXT NOT NULL,
      amc_name TEXT NOT NULL,
      pan_number TEXT,
      investor_name TEXT,
      email TEXT,
      mobile TEXT,
      registrar TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mutual_fund_holdings (
      id TEXT PRIMARY KEY,
      folio_id TEXT NOT NULL,
      scheme_name TEXT NOT NULL,
      scheme_code TEXT,
      isin TEXT,
      scheme_type TEXT,
      scheme_category TEXT,
      units REAL NOT NULL,
      cost_value REAL NOT NULL,
      current_value REAL,
      nav REAL,
      nav_date TEXT,
      purchase_date TEXT,
      avg_purchase_price REAL,
      absolute_return REAL,
      absolute_return_percent REAL,
      xirr REAL,
      is_active INTEGER DEFAULT 1,
      last_updated TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mutual_fund_transactions (
      id TEXT PRIMARY KEY,
      holding_id TEXT NOT NULL,
      folio_id TEXT NOT NULL,
      date TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      units REAL,
      nav REAL,
      amount REAL NOT NULL,
      stamp_duty REAL,
      stt REAL,
      load REAL,
      description TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mutual_fund_nav_history (
      id TEXT PRIMARY KEY,
      holding_id TEXT NOT NULL,
      date TEXT NOT NULL,
      nav REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mutual_fund_folios_folio_number ON mutual_fund_folios(folio_number);
    CREATE INDEX IF NOT EXISTS idx_mutual_fund_folios_amc ON mutual_fund_folios(amc_name);
    CREATE INDEX IF NOT EXISTS idx_mutual_fund_holdings_folio ON mutual_fund_holdings(folio_id);
    CREATE INDEX IF NOT EXISTS idx_mutual_fund_holdings_isin ON mutual_fund_holdings(isin);
    CREATE INDEX IF NOT EXISTS idx_mutual_fund_transactions_holding ON mutual_fund_transactions(holding_id);
    CREATE INDEX IF NOT EXISTS idx_mutual_fund_transactions_folio ON mutual_fund_transactions(folio_id);

    -- Physical Assets (Houses, Land, etc.)
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      country TEXT DEFAULT 'India',
      area REAL,
      area_unit TEXT DEFAULT 'sqft',
      registration_number TEXT,
      purchase_date TEXT,
      purchase_value REAL NOT NULL,
      current_value REAL,
      last_valuation_date TEXT,
      currency TEXT DEFAULT 'INR',
      linked_loan_id TEXT,
      ownership_type TEXT DEFAULT 'self',
      ownership_percentage REAL DEFAULT 100,
      co_owners TEXT,
      documents_path TEXT,
      status TEXT DEFAULT 'owned',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Insurance Policies
    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      provider TEXT NOT NULL,
      policy_number TEXT,
      policy_holder TEXT,
      sum_assured REAL,
      coverage_amount REAL,
      coverage_details TEXT,
      premium_amount REAL,
      premium_frequency TEXT,
      next_premium_date TEXT,
      total_premium_paid REAL DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      policy_term INTEGER,
      nominees TEXT,
      maturity_benefit REAL,
      death_benefit REAL,
      bonus_accrued REAL,
      family_members TEXT,
      waiting_period TEXT,
      linked_asset_id TEXT,
      documents_path TEXT,
      status TEXT DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Policy premium payments
    CREATE TABLE IF NOT EXISTS policy_payments (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      payment_date TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_mode TEXT,
      reference_number TEXT,
      receipt_path TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
    CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
    CREATE INDEX IF NOT EXISTS idx_assets_linked_loan ON assets(linked_loan_id);
    CREATE INDEX IF NOT EXISTS idx_policies_type ON policies(type);
    CREATE INDEX IF NOT EXISTS idx_policies_status ON policies(status);
    CREATE INDEX IF NOT EXISTS idx_policy_payments_policy ON policy_payments(policy_id);

    -- Fixed Expenses (recurring expenses like rent, school fees)
    CREATE TABLE IF NOT EXISTS fixed_expenses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'INR',
      frequency TEXT NOT NULL,
      due_day INTEGER,
      due_month INTEGER,
      beneficiary TEXT,
      account_number TEXT,
      for_whom TEXT,
      start_date TEXT,
      end_date TEXT,
      last_paid_date TEXT,
      next_due_date TEXT,
      status TEXT DEFAULT 'active',
      auto_pay_enabled INTEGER DEFAULT 0,
      auto_pay_account TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fixed_expense_payments (
      id TEXT PRIMARY KEY,
      expense_id TEXT NOT NULL,
      payment_date TEXT NOT NULL,
      amount REAL NOT NULL,
      for_period TEXT,
      payment_mode TEXT,
      reference_number TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_fixed_expenses_category ON fixed_expenses(category);
    CREATE INDEX IF NOT EXISTS idx_fixed_expenses_status ON fixed_expenses(status);
    CREATE INDEX IF NOT EXISTS idx_fixed_expense_payments_expense ON fixed_expense_payments(expense_id);

    -- Recurring Income (salary, rental income, dividends, etc.)
    CREATE TABLE IF NOT EXISTS recurring_income (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'INR',
      frequency TEXT NOT NULL,
      expected_day INTEGER,
      expected_month INTEGER,
      source TEXT,
      account_number TEXT,
      for_whom TEXT,
      start_date TEXT,
      end_date TEXT,
      last_received_date TEXT,
      next_expected_date TEXT,
      status TEXT DEFAULT 'active',
      auto_credit INTEGER DEFAULT 0,
      credit_account TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS income_receipts (
      id TEXT PRIMARY KEY,
      income_id TEXT NOT NULL,
      receipt_date TEXT NOT NULL,
      amount REAL NOT NULL,
      for_period TEXT,
      payment_mode TEXT,
      reference_number TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_recurring_income_category ON recurring_income(category);
    CREATE INDEX IF NOT EXISTS idx_recurring_income_status ON recurring_income(status);
    CREATE INDEX IF NOT EXISTS idx_income_receipts_income ON income_receipts(income_id);

    -- Gmail Integration tables
    CREATE TABLE IF NOT EXISTS gmail_connections (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expiry TEXT NOT NULL,
      scope TEXT,
      is_active INTEGER DEFAULT 1,
      last_sync_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gmail_sync_state (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      sync_type TEXT NOT NULL,
      status TEXT NOT NULL,
      last_history_id TEXT,
      processed_count INTEGER DEFAULT 0,
      matched_count INTEGER DEFAULT 0,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processed_emails (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      gmail_message_id TEXT NOT NULL UNIQUE,
      thread_id TEXT,
      from_address TEXT NOT NULL,
      subject TEXT,
      received_at TEXT NOT NULL,
      bank_name TEXT,
      parse_status TEXT NOT NULL,
      transaction_id TEXT,
      transaction_type TEXT,
      raw_content TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_gmail_connections_email ON gmail_connections(email);
    CREATE INDEX IF NOT EXISTS idx_gmail_connections_active ON gmail_connections(is_active);
    CREATE INDEX IF NOT EXISTS idx_gmail_sync_state_connection ON gmail_sync_state(connection_id);
    CREATE INDEX IF NOT EXISTS idx_gmail_sync_state_status ON gmail_sync_state(status);
    CREATE INDEX IF NOT EXISTS idx_processed_emails_connection ON processed_emails(connection_id);
    CREATE INDEX IF NOT EXISTS idx_processed_emails_message_id ON processed_emails(gmail_message_id);
    CREATE INDEX IF NOT EXISTS idx_processed_emails_status ON processed_emails(parse_status);

    -- Portfolio Snapshots for daily tracking
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      snapshot_time TEXT NOT NULL,
      bank_balance REAL DEFAULT 0,
      us_stocks_value REAL DEFAULT 0,
      india_stocks_value REAL DEFAULT 0,
      mutual_funds_value REAL DEFAULT 0,
      fd_value REAL DEFAULT 0,
      ppf_value REAL DEFAULT 0,
      gold_value REAL DEFAULT 0,
      crypto_value REAL DEFAULT 0,
      other_investments_value REAL DEFAULT 0,
      real_estate_value REAL DEFAULT 0,
      vehicles_value REAL DEFAULT 0,
      other_assets_value REAL DEFAULT 0,
      loans_given_value REAL DEFAULT 0,
      home_loan_outstanding REAL DEFAULT 0,
      car_loan_outstanding REAL DEFAULT 0,
      personal_loan_outstanding REAL DEFAULT 0,
      other_loans_outstanding REAL DEFAULT 0,
      credit_card_dues REAL DEFAULT 0,
      total_assets REAL DEFAULT 0,
      total_liabilities REAL DEFAULT 0,
      net_worth REAL DEFAULT 0,
      total_investments REAL DEFAULT 0,
      total_physical_assets REAL DEFAULT 0,
      day_change_amount REAL DEFAULT 0,
      day_change_percent REAL DEFAULT 0,
      is_manual_capture INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user_date ON portfolio_snapshots(user_id, snapshot_date);
    CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_date ON portfolio_snapshots(snapshot_date);

    -- Learned statement templates
    CREATE TABLE IF NOT EXISTS learned_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      institution TEXT NOT NULL,
      statement_type TEXT NOT NULL,
      file_type TEXT NOT NULL,
      detection_patterns TEXT NOT NULL,
      field_mappings TEXT NOT NULL,
      sample_headers TEXT,
      sample_rows TEXT,
      is_active INTEGER DEFAULT 1,
      confidence_score REAL DEFAULT 0,
      times_used INTEGER DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_learned_templates_user ON learned_templates(user_id);
    CREATE INDEX IF NOT EXISTS idx_learned_templates_active ON learned_templates(is_active);

    -- Template learning sessions
    CREATE TABLE IF NOT EXISTS template_learning_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      template_id TEXT,
      status TEXT DEFAULT 'extracting',
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT,
      extracted_fields TEXT,
      suggested_mappings TEXT,
      final_mappings TEXT,
      detected_patterns TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_template_learning_sessions_user ON template_learning_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_template_learning_sessions_status ON template_learning_sessions(status);
  `);

  // Add currency column if it doesn't exist (migration for existing DBs)
  try {
    sqlite.exec(`ALTER TABLE loan_given_details ADD COLUMN currency TEXT DEFAULT 'INR'`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Migration: Add new columns to credit_card_transactions for HDFC Infinia support
  const ccMigrations = [
    'ALTER TABLE credit_card_transactions ADD COLUMN card_holder_name TEXT',
    'ALTER TABLE credit_card_transactions ADD COLUMN is_emi INTEGER DEFAULT 0',
    'ALTER TABLE credit_card_transactions ADD COLUMN emi_tenure INTEGER',
    'ALTER TABLE credit_card_transactions ADD COLUMN reward_points INTEGER DEFAULT 0',
    'ALTER TABLE credit_card_transactions ADD COLUMN merchant_location TEXT',
    'ALTER TABLE credit_card_transactions ADD COLUMN transaction_time TEXT',
    'ALTER TABLE credit_card_transactions ADD COLUMN pi_category TEXT',
    'ALTER TABLE credit_card_transactions ADD COLUMN statement_id TEXT',
  ];
  for (const migration of ccMigrations) {
    try {
      sqlite.exec(migration);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  // Migration: Add credit card specific fields to accounts
  const accountMigrations = [
    'ALTER TABLE accounts ADD COLUMN card_name TEXT',
    'ALTER TABLE accounts ADD COLUMN card_network TEXT',
    'ALTER TABLE accounts ADD COLUMN card_image TEXT',
    'ALTER TABLE accounts ADD COLUMN card_holder_name TEXT',
  ];
  for (const migration of accountMigrations) {
    try {
      sqlite.exec(migration);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  // Create indexes for new credit card columns (after migrations add the columns)
  const ccIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_credit_card_transactions_date ON credit_card_transactions(date)',
    'CREATE INDEX IF NOT EXISTS idx_credit_card_transactions_statement ON credit_card_transactions(statement_id)',
    'CREATE INDEX IF NOT EXISTS idx_credit_card_transactions_holder ON credit_card_transactions(card_holder_name)',
    'CREATE INDEX IF NOT EXISTS idx_credit_card_statements_account ON credit_card_statements(account_id)',
    'CREATE INDEX IF NOT EXISTS idx_credit_card_statements_date ON credit_card_statements(statement_date)',
    'CREATE INDEX IF NOT EXISTS idx_card_holders_account ON card_holders(account_id)',
  ];
  for (const idx of ccIndexes) {
    try {
      sqlite.exec(idx);
    } catch (e) {
      // Index might already exist or table doesn't exist yet, ignore
    }
  }

  // Migration: Add user_id column to all data tables for multi-user support
  const userIdMigrations = [
    'ALTER TABLE accounts ADD COLUMN user_id TEXT',
    'ALTER TABLE bank_transactions ADD COLUMN user_id TEXT',
    'ALTER TABLE vyapar_transactions ADD COLUMN user_id TEXT',
    'ALTER TABLE vyapar_item_details ADD COLUMN user_id TEXT',
    'ALTER TABLE credit_card_transactions ADD COLUMN user_id TEXT',
    'ALTER TABLE credit_card_statements ADD COLUMN user_id TEXT',
    'ALTER TABLE card_holders ADD COLUMN user_id TEXT',
    'ALTER TABLE investments ADD COLUMN user_id TEXT',
    'ALTER TABLE investment_history ADD COLUMN user_id TEXT',
    'ALTER TABLE loans ADD COLUMN user_id TEXT',
    'ALTER TABLE loan_payments ADD COLUMN user_id TEXT',
    'ALTER TABLE loan_disbursements ADD COLUMN user_id TEXT',
    'ALTER TABLE loan_schedule ADD COLUMN user_id TEXT',
    'ALTER TABLE loan_given_details ADD COLUMN user_id TEXT',
    'ALTER TABLE uploads ADD COLUMN user_id TEXT',
    'ALTER TABLE categories ADD COLUMN user_id TEXT',
    'ALTER TABLE reconciliation_matches ADD COLUMN user_id TEXT',
    'ALTER TABLE mutual_fund_folios ADD COLUMN user_id TEXT',
    'ALTER TABLE mutual_fund_holdings ADD COLUMN user_id TEXT',
    'ALTER TABLE mutual_fund_transactions ADD COLUMN user_id TEXT',
    'ALTER TABLE mutual_fund_nav_history ADD COLUMN user_id TEXT',
    'ALTER TABLE assets ADD COLUMN user_id TEXT',
    'ALTER TABLE policies ADD COLUMN user_id TEXT',
    'ALTER TABLE policy_payments ADD COLUMN user_id TEXT',
    'ALTER TABLE fixed_expenses ADD COLUMN user_id TEXT',
    'ALTER TABLE fixed_expense_payments ADD COLUMN user_id TEXT',
    'ALTER TABLE recurring_income ADD COLUMN user_id TEXT',
    'ALTER TABLE income_receipts ADD COLUMN user_id TEXT',
    'ALTER TABLE gmail_connections ADD COLUMN user_id TEXT',
    'ALTER TABLE gmail_sync_state ADD COLUMN user_id TEXT',
    'ALTER TABLE processed_emails ADD COLUMN user_id TEXT',
  ];
  for (const migration of userIdMigrations) {
    try {
      sqlite.exec(migration);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  // Migration: Add extended account fields for smart import
  const accountExtendedMigrations = [
    'ALTER TABLE accounts ADD COLUMN sweep_balance REAL DEFAULT 0',
    'ALTER TABLE accounts ADD COLUMN linked_fd_account TEXT',
    'ALTER TABLE accounts ADD COLUMN ifsc_code TEXT',
    'ALTER TABLE accounts ADD COLUMN branch_name TEXT',
    'ALTER TABLE accounts ADD COLUMN account_holder_name TEXT',
    'ALTER TABLE accounts ADD COLUMN address TEXT',
    'ALTER TABLE accounts ADD COLUMN account_status TEXT',
  ];
  for (const migration of accountExtendedMigrations) {
    try {
      sqlite.exec(migration);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  // Migration: Add GearUp Mods business account flag
  try {
    sqlite.exec('ALTER TABLE accounts ADD COLUMN is_gearup_business INTEGER DEFAULT 0');
  } catch (e) {
    // Column already exists, ignore
  }

  // Migration: Add reconciliation fingerprint fields to vyapar_transactions
  const vyaparFingerprintMigrations = [
    'ALTER TABLE vyapar_transactions ADD COLUMN matched_bank_date TEXT',
    'ALTER TABLE vyapar_transactions ADD COLUMN matched_bank_amount REAL',
    'ALTER TABLE vyapar_transactions ADD COLUMN matched_bank_narration TEXT',
    'ALTER TABLE vyapar_transactions ADD COLUMN matched_bank_account_id TEXT',
  ];
  for (const migration of vyaparFingerprintMigrations) {
    try {
      sqlite.exec(migration);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  // Create indexes for user_id columns
  const userIdIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_bank_transactions_user_id ON bank_transactions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_vyapar_transactions_user_id ON vyapar_transactions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_credit_card_transactions_user_id ON credit_card_transactions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_investments_user_id ON investments(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_loans_user_id ON loans(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON uploads(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_mutual_fund_folios_user_id ON mutual_fund_folios(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_assets_user_id ON assets(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_policies_user_id ON policies(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_fixed_expenses_user_id ON fixed_expenses(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_recurring_income_user_id ON recurring_income(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_gmail_connections_user_id ON gmail_connections(user_id)',
  ];
  for (const idx of userIdIndexes) {
    try {
      sqlite.exec(idx);
    } catch (e) {
      // Index might already exist, ignore
    }
  }

  // Migration: Add business accounting fields to bank_transactions (ASG Technologies)
  const businessAccountingMigrations = [
    'ALTER TABLE bank_transactions ADD COLUMN biz_type TEXT',
    'ALTER TABLE bank_transactions ADD COLUMN biz_description TEXT',
    'ALTER TABLE bank_transactions ADD COLUMN vendor_name TEXT',
    'ALTER TABLE bank_transactions ADD COLUMN needs_invoice INTEGER DEFAULT 0',
    'ALTER TABLE bank_transactions ADD COLUMN invoice_file_id TEXT',
    'ALTER TABLE bank_transactions ADD COLUMN gst_amount REAL',
    'ALTER TABLE bank_transactions ADD COLUMN cgst_amount REAL',
    'ALTER TABLE bank_transactions ADD COLUMN sgst_amount REAL',
    'ALTER TABLE bank_transactions ADD COLUMN igst_amount REAL',
    'ALTER TABLE bank_transactions ADD COLUMN gst_type TEXT',
  ];
  for (const migration of businessAccountingMigrations) {
    try {
      sqlite.exec(migration);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  // Create business_invoices table for invoice attachments
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS business_invoices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      invoice_date TEXT,
      invoice_number TEXT,
      vendor_name TEXT,
      total_amount REAL,
      gst_amount REAL,
      notes TEXT,
      created_at TEXT NOT NULL
    )
  `);

  // Migration: Add new GST columns to business_invoices
  const businessInvoicesMigrations = [
    'ALTER TABLE business_invoices ADD COLUMN party_name TEXT',
    'ALTER TABLE business_invoices ADD COLUMN party_gstin TEXT',
    'ALTER TABLE business_invoices ADD COLUMN gst_type TEXT',
    'ALTER TABLE business_invoices ADD COLUMN taxable_amount REAL',
    'ALTER TABLE business_invoices ADD COLUMN cgst_amount REAL',
    'ALTER TABLE business_invoices ADD COLUMN sgst_amount REAL',
    'ALTER TABLE business_invoices ADD COLUMN igst_amount REAL',
    'ALTER TABLE business_invoices ADD COLUMN updated_at TEXT',
    'ALTER TABLE business_invoices ADD COLUMN document_type TEXT',
    'ALTER TABLE business_invoices ADD COLUMN is_estimate INTEGER DEFAULT 0',
  ];
  for (const migration of businessInvoicesMigrations) {
    try {
      sqlite.exec(migration);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  // Make transaction_id, filename, etc. nullable (for external invoices)
  // SQLite doesn't support ALTER COLUMN, so we recreate the table
  try {
    // Check if we need to migrate (if transaction_id has NOT NULL constraint)
    const tableInfo = sqlite.prepare("PRAGMA table_info(business_invoices)").all() as any[];
    const txIdColumn = tableInfo.find((c: any) => c.name === 'transaction_id');

    if (txIdColumn && txIdColumn.notnull === 1) {
      console.log('Migrating business_invoices to make columns nullable...');

      sqlite.exec(`
        -- Create new table with nullable columns
        CREATE TABLE business_invoices_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          transaction_id TEXT,
          filename TEXT,
          original_name TEXT,
          mime_type TEXT,
          size INTEGER,
          invoice_date TEXT,
          invoice_number TEXT,
          vendor_name TEXT,
          total_amount REAL,
          gst_amount REAL,
          notes TEXT,
          created_at TEXT NOT NULL,
          party_name TEXT,
          party_gstin TEXT,
          gst_type TEXT,
          taxable_amount REAL,
          cgst_amount REAL,
          sgst_amount REAL,
          igst_amount REAL,
          updated_at TEXT,
          document_type TEXT,
          is_estimate INTEGER DEFAULT 0
        );

        -- Copy existing data
        INSERT INTO business_invoices_new
        SELECT id, user_id, transaction_id, filename, original_name, mime_type, size,
               invoice_date, invoice_number, vendor_name, total_amount, gst_amount, notes, created_at,
               party_name, party_gstin, gst_type, taxable_amount, cgst_amount, sgst_amount, igst_amount, updated_at,
               document_type, is_estimate
        FROM business_invoices;

        -- Drop old table and rename new one
        DROP TABLE business_invoices;
        ALTER TABLE business_invoices_new RENAME TO business_invoices;
      `);

      console.log('Migration complete: business_invoices columns are now nullable');
    }
  } catch (e) {
    // Migration failed or already done, continue
    console.log('business_invoices migration check:', (e as Error).message);
  }

  // Create enrichment_rules table for learned auto-enrichment patterns
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS enrichment_rules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      pattern_type TEXT NOT NULL,
      pattern_value TEXT NOT NULL,
      biz_type TEXT,
      biz_description TEXT,
      vendor_name TEXT,
      needs_invoice INTEGER,
      gst_type TEXT,
      match_count INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_enrichment_rules_user_id ON enrichment_rules(user_id);
    CREATE INDEX IF NOT EXISTS idx_enrichment_rules_pattern ON enrichment_rules(pattern_type, pattern_value);
  `);

  // Create reconciliation_rules table for learned bank-to-vyapar mappings
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS reconciliation_rules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      bank_pattern_type TEXT NOT NULL,
      bank_pattern_value TEXT NOT NULL,
      vyapar_party_name TEXT NOT NULL,
      match_count INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reconciliation_rules_user_id ON reconciliation_rules(user_id);
    CREATE INDEX IF NOT EXISTS idx_reconciliation_rules_pattern ON reconciliation_rules(bank_pattern_type, bank_pattern_value);
  `);

  // Create indexes for business accounting
  const businessAccountingIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_bank_transactions_biz_type ON bank_transactions(biz_type)',
    'CREATE INDEX IF NOT EXISTS idx_bank_transactions_vendor_name ON bank_transactions(vendor_name)',
    'CREATE INDEX IF NOT EXISTS idx_bank_transactions_needs_invoice ON bank_transactions(needs_invoice)',
    'CREATE INDEX IF NOT EXISTS idx_business_invoices_user_id ON business_invoices(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_business_invoices_transaction_id ON business_invoices(transaction_id)',
  ];
  for (const idx of businessAccountingIndexes) {
    try {
      sqlite.exec(idx);
    } catch (e) {
      // Index might already exist, ignore
    }
  }

  // Migration: Add source column to credit_card_transactions for tracking Gmail vs Statement
  try {
    sqlite.exec("ALTER TABLE credit_card_transactions ADD COLUMN source TEXT DEFAULT 'statement'");
    console.log('Migration: Added source column to credit_card_transactions');
  } catch (e) {
    // Column already exists, ignore
  }

  // Update existing transactions to have source based on notes containing [Gmail Sync]
  try {
    sqlite.exec(`
      UPDATE credit_card_transactions
      SET source = 'gmail'
      WHERE notes LIKE '%[Gmail Sync]%' AND (source IS NULL OR source = 'statement')
    `);
  } catch (e) {
    // Ignore errors
  }

  // Seed default categories if none exist
  const categoryCount = sqlite.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number };
  if (categoryCount.count === 0) {
    const now = new Date().toISOString();
    const insertCategory = sqlite.prepare(`
      INSERT INTO categories (id, name, type, icon, color, is_system, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `);

    for (const cat of categoriesSchema.defaultCategories) {
      insertCategory.run(uuidv4(), cat.name, cat.type, cat.icon, cat.color, now, now);
    }
    console.log('Default categories seeded');
  }

  console.log('Database initialized');
}

// Export schema
export * from './schema/users.js';
export * from './schema/accounts.js';
export * from './schema/transactions.js';
export * from './schema/vyapar.js';
export * from './schema/credit-cards.js';
export * from './schema/investments.js';
export * from './schema/loans.js';
export * from './schema/uploads.js';
export * from './schema/categories.js';
export * from './schema/reconciliation.js';
export * from './schema/mutual-funds.js';
export * from './schema/assets.js';
export * from './schema/fixed-expenses.js';
export * from './schema/recurring-income.js';
export * from './schema/gmail-integration.js';
export * from './schema/portfolio-snapshots.js';
export * from './schema/templates.js';
export * from './schema/business-invoices.js';
export * from './schema/enrichment-rules.js';
export * from './schema/reconciliation-rules.js';

// Export sqlite for direct queries
export { sqlite };

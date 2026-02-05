import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

// Physical Assets - Houses, Land, Vehicles, etc.
export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  userId: text('user_id'),

  // Basic info
  name: text('name').notNull(), // e.g., "Flat in Gurgaon", "Plot in Noida"
  type: text('type').notNull(), // house, apartment, land, vehicle, gold, other
  description: text('description'),

  // Location (for property)
  address: text('address'),
  city: text('city'),
  state: text('state'),
  country: text('country').default('India'),

  // Property specific
  area: real('area'), // sq ft or sq m
  areaUnit: text('area_unit').default('sqft'), // sqft, sqm, acres
  registrationNumber: text('registration_number'),

  // Financial
  purchaseDate: text('purchase_date'),
  purchaseValue: real('purchase_value').notNull(),
  currentValue: real('current_value'),
  lastValuationDate: text('last_valuation_date'),
  currency: text('currency').default('INR'),

  // Linked loan (if any)
  linkedLoanId: text('linked_loan_id'), // FK to loans table

  // Ownership
  ownershipType: text('ownership_type').default('self'), // self, joint, family
  ownershipPercentage: real('ownership_percentage').default(100),
  coOwners: text('co_owners'), // JSON array of co-owner names

  // Documents
  documentsPath: text('documents_path'), // Path to uploaded documents

  // Status
  status: text('status').default('owned'), // owned, sold, under_construction

  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

// Insurance Policies
export const policies = sqliteTable('policies', {
  id: text('id').primaryKey(),
  userId: text('user_id'),

  // Basic info
  name: text('name').notNull(), // e.g., "LIC Term Plan", "HDFC Health Insurance"
  type: text('type').notNull(), // life, term, health, vehicle, home, travel, other
  provider: text('provider').notNull(), // Insurance company name

  // Policy details
  policyNumber: text('policy_number'),
  policyHolder: text('policy_holder'),

  // Coverage
  sumAssured: real('sum_assured'), // Life/Term coverage amount
  coverageAmount: real('coverage_amount'), // Health coverage amount
  coverageDetails: text('coverage_details'), // JSON - room rent, critical illness, etc.

  // Premium
  premiumAmount: real('premium_amount'),
  premiumFrequency: text('premium_frequency'), // monthly, quarterly, half_yearly, yearly, one_time
  nextPremiumDate: text('next_premium_date'),
  totalPremiumPaid: real('total_premium_paid').default(0),

  // Dates
  startDate: text('start_date'),
  endDate: text('end_date'), // Maturity date
  policyTerm: integer('policy_term'), // Term in years

  // Nominees
  nominees: text('nominees'), // JSON array of {name, relation, percentage}

  // Benefits
  maturityBenefit: real('maturity_benefit'),
  deathBenefit: real('death_benefit'),
  bonusAccrued: real('bonus_accrued'),

  // For health insurance
  familyMembers: text('family_members'), // JSON array of covered members
  waitingPeriod: text('waiting_period'),

  // Linked asset (for vehicle/home insurance)
  linkedAssetId: text('linked_asset_id'),

  // Documents
  documentsPath: text('documents_path'),

  // Status
  status: text('status').default('active'), // active, lapsed, matured, surrendered, claimed

  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type Policy = typeof policies.$inferSelect;
export type NewPolicy = typeof policies.$inferInsert;

// Policy premium payments tracking
export const policyPayments = sqliteTable('policy_payments', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  policyId: text('policy_id').notNull(),

  paymentDate: text('payment_date').notNull(),
  amount: real('amount').notNull(),
  paymentMode: text('payment_mode'), // online, cheque, cash, auto_debit
  referenceNumber: text('reference_number'),
  receiptPath: text('receipt_path'), // Path to uploaded receipt

  notes: text('notes'),
  createdAt: text('created_at').notNull(),
});

export type PolicyPayment = typeof policyPayments.$inferSelect;
export type NewPolicyPayment = typeof policyPayments.$inferInsert;

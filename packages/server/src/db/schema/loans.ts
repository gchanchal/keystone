import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

export const loans = sqliteTable('loans', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  type: text('type').notNull(), // given, taken, home_loan, car_loan, personal_loan
  loanType: text('loan_type'), // home, car, personal, business, education
  partyName: text('party_name').notNull(), // Lender name (e.g., "Axis Bank")
  borrowerName: text('borrower_name'), // Primary borrower
  coBorrowerName: text('co_borrower_name'), // Co-applicant

  // Loan identifiers
  agreementNumber: text('agreement_number'),
  applicationNumber: text('application_number'),

  // Amounts
  sanctionedAmount: real('sanctioned_amount'), // Total sanctioned
  disbursedAmount: real('disbursed_amount'), // Total disbursed
  principalAmount: real('principal_amount').notNull(), // Current principal
  outstandingAmount: real('outstanding_amount').notNull(),

  // Interest
  interestRate: real('interest_rate').default(0),
  interestType: text('interest_type'), // fixed, floating

  // EMI details
  emiAmount: real('emi_amount'),
  emiStartDate: text('emi_start_date'),
  totalInstallments: integer('total_installments'),
  paidInstallments: integer('paid_installments').default(0),
  pendingInstallments: integer('pending_installments'),

  // Payment tracking
  totalPrincipalPaid: real('total_principal_paid').default(0),
  totalInterestPaid: real('total_interest_paid').default(0),
  totalChargesPaid: real('total_charges_paid').default(0),

  // Dates
  startDate: text('start_date').notNull(),
  disbursalDate: text('disbursal_date'),
  dueDate: text('due_date'),
  maturityDate: text('maturity_date'),

  // Property details (for home loans)
  propertyAddress: text('property_address'),
  propertyType: text('property_type'), // apartment, villa, plot

  // Bank details
  repaymentBank: text('repayment_bank'),
  repaymentMode: text('repayment_mode'), // SI, PDC, NACH

  // Status
  status: text('status').default('active'), // active, closed, defaulted
  lastPaidDate: text('last_paid_date'), // Track when current month EMI was marked as paid

  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const loanPayments = sqliteTable('loan_payments', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  loanId: text('loan_id').notNull(),
  date: text('date').notNull(),
  valueDate: text('value_date'),

  // Transaction details
  transactionType: text('transaction_type').notNull(), // emi, pre_emi_interest, disbursement, charge, prepayment
  particulars: text('particulars'), // Original description from statement
  installmentNumber: integer('installment_number'),

  // Amounts
  amount: real('amount').notNull(),
  principalPaid: real('principal_paid').default(0),
  interestPaid: real('interest_paid').default(0),
  chargesPaid: real('charges_paid').default(0),

  // For disbursements
  disbursementAmount: real('disbursement_amount'),

  // Reference
  referenceNumber: text('reference_number'),
  paymentMode: text('payment_mode'), // SI, cheque, transfer

  notes: text('notes'),
  createdAt: text('created_at').notNull(),
});

// Loan disbursements tracking (for construction-linked loans)
export const loanDisbursements = sqliteTable('loan_disbursements', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  loanId: text('loan_id').notNull(),
  date: text('date').notNull(),
  amount: real('amount').notNull(),
  purpose: text('purpose'), // construction_stage, final_disbursement
  referenceNumber: text('reference_number'),
  runningTotal: real('running_total'), // Total disbursed after this
  createdAt: text('created_at').notNull(),
});

export type Loan = typeof loans.$inferSelect;
export type NewLoan = typeof loans.$inferInsert;
export type LoanPayment = typeof loanPayments.$inferSelect;
export type NewLoanPayment = typeof loanPayments.$inferInsert;
export type LoanDisbursement = typeof loanDisbursements.$inferSelect;
export type NewLoanDisbursement = typeof loanDisbursements.$inferInsert;

// Loan repayment schedule (future EMIs)
export const loanSchedule = sqliteTable('loan_schedule', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  loanId: text('loan_id').notNull(),
  installmentNumber: integer('installment_number').notNull(),
  dueDate: text('due_date').notNull(),
  openingPrincipal: real('opening_principal').notNull(),
  installmentAmount: real('installment_amount').notNull(),
  principalAmount: real('principal_amount').notNull(),
  interestAmount: real('interest_amount').notNull(),
  closingPrincipal: real('closing_principal').notNull(),
  interestRate: real('interest_rate').notNull(),
  status: text('status').default('pending'), // pending, paid, overdue, partial
  actualPaymentDate: text('actual_payment_date'),
  actualAmountPaid: real('actual_amount_paid'),
  createdAt: text('created_at').notNull(),
});

export type LoanSchedule = typeof loanSchedule.$inferSelect;
export type NewLoanSchedule = typeof loanSchedule.$inferInsert;

// Loan Given Details - tracking individual transactions for loans given
export const loanGivenDetails = sqliteTable('loan_given_details', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  loanId: text('loan_id').notNull(),
  particular: text('particular').notNull(),
  toGet: real('to_get').default(0), // Amount to receive
  toGive: real('to_give').default(0), // Amount to give
  currency: text('currency').default('INR'), // INR or USD
  details: text('details'),
  date: text('date').notNull(),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
});

export type LoanGivenDetail = typeof loanGivenDetails.$inferSelect;
export type NewLoanGivenDetail = typeof loanGivenDetails.$inferInsert;

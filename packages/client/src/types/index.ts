export interface User {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthStatus {
  authenticated: boolean;
  user?: User;
}

export interface Account {
  id: string;
  name: string;
  bankName: string;
  accountNumber: string | null;
  accountType: 'savings' | 'current' | 'credit_card' | 'loan';
  currency: string;
  openingBalance: number;
  currentBalance: number;
  isActive: boolean;
  // Bank account metadata
  ifscCode: string | null;
  branchName: string | null;
  accountHolderName: string | null;
  address: string | null;
  accountStatus: string | null;
  // Credit card specific fields
  cardName: string | null;
  cardNetwork: string | null;
  cardHolderName: string | null;
  cardImage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BankTransaction {
  id: string;
  accountId: string;
  date: string;
  valueDate: string | null;
  narration: string;
  reference: string | null;
  transactionType: 'credit' | 'debit';
  amount: number;
  balance: number | null;
  categoryId: string | null;
  notes: string | null;
  isReconciled: boolean;
  reconciledWithId: string | null;
  reconciledWithType: string | null;
  uploadId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VyaparTransaction {
  id: string;
  date: string;
  invoiceNumber: string | null;
  transactionType: string;
  partyName: string | null;
  categoryName: string | null;
  paymentType: string | null;
  amount: number;
  balance: number | null;
  description: string | null;
  isReconciled: boolean;
  reconciledWithId: string | null;
  uploadId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreditCardTransaction {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amount: number;
  transactionType: 'credit' | 'debit';
  categoryId: string | null;
  notes: string | null;
  isReconciled: boolean;
  reconciledWithId: string | null;
  uploadId: string | null;
  // HDFC Infinia specific fields
  cardHolderName: string | null;
  isEmi: boolean;
  emiTenure: number | null;
  rewardPoints: number;
  merchantLocation: string | null;
  transactionTime: string | null;
  piCategory: string | null;
  statementId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreditCardStatement {
  id: string;
  accountId: string;
  statementDate: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  dueDate: string;
  totalDue: number;
  minimumDue: number;
  creditLimit: number | null;
  availableLimit: number | null;
  rewardPointsBalance: number | null;
  rewardPointsEarned: number | null;
  rewardPointsRedeemed: number | null;
  cashbackEarned: number | null;
  openingBalance: number | null;
  closingBalance: number | null;
  totalCredits: number | null;
  totalDebits: number | null;
  financeCharges: number | null;
  uploadId: string | null;
  createdAt: string;
}

export interface CardHolder {
  id: string;
  accountId: string;
  name: string;
  isPrimary: boolean;
  cardLastFour: string | null;
  createdAt: string;
}

export interface CreditCardAccountSummary extends Account {
  outstanding: number;
  creditLimit: number;
  availableLimit: number;
  rewardPoints: number;
  dueDate: string | null;
  minimumDue: number;
  cardHolders: CardHolder[];
  latestStatement: CreditCardStatement | null;
}

export interface CreditCardsSummary {
  totalOutstanding: number;
  totalAvailableLimit: number;
  totalCreditLimit: number;
  totalRewardPoints: number;
  nextDueDate: string | null;
  nextDueAmount: number;
  accounts: CreditCardAccountSummary[];
}

export interface CreditCardAnalytics {
  categorySpend: Array<{
    category: string;
    total: number;
    count: number;
    percentage: number;
  }>;
  holderSpend: Array<{
    cardHolder: string;
    total: number;
    count: number;
  }>;
  monthlyTrends: Array<{
    month: string;
    spend: number;
    payments: number;
    transactionCount: number;
  }>;
  topMerchants: Array<{
    merchant: string;
    total: number;
    count: number;
  }>;
  emiSummary: Array<{
    merchant: string;
    emiTenure: number | null;
    totalAmount: number;
    transactionCount: number;
  }>;
  rewardsSummary: {
    totalEarned: number;
    totalRedeemed: number;
  };
  totalSpend: number;
}

export interface Category {
  id: string;
  name: string;
  type: 'income' | 'expense';
  icon: string | null;
  color: string | null;
  parentId: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Investment {
  id: string;
  name: string;
  type: string;
  symbol: string | null;
  platform: string | null;
  country: 'IN' | 'US'; // IN = India (₹), US = United States ($)
  quantity: number;
  purchasePrice: number;
  purchaseDate: string;
  currentPrice: number | null;
  currentValue: number | null;
  lastUpdated: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Loan {
  id: string;
  type: 'given' | 'taken';
  loanType?: 'home' | 'car' | 'personal' | 'business' | 'education' | null;
  partyName: string;
  borrowerName?: string | null;
  coBorrowerName?: string | null;
  agreementNumber?: string | null;
  applicationNumber?: string | null;
  sanctionedAmount?: number | null;
  disbursedAmount?: number | null;
  principalAmount: number;
  outstandingAmount: number;
  interestRate: number;
  interestType?: 'fixed' | 'floating' | null;
  emiAmount?: number | null;
  emiStartDate?: string | null;
  totalInstallments?: number | null;
  paidInstallments?: number | null;
  pendingInstallments?: number | null;
  totalPrincipalPaid?: number | null;
  totalInterestPaid?: number | null;
  totalChargesPaid?: number | null;
  startDate: string;
  disbursalDate?: string | null;
  dueDate: string | null;
  maturityDate?: string | null;
  propertyAddress?: string | null;
  propertyType?: string | null;
  repaymentBank?: string | null;
  repaymentMode?: string | null;
  lastPaidDate?: string | null;
  status: 'active' | 'closed' | 'defaulted';
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoanPayment {
  id: string;
  loanId: string;
  date: string;
  valueDate?: string | null;
  transactionType: string;
  particulars?: string | null;
  installmentNumber?: number | null;
  amount: number;
  principalPaid: number | null;
  interestPaid: number | null;
  chargesPaid?: number | null;
  disbursementAmount?: number | null;
  referenceNumber?: string | null;
  paymentMode?: string | null;
  notes: string | null;
  createdAt: string;
}

export interface LoanDisbursement {
  id: string;
  loanId: string;
  date: string;
  amount: number;
  purpose?: string | null;
  referenceNumber?: string | null;
  runningTotal?: number | null;
  createdAt: string;
}

export interface LoanSchedule {
  id: string;
  loanId: string;
  installmentNumber: number;
  dueDate: string;
  openingPrincipal: number;
  installmentAmount: number;
  principalAmount: number;
  interestAmount: number;
  closingPrincipal: number;
  interestRate: number;
  status: 'pending' | 'paid' | 'overdue' | 'partial';
  actualPaymentDate?: string | null;
  actualAmountPaid?: number | null;
  createdAt: string;
}

export interface LoanGivenDetail {
  id: string;
  loanId: string;
  particular: string;
  toGet: number;
  toGive: number;
  currency: 'INR' | 'USD';
  details: string | null;
  date: string;
  notes: string | null;
  createdAt: string;
}

export interface Upload {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadType: string;
  bankName: string | null;
  accountId: string | null;
  status: string;
  transactionCount: number;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface DashboardStats {
  totalBalance: number;
  monthlyIncome: number;
  monthlyExpense: number;
  netProfit: number;
  unreconciledCount: number;
}

export interface CashFlowData {
  month: string;
  income: number;
  expense: number;
}

export interface ExpenseBreakdown {
  category: string;
  amount: number;
  percentage: number;
  color: string;
}

export interface ReconciliationMatch {
  bankTransactionId: string;
  vyaparTransactionId: string;
  confidence: number;
  matchType: 'exact' | 'date_fuzzy' | 'party_fuzzy';
  bankAmount: number;
  vyaparAmount: number;
  bankDate: string;
  vyaparDate: string;
}

// Physical Assets (Houses, Land, Vehicles, etc.)
export interface Asset {
  id: string;
  name: string;
  type: 'house' | 'apartment' | 'land' | 'vehicle' | 'gold' | 'other';
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  area: number | null;
  areaUnit: 'sqft' | 'sqm' | 'acres' | null;
  registrationNumber: string | null;
  purchaseDate: string | null;
  purchaseValue: number;
  currentValue: number | null;
  lastValuationDate: string | null;
  currency: string | null;
  linkedLoanId: string | null;
  linkedLoan?: Loan | null;
  ownershipType: 'self' | 'joint' | 'family' | null;
  ownershipPercentage: number | null;
  coOwners: string | null;
  status: 'owned' | 'sold' | 'under_construction' | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// Insurance Policies
export interface Policy {
  id: string;
  name: string;
  type: 'life' | 'term' | 'health' | 'vehicle' | 'home' | 'travel' | 'other';
  provider: string;
  policyNumber: string | null;
  policyHolder: string | null;
  sumAssured: number | null;
  coverageAmount: number | null;
  coverageDetails: string | null;
  premiumAmount: number | null;
  premiumFrequency: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'one_time' | null;
  nextPremiumDate: string | null;
  totalPremiumPaid: number | null;
  startDate: string | null;
  endDate: string | null;
  policyTerm: number | null;
  nominees: string | null;
  maturityBenefit: number | null;
  deathBenefit: number | null;
  bonusAccrued: number | null;
  familyMembers: string | null;
  waitingPeriod: string | null;
  linkedAssetId: string | null;
  status: 'active' | 'lapsed' | 'matured' | 'surrendered' | 'claimed' | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  payments?: PolicyPayment[];
}

export interface PolicyPayment {
  id: string;
  policyId: string;
  paymentDate: string;
  amount: number;
  paymentMode: string | null;
  referenceNumber: string | null;
  notes: string | null;
  createdAt: string;
}

// Gmail Integration Types
export interface GmailConnection {
  id: string;
  email: string;
  isActive: boolean;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GmailSyncState {
  id: string;
  connectionId: string;
  syncType: 'historical' | 'incremental';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  lastHistoryId: string | null;
  processedCount: number;
  matchedCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ProcessedEmail {
  id: string;
  gmailMessageId: string;
  fromAddress: string;
  subject: string | null;
  receivedAt: string;
  bankName: string | null;
  parseStatus: 'success' | 'failed' | 'skipped';
  transactionId: string | null;
  transactionType: 'bank' | 'credit_card' | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface SyncResult {
  syncId: string;
  status: 'completed' | 'failed';
  processedCount: number;
  matchedCount: number;
  newTransactions: number;
  duplicates: number;
  errors: number;
  errorMessage?: string;
}

export interface GmailConfig {
  configured: boolean;
  supportedBanks: string[];
}

export type SupportedBank = 'HDFC' | 'ICICI' | 'Kotak' | 'Axis';

// Business Accounting Types (ASG Technologies)
export type BizType = 'SALARY' | 'PETROL' | 'PORTER' | 'HELPER' | 'VENDOR' | 'SALES_INCOME' | 'OTHER';

export interface BusinessTransaction extends BankTransaction {
  bizType: BizType | null;
  bizDescription: string | null;
  vendorName: string | null;
  needsInvoice: boolean;
  invoiceFileId: string | null;
  gstAmount: number | null;
  cgstAmount: number | null;
  sgstAmount: number | null;
  igstAmount: number | null;
  gstType: 'input' | 'output' | null;
}

export interface BusinessInvoice {
  id: string;
  userId: string;
  transactionId: string | null; // NULL for external invoices
  filename: string | null;
  originalName: string | null;
  mimeType: string | null;
  size: number | null;
  invoiceDate: string | null;
  invoiceNumber: string | null;
  partyName: string | null;
  partyGstin: string | null;
  vendorName: string | null; // Legacy
  gstType: 'input' | 'output' | null;
  taxableAmount: number | null;
  cgstAmount: number | null;
  sgstAmount: number | null;
  igstAmount: number | null;
  gstAmount: number | null;
  totalAmount: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface GSTTotals {
  count: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
  totalAmount: number;
}

export interface GSTLedger {
  inputTotals: GSTTotals;
  outputTotals: GSTTotals;
  netLiability: {
    cgst: number;
    sgst: number;
    igst: number;
    total: number;
    status: 'payable' | 'credit';
  };
  months: Array<{
    month: string;
    input: GSTTotals;
    output: GSTTotals;
    net: number;
  }>;
  inputInvoices: BusinessInvoice[];
  outputInvoices: BusinessInvoice[];
}

export interface VendorSummary {
  vendorName: string;
  totalAmount: number;
  transactionCount: number;
  lastPaymentDate: string;
  invoiceCount: number;
}

export interface VendorPaymentHistory {
  month: string;
  totalAmount: number;
  transactionCount: number;
}

export interface GSTMonthlySummary {
  month: string;
  input: number;
  output: number;
  inputCount: number;
  outputCount: number;
  net: number;
}

export interface GSTSummary {
  months: GSTMonthlySummary[];
  totals: {
    input: number;
    output: number;
    net: number;
  };
}

export interface BusinessAccountingSummary {
  totalExpenses: number;
  totalIncome: number;
  pendingInvoices: number;
  gstPayable: number;
  vendorCount: number;
}

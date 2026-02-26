import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Send cookies with requests
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.error || error.message || 'An error occurred';
    console.error('API Error:', message);

    // Redirect to login on 401 (unless already on auth routes)
    if (error.response?.status === 401 && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login?error=session_expired';
    }

    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  getStatus: () => api.get('/auth/status').then((r) => r.data),
  getMe: () => api.get('/auth/me').then((r) => r.data),
  logout: () => api.post('/auth/logout').then((r) => r.data),
  getLoginUrl: () => '/api/auth/google',
};

// Dashboard
export const dashboardApi = {
  getDashboard: (month?: string) =>
    api.get('/dashboard', { params: { month } }).then((r) => r.data),
  getStats: (month?: string, context?: 'personal' | 'business') =>
    api.get('/dashboard/stats', { params: { month, context } }).then((r) => r.data),
  getCashFlow: (months?: number) =>
    api.get('/dashboard/cash-flow', { params: { months } }).then((r) => r.data),
  getExpenseBreakdown: (startDate: string, endDate: string) =>
    api.get('/dashboard/expense-breakdown', { params: { startDate, endDate } }).then((r) => r.data),
  getTrends: (startDate: string, endDate: string, granularity?: 'daily' | 'weekly' | 'monthly') =>
    api.get('/dashboard/trends', { params: { startDate, endDate, granularity } }).then((r) => r.data),
  getVyaparTrends: (startDate: string, endDate: string, granularity?: 'daily' | 'weekly' | 'monthly') =>
    api.get('/dashboard/vyapar-trends', { params: { startDate, endDate, granularity } }).then((r) => r.data),
  getCategoryTrends: (startDate: string, endDate: string, granularity?: 'daily' | 'weekly' | 'monthly', type?: 'expense' | 'income' | 'all') =>
    api.get('/dashboard/category-trends', { params: { startDate, endDate, granularity, type } }).then((r) => r.data),
  getVyaparSummary: (startDate: string, endDate: string) =>
    api.get('/dashboard/vyapar-summary', { params: { startDate, endDate } }).then((r) => r.data),
  getRecentTransactions: (limit?: number) =>
    api.get('/dashboard/recent-transactions', { params: { limit } }).then((r) => r.data),
};

// Accounts
export const accountsApi = {
  getAll: () => api.get('/accounts').then((r) => r.data),
  getById: (id: string) => api.get(`/accounts/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/accounts', data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/accounts/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/accounts/${id}`).then((r) => r.data),
  updateBalance: (id: string, balance: number) =>
    api.patch(`/accounts/${id}/balance`, { balance }).then((r) => r.data),
  saveStatementPassword: (id: string, password: string | null) =>
    api.patch(`/accounts/${id}/statement-password`, { password }).then((r) => r.data),
};

// Transactions
export const transactionsApi = {
  getBank: (params?: Record<string, any>) =>
    api.get('/transactions/bank', { params }).then((r) => r.data),
  getVyapar: (params?: Record<string, any>) =>
    api.get('/transactions/vyapar', { params }).then((r) => r.data),
  getCreditCard: (params?: Record<string, any>) =>
    api.get('/transactions/credit-card', { params }).then((r) => r.data),
  createBank: (data: any) => api.post('/transactions/bank', data).then((r) => r.data),
  updateBank: (id: string, data: any) =>
    api.put(`/transactions/bank/${id}`, data).then((r) => r.data),
  deleteBank: (id: string) => api.delete(`/transactions/bank/${id}`).then((r) => r.data),
  bulkUpdateCategory: (ids: string[], categoryId: string | null) =>
    api.patch('/transactions/bank/bulk-category', { ids, categoryId }).then((r) => r.data),
  updateBankCategory: (id: string, categoryId: string | null) =>
    api.patch(`/transactions/bank/${id}/category`, { categoryId }).then((r) => r.data),
  updateBankPurpose: (id: string, purpose: 'business' | 'personal' | null) =>
    api.patch(`/transactions/bank/${id}/purpose`, { purpose }).then((r) => r.data),
  updateVyaparPurpose: (id: string, purpose: 'ignored' | null) =>
    api.patch(`/transactions/vyapar/${id}/purpose`, { purpose }).then((r) => r.data),
  updateCreditCardCategory: (id: string, categoryId: string | null) =>
    api.patch(`/transactions/credit-card/${id}/category`, { categoryId }).then((r) => r.data),
  getCategories: () => api.get('/transactions/categories').then((r) => r.data),
  getVyaparItems: (params?: Record<string, any>) =>
    api.get('/transactions/vyapar-items', { params }).then((r) => r.data),
  getVyaparItemCategories: (params?: Record<string, any>) =>
    api.get('/transactions/vyapar-items/categories', { params }).then((r) => r.data),
  updateVyaparItemCategory: (id: string, category: string | null) =>
    api.patch(`/transactions/vyapar-items/${id}/category`, { category }).then((r) => r.data),
  autoCategorizeVyaparItems: (rules: Array<{ pattern: string; category: string; caseSensitive?: boolean }>, onlyUncategorized = true) =>
    api.post('/transactions/vyapar-items/auto-categorize', { rules, onlyUncategorized }).then((r) => r.data),
  // Bulk delete operations
  bulkDeleteBank: (params: { accountId?: string; startDate?: string; endDate?: string; deleteAll?: boolean }) =>
    api.post('/transactions/bank/bulk-delete', params).then((r) => r.data),
  bulkDeleteVyapar: (params: { startDate?: string; endDate?: string; transactionType?: string; deleteAll?: boolean }) =>
    api.post('/transactions/vyapar/bulk-delete', params).then((r) => r.data),
  bulkDeleteCreditCard: (params: { accountId?: string; startDate?: string; endDate?: string; source?: 'gmail' | 'statement'; deleteAll?: boolean }) =>
    api.post('/transactions/credit-card/bulk-delete', params).then((r) => r.data),
  getCounts: (params: { type: 'bank' | 'vyapar' | 'credit-card'; accountId?: string; startDate?: string; endDate?: string; source?: 'gmail' | 'statement' }) =>
    api.get('/transactions/counts', { params }).then((r) => r.data),
  verifyFixTypes: (accountId?: string) =>
    api.post('/transactions/bank/verify-fix-types', { accountId }).then((r) => r.data),
  removeDuplicates: (accountId?: string, dryRun = false) =>
    api.delete('/transactions/bank/duplicates', { data: { accountId, dryRun } }).then((r) => r.data),
};

// Reconciliation
export const reconciliationApi = {
  getData: (startMonth: string, endMonth: string, accountId?: string) =>
    api.get('/reconciliation', { params: { startMonth, endMonth, accountId } }).then((r) => r.data),
  autoMatch: (startMonth: string, endMonth: string, accountIds?: string[], apply = false) =>
    api.post('/reconciliation/auto-match', { startMonth, endMonth, accountIds, apply }).then((r) => r.data),
  applyMatches: (matches: Array<{ bankTransactionId: string; vyaparTransactionId: string }>) =>
    api.post('/reconciliation/apply-matches', { matches }).then((r) => r.data),
  manualMatch: (bankTransactionId: string, vyaparTransactionId: string) =>
    api.post('/reconciliation/manual-match', { bankTransactionId, vyaparTransactionId }).then((r) => r.data),
  multiMatch: (bankTransactionIds: string[], vyaparTransactionIds: string[]) =>
    api.post('/reconciliation/multi-match', { bankTransactionIds, vyaparTransactionIds }).then((r) => r.data),
  unmatch: (bankTransactionId: string) =>
    api.post('/reconciliation/unmatch', { bankTransactionId }).then((r) => r.data),
  unmatchVyapar: (vyaparTransactionId: string) =>
    api.post('/reconciliation/unmatch-vyapar', { vyaparTransactionId }).then((r) => r.data),
  unmatchGroup: (matchGroupId: string) =>
    api.post('/reconciliation/unmatch-group', { matchGroupId }).then((r) => r.data),
  getMatchGroup: (matchGroupId: string) =>
    api.get(`/reconciliation/match-group/${matchGroupId}`).then((r) => r.data),
  getMatchDetails: (params: { bankId?: string; vyaparId?: string }) =>
    api.get('/reconciliation/match-details', { params }).then((r) => r.data),
  exportReport: (startMonth: string, endMonth: string, accountId?: string) =>
    api.get('/reconciliation/export', {
      params: { startMonth, endMonth, accountId },
      responseType: 'blob',
    }).then((r) => r.data),
  getOrphanedMatches: () =>
    api.get('/reconciliation/orphaned-matches').then((r) => r.data),
  fixOrphanedMatches: () =>
    api.post('/reconciliation/fix-orphaned-matches').then((r) => r.data),
  repairMatches: () =>
    api.post('/reconciliation/repair-matches').then((r) => r.data),
};

// Uploads
export const uploadsApi = {
  getAll: () => api.get('/uploads').then((r) => r.data),
  detectFileType: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/uploads/detect', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  // Smart import: auto-detect bank, create account, import transactions
  // Supports password for encrypted PDFs
  smartImport: (file: File, password?: string, rememberPassword?: boolean) => {
    const formData = new FormData();
    formData.append('file', file);
    if (password) {
      formData.append('password', password);
    }
    if (rememberPassword !== undefined) {
      formData.append('rememberPassword', String(rememberPassword));
    }
    return api.post('/uploads/smart-import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  previewBankStatement: (file: File, bankName: string, accountId: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('bankName', bankName);
    formData.append('accountId', accountId);
    return api.post('/uploads/bank-statement/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  confirmBankStatement: (uploadId: string, accountId: string, transactions: any[]) =>
    api.post('/uploads/bank-statement/confirm', { uploadId, accountId, transactions }).then((r) => r.data),
  previewVyapar: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/uploads/vyapar/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  confirmVyapar: (uploadId: string, transactions: any[], itemDetails?: any[]) =>
    api.post('/uploads/vyapar/confirm', { uploadId, transactions, itemDetails }).then((r) => r.data),
  previewCreditCard: (file: File, accountId: string, bankHint?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('accountId', accountId);
    if (bankHint) formData.append('bankHint', bankHint);
    return api.post('/uploads/credit-card/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  confirmCreditCard: (uploadId: string, accountId: string, transactions: any[]) =>
    api.post('/uploads/credit-card/confirm', { uploadId, accountId, transactions }).then((r) => r.data),
  previewETrade: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/uploads/etrade/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  confirmETrade: (uploadId: string, holdings: any[]) =>
    api.post('/uploads/etrade/confirm', { uploadId, holdings }).then((r) => r.data),
  previewHomeLoan: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/uploads/home-loan/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  confirmHomeLoan: (uploadId: string, loan: any, payments: any[], disbursements: any[]) =>
    api.post('/uploads/home-loan/confirm', { uploadId, loan, payments, disbursements }).then((r) => r.data),
  previewCAMS: (file: File, password: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('password', password);
    return api.post('/uploads/cams/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  confirmCAMS: (uploadId: string, investorName: string, email: string | null, panNumber: string | null, holdings: any[]) =>
    api.post('/uploads/cams/confirm', { uploadId, investorName, email, panNumber, holdings }).then((r) => r.data),
  delete: (id: string) => api.delete(`/uploads/${id}`).then((r) => r.data),
};

// Investments
export const investmentsApi = {
  getAll: () => api.get('/investments').then((r) => r.data),
  getSummary: () => api.get('/investments/summary').then((r) => r.data),
  getById: (id: string) => api.get(`/investments/${id}`).then((r) => r.data),
  getLiveQuotes: () => api.get('/investments/live-quotes').then((r) => r.data),
  create: (data: any) => api.post('/investments', data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/investments/${id}`, data).then((r) => r.data),
  updatePrice: (id: string, price: number) =>
    api.patch(`/investments/${id}/price`, { price }).then((r) => r.data),
  syncPrices: () => api.post('/investments/sync-prices').then((r) => r.data),
  delete: (id: string) => api.delete(`/investments/${id}`).then((r) => r.data),
};

// Loans
export const loansApi = {
  getAll: (params?: { type?: string; status?: string }) =>
    api.get('/loans', { params }).then((r) => r.data),
  getSummary: () => api.get('/loans/summary').then((r) => r.data),
  getById: (id: string) => api.get(`/loans/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/loans', data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/loans/${id}`, data).then((r) => r.data),
  addPayment: (loanId: string, data: any) =>
    api.post(`/loans/${loanId}/payments`, data).then((r) => r.data),
  deletePayment: (loanId: string, paymentId: string) =>
    api.delete(`/loans/${loanId}/payments/${paymentId}`).then((r) => r.data),
  updateStatus: (id: string, status: string) =>
    api.patch(`/loans/${id}/status`, { status }).then((r) => r.data),
  markAsPaid: (id: string) =>
    api.post(`/loans/${id}/mark-paid`).then((r) => r.data),
  markAsUnpaid: (id: string) =>
    api.post(`/loans/${id}/mark-unpaid`).then((r) => r.data),
  delete: (id: string) => api.delete(`/loans/${id}`).then((r) => r.data),
  // Exchange rate
  getExchangeRate: () =>
    api.get('/loans/exchange-rate/usd-inr').then((r) => r.data),
  // Loan Given Details
  getGivenDetails: (loanId: string) =>
    api.get(`/loans/${loanId}/given-details`).then((r) => r.data),
  addGivenDetail: (loanId: string, data: any) =>
    api.post(`/loans/${loanId}/given-details`, data).then((r) => r.data),
  updateGivenDetail: (loanId: string, detailId: string, data: any) =>
    api.put(`/loans/${loanId}/given-details/${detailId}`, data).then((r) => r.data),
  deleteGivenDetail: (loanId: string, detailId: string) =>
    api.delete(`/loans/${loanId}/given-details/${detailId}`).then((r) => r.data),
};

// Reports
export const reportsApi = {
  getPL: (month: string) => api.get('/reports/pl', { params: { month } }).then((r) => r.data),
  exportPL: (month: string, format: 'xlsx' | 'csv' = 'xlsx') =>
    api.get('/reports/pl/export', {
      params: { month, format },
      responseType: 'blob',
    }).then((r) => r.data),
  getGST: (startDate: string, endDate: string) =>
    api.get('/reports/gst', { params: { startDate, endDate } }).then((r) => r.data),
  getCategoryBreakdown: (startDate: string, endDate: string, type?: string) =>
    api.get('/reports/category-breakdown', { params: { startDate, endDate, type } }).then((r) => r.data),
  exportTransactions: (params: {
    startDate: string;
    endDate: string;
    type?: string;
    format?: 'xlsx' | 'csv';
    accountId?: string;
  }) =>
    api.get('/reports/transactions/export', {
      params,
      responseType: 'blob',
    }).then((r) => r.data),
};

// Categories
export const categoriesApi = {
  getAll: () => api.get('/categories').then((r) => r.data),
  create: (data: any) => api.post('/categories', data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/categories/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/categories/${id}`).then((r) => r.data),
};

// Mutual Funds
export const mutualFundsApi = {
  getHoldings: () => api.get('/mutual-funds/holdings').then((r) => r.data),
  getSummary: () => api.get('/mutual-funds/summary').then((r) => r.data),
  getFolios: () => api.get('/mutual-funds/folios').then((r) => r.data),
  getFolioHoldings: (folioId: string) => api.get(`/mutual-funds/folios/${folioId}/holdings`).then((r) => r.data),
  updateNAV: (id: string, nav: number, navDate?: string) =>
    api.patch(`/mutual-funds/${id}/nav`, { nav, navDate }).then((r) => r.data),
  syncNAV: () => api.post('/mutual-funds/sync-nav').then((r) => r.data),
  delete: (id: string) => api.delete(`/mutual-funds/${id}`).then((r) => r.data),
  deleteFolio: (folioId: string) => api.delete(`/mutual-funds/folios/${folioId}`).then((r) => r.data),
};

// Assets (Physical properties)
export const assetsApi = {
  getAll: () => api.get('/assets').then((r) => r.data),
  getSummary: () => api.get('/assets/summary').then((r) => r.data),
  getById: (id: string) => api.get(`/assets/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/assets', data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/assets/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/assets/${id}`).then((r) => r.data),
  linkLoan: (id: string, loanId: string | null) =>
    api.patch(`/assets/${id}/link-loan`, { loanId }).then((r) => r.data),
};

// Policies (Insurance)
export const policiesApi = {
  getAll: () => api.get('/assets/policies').then((r) => r.data),
  getSummary: () => api.get('/assets/policies/summary').then((r) => r.data),
  getById: (id: string) => api.get(`/assets/policies/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/assets/policies', data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/assets/policies/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/assets/policies/${id}`).then((r) => r.data),
  addPayment: (policyId: string, data: any) =>
    api.post(`/assets/policies/${policyId}/payments`, data).then((r) => r.data),
  deletePayment: (policyId: string, paymentId: string) =>
    api.delete(`/assets/policies/${policyId}/payments/${paymentId}`).then((r) => r.data),
  extractFromPdf: (file: File, password?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (password) {
      formData.append('password', password);
    }
    return api.post('/assets/policies/extract', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
};

// Fixed Expenses (recurring expenses like rent, school fees)
export const fixedExpensesApi = {
  getAll: () => api.get('/fixed-expenses').then((r) => r.data),
  getSummary: () => api.get('/fixed-expenses/summary').then((r) => r.data),
  getById: (id: string) => api.get(`/fixed-expenses/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/fixed-expenses', data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/fixed-expenses/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/fixed-expenses/${id}`).then((r) => r.data),
  addPayment: (expenseId: string, data: any) =>
    api.post(`/fixed-expenses/${expenseId}/payments`, data).then((r) => r.data),
};

// Recurring Income
export const recurringIncomeApi = {
  getAll: () => api.get('/recurring-income').then((r) => r.data),
  getSummary: () => api.get('/recurring-income/summary').then((r) => r.data),
  getById: (id: string) => api.get(`/recurring-income/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/recurring-income', data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/recurring-income/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/recurring-income/${id}`).then((r) => r.data),
  addReceipt: (incomeId: string, data: any) =>
    api.post(`/recurring-income/${incomeId}/receipts`, data).then((r) => r.data),
};

// Credit Cards
export const creditCardsApi = {
  getAll: () => api.get('/credit-cards').then((r) => r.data),
  getSummary: (accountId?: string) =>
    api.get('/credit-cards/summary', { params: { accountId } }).then((r) => r.data),
  getTransactions: (
    accountId: string,
    params?: {
      startDate?: string;
      endDate?: string;
      cardHolder?: string;
      category?: string;
      emiOnly?: boolean;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ) =>
    api.get(`/credit-cards/${accountId}/transactions`, { params }).then((r) => r.data),
  getStatements: (accountId: string, limit?: number) =>
    api.get(`/credit-cards/${accountId}/statements`, { params: { limit } }).then((r) => r.data),
  getCardHolders: (accountId: string) =>
    api.get(`/credit-cards/${accountId}/card-holders`).then((r) => r.data),
  getAnalytics: (params?: { accountId?: string; startDate?: string; endDate?: string }) =>
    api.get('/credit-cards/analytics', { params }).then((r) => r.data),
  updateTransactionCategory: (accountId: string, transactionId: string, categoryId: string | null) =>
    api.patch(`/credit-cards/${accountId}/transactions/${transactionId}/category`, { categoryId }).then((r) => r.data),
  // Sync credit card transactions from Gmail
  syncGmail: (params?: { afterDate?: string }) =>
    api.post('/credit-cards/sync-gmail', params || {}).then((r) => r.data),
};

// Gmail Integration
export const gmailApi = {
  // Check if Gmail OAuth is configured
  getConfig: () => api.get('/gmail/config').then((r) => r.data),

  // Get OAuth authorization URL
  getAuthUrl: () => api.get('/gmail/auth/url').then((r) => r.data),

  // Get all connected accounts
  getConnections: () => api.get('/gmail/connections').then((r) => r.data),

  // Get a single connection
  getConnection: (id: string) => api.get(`/gmail/connections/${id}`).then((r) => r.data),

  // Disconnect a Gmail account
  disconnect: (id: string) => api.delete(`/gmail/connections/${id}`).then((r) => r.data),

  // Trigger email sync
  sync: (data: {
    connectionId: string;
    syncType: 'historical' | 'incremental';
    afterDate?: string;
    beforeDate?: string;
    banks?: string[];
    maxEmails?: number;
  }) => api.post('/gmail/sync', data).then((r) => r.data),

  // Get sync state by ID
  getSyncState: (syncId: string) => api.get(`/gmail/sync/${syncId}`).then((r) => r.data),

  // Get sync history for a connection
  getSyncHistory: (connectionId: string, limit?: number) =>
    api.get(`/gmail/connections/${connectionId}/sync-history`, { params: { limit } }).then((r) => r.data),

  // Get processed emails for a connection
  getProcessedEmails: (
    connectionId: string,
    params?: { status?: 'success' | 'failed' | 'skipped'; limit?: number; offset?: number }
  ) => api.get(`/gmail/connections/${connectionId}/emails`, { params }).then((r) => r.data),
};

// Portfolio Tracking
export const portfolioApi = {
  // Get current portfolio summary (live calculation)
  getSummary: () => api.get('/portfolio/summary').then((r) => r.data),

  // Get snapshot history
  getSnapshots: (params?: { startDate?: string; endDate?: string; limit?: number }) =>
    api.get('/portfolio/snapshots', { params }).then((r) => r.data),

  // Get latest snapshot
  getLatestSnapshot: () => api.get('/portfolio/snapshots/latest').then((r) => r.data),

  // Capture a new snapshot manually
  capture: (notes?: string) => api.post('/portfolio/capture', { notes }).then((r) => r.data),

  // Initialize portfolio tracking (creates seed + current snapshot)
  initialize: () => api.post('/portfolio/initialize').then((r) => r.data),

  // Get performance data for charts
  getPerformance: (params?: { period?: 'daily' | 'weekly' | 'monthly' | 'quarterly'; limit?: number }) =>
    api.get('/portfolio/performance', { params }).then((r) => r.data),

  // Get asset allocation for pie chart
  getAllocation: () => api.get('/portfolio/allocation').then((r) => r.data),

  // Get stock trends - historical performance based on current holdings
  getStockTrends: (days: number = 30) =>
    api.get('/portfolio/stock-trends', { params: { days } }).then((r) => r.data),
};

// Business Accounting (ASG Technologies)
export const businessAccountingApi = {
  // Get transactions with enrichment data
  getTransactions: (params?: Record<string, any>) =>
    api.get('/business-accounting/transactions', { params }).then((r) => r.data),

  // Get summary stats
  getSummary: (params?: { startDate?: string; endDate?: string }) =>
    api.get('/business-accounting/summary', { params }).then((r) => r.data),

  // Run auto-enrichment
  enrich: (data?: { accountId?: string; overwrite?: boolean }) =>
    api.post('/business-accounting/enrich', data).then((r) => r.data),

  // Update transaction business details
  updateTransaction: (id: string, data: any) =>
    api.patch(`/business-accounting/transaction/${id}`, data).then((r) => r.data),

  // Invoice operations
  uploadInvoice: (transactionId: string, file: File, metadata?: Record<string, any>) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('transactionId', transactionId);
    if (metadata) {
      Object.entries(metadata).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          formData.append(key, String(value));
        }
      });
    }
    return api.post('/business-accounting/invoice', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  getInvoiceUrl: (id: string) => `/api/business-accounting/invoice/${id}`,

  deleteInvoice: (id: string) =>
    api.delete(`/business-accounting/invoice/${id}`).then((r) => r.data),

  // Vendor operations
  getVendors: (params?: { startDate?: string; endDate?: string }) =>
    api.get('/business-accounting/vendors', { params }).then((r) => r.data),

  getVendorPayments: (vendorName: string) =>
    api.get(`/business-accounting/vendors/${encodeURIComponent(vendorName)}/payments`).then((r) => r.data),

  getVendorTransactions: (vendorName: string, month?: string) =>
    api.get(`/business-accounting/vendors/${encodeURIComponent(vendorName)}/transactions`, {
      params: month ? { month } : undefined,
    }).then((r) => r.data),

  // GST Summary
  getGSTSummary: (params?: { startDate?: string; endDate?: string }) =>
    api.get('/business-accounting/gst-summary', { params }).then((r) => r.data),

  // CA Export
  exportForCA: (params?: { startDate?: string; endDate?: string }) =>
    api.get('/business-accounting/ca-export', {
      params,
      responseType: 'blob',
    }).then((r) => r.data),

  // Get business type labels
  getBizTypes: () => api.get('/business-accounting/biz-types').then((r) => r.data),

  // Get all matching transactions for a given transaction (full history)
  getMatchingTransactions: (transactionId: string) =>
    api.get(`/business-accounting/transaction/${transactionId}/matches`).then((r) => r.data),

  // GST Invoice Management
  createGSTInvoice: (data: FormData) =>
    api.post('/business-accounting/gst-invoice', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data),

  getGSTInvoices: (params?: {
    startDate?: string;
    endDate?: string;
    gstType?: string;
    hasFile?: boolean;
    isExternal?: boolean;
  }) => api.get('/business-accounting/gst-invoices', { params }).then((r) => r.data),

  updateGSTInvoice: (id: string, data: any) =>
    api.patch(`/business-accounting/gst-invoice/${id}`, data).then((r) => r.data),

  bulkUpdateGSTInvoices: (invoiceIds: string[], updates: any) =>
    api.patch('/business-accounting/gst-invoices/bulk', { invoiceIds, updates }).then((r) => r.data),

  deleteGSTInvoice: (id: string) =>
    api.delete(`/business-accounting/gst-invoice/${id}`).then((r) => r.data),

  getGSTLedger: (params?: { startDate?: string; endDate?: string }) =>
    api.get('/business-accounting/gst-ledger', { params }).then((r) => r.data),

  // Fix old invoices that don't have GST fields
  fixOldInvoices: () =>
    api.post('/business-accounting/fix-invoices').then((r) => r.data),

  // Auto-match unlinked invoices to transactions
  autoMatchInvoices: () =>
    api.post('/business-accounting/auto-match-invoices').then((r) => r.data),

  // Get unlinked invoices by vendor name
  getInvoicesByVendor: (vendorName: string) =>
    api.get('/business-accounting/invoices-by-vendor', { params: { vendorName } }).then((r) => r.data),

  // Manually link an invoice to a transaction
  linkInvoice: (invoiceId: string, transactionId: string) =>
    api.post('/business-accounting/link-invoice', { invoiceId, transactionId }).then((r) => r.data),

  // Import Amazon Business CSV
  importAmazonCSV: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/business-accounting/import-amazon-csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  // Rename a vendor
  renameVendor: (oldName: string, newName: string) =>
    api.patch(`/business-accounting/vendors/${encodeURIComponent(oldName)}`, { newName }).then((r) => r.data),

  // GearUp Mods Account Management
  getGearupAccounts: () =>
    api.get('/business-accounting/gearup-accounts').then((r) => r.data),

  toggleGearupAccount: (accountId: string) =>
    api.post(`/business-accounting/gearup-accounts/${accountId}/toggle`).then((r) => r.data),

  bulkUpdateGearupAccounts: (accountIds: string[], isGearupBusiness: boolean) =>
    api.post('/business-accounting/gearup-accounts/bulk-update', { accountIds, isGearupBusiness }).then((r) => r.data),

  getGearupTransactions: (params?: { startDate?: string; endDate?: string }) =>
    api.get('/business-accounting/gearup-transactions', { params }).then((r) => r.data),

  // Team Management
  checkAccess: () =>
    api.get('/business-accounting/gearup-team/my-access').then((r) => r.data),

  getTeamMembers: () =>
    api.get('/business-accounting/gearup-team/members').then((r) => r.data),

  inviteTeamMember: (email: string, role: 'viewer' | 'editor' | 'admin' = 'viewer') =>
    api.post('/business-accounting/gearup-team/invite', { email, role }).then((r) => r.data),

  updateTeamMemberRole: (id: string, role: 'viewer' | 'editor' | 'admin') =>
    api.patch(`/business-accounting/gearup-team/members/${id}`, { role }).then((r) => r.data),

  removeTeamMember: (id: string) =>
    api.delete(`/business-accounting/gearup-team/members/${id}`).then((r) => r.data),

  // Transaction Notes (Vyapar + Bank)
  getTransactionNotes: (transactionId: string, type: 'vyapar' | 'bank' = 'vyapar') =>
    api.get(`/business-accounting/transaction/${transactionId}/notes`, { params: { type } }).then((r) => r.data),

  addTransactionNote: (transactionId: string, note: string, type: 'vyapar' | 'bank' = 'vyapar') =>
    api.post(`/business-accounting/transaction/${transactionId}/notes`, { note, type }).then((r) => r.data),

  deleteTransactionNote: (transactionId: string, noteId: string, type: 'vyapar' | 'bank' = 'vyapar') =>
    api.delete(`/business-accounting/transaction/${transactionId}/notes/${noteId}`, { params: { type } }).then((r) => r.data),

  getNoteCounts: (vyaparIds: string[], bankIds: string[]) =>
    api.post('/business-accounting/transactions/note-counts', { vyaparIds, bankIds }).then((r) => r.data),

  deleteTransaction: (id: string) =>
    api.delete(`/business-accounting/transaction/${id}`).then((r) => r.data),
};

// Personal Team (shared access to personal data)
export const personalTeamApi = {
  getMyAccess: () =>
    api.get('/personal-team/my-access').then((r) => r.data),

  getMembers: () =>
    api.get('/personal-team/members').then((r) => r.data),

  invite: (email: string, role: 'viewer' | 'editor' | 'admin' = 'viewer') =>
    api.post('/personal-team/invite', { email, role }).then((r) => r.data),

  updateRole: (id: string, role: 'viewer' | 'editor' | 'admin') =>
    api.patch(`/personal-team/members/${id}`, { role }).then((r) => r.data),

  remove: (id: string) =>
    api.delete(`/personal-team/members/${id}`).then((r) => r.data),
};

// Calendar
export const calendarApi = {
  getEvents: (year: number) =>
    api.get('/calendar/events', { params: { year } }).then((r) => r.data),
};

// Investment Advisor (AI-powered)
export const investmentAdvisorApi = {
  // Chat with AI advisor
  chat: (data: {
    message: string;
    portfolio: Array<{
      name: string;
      symbol?: string;
      type: string;
      country: 'IN' | 'US';
      quantity: number;
      purchasePrice: number;
      currentPrice?: number;
      currentValue?: number;
      purchaseDate: string;
      platform?: string;
    }>;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    exchangeRate?: number;
  }) => api.post('/investment-advisor/chat', data).then((r) => r.data),

  // Get initial portfolio analysis
  analyze: (data: {
    portfolio: Array<{
      name: string;
      symbol?: string;
      type: string;
      country: 'IN' | 'US';
      quantity: number;
      purchasePrice: number;
      currentPrice?: number;
      currentValue?: number;
      purchaseDate: string;
      platform?: string;
    }>;
    exchangeRate?: number;
  }) => api.post('/investment-advisor/analyze', data).then((r) => r.data),
};

export default api;

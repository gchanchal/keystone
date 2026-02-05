import { create } from 'zustand';
import { getMonthYear } from '@/lib/utils';

interface FilterState {
  selectedMonth: string;
  selectedAccountId: string | null;
  selectedCategoryId: string | null;
  searchQuery: string;
  transactionType: 'all' | 'credit' | 'debit';
  reconciledFilter: 'all' | 'reconciled' | 'unreconciled';
  dateRange: { start: string; end: string } | null;
  setSelectedMonth: (month: string) => void;
  setSelectedAccountId: (accountId: string | null) => void;
  setSelectedCategoryId: (categoryId: string | null) => void;
  setSearchQuery: (query: string) => void;
  setTransactionType: (type: 'all' | 'credit' | 'debit') => void;
  setReconciledFilter: (filter: 'all' | 'reconciled' | 'unreconciled') => void;
  setDateRange: (range: { start: string; end: string } | null) => void;
  resetFilters: () => void;
}

const initialState = {
  selectedMonth: getMonthYear(),
  selectedAccountId: null,
  selectedCategoryId: null,
  searchQuery: '',
  transactionType: 'all' as const,
  reconciledFilter: 'all' as const,
  dateRange: null,
};

export const useFilterStore = create<FilterState>((set) => ({
  ...initialState,
  setSelectedMonth: (selectedMonth) => set({ selectedMonth }),
  setSelectedAccountId: (selectedAccountId) => set({ selectedAccountId }),
  setSelectedCategoryId: (selectedCategoryId) => set({ selectedCategoryId }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setTransactionType: (transactionType) => set({ transactionType }),
  setReconciledFilter: (reconciledFilter) => set({ reconciledFilter }),
  setDateRange: (dateRange) => set({ dateRange }),
  resetFilters: () => set(initialState),
}));

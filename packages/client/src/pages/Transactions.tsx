import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, subMonths, startOfMonth, endOfMonth, addMonths, isWithinInterval, parseISO } from 'date-fns';
import {
  Download,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle,
  Circle,
  Link2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DataTable, ColumnDef } from '@/components/ui/data-table';
import { transactionsApi, accountsApi, reportsApi, categoriesApi } from '@/lib/api';
import { formatCurrency, formatDate, getMonthYear, parseMonthYear } from '@/lib/utils';
import type { BankTransaction, VyaparTransaction, CreditCardTransaction, Account, Category } from '@/types';

export function Transactions() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read initial values from URL params
  const tabParam = searchParams.get('tab') || 'bank';
  const transactionTypeParam = searchParams.get('transactionType');
  const statusParam = searchParams.get('status');
  const accountParam = searchParams.get('account');
  const startDateParam = searchParams.get('startDate');
  const endDateParam = searchParams.get('endDate');

  const [activeTab, setActiveTab] = useState(tabParam);

  // Date range state - priority: URL params > localStorage > default (last 3 months)
  const [startMonth, setStartMonth] = useState(() => {
    if (startDateParam) {
      return startDateParam.substring(0, 7); // Extract yyyy-MM from yyyy-MM-dd
    }
    const stored = localStorage.getItem('keystone-date-start');
    if (stored) return stored;
    return format(subMonths(new Date(), 2), 'yyyy-MM');
  });
  const [endMonth, setEndMonth] = useState(() => {
    if (endDateParam) {
      return endDateParam.substring(0, 7);
    }
    const stored = localStorage.getItem('keystone-date-end');
    if (stored) return stored;
    return getMonthYear();
  });

  // Persist date range to localStorage
  useEffect(() => {
    localStorage.setItem('keystone-date-start', startMonth);
    localStorage.setItem('keystone-date-end', endMonth);
  }, [startMonth, endMonth]);

  // Calculate date range
  const startMonthDate = parseMonthYear(startMonth);
  const endMonthDate = parseMonthYear(endMonth);
  const startDate = format(startOfMonth(startMonthDate), 'yyyy-MM-dd');
  const endDate = format(endOfMonth(endMonthDate), 'yyyy-MM-dd');

  // Sync tab and dates with URL params
  useEffect(() => {
    const urlTab = searchParams.get('tab');
    if (urlTab && urlTab !== activeTab) {
      setActiveTab(urlTab);
    }

    const urlStartDate = searchParams.get('startDate');
    const urlEndDate = searchParams.get('endDate');

    if (urlStartDate) {
      const newStartMonth = urlStartDate.substring(0, 7);
      if (newStartMonth !== startMonth) {
        setStartMonth(newStartMonth);
      }
    }

    if (urlEndDate) {
      const newEndMonth = urlEndDate.substring(0, 7);
      if (newEndMonth !== endMonth) {
        setEndMonth(newEndMonth);
      }
    }
  }, [searchParams]);

  // Build initial filters from URL params
  const bankInitialFilters = useMemo(() => {
    const filters: Record<string, string> = {};
    if (accountParam) {
      filters.account = accountParam;
    }
    return filters;
  }, [accountParam]);

  const vyaparInitialFilters = useMemo(() => {
    const filters: Record<string, string> = {};
    if (transactionTypeParam) {
      filters.transactionType = transactionTypeParam;
    }
    if (statusParam) {
      filters.status = statusParam;
    }
    return filters;
  }, [transactionTypeParam, statusParam]);

  const creditCardInitialFilters = useMemo(() => {
    const filters: Record<string, string> = {};
    if (accountParam) {
      filters.account = accountParam;
    }
    return filters;
  }, [accountParam]);

  // Update URL when tab changes (but not from URL sync)
  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    // Keep date range, clear other filters when switching tabs
    setSearchParams({ tab: newTab, startDate, endDate });
  };

  // Date navigation handlers
  const handlePreviousStartMonth = () => {
    const newStart = format(subMonths(startMonthDate, 1), 'yyyy-MM');
    setStartMonth(newStart);
    if (newStart > endMonth) {
      setEndMonth(newStart);
    }
  };

  const handleNextStartMonth = () => {
    const newStart = format(addMonths(startMonthDate, 1), 'yyyy-MM');
    if (newStart <= endMonth) {
      setStartMonth(newStart);
    }
  };

  const handlePreviousEndMonth = () => {
    const newEnd = format(subMonths(endMonthDate, 1), 'yyyy-MM');
    if (newEnd >= startMonth) {
      setEndMonth(newEnd);
    }
  };

  const handleNextEndMonth = () => {
    setEndMonth(format(addMonths(endMonthDate, 1), 'yyyy-MM'));
  };

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.getAll,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.getAll,
  });

  const { data: allBankTransactions = [], isLoading: bankLoading } = useQuery({
    queryKey: ['transactions', 'bank'],
    queryFn: () => transactionsApi.getBank({}),
  });

  const { data: allVyaparTransactions = [], isLoading: vyaparLoading } = useQuery({
    queryKey: ['transactions', 'vyapar'],
    queryFn: () => transactionsApi.getVyapar({}),
  });

  const { data: allCcTransactions = [], isLoading: ccLoading } = useQuery({
    queryKey: ['transactions', 'credit-card'],
    queryFn: () => transactionsApi.getCreditCard({}),
  });

  // Filter transactions by date range
  const dateInterval = { start: parseISO(startDate), end: parseISO(endDate) };

  const bankTransactions = useMemo(() => {
    return allBankTransactions.filter((t: BankTransaction) => {
      const txnDate = parseISO(t.date);
      return isWithinInterval(txnDate, dateInterval);
    });
  }, [allBankTransactions, startDate, endDate]);

  const vyaparTransactions = useMemo(() => {
    return allVyaparTransactions.filter((t: VyaparTransaction) => {
      const txnDate = parseISO(t.date);
      return isWithinInterval(txnDate, dateInterval);
    });
  }, [allVyaparTransactions, startDate, endDate]);

  const ccTransactions = useMemo(() => {
    return allCcTransactions.filter((t: CreditCardTransaction) => {
      const txnDate = parseISO(t.date);
      return isWithinInterval(txnDate, dateInterval);
    });
  }, [allCcTransactions, startDate, endDate]);

  const handleExport = async () => {
    const blob = await reportsApi.exportTransactions({
      startDate,
      endDate,
      type: activeTab === 'all' ? 'all' : activeTab,
      format: 'xlsx',
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${startDate}-${endDate}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Create maps for lookups
  const accountMap = new Map<string, string>(accounts.map((a: Account) => [a.id, a.name]));
  const categoryMap = new Map<string, Category>(categories.map((c: Category) => [c.id, c]));

  return (
    <div className="space-y-6">
      {/* Header with date range */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Transactions</h1>

        <div className="flex items-center gap-4">
          {/* Start Month */}
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">From:</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={handlePreviousStartMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="w-24 text-center font-medium text-sm">
              {format(startMonthDate, 'MMM yyyy')}
            </span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleNextStartMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* End Month */}
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">To:</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={handlePreviousEndMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="w-24 text-center font-medium text-sm">
              {format(endMonthDate, 'MMM yyyy')}
            </span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleNextEndMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="bank">Bank ({bankTransactions.length})</TabsTrigger>
          <TabsTrigger value="vyapar">Vyapar ({vyaparTransactions.length})</TabsTrigger>
          <TabsTrigger value="credit-card">Credit Card ({ccTransactions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="bank" className="mt-4">
          <BankTransactionTable
            transactions={bankTransactions}
            isLoading={bankLoading}
            accounts={accounts}
            categories={categories}
            accountMap={accountMap}
            categoryMap={categoryMap}
            queryClient={queryClient}
            initialFilters={bankInitialFilters}
          />
        </TabsContent>

        <TabsContent value="vyapar" className="mt-4">
          <VyaparTransactionTable
            transactions={vyaparTransactions}
            isLoading={vyaparLoading}
            bankTransactions={bankTransactions}
            accountMap={accountMap}
            initialFilters={vyaparInitialFilters}
          />
        </TabsContent>

        <TabsContent value="credit-card" className="mt-4">
          <CreditCardTransactionTable
            transactions={ccTransactions}
            isLoading={ccLoading}
            accounts={accounts}
            categories={categories}
            accountMap={accountMap}
            categoryMap={categoryMap}
            queryClient={queryClient}
            initialFilters={creditCardInitialFilters}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Bank Transactions Table
function BankTransactionTable({
  transactions,
  isLoading,
  accounts,
  categories,
  accountMap,
  categoryMap,
  queryClient,
  initialFilters = {},
}: {
  transactions: BankTransaction[];
  isLoading: boolean;
  accounts: Account[];
  categories: Category[];
  accountMap: Map<string, string>;
  categoryMap: Map<string, Category>;
  queryClient: any;
  initialFilters?: Record<string, string>;
}) {
  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, categoryId }: { id: string; categoryId: string | null }) =>
      transactionsApi.updateBankCategory(id, categoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const updatePurposeMutation = useMutation({
    mutationFn: ({ id, purpose }: { id: string; purpose: 'business' | 'personal' | null }) =>
      transactionsApi.updateBankPurpose(id, purpose),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const deleteBankMutation = useMutation({
    mutationFn: (id: string) => transactionsApi.deleteBank(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  // Create bank lookup from accounts
  const accountToBankMap = new Map<string, string>(
    accounts.map((a: Account) => [a.id, a.bankName])
  );

  // Get unique bank names for filter
  const uniqueBanks = [...new Set(accounts.map((a: Account) => a.bankName))].filter(Boolean);

  const columns: ColumnDef<BankTransaction>[] = [
    {
      id: 'date',
      header: 'Date',
      accessorKey: 'date',
      cell: (row) => formatDate(row.date),
      width: '100px',
    },
    {
      id: 'narration',
      header: 'Description',
      accessorKey: 'narration',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div
            className={`rounded-full p-1 ${
              row.transactionType === 'credit'
                ? 'bg-green-500/10 text-green-500'
                : 'bg-red-500/10 text-red-500'
            }`}
          >
            {row.transactionType === 'credit' ? (
              <ArrowDownRight className="h-3 w-3" />
            ) : (
              <ArrowUpRight className="h-3 w-3" />
            )}
          </div>
          <span className="max-w-[300px] truncate text-sm" title={row.narration}>
            {row.narration}
          </span>
        </div>
      ),
    },
    {
      id: 'account',
      header: 'Account',
      accessorKey: (row) => accountMap.get(row.accountId) || '-',
      filterType: 'select',
      filterOptions: accounts
        .filter((a: Account) => a.accountType === 'savings' || a.accountType === 'current')
        .map((a: Account) => ({ label: a.name, value: a.name })),
    },
    {
      id: 'bank',
      header: 'Bank',
      accessorKey: (row) => accountToBankMap.get(row.accountId) || '-',
      cell: (row) => (
        <Badge variant="outline" className="text-xs">
          {accountToBankMap.get(row.accountId) || '-'}
        </Badge>
      ),
      filterType: 'select',
      filterOptions: uniqueBanks.map((bank) => ({ label: bank, value: bank })),
    },
    {
      id: 'source',
      header: 'Source',
      accessorKey: (row) => (row.notes?.includes('[Gmail Sync]') ? 'Gmail Sync' : 'Manual/Upload'),
      cell: (row) => (
        <Badge
          variant={row.notes?.includes('[Gmail Sync]') ? 'default' : 'secondary'}
          className="text-xs"
        >
          {row.notes?.includes('[Gmail Sync]') ? 'Gmail' : 'Upload'}
        </Badge>
      ),
      filterType: 'select',
      filterOptions: [
        { label: 'Gmail Sync', value: 'Gmail Sync' },
        { label: 'Manual/Upload', value: 'Manual/Upload' },
      ],
    },
    {
      id: 'category',
      header: 'Category',
      accessorKey: (row) => categoryMap.get(row.categoryId || '')?.name || '',
      cell: (row) => (
        <Select
          value={row.categoryId || 'none'}
          onValueChange={(value) =>
            updateCategoryMutation.mutate({
              id: row.id,
              categoryId: value === 'none' ? null : value,
            })
          }
        >
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue>
              {row.categoryId ? (
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: categoryMap.get(row.categoryId)?.color || '#6b7280' }}
                  />
                  <span className="truncate">{categoryMap.get(row.categoryId)?.name || '-'}</span>
                </div>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {categories.map((cat: Category) => (
              <SelectItem key={cat.id} value={cat.id}>
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: cat.color || '#6b7280' }}
                  />
                  {cat.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
      filterType: 'select',
      filterOptions: [
        { label: 'Uncategorized', value: '' },
        ...categories.map((c: Category) => ({ label: c.name, value: c.name })),
      ],
    },
    {
      id: 'credit',
      header: 'Credit',
      accessorKey: (row) => (row.transactionType === 'credit' ? row.amount : 0),
      cell: (row) =>
        row.transactionType === 'credit' ? (
          <span className="font-medium text-green-600">{formatCurrency(row.amount)}</span>
        ) : (
          '-'
        ),
      align: 'right',
    },
    {
      id: 'debit',
      header: 'Debit',
      accessorKey: (row) => (row.transactionType === 'debit' ? row.amount : 0),
      cell: (row) =>
        row.transactionType === 'debit' ? (
          <span className="font-medium text-red-600">{formatCurrency(row.amount)}</span>
        ) : (
          '-'
        ),
      align: 'right',
    },
    {
      id: 'balance',
      header: 'Balance',
      accessorKey: 'balance',
      cell: (row) => (row.balance !== null ? formatCurrency(row.balance) : '-'),
      align: 'right',
    },
    {
      id: 'purpose',
      header: 'Purpose',
      accessorKey: (row) => row.purpose || '',
      cell: (row) => (
        <Select
          value={row.purpose || 'unclassified'}
          onValueChange={(value) =>
            updatePurposeMutation.mutate({
              id: row.id,
              purpose: value === 'unclassified' ? null : (value as 'business' | 'personal'),
            })
          }
        >
          <SelectTrigger className="h-8 w-[100px]">
            <SelectValue>
              {row.purpose === 'personal' ? (
                <span className="text-orange-600">Personal</span>
              ) : row.purpose === 'business' ? (
                <span className="text-green-600">Business</span>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unclassified">
              <span className="text-muted-foreground">Unclassified</span>
            </SelectItem>
            <SelectItem value="business">
              <span className="text-green-600">Business</span>
            </SelectItem>
            <SelectItem value="personal">
              <span className="text-orange-600">Personal</span>
            </SelectItem>
          </SelectContent>
        </Select>
      ),
      filterType: 'select',
      filterOptions: [
        { label: 'Unclassified', value: '' },
        { label: 'Business', value: 'business' },
        { label: 'Personal', value: 'personal' },
      ],
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: (row) => (row.isReconciled ? 'Reconciled' : 'Unreconciled'),
      cell: (row) =>
        row.isReconciled ? (
          <CheckCircle className="mx-auto h-4 w-4 text-green-500" />
        ) : (
          <Circle className="mx-auto h-4 w-4 text-muted-foreground" />
        ),
      align: 'center',
      filterType: 'select',
      filterOptions: [
        { label: 'Reconciled', value: 'Reconciled' },
        { label: 'Unreconciled', value: 'Unreconciled' },
      ],
    },
    {
      id: 'actions',
      header: '',
      accessorKey: 'id',
      width: '50px',
      sortable: false,
      filterable: false,
      cell: (row) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm('Are you sure you want to delete this transaction?')) {
              deleteBankMutation.mutate(row.id);
            }
          }}
          title="Delete transaction"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <DataTable
      data={transactions}
      columns={columns}
      isLoading={isLoading}
      emptyMessage="No bank transactions found"
      getRowId={(row) => row.id}
      pageSize={25}
      initialFilters={initialFilters}
    />
  );
}

// Vyapar Transactions Table
function VyaparTransactionTable({
  transactions,
  isLoading,
  bankTransactions,
  accountMap,
  initialFilters = {},
}: {
  transactions: VyaparTransaction[];
  isLoading: boolean;
  bankTransactions: BankTransaction[];
  accountMap: Map<string, string>;
  initialFilters?: Record<string, string>;
}) {
  const [selectedMatch, setSelectedMatch] = useState<{
    vyapar: VyaparTransaction;
    bank: BankTransaction | null;
  } | null>(null);

  const bankTxnMap = new Map<string, BankTransaction>(bankTransactions.map((b) => [b.id, b]));

  // Transaction types that should be reconciled with bank
  // Sale = payment received, Sale Order = pending payment (not reconcilable)
  const reconciledTypes = ['Sale', 'Payment-In', 'Purchase', 'Payment-Out', 'Expense'];
  const isReconcilable = (type: string) => reconciledTypes.includes(type);

  // Apply filters from URL params to transactions for tile calculations
  const filteredTransactions = useMemo(() => {
    let result = transactions;
    if (initialFilters.transactionType) {
      result = result.filter((t) => t.transactionType === initialFilters.transactionType);
    }
    if (initialFilters.status) {
      if (initialFilters.status === 'Reconciled') {
        result = result.filter((t) => t.isReconciled);
      } else if (initialFilters.status === 'Unreconciled') {
        result = result.filter((t) => !t.isReconciled && isReconcilable(t.transactionType));
      } else if (initialFilters.status === 'N/A') {
        result = result.filter((t) => !isReconcilable(t.transactionType));
      }
    }
    return result;
  }, [transactions, initialFilters]);

  // Calculate summary stats from filtered transactions
  const reconcilableTransactions = filteredTransactions.filter((t) => isReconcilable(t.transactionType));
  const nonReconcilableTransactions = filteredTransactions.filter((t) => !isReconcilable(t.transactionType));
  const reconciledCount = reconcilableTransactions.filter((t) => t.isReconciled).length;
  const unreconciledCount = reconcilableTransactions.length - reconciledCount;
  const reconciledAmount = reconcilableTransactions
    .filter((t) => t.isReconciled)
    .reduce((sum, t) => sum + t.amount, 0);
  const unreconciledAmount = reconcilableTransactions
    .filter((t) => !t.isReconciled)
    .reduce((sum, t) => sum + t.amount, 0);
  const pendingPaymentCount = nonReconcilableTransactions.length;
  const pendingPaymentAmount = nonReconcilableTransactions.reduce((sum, t) => sum + t.amount, 0);

  // Sales and Expenses totals from filtered transactions
  const salesAmount = filteredTransactions
    .filter((t) => t.transactionType === 'Sale')
    .reduce((sum, t) => sum + t.amount, 0);
  const salesCount = filteredTransactions.filter((t) => t.transactionType === 'Sale').length;
  const expensesAmount = filteredTransactions
    .filter((t) => t.transactionType === 'Expense')
    .reduce((sum, t) => sum + t.amount, 0);
  const expensesCount = filteredTransactions.filter((t) => t.transactionType === 'Expense').length;

  const columns: ColumnDef<VyaparTransaction>[] = [
    {
      id: 'date',
      header: 'Date',
      accessorKey: 'date',
      cell: (row) => formatDate(row.date),
      width: '100px',
    },
    {
      id: 'invoiceNumber',
      header: 'Invoice',
      accessorKey: 'invoiceNumber',
      cell: (row) => <span className="font-mono text-sm">{row.invoiceNumber || '-'}</span>,
    },
    {
      id: 'transactionType',
      header: 'Type',
      accessorKey: 'transactionType',
      cell: (row) => {
        const isPendingPayment = row.transactionType === 'Sale Order';
        const isIncomingPayment = ['Sale', 'Payment-In'].includes(row.transactionType);

        return (
          <Badge
            variant="secondary"
            className={
              isPendingPayment
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                : isIncomingPayment
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
            }
          >
            {row.transactionType}
            {isPendingPayment && ' (Pending)'}
          </Badge>
        );
      },
      filterType: 'select',
      filterOptions: [
        { label: 'Sale', value: 'Sale' },
        { label: 'Sale Order', value: 'Sale Order' },
        { label: 'Payment-In', value: 'Payment-In' },
        { label: 'Purchase', value: 'Purchase' },
        { label: 'Payment-Out', value: 'Payment-Out' },
        { label: 'Expense', value: 'Expense' },
      ],
    },
    {
      id: 'partyName',
      header: 'Party',
      accessorKey: 'partyName',
      cell: (row) => (
        <span className="max-w-[200px] truncate block" title={row.partyName || ''}>
          {row.partyName || '-'}
        </span>
      ),
    },
    {
      id: 'paymentType',
      header: 'Payment',
      accessorKey: 'paymentType',
      cell: (row) =>
        row.paymentType ? (
          <Badge variant="outline" className="text-xs">
            {row.paymentType}
          </Badge>
        ) : (
          '-'
        ),
      filterType: 'select',
      filterOptions: [
        { label: 'Cash', value: 'Cash' },
        { label: 'Bank', value: 'Bank' },
        { label: 'UPI', value: 'UPI' },
        { label: 'Card', value: 'Card' },
        { label: 'Cheque', value: 'Cheque' },
      ],
    },
    {
      id: 'amount',
      header: 'Amount',
      accessorKey: 'amount',
      cell: (row) => {
        const isPendingPayment = row.transactionType === 'Sale Order';
        const isIncomingPayment = ['Sale', 'Payment-In'].includes(row.transactionType);

        return (
          <span
            className={`font-medium ${
              isPendingPayment
                ? 'text-blue-600'
                : isIncomingPayment
                ? 'text-green-600'
                : 'text-red-600'
            }`}
          >
            {isPendingPayment ? '~' : isIncomingPayment ? '+' : '-'}
            {formatCurrency(row.amount)}
          </span>
        );
      },
      align: 'right',
    },
    {
      id: 'status',
      header: 'Reconciled',
      accessorKey: (row) => {
        if (!isReconcilable(row.transactionType)) return 'N/A';
        return row.isReconciled ? 'Reconciled' : 'Unreconciled';
      },
      cell: (row) => {
        const canBeReconciled = isReconcilable(row.transactionType);

        if (!canBeReconciled) {
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <span className="text-xs text-blue-500 font-medium">N/A</span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Payment not yet received - not applicable for bank reconciliation</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        }

        return row.isReconciled ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <CheckCircle className="mx-auto h-5 w-5 text-green-500" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Reconciled with bank transaction</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Circle className="mx-auto h-5 w-5 text-orange-400" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Payment received but not yet reconciled with bank</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      },
      align: 'center',
      filterType: 'select',
      filterOptions: [
        { label: 'Reconciled', value: 'Reconciled' },
        { label: 'Unreconciled', value: 'Unreconciled' },
        { label: 'N/A (Pending Payment)', value: 'N/A' },
      ],
    },
    {
      id: 'matchedWith',
      header: 'Matched With',
      accessorKey: (row) => {
        if (!isReconcilable(row.transactionType)) return 'Awaiting payment';
        const matchedBank = row.reconciledWithId ? bankTxnMap.get(row.reconciledWithId) : null;
        if (matchedBank) return `${matchedBank.date} - ${matchedBank.amount}`;
        if (row.isReconciled) return 'Reconciled';
        return 'Needs matching';
      },
      cell: (row) => {
        const canBeReconciled = isReconcilable(row.transactionType);
        const matchedBank = row.reconciledWithId ? bankTxnMap.get(row.reconciledWithId) : null;

        if (!canBeReconciled) {
          return <span className="text-xs text-blue-500">Awaiting payment</span>;
        }

        if (matchedBank) {
          return (
            <button
              onClick={() => setSelectedMatch({ vyapar: row, bank: matchedBank })}
              className="flex items-center gap-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              <Link2 className="h-3 w-3" />
              <span className="max-w-[150px] truncate text-xs">
                {formatDate(matchedBank.date)} - {formatCurrency(matchedBank.amount)}
              </span>
              <ExternalLink className="h-3 w-3" />
            </button>
          );
        }

        if (row.isReconciled) {
          return <span className="text-xs text-green-600">Reconciled</span>;
        }

        return <span className="text-xs text-orange-500">Needs matching</span>;
      },
      filterable: false,
    },
  ];

  const getRowClassName = (row: VyaparTransaction) => {
    const isPendingPayment = row.transactionType === 'Sale Order';
    const canBeReconciled = isReconcilable(row.transactionType);

    if (isPendingPayment) return 'bg-blue-50/50 dark:bg-blue-950/10';
    if (canBeReconciled && !row.isReconciled) return 'bg-orange-50/50 dark:bg-orange-950/10';
    return '';
  };

  return (
    <>
      {/* Summary Stats - only show tiles with non-zero values */}
      <div className="mb-4 flex flex-wrap gap-4">
        {salesCount > 0 && (
          <Card className="flex-1 min-w-[150px]">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Sales ({salesCount})</div>
              <div className="text-2xl font-bold text-green-600">{formatCurrency(salesAmount)}</div>
            </CardContent>
          </Card>
        )}
        {expensesCount > 0 && (
          <Card className="flex-1 min-w-[150px]">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Expenses ({expensesCount})</div>
              <div className="text-2xl font-bold text-red-600">{formatCurrency(expensesAmount)}</div>
            </CardContent>
          </Card>
        )}
        {filteredTransactions.length > 0 && (
          <Card className="flex-1 min-w-[150px]">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Total Transactions</div>
              <div className="text-2xl font-bold">{filteredTransactions.length}</div>
            </CardContent>
          </Card>
        )}
        {reconciledCount > 0 && (
          <Card className="flex-1 min-w-[150px]">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Reconciled</div>
              <div className="text-2xl font-bold text-green-600">{reconciledCount}</div>
              <div className="text-sm text-muted-foreground">{formatCurrency(reconciledAmount)}</div>
            </CardContent>
          </Card>
        )}
        {unreconciledCount > 0 && (
          <Card className="flex-1 min-w-[150px]">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Pending Reconciliation</div>
              <div className="text-2xl font-bold text-orange-600">{unreconciledCount}</div>
              <div className="text-sm text-muted-foreground">{formatCurrency(unreconciledAmount)}</div>
            </CardContent>
          </Card>
        )}
        {pendingPaymentCount > 0 && (
          <Card className="flex-1 min-w-[150px]">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Pending Payment (Sales)</div>
              <div className="text-2xl font-bold text-blue-600">{pendingPaymentCount}</div>
              <div className="text-sm text-muted-foreground">{formatCurrency(pendingPaymentAmount)}</div>
            </CardContent>
          </Card>
        )}
        {reconcilableTransactions.length > 0 && (
          <Card className="flex-1 min-w-[150px]">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Match Rate</div>
              <div className="text-2xl font-bold">
                {Math.round((reconciledCount / reconcilableTransactions.length) * 100)}%
              </div>
              <div className="text-xs text-muted-foreground">of reconcilable txns</div>
            </CardContent>
          </Card>
        )}
      </div>

      <DataTable
        data={transactions}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No Vyapar transactions found"
        getRowId={(row) => row.id}
        rowClassName={getRowClassName}
        pageSize={25}
        initialFilters={initialFilters}
      />

      {/* Match Details Dialog */}
      <Dialog open={!!selectedMatch} onOpenChange={() => setSelectedMatch(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Reconciliation Match Details</DialogTitle>
          </DialogHeader>
          {selectedMatch && (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-3">
                <h3 className="font-semibold text-green-600">Vyapar Transaction</h3>
                <div className="rounded-lg border p-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date:</span>
                    <span className="font-medium">{formatDate(selectedMatch.vyapar.date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Invoice:</span>
                    <span className="font-mono">{selectedMatch.vyapar.invoiceNumber || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type:</span>
                    <Badge variant="secondary">{selectedMatch.vyapar.transactionType}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Party:</span>
                    <span className="font-medium">{selectedMatch.vyapar.partyName || '-'}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-muted-foreground">Amount:</span>
                    <span className="text-lg font-bold">{formatCurrency(selectedMatch.vyapar.amount)}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <h3 className="font-semibold text-blue-600">Bank Transaction</h3>
                {selectedMatch.bank ? (
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Date:</span>
                      <span className="font-medium">{formatDate(selectedMatch.bank.date)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Account:</span>
                      <span>{accountMap.get(selectedMatch.bank.accountId) || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Type:</span>
                      <Badge variant={selectedMatch.bank.transactionType === 'credit' ? 'default' : 'destructive'}>
                        {selectedMatch.bank.transactionType}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Narration:</span>
                      <p className="mt-1 text-sm">{selectedMatch.bank.narration}</p>
                    </div>
                    <div className="flex justify-between border-t pt-2">
                      <span className="text-muted-foreground">Amount:</span>
                      <span className="text-lg font-bold">{formatCurrency(selectedMatch.bank.amount)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border p-4 text-muted-foreground">
                    Bank transaction details not available
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// Credit Card Transactions Table
function CreditCardTransactionTable({
  transactions,
  isLoading,
  accounts,
  categories,
  accountMap,
  categoryMap,
  queryClient,
  initialFilters = {},
}: {
  transactions: CreditCardTransaction[];
  isLoading: boolean;
  accounts: Account[];
  categories: Category[];
  accountMap: Map<string, string>;
  categoryMap: Map<string, Category>;
  queryClient: any;
  initialFilters?: Record<string, string>;
}) {
  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, categoryId }: { id: string; categoryId: string | null }) =>
      transactionsApi.updateCreditCardCategory(id, categoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  // Create bank lookup from accounts
  const accountToBankMap = new Map<string, string>(
    accounts.map((a: Account) => [a.id, a.bankName])
  );

  // Get unique bank names for credit cards
  const uniqueCCBanks = [...new Set(
    accounts
      .filter((a: Account) => a.accountType === 'credit_card')
      .map((a: Account) => a.bankName)
  )].filter(Boolean);

  const columns: ColumnDef<CreditCardTransaction>[] = [
    {
      id: 'date',
      header: 'Date',
      accessorKey: 'date',
      cell: (row) => formatDate(row.date),
      width: '100px',
    },
    {
      id: 'description',
      header: 'Description',
      accessorKey: 'description',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div
            className={`rounded-full p-1 ${
              row.transactionType === 'credit'
                ? 'bg-green-500/10 text-green-500'
                : 'bg-red-500/10 text-red-500'
            }`}
          >
            {row.transactionType === 'credit' ? (
              <ArrowDownRight className="h-3 w-3" />
            ) : (
              <ArrowUpRight className="h-3 w-3" />
            )}
          </div>
          <span className="max-w-[300px] truncate" title={row.description}>
            {row.description}
          </span>
        </div>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      accessorKey: (row) => row.transactionType === 'credit' ? 'Payment' : 'Purchase',
      cell: (row) => (
        <Badge variant={row.transactionType === 'credit' ? 'default' : 'secondary'}>
          {row.transactionType === 'credit' ? 'Payment' : 'Purchase'}
        </Badge>
      ),
      filterType: 'select',
      filterOptions: [
        { label: 'Payments (Credits)', value: 'Payment' },
        { label: 'Purchases (Debits)', value: 'Purchase' },
      ],
    },
    {
      id: 'account',
      header: 'Card',
      accessorKey: (row) => accountMap.get(row.accountId) || '-',
      filterType: 'select',
      filterOptions: accounts
        .filter((a: Account) => a.accountType === 'credit_card')
        .map((a: Account) => ({ label: a.name, value: a.name })),
    },
    {
      id: 'bank',
      header: 'Bank',
      accessorKey: (row) => accountToBankMap.get(row.accountId) || '-',
      cell: (row) => (
        <Badge variant="outline" className="text-xs">
          {accountToBankMap.get(row.accountId) || '-'}
        </Badge>
      ),
      filterType: 'select',
      filterOptions: uniqueCCBanks.map((bank) => ({ label: bank, value: bank })),
    },
    {
      id: 'source',
      header: 'Source',
      accessorKey: (row) => (row.notes?.includes('[Gmail Sync]') ? 'Gmail Sync' : 'Manual/Upload'),
      cell: (row) => (
        <Badge
          variant={row.notes?.includes('[Gmail Sync]') ? 'default' : 'secondary'}
          className="text-xs"
        >
          {row.notes?.includes('[Gmail Sync]') ? 'Gmail' : 'Upload'}
        </Badge>
      ),
      filterType: 'select',
      filterOptions: [
        { label: 'Gmail Sync', value: 'Gmail Sync' },
        { label: 'Manual/Upload', value: 'Manual/Upload' },
      ],
    },
    {
      id: 'category',
      header: 'Category',
      accessorKey: (row) => categoryMap.get(row.categoryId || '')?.name || '',
      cell: (row) => (
        <Select
          value={row.categoryId || 'none'}
          onValueChange={(value) =>
            updateCategoryMutation.mutate({
              id: row.id,
              categoryId: value === 'none' ? null : value,
            })
          }
        >
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue>
              {row.categoryId ? (
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: categoryMap.get(row.categoryId)?.color || '#6b7280' }}
                  />
                  <span className="truncate">{categoryMap.get(row.categoryId)?.name || '-'}</span>
                </div>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {categories.map((cat: Category) => (
              <SelectItem key={cat.id} value={cat.id}>
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: cat.color || '#6b7280' }}
                  />
                  {cat.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
      filterType: 'select',
      filterOptions: [
        { label: 'Uncategorized', value: '' },
        ...categories.map((c: Category) => ({ label: c.name, value: c.name })),
      ],
    },
    {
      id: 'amount',
      header: 'Amount',
      accessorKey: 'amount',
      cell: (row) => (
        <span className={`font-medium ${row.transactionType === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
          {row.transactionType === 'credit' ? '+' : '-'}{formatCurrency(row.amount)}
        </span>
      ),
      align: 'right',
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: (row) => (row.isReconciled ? 'Reconciled' : 'Unreconciled'),
      cell: (row) =>
        row.isReconciled ? (
          <CheckCircle className="mx-auto h-4 w-4 text-green-500" />
        ) : (
          <Circle className="mx-auto h-4 w-4 text-muted-foreground" />
        ),
      align: 'center',
      filterType: 'select',
      filterOptions: [
        { label: 'Reconciled', value: 'Reconciled' },
        { label: 'Unreconciled', value: 'Unreconciled' },
      ],
    },
  ];

  return (
    <DataTable
      data={transactions}
      columns={columns}
      isLoading={isLoading}
      emptyMessage="No credit card transactions found"
      getRowId={(row) => row.id}
      pageSize={25}
      initialFilters={initialFilters}
    />
  );
}

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, subMonths, addMonths, startOfMonth, endOfMonth } from 'date-fns';
import {
  FileSpreadsheet,
  RefreshCw,
  FileText,
  AlertCircle,
  TrendingDown,
  TrendingUp,
  Users,
  Receipt,
  Download,
  ChevronLeft,
  ChevronRight,
  Link2,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle,
  Circle,
  MessageSquare,
  ShoppingCart,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { DataTable, ColumnDef } from '@/components/ui/data-table';
import { businessAccountingApi } from '@/lib/api';
import { formatCurrency, formatDate, getMonthYear, parseMonthYear } from '@/lib/utils';
import { TransactionDetailModal } from '@/components/business-accounting/TransactionDetailModal';
import { TransactionNotesModal } from '@/components/business-accounting/TransactionNotesModal';
import { GSTManagementTab } from '@/components/business-accounting/GSTManagementTab';
import { VendorsTab } from '@/components/business-accounting/VendorsTab';
import { GearupAccountsTab } from '@/components/business-accounting/GearupAccountsTab';
import { TeamManagement } from '@/components/business-accounting/TeamManagement';
import type { BusinessTransaction, BusinessAccountingSummary, BizType } from '@/types';

// Owner email for showing Team tab
const GEARUP_OWNER_EMAIL = 'g.chanchal@gmail.com';

const BIZ_TYPE_COLORS: Record<string, string> = {
  // Bank transaction types
  SALARY: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  PETROL: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
  PORTER: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  HELPER: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300',
  VENDOR: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  SALES_INCOME: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  RENT: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  UTILITIES: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300',
  TRANSPORT: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300',
  SUPPLIES: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300',
  MARKETING: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-300',
  MAINTENANCE: 'bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-300',
  // Vyapar transaction types
  SALE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300',
  SALE_ORDER: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-300',
  PAYMENT_IN: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300',
  RECORD: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-300',
  EXPENSE: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  PURCHASE: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  PAYMENT_OUT: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-300',
};

const DEFAULT_TYPE_COLOR = 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-300';

const BIZ_TYPE_LABELS: Record<string, string> = {
  // Bank transaction types
  SALARY: 'Salary',
  PETROL: 'Petrol/Fuel',
  PORTER: 'Porter/Delivery',
  HELPER: 'Helper',
  VENDOR: 'Vendor',
  SALES_INCOME: 'Sales Income',
  RENT: 'Rent',
  UTILITIES: 'Utilities',
  TRANSPORT: 'Transport',
  SUPPLIES: 'Supplies',
  MARKETING: 'Marketing',
  MAINTENANCE: 'Maintenance',
  // Vyapar transaction types
  SALE: 'Sale',
  SALE_ORDER: 'Sale Order',
  PAYMENT_IN: 'Payment In',
  RECORD: 'Record',
  EXPENSE: 'Expense',
  PURCHASE: 'Purchase',
  PAYMENT_OUT: 'Payment Out',
};

// Helper to get type label (handles custom types)
const getTypeLabel = (type: string) => BIZ_TYPE_LABELS[type] || type.replace(/_/g, ' ');
const getTypeColor = (type: string) => BIZ_TYPE_COLORS[type] || DEFAULT_TYPE_COLOR;

export function BusinessAccounting() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Check if user is owner (for showing Team tab)
  const { data: gearupAccess } = useQuery({
    queryKey: ['gearup-access'],
    queryFn: businessAccountingApi.checkAccess,
    staleTime: 5 * 60 * 1000,
  });
  const isOwner = gearupAccess?.isOwner || false;

  // Get tab from URL or default to 'transactions'
  const activeTab = searchParams.get('tab') || 'transactions';
  const setActiveTab = (tab: string) => {
    setSearchParams({ tab });
  };

  const [selectedTransaction, setSelectedTransaction] = useState<BusinessTransaction | null>(null);
  const [notesTransaction, setNotesTransaction] = useState<BusinessTransaction | null>(null);
  const [bizTypeFilter, setBizTypeFilter] = useState<string>('all');
  const [invoiceFilter, setInvoiceFilter] = useState<string>('all');
  const [tileFilter, setTileFilter] = useState<'expenses' | 'income' | 'pending' | 'saleOrders' | null>(null);

  // Handle tile click - filter transactions and switch to transactions tab
  const handleTileClick = (filter: 'expenses' | 'income' | 'pending' | 'gst' | 'vendors' | 'saleOrders') => {
    if (filter === 'gst') {
      setActiveTab('gst');
      setTileFilter(null);
    } else if (filter === 'vendors') {
      setActiveTab('vendors');
      setTileFilter(null);
    } else {
      setActiveTab('transactions');
      // Toggle filter if already active
      setTileFilter(prev => prev === filter ? null : filter);
      // Reset other filters when tile is clicked
      setBizTypeFilter('all');
      setInvoiceFilter(filter === 'pending' ? 'needs' : 'all');
    }
  };

  // Date range state
  const [startMonth, setStartMonth] = useState(() => format(subMonths(new Date(), 2), 'yyyy-MM'));
  const [endMonth, setEndMonth] = useState(() => getMonthYear());

  const startMonthDate = parseMonthYear(startMonth);
  const endMonthDate = parseMonthYear(endMonth);
  const startDate = format(startOfMonth(startMonthDate), 'yyyy-MM-dd');
  const endDate = format(endOfMonth(endMonthDate), 'yyyy-MM-dd');

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

  // Fetch summary (filtered by date)
  const { data: summary } = useQuery<BusinessAccountingSummary>({
    queryKey: ['business-accounting-summary', startDate, endDate],
    queryFn: () => businessAccountingApi.getSummary({ startDate, endDate }),
  });

  // Fetch transactions
  const { data: transactions = [], isLoading } = useQuery<BusinessTransaction[]>({
    queryKey: ['business-accounting-transactions', startDate, endDate, bizTypeFilter, invoiceFilter],
    queryFn: () =>
      businessAccountingApi.getTransactions({
        startDate,
        endDate,
        bizType: bizTypeFilter !== 'all' ? bizTypeFilter : undefined,
        needsInvoice: invoiceFilter === 'needs' ? 'true' : undefined,
        hasInvoice: invoiceFilter === 'has' ? 'true' : invoiceFilter === 'missing' ? 'false' : undefined,
      }),
  });

  // Get transaction IDs for note counts (separated by type)
  const { vyaparIds, bankIds } = useMemo(() => {
    const vyapar: string[] = [];
    const bank: string[] = [];
    transactions.forEach(tx => {
      if (tx.accountName === 'Vyapar') {
        vyapar.push(tx.id);
      } else {
        bank.push(tx.id);
      }
    });
    return { vyaparIds: vyapar, bankIds: bank };
  }, [transactions]);

  // Fetch note counts and latest note for all transactions
  const { data: noteData = {} } = useQuery<Record<string, { count: number; latestNote: string; latestAt: string }>>({
    queryKey: ['transaction-note-counts', vyaparIds, bankIds],
    queryFn: () => (vyaparIds.length > 0 || bankIds.length > 0)
      ? businessAccountingApi.getNoteCounts(vyaparIds, bankIds)
      : Promise.resolve({}),
    enabled: vyaparIds.length > 0 || bankIds.length > 0,
    staleTime: 30 * 1000, // 30 seconds
  });

  // Enrich mutation
  const enrichMutation = useMutation({
    mutationFn: (overwrite: boolean) => businessAccountingApi.enrich({ overwrite }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-accounting-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['business-accounting-summary'] });
    },
  });

  // Auto-match invoices mutation
  const autoMatchMutation = useMutation({
    mutationFn: () => businessAccountingApi.autoMatchInvoices(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['business-accounting-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['business-accounting-summary'] });
      queryClient.invalidateQueries({ queryKey: ['gst-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['gst-ledger'] });
      if (data.matched > 0) {
        alert(`Matched ${data.matched} invoices to transactions!\n\n${data.details?.map((d: any) => `• ${d.invoiceNumber || 'Invoice'} → ${d.partyName}`).join('\n') || ''}`);
      } else {
        alert(`No matches found. ${data.total} unlinked invoices checked.`);
      }
    },
  });

  // Export mutation
  const handleExport = async () => {
    try {
      const blob = await businessAccountingApi.exportForCA({ startDate, endDate });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ASG_Transactions_${startDate}_${endDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  // Export filtered transactions as CSV
  const handleCSVExport = () => {
    const rows = filteredTransactions.map(tx => ({
      Date: tx.date,
      Description: tx.bizDescription || tx.narration,
      Account: tx.accountName || '',
      Vendor: tx.vendorName || '',
      Type: tx.bizType ? getTypeLabel(tx.bizType) : '',
      Credit: tx.transactionType === 'credit' ? tx.amount : '',
      Debit: tx.transactionType === 'debit' ? tx.amount : '',
      Balance: tx.balance ?? '',
      Status: tx.isReconciled ? 'Reconciled' : 'Unreconciled',
    }));

    const headers = Object.keys(rows[0] || {});
    const csvContent = [
      headers.join(','),
      ...rows.map(row =>
        headers.map(h => {
          const val = String(row[h as keyof typeof row] ?? '');
          return val.includes(',') || val.includes('"') || val.includes('\n')
            ? `"${val.replace(/"/g, '""')}"` : val;
        }).join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filterSuffix = tileFilter ? `_${tileFilter}` : '';
    a.download = `Transactions_${startDate}_${endDate}${filterSuffix}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Extract unique account names for filter options
  const uniqueAccountNames = useMemo(() => {
    const names = new Set<string>();
    transactions.forEach((tx) => {
      if (tx.accountName) {
        names.add(tx.accountName);
      }
    });
    return Array.from(names).sort();
  }, [transactions]);

  // Filter transactions based on tile filter
  const filteredTransactions = useMemo(() => {
    if (!tileFilter) return transactions;

    switch (tileFilter) {
      case 'expenses':
        return transactions.filter(tx => tx.transactionType === 'debit');
      case 'income':
        return transactions.filter(tx => tx.transactionType === 'credit');
      case 'pending':
        return transactions.filter(tx => tx.needsInvoice && !tx.invoiceFileId);
      case 'saleOrders': {
        // Build set of party names that have a Sale (converted from Sale Order)
        const partiesWithSale = new Set(
          transactions
            .filter(tx => tx.accountName === 'Vyapar' && tx.bizType === 'SALE' && tx.vendorName)
            .map(tx => tx.vendorName!.toLowerCase())
        );
        // Include Sale Orders (exclude those converted to Sale) + Sales with balance > 0 (partial paid) - Vyapar only
        return transactions.filter(tx =>
          tx.accountName === 'Vyapar' && (
            (tx.bizType === 'SALE_ORDER' && !(tx.vendorName && partiesWithSale.has(tx.vendorName.toLowerCase()))) ||
            (tx.bizType === 'SALE' && tx.balance !== null && tx.balance > 0)
          )
        );
      }
      default:
        return transactions;
    }
  }, [transactions, tileFilter]);

  // Column definitions for DataTable - matching Transactions page layout
  const columns: ColumnDef<BusinessTransaction>[] = useMemo(() => [
    {
      id: 'date',
      header: 'Date',
      accessorKey: 'date',
      width: '90px',
      minWidth: 90,
      sortable: true,
      filterable: true,
      cell: (row) => <span className="whitespace-nowrap">{formatDate(row.date)}</span>,
    },
    {
      id: 'description',
      header: 'Description',
      accessorKey: (row) => row.bizDescription || row.narration,
      minWidth: 200,
      sortable: true,
      filterable: true,
      cell: (row) => (
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`flex-shrink-0 rounded-full p-1 ${
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
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm" title={row.bizDescription || row.narration}>
              {row.bizDescription || row.narration}
            </div>
            {row.bizDescription && row.narration !== row.bizDescription && (
              <div className="truncate text-xs text-muted-foreground" title={row.narration}>
                {row.narration}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'account',
      header: 'Account',
      accessorKey: (row) => row.accountName || '-',
      width: '120px',
      minWidth: 100,
      sortable: true,
      filterable: true,
      filterType: 'select',
      filterOptions: uniqueAccountNames.map((name) => ({ label: name, value: name })),
      cell: (row) => (
        <span className="block truncate text-sm" title={row.accountName || '-'}>{row.accountName || '-'}</span>
      ),
    },
    {
      id: 'vendorName',
      header: 'Vendor',
      accessorKey: 'vendorName',
      width: '120px',
      minWidth: 100,
      sortable: true,
      filterable: true,
      cell: (row) => row.vendorName ? (
        <span className="block truncate text-sm" title={row.vendorName}>{row.vendorName}</span>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
    },
    {
      id: 'bizType',
      header: 'Type',
      accessorKey: 'bizType',
      width: '100px',
      minWidth: 90,
      sortable: true,
      filterable: true,
      filterType: 'select',
      filterOptions: Object.entries(BIZ_TYPE_LABELS).map(([value, label]) => ({ value, label })),
      cell: (row) => row.bizType ? (
        <Badge className={`whitespace-nowrap ${getTypeColor(row.bizType)}`}>
          {getTypeLabel(row.bizType)}
        </Badge>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
    },
    {
      id: 'invoice',
      header: 'Inv',
      accessorKey: (row) => row.invoiceFileId ? 'Yes' : (row.needsInvoice ? 'Pending' : 'N/A'),
      align: 'center',
      width: '50px',
      minWidth: 50,
      sortable: true,
      filterable: true,
      filterType: 'select',
      filterOptions: [
        { value: 'Yes', label: 'Has Invoice' },
        { value: 'Pending', label: 'Needs Invoice' },
        { value: 'N/A', label: 'Not Required' },
      ],
      cell: (row) => row.invoiceFileId ? (
        <FileText className="inline-block h-4 w-4 text-green-600" />
      ) : row.needsInvoice ? (
        <AlertCircle className="inline-block h-4 w-4 text-amber-500" />
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
    },
    {
      id: 'credit',
      header: 'Credit',
      accessorKey: (row) => (row.transactionType === 'credit' ? row.amount : 0),
      width: '100px',
      minWidth: 90,
      cell: (row) =>
        row.transactionType === 'credit' ? (
          <span className="whitespace-nowrap font-medium text-green-600">{formatCurrency(row.amount)}</span>
        ) : (
          '-'
        ),
      align: 'right',
      sortable: true,
    },
    {
      id: 'debit',
      header: 'Debit',
      accessorKey: (row) => (row.transactionType === 'debit' ? row.amount : 0),
      width: '100px',
      minWidth: 90,
      cell: (row) =>
        row.transactionType === 'debit' ? (
          <span className="whitespace-nowrap font-medium text-red-600">{formatCurrency(row.amount)}</span>
        ) : (
          '-'
        ),
      align: 'right',
      sortable: true,
    },
    {
      id: 'balance',
      header: 'Balance',
      accessorKey: 'balance',
      width: '100px',
      minWidth: 90,
      cell: (row) => <span className="whitespace-nowrap">{row.balance !== null ? formatCurrency(row.balance) : '-'}</span>,
      align: 'right',
      sortable: true,
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: (row) => (row.isReconciled ? 'Reconciled' : 'Unreconciled'),
      width: '60px',
      minWidth: 60,
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
      id: 'notes',
      header: 'Notes',
      accessorKey: (row) => noteData[row.id]?.latestNote || '',
      width: '180px',
      minWidth: 140,
      cell: (row) => {
        const info = noteData[row.id];
        const count = info?.count || 0;
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setNotesTransaction(row);
            }}
            className={`flex items-start gap-1.5 w-full text-left p-1 rounded hover:bg-muted transition-colors ${
              count > 0 ? 'text-foreground' : 'text-muted-foreground'
            }`}
            title={count > 0 ? `${count} note${count > 1 ? 's' : ''} - Click to view` : 'Add note'}
          >
            <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            {count > 0 ? (
              <div className="min-w-0 flex-1">
                <p className="text-xs line-clamp-2">{info.latestNote}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {format(new Date(info.latestAt), 'dd MMM, HH:mm')}
                  {count > 1 && ` · +${count - 1} more`}
                </p>
              </div>
            ) : (
              <span className="text-xs">Add note</span>
            )}
          </button>
        );
      },
    },
  ], [uniqueAccountNames, noteData]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">ASG Technologies - Business Accounting</h1>
          <p className="text-muted-foreground">GearUp Mods business transactions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => enrichMutation.mutate(false)}
            disabled={enrichMutation.isPending}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${enrichMutation.isPending ? 'animate-spin' : ''}`} />
            Auto-Enrich
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => autoMatchMutation.mutate()}
            disabled={autoMatchMutation.isPending}
          >
            <Link2 className={`mr-2 h-4 w-4 ${autoMatchMutation.isPending ? 'animate-spin' : ''}`} />
            {autoMatchMutation.isPending ? 'Matching...' : 'Auto-Match'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export for CA
          </Button>
          <Button variant="outline" size="sm" onClick={handleCSVExport} disabled={filteredTransactions.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            CSV{tileFilter ? ` (${filteredTransactions.length})` : ''}
          </Button>
        </div>
      </div>

      {/* Date Filter - Above Tiles */}
      <div className="flex flex-wrap items-center gap-4 p-4 rounded-lg border bg-muted/30">
        <span className="text-sm font-medium">Period:</span>
        {/* Start Month */}
        <div className="flex items-center gap-1">
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

        <span className="text-muted-foreground">to</span>

        {/* End Month */}
        <div className="flex items-center gap-1">
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
      </div>

      {/* Summary Cards - Clickable to filter transactions */}
      <div className="grid gap-4 md:grid-cols-6">
        <Card
          className={`cursor-pointer transition-all hover:shadow-md hover:border-red-300 ${tileFilter === 'expenses' ? 'ring-2 ring-red-500 border-red-500' : ''}`}
          onClick={() => handleTileClick('expenses')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatCurrency(summary?.totalExpenses || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Click to filter debits</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:shadow-md hover:border-green-300 ${tileFilter === 'income' ? 'ring-2 ring-green-500 border-green-500' : ''}`}
          onClick={() => handleTileClick('income')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Income</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(summary?.totalIncome || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Click to filter credits</p>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer transition-all hover:shadow-md hover:border-orange-300"
          onClick={() => handleTileClick('gst')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">GST Payable</CardTitle>
            <Receipt className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(summary?.gstPayable || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Click for GST details</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:shadow-md hover:border-amber-300 ${tileFilter === 'pending' ? 'ring-2 ring-amber-500 border-amber-500' : ''}`}
          onClick={() => handleTileClick('pending')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Invoices</CardTitle>
            <AlertCircle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {summary?.pendingInvoices || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Click to filter</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all hover:shadow-md hover:border-orange-300 ${tileFilter === 'saleOrders' ? 'ring-2 ring-orange-500 border-orange-500' : ''}`}
          onClick={() => handleTileClick('saleOrders')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Payments</CardTitle>
            <ShoppingCart className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {formatCurrency(summary?.saleOrdersTotal || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary?.saleOrdersCount || 0} orders/invoices
            </p>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer transition-all hover:shadow-md hover:border-blue-300"
          onClick={() => handleTileClick('vendors')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vendors</CardTitle>
            <Users className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.vendorCount || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Click for details</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="vendors">Vendors</TabsTrigger>
            <TabsTrigger value="gst">GST Summary</TabsTrigger>
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
            {isOwner && <TabsTrigger value="team">Team</TabsTrigger>}
          </TabsList>

          {activeTab === 'transactions' && (
            <div className="flex flex-wrap items-center gap-4">
              {/* Active tile filter indicator */}
              {tileFilter && (
                <Badge variant="secondary" className="gap-1">
                  {tileFilter === 'expenses' && 'Debits only'}
                  {tileFilter === 'income' && 'Credits only'}
                  {tileFilter === 'pending' && 'Pending invoices'}
                  {tileFilter === 'saleOrders' && 'Pending Payments'}
                  <button
                    onClick={() => {
                      setTileFilter(null);
                      setInvoiceFilter('all');
                      setBizTypeFilter('all');
                    }}
                    className="ml-1 hover:text-destructive"
                  >
                    ×
                  </button>
                </Badge>
              )}

              {/* Type Filter */}
              <Select value={bizTypeFilter} onValueChange={setBizTypeFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {Object.entries(BIZ_TYPE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Invoice Filter */}
              <Select value={invoiceFilter} onValueChange={setInvoiceFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Invoice Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="needs">Needs Invoice</SelectItem>
                  <SelectItem value="has">Has Invoice</SelectItem>
                  <SelectItem value="missing">Missing Invoice</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <TabsContent value="transactions" className="space-y-4">
          <DataTable
            data={filteredTransactions}
            columns={columns}
            isLoading={isLoading}
            emptyMessage={tileFilter ? `No ${tileFilter === 'expenses' ? 'debit' : tileFilter === 'income' ? 'credit' : tileFilter === 'saleOrders' ? 'pending payment' : 'pending invoice'} transactions found` : 'No transactions found'}
            onRowClick={(row) => setSelectedTransaction(row)}
            getRowId={(row) => row.id}
            showGlobalSearch={true}
            showPagination={true}
            pageSize={25}
          />
        </TabsContent>

        <TabsContent value="vendors">
          <VendorsTab startDate={startDate} endDate={endDate} />
        </TabsContent>

        <TabsContent value="gst">
          <GSTManagementTab startDate={startDate} endDate={endDate} />
        </TabsContent>

        <TabsContent value="accounts">
          <GearupAccountsTab />
        </TabsContent>

        {/* Team tab - only visible to owner */}
        {isOwner && (
          <TabsContent value="team">
            <TeamManagement />
          </TabsContent>
        )}
      </Tabs>

      {/* Transaction Detail Modal */}
      {selectedTransaction && (
        <TransactionDetailModal
          transaction={selectedTransaction}
          onClose={() => setSelectedTransaction(null)}
          onUpdate={() => {
            queryClient.invalidateQueries({ queryKey: ['business-accounting-transactions'] });
            queryClient.invalidateQueries({ queryKey: ['business-accounting-summary'] });
          }}
        />
      )}

      {/* Transaction Notes Modal */}
      {notesTransaction && (
        <TransactionNotesModal
          transaction={notesTransaction}
          onClose={() => setNotesTransaction(null)}
        />
      )}
    </div>
  );
}

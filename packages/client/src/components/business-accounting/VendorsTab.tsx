import { useState, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Users, FileText, ChevronRight, ArrowLeft, ChevronDown, ChevronUp, Edit2, Check, X, Search, Filter } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { businessAccountingApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { TransactionDetailModal } from './TransactionDetailModal';
import type { VendorSummary, VendorPaymentHistory, BusinessTransaction } from '@/types';

// Type labels and colors
const TYPE_LABELS: Record<string, string> = {
  SALARY: 'Salary',
  PETROL: 'Petrol/Fuel',
  PORTER: 'Porter/Delivery',
  HELPER: 'Helper',
  VENDOR: 'Vendor',
  SALE: 'Sale',
  SALE_ORDER: 'Sale Order',
  PAYMENT_IN: 'Payment In',
  EXPENSE: 'Expense',
  PURCHASE: 'Purchase',
  PAYMENT_OUT: 'Payment Out',
};

const TYPE_COLORS: Record<string, string> = {
  VENDOR: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  SALE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300',
  SALE_ORDER: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-300',
  PAYMENT_IN: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300',
  EXPENSE: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  PURCHASE: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  PAYMENT_OUT: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-300',
};


type SortColumn = 'vendorName' | 'accountNames' | 'primaryType' | 'transactionCount' | 'totalAmount' | 'avgPayment' | 'invoiceCount' | 'lastPaymentDate';
type SortDirection = 'asc' | 'desc';

export function VendorsTab() {
  const queryClient = useQueryClient();
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<BusinessTransaction | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Sorting state
  const [sortColumn, setSortColumn] = useState<SortColumn>('totalAmount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Filter state
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // Fetch vendors list
  const { data: vendors = [], isLoading } = useQuery<VendorSummary[]>({
    queryKey: ['business-accounting-vendors'],
    queryFn: businessAccountingApi.getVendors,
  });

  // Fetch selected vendor's payment history
  const { data: paymentHistory = [] } = useQuery<VendorPaymentHistory[]>({
    queryKey: ['vendor-payments', selectedVendor],
    queryFn: () => businessAccountingApi.getVendorPayments(selectedVendor!),
    enabled: !!selectedVendor,
  });

  // Fetch transactions for expanded month
  const { data: monthTransactions = [] } = useQuery<BusinessTransaction[]>({
    queryKey: ['vendor-transactions', selectedVendor, expandedMonth],
    queryFn: () => businessAccountingApi.getVendorTransactions(selectedVendor!, expandedMonth!),
    enabled: !!selectedVendor && !!expandedMonth,
  });

  const handleTransactionUpdate = () => {
    queryClient.invalidateQueries({ queryKey: ['vendor-transactions'] });
    queryClient.invalidateQueries({ queryKey: ['vendor-payments'] });
    queryClient.invalidateQueries({ queryKey: ['business-accounting-vendors'] });
    queryClient.invalidateQueries({ queryKey: ['business-accounting-transactions'] });
    queryClient.invalidateQueries({ queryKey: ['business-accounting-summary'] });
  };

  const renameVendorMutation = useMutation({
    mutationFn: ({ oldName, newName }: { oldName: string; newName: string }) =>
      businessAccountingApi.renameVendor(oldName, newName),
    onSuccess: (data) => {
      // Update selectedVendor to the new name
      setSelectedVendor(data.newName);
      setIsEditingName(false);
      // Invalidate all related queries
      queryClient.invalidateQueries({ queryKey: ['business-accounting-vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-payments'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['business-accounting-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['gst-invoices'] });
    },
    onError: (error: any) => {
      alert(`Failed to rename vendor: ${error.response?.data?.error || error.message}`);
    },
  });

  const startEditingName = () => {
    setEditedName(selectedVendor || '');
    setIsEditingName(true);
  };

  const cancelEditingName = () => {
    setIsEditingName(false);
    setEditedName('');
  };

  const saveVendorName = () => {
    if (selectedVendor && editedName.trim() && editedName.trim() !== selectedVendor) {
      renameVendorMutation.mutate({ oldName: selectedVendor, newName: editedName.trim() });
    } else {
      cancelEditingName();
    }
  };

  // Extract unique values for filters - MUST be before any returns
  const uniqueAccounts = useMemo(() => {
    const accts = new Set<string>();
    vendors.forEach(v => {
      if (v.accountNames && Array.isArray(v.accountNames)) {
        v.accountNames.forEach(a => accts.add(a));
      }
    });
    return Array.from(accts).sort();
  }, [vendors]);

  const uniqueTypes = useMemo(() => {
    const types = new Set<string>();
    vendors.forEach(v => {
      if (v.primaryType) types.add(v.primaryType);
    });
    return Array.from(types).sort();
  }, [vendors]);

  // Handle sort
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // Sort icon component
  const SortIcon = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) return null;
    return sortDirection === 'asc' ? (
      <ChevronUp className="h-3 w-3 ml-1 inline" />
    ) : (
      <ChevronDown className="h-3 w-3 ml-1 inline" />
    );
  };

  // Filter and sort vendors - MUST be before any returns
  const filteredAndSortedVendors = useMemo(() => {
    let result = [...vendors];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(v => v.vendorName.toLowerCase().includes(query));
    }

    // Apply account filter
    if (accountFilter !== 'all') {
      result = result.filter(v => v.accountNames?.includes(accountFilter));
    }

    // Apply type filter
    if (typeFilter !== 'all') {
      result = result.filter(v => v.primaryType === typeFilter);
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'vendorName':
          comparison = a.vendorName.localeCompare(b.vendorName);
          break;
        case 'accountNames':
          comparison = (a.accountNames?.join(',') || '').localeCompare(b.accountNames?.join(',') || '');
          break;
        case 'primaryType':
          comparison = (a.primaryType || '').localeCompare(b.primaryType || '');
          break;
        case 'transactionCount':
          comparison = a.transactionCount - b.transactionCount;
          break;
        case 'totalAmount':
          comparison = a.totalAmount - b.totalAmount;
          break;
        case 'avgPayment':
          comparison = (a.avgPayment || 0) - (b.avgPayment || 0);
          break;
        case 'invoiceCount':
          comparison = a.invoiceCount - b.invoiceCount;
          break;
        case 'lastPaymentDate':
          comparison = (a.lastPaymentDate || '').localeCompare(b.lastPaymentDate || '');
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [vendors, searchQuery, accountFilter, typeFilter, sortColumn, sortDirection]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading vendors...
        </CardContent>
      </Card>
    );
  }

  if (vendors.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No vendors found. Run auto-enrichment first to detect vendor names from transactions.
        </CardContent>
      </Card>
    );
  }

  // Vendor detail view
  if (selectedVendor) {
    const vendor = vendors.find((v) => v.vendorName === selectedVendor);

    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => { setSelectedVendor(null); setExpandedMonth(null); }}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Vendors
        </Button>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
                <Users className="h-6 w-6 text-blue-600 dark:text-blue-300" />
              </div>
              <div className="flex-1">
                {isEditingName ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editedName}
                      onChange={(e) => setEditedName(e.target.value)}
                      className="max-w-xs font-semibold text-lg"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveVendorName();
                        if (e.key === 'Escape') cancelEditingName();
                      }}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={saveVendorName}
                      disabled={renameVendorMutation.isPending}
                      className="h-8 w-8 text-green-600"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={cancelEditingName}
                      className="h-8 w-8 text-red-500"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <CardTitle>{selectedVendor}</CardTitle>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={startEditingName}
                      className="h-8 w-8"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  {vendor?.transactionCount} payments totaling {formatCurrency(vendor?.totalAmount || 0)}
                </p>
              </div>
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment History</CardTitle>
            <p className="text-sm text-muted-foreground">Click on a month to see individual transactions</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {paymentHistory.map((payment) => (
                <div key={payment.month}>
                  {/* Month Header - Clickable */}
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => setExpandedMonth(expandedMonth === payment.month ? null : payment.month)}
                  >
                    <div className="flex items-center gap-3">
                      {expandedMonth === payment.month ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <div>
                        <p className="font-medium">
                          {format(new Date(payment.month + '-01'), 'MMMM yyyy')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {payment.transactionCount} transaction{payment.transactionCount > 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <span className="font-medium text-red-600">
                      {formatCurrency(payment.totalAmount)}
                    </span>
                  </div>

                  {/* Expanded Transactions */}
                  {expandedMonth === payment.month && (
                    <div className="bg-muted/30 border-t">
                      {monthTransactions.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                          Loading transactions...
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                              <TableHead className="text-center">Invoice</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {monthTransactions.map((tx) => (
                              <TableRow
                                key={tx.id}
                                className="cursor-pointer hover:bg-muted/50"
                                onClick={() => setSelectedTransaction(tx)}
                              >
                                <TableCell className="text-sm">
                                  {formatDate(tx.date)}
                                </TableCell>
                                <TableCell>
                                  <div className="max-w-[300px]">
                                    <div className="truncate text-sm">
                                      {tx.bizDescription || tx.narration}
                                    </div>
                                    {tx.bizDescription && (
                                      <div className="truncate text-xs text-muted-foreground">
                                        {tx.narration}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {tx.bizType && (
                                    <Badge variant="outline" className="text-xs">
                                      {tx.bizType}
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <span className={tx.transactionType === 'credit' ? 'text-green-600' : 'text-red-600'}>
                                    {tx.transactionType === 'credit' ? '+' : '-'}
                                    {formatCurrency(tx.amount)}
                                  </span>
                                </TableCell>
                                <TableCell className="text-center">
                                  {tx.invoiceFileId ? (
                                    <FileText className="inline-block h-4 w-4 text-green-600" />
                                  ) : tx.needsInvoice ? (
                                    <span className="text-amber-500 text-xs">Pending</span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Transaction Detail Modal */}
        {selectedTransaction && (
          <TransactionDetailModal
            transaction={selectedTransaction}
            onClose={() => setSelectedTransaction(null)}
            onUpdate={handleTransactionUpdate}
          />
        )}
      </div>
    );
  }

  // Vendors list view
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Vendors</CardTitle>
            <Users className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{vendors.length}</div>
            <p className="text-xs text-muted-foreground">
              {filteredAndSortedVendors.length} shown
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Amount</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(filteredAndSortedVendors.reduce((sum, v) => sum + v.totalAmount, 0))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg per Vendor</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(filteredAndSortedVendors.length > 0 ? Math.round(filteredAndSortedVendors.reduce((sum, v) => sum + v.totalAmount, 0) / filteredAndSortedVendors.length) : 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Invoices Attached</CardTitle>
            <FileText className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {filteredAndSortedVendors.reduce((sum, v) => sum + v.invoiceCount, 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>All Vendors</CardTitle>
            <div className="flex flex-wrap gap-2">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search vendors..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-48"
                />
              </div>
              {/* Account Filter */}
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Account" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Accounts</SelectItem>
                  {uniqueAccounts.map(acc => (
                    <SelectItem key={acc} value={acc}>{acc}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Type Filter */}
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {uniqueTypes.map(type => (
                    <SelectItem key={type} value={type}>{TYPE_LABELS[type] || type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('vendorName')}
                >
                  Vendor Name <SortIcon column="vendorName" />
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('accountNames')}
                >
                  Account <SortIcon column="accountNames" />
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('primaryType')}
                >
                  Type <SortIcon column="primaryType" />
                </TableHead>
                <TableHead
                  className="text-right cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('transactionCount')}
                >
                  Txns <SortIcon column="transactionCount" />
                </TableHead>
                <TableHead
                  className="text-right cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('totalAmount')}
                >
                  Total Amount <SortIcon column="totalAmount" />
                </TableHead>
                <TableHead
                  className="text-right cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('avgPayment')}
                >
                  Avg <SortIcon column="avgPayment" />
                </TableHead>
                <TableHead
                  className="text-right cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('invoiceCount')}
                >
                  Invoices <SortIcon column="invoiceCount" />
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('lastPaymentDate')}
                >
                  Last Payment <SortIcon column="lastPaymentDate" />
                </TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedVendors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No vendors found
                  </TableCell>
                </TableRow>
              ) : (
                filteredAndSortedVendors.map((vendor) => (
                  <TableRow
                    key={vendor.vendorName}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedVendor(vendor.vendorName)}
                  >
                    <TableCell className="font-medium">{vendor.vendorName}</TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {vendor.accountNames?.join(', ') || '-'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {vendor.primaryType ? (
                        <Badge className={TYPE_COLORS[vendor.primaryType] || 'bg-slate-100 text-slate-800'}>
                          {TYPE_LABELS[vendor.primaryType] || vendor.primaryType}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{vendor.transactionCount}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(vendor.totalAmount)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatCurrency(vendor.avgPayment || 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      {vendor.invoiceCount > 0 ? (
                        <span className="text-green-600">{vendor.invoiceCount}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(vendor.lastPaymentDate)}</TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

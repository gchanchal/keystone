import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Users, FileText, ChevronRight, ArrowLeft, ChevronDown, Edit2, Check, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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

export function VendorsTab() {
  const queryClient = useQueryClient();
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<BusinessTransaction | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');

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
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Vendors</CardTitle>
            <Users className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{vendors.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Paid</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(vendors.reduce((sum, v) => sum + v.totalAmount, 0))}
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
              {vendors.reduce((sum, v) => sum + v.invoiceCount, 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Vendors</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor Name</TableHead>
                <TableHead className="text-right">Transactions</TableHead>
                <TableHead className="text-right">Total Amount</TableHead>
                <TableHead className="text-right">Invoices</TableHead>
                <TableHead>Last Payment</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendors.map((vendor) => (
                <TableRow
                  key={vendor.vendorName}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedVendor(vendor.vendorName)}
                >
                  <TableCell className="font-medium">{vendor.vendorName}</TableCell>
                  <TableCell className="text-right">{vendor.transactionCount}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(vendor.totalAmount)}
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
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

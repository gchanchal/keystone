import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { businessAccountingApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import type { GSTSummary } from '@/types';

export function GSTSummaryTab() {
  const { data: gstSummary, isLoading } = useQuery<GSTSummary>({
    queryKey: ['gst-summary'],
    queryFn: () => businessAccountingApi.getGSTSummary(),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading GST summary...
        </CardContent>
      </Card>
    );
  }

  if (!gstSummary || gstSummary.months.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No GST data available. Run auto-enrichment first to detect GST transactions.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">GST Collected (Output)</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(gstSummary.totals.output)}
            </div>
            <p className="text-xs text-muted-foreground">From sales</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">GST Paid (Input)</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatCurrency(gstSummary.totals.input)}
            </div>
            <p className="text-xs text-muted-foreground">From purchases</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net GST Liability</CardTitle>
            <Minus className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                gstSummary.totals.net >= 0 ? 'text-amber-600' : 'text-green-600'
              }`}
            >
              {gstSummary.totals.net >= 0 ? '' : '-'}
              {formatCurrency(Math.abs(gstSummary.totals.net))}
            </div>
            <p className="text-xs text-muted-foreground">
              {gstSummary.totals.net >= 0 ? 'Payable to government' : 'Credit available'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly GST Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">GST Collected (Output)</TableHead>
                <TableHead className="text-right">GST Paid (Input)</TableHead>
                <TableHead className="text-right">Net Liability</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gstSummary.months.map((month) => (
                <TableRow key={month.month}>
                  <TableCell className="font-medium">
                    {format(new Date(month.month + '-01'), 'MMMM yyyy')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="text-green-600">{formatCurrency(month.output)}</div>
                    <div className="text-xs text-muted-foreground">
                      {month.outputCount} transactions
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="text-red-600">{formatCurrency(month.input)}</div>
                    <div className="text-xs text-muted-foreground">
                      {month.inputCount} transactions
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div
                      className={`font-medium ${
                        month.net >= 0 ? 'text-amber-600' : 'text-green-600'
                      }`}
                    >
                      {month.net >= 0 ? '' : '-'}
                      {formatCurrency(Math.abs(month.net))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Info Note */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
        <h4 className="font-medium text-blue-800 dark:text-blue-300">About GST Tracking</h4>
        <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
          <strong>GST Collected (Output):</strong> GST on sales income (from payment gateways like Cashfree/Razorpay).
          <br />
          <strong>GST Paid (Input):</strong> GST paid on purchases from vendors (requires invoices).
          <br />
          <strong>Net Liability:</strong> If positive, you owe GST to the government. If negative, you have input credit.
        </p>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AreaChart } from '@/components/charts/AreaChart';
import { LineChart } from '@/components/charts/LineChart';
import { portfolioApi, investmentsApi, mutualFundsApi, assetsApi, policiesApi, loansApi } from '@/lib/api';
import { useCurrency } from '@/contexts/CurrencyContext';

interface PortfolioSnapshot {
  id: string;
  snapshotDate: string;
  snapshotTime: string;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  totalInvestments: number;
  usStocksValue: number;
  indiaStocksValue: number;
  mutualFundsValue: number;
  dayChangeAmount: number;
  dayChangePercent: number;
}

interface PerformanceData {
  labels: string[];
  netWorth: number[];
  totalInvestments: number[];
  totalLiabilities: number[];
  usStocksValue: number[];
  indiaStocksValue: number[];
  mutualFundsValue: number[];
}

interface StockTrendsData {
  labels: string[];
  totalValue: number[];
  usStocksValue: number[];
  indiaStocksValue: number[];
  stocks: Array<{
    symbol: string;
    name: string;
    country: string;
    quantity: number;
    values: number[];
  }>;
}

export function PortfolioPerformance() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'quarterly'>('daily');
  const { formatAmount, exchangeRate, convert, currency } = useCurrency();

  // Fetch all investments for current value calculation (matching Investments page)
  const { data: investmentsData = [] } = useQuery({
    queryKey: ['investments-all'],
    queryFn: () => investmentsApi.getAll(),
  });

  const { data: mutualFundsSummary } = useQuery({
    queryKey: ['mutual-funds-summary'],
    queryFn: () => mutualFundsApi.getSummary(),
  });

  const { data: assetsSummary } = useQuery({
    queryKey: ['assets-summary'],
    queryFn: () => assetsApi.getSummary(),
  });

  const { data: policiesSummary } = useQuery({
    queryKey: ['policies-summary'],
    queryFn: () => policiesApi.getSummary(),
  });

  const { data: loansSummary } = useQuery({
    queryKey: ['loans-summary'],
    queryFn: () => loansApi.getSummary(),
  });

  // Calculate investments by country (same as Investments page)
  const investmentsByCountry = investmentsData.reduce(
    (acc: { india: number; us: number }, inv: any) => {
      const currentValue = inv.currentValue || (inv.quantity * inv.purchasePrice);
      if (inv.country === 'US') {
        acc.us += currentValue;
      } else {
        acc.india += currentValue;
      }
      return acc;
    },
    { india: 0, us: 0 }
  );

  // Convert US investments to INR
  const usInvestmentsInINR = investmentsByCountry.us * exchangeRate;

  // Total investments (matching Investments page exactly)
  const totalFundsINR = investmentsByCountry.india + usInvestmentsInINR + (mutualFundsSummary?.totalCurrentValue || 0);
  const totalAssetsINR = assetsSummary?.totalCurrentValue || 0;
  const totalPoliciesINR = policiesSummary?.totalPremiumPaid || 0;
  const totalInvestments = totalFundsINR + totalAssetsINR + totalPoliciesINR;

  // Liabilities
  const totalLiabilities = loansSummary?.taken?.outstanding || 0;
  const loansGiven = loansSummary?.given?.outstanding || 0;

  // Net Worth (Investments + Loans Given - Liabilities) - excluding bank balance as requested
  const netWorth = totalInvestments + loansGiven - totalLiabilities;

  // Fetch performance data for charts
  const { data: performance, isLoading: performanceLoading } = useQuery<PerformanceData>({
    queryKey: ['portfolio', 'performance', period],
    queryFn: () => portfolioApi.getPerformance({ period, limit: 30 }),
  });

  // Fetch snapshots
  const { data: snapshots = [] } = useQuery<PortfolioSnapshot[]>({
    queryKey: ['portfolio', 'snapshots'],
    queryFn: () => portfolioApi.getSnapshots({ limit: 90 }),
  });

  // Fetch stock trends (30-day historical performance)
  const { data: stockTrends, isLoading: stockTrendsLoading } = useQuery<StockTrendsData>({
    queryKey: ['portfolio', 'stock-trends'],
    queryFn: () => portfolioApi.getStockTrends(30),
  });

  // Fetch latest snapshot for change indicator
  const { data: latestSnapshot } = useQuery<PortfolioSnapshot>({
    queryKey: ['portfolio', 'latest'],
    queryFn: portfolioApi.getLatestSnapshot,
  });

  // Initialize mutation
  const initializeMutation = useMutation({
    mutationFn: portfolioApi.initialize,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });

  // Capture mutation
  const captureMutation = useMutation({
    mutationFn: () => portfolioApi.capture(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });

  const isInitialized = snapshots.length > 0;

  // Auto-initialize tracking if not yet started
  useEffect(() => {
    if (!isInitialized && !initializeMutation.isPending && !initializeMutation.isSuccess) {
      initializeMutation.mutate();
    }
  }, [isInitialized]);

  // Chart data (apply currency conversion - all backend data is in INR)
  const netWorthChartData = performance?.labels.map((label, idx) => ({
    name: label,
    'Net Worth': convert(performance.netWorth[idx], 'INR'),
    'Investments': convert(performance.totalInvestments[idx], 'INR'),
  })) || [];

  const investmentTrendsData = performance?.labels.map((label, idx) => ({
    name: label,
    'US Stocks': convert(performance.usStocksValue[idx], 'INR'),
    'India Stocks': convert(performance.indiaStocksValue[idx], 'INR'),
    'Mutual Funds': convert(performance.mutualFundsValue[idx], 'INR'),
  })) || [];

  // Stock trends chart data (30-day historical based on current holdings)
  const stockTrendsChartData = stockTrends?.labels.map((label, idx) => ({
    name: label,
    'Total': convert(stockTrends.totalValue[idx], 'INR'),
    'US Stocks': convert(stockTrends.usStocksValue[idx], 'INR'),
    'India Stocks': convert(stockTrends.indiaStocksValue[idx], 'INR'),
  })) || [];

  // Calculate period change
  const getChangeFromSnapshots = () => {
    if (snapshots.length < 2) return { amount: 0, percent: 0 };
    const latest = snapshots[0];
    const previous = snapshots[snapshots.length - 1];
    const change = latest.netWorth - previous.netWorth;
    const percent = previous.netWorth ? (change / previous.netWorth) * 100 : 0;
    return { amount: change, percent };
  };

  const periodChange = getChangeFromSnapshots();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Portfolio Performance</h1>
          <p className="text-muted-foreground">
            Track your investment trends over time
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => captureMutation.mutate()}
            disabled={captureMutation.isPending || initializeMutation.isPending}
          >
            {(captureMutation.isPending || initializeMutation.isPending) ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Snapshot
          </Button>
        </div>
      </div>

      {/* Summary Cards - Compact Row */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/20">
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Net Worth</div>
            <div className="text-2xl font-bold">{formatAmount(netWorth)}</div>
            {latestSnapshot && latestSnapshot.dayChangeAmount !== 0 && (
              <div className={`flex items-center text-xs mt-1 ${
                latestSnapshot.dayChangeAmount >= 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {latestSnapshot.dayChangeAmount >= 0 ? (
                  <ArrowUpRight className="h-3 w-3 mr-1" />
                ) : (
                  <ArrowDownRight className="h-3 w-3 mr-1" />
                )}
                {formatAmount(Math.abs(latestSnapshot.dayChangeAmount))} today
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Total Investments</div>
            <div className="text-2xl font-bold text-green-600">{formatAmount(totalInvestments)}</div>
            <div className="text-xs text-muted-foreground">Stocks + MF + Assets</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Total Liabilities</div>
            <div className="text-2xl font-bold text-red-600">{formatAmount(totalLiabilities)}</div>
            <div className="text-xs text-muted-foreground">Loans outstanding</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Period Change</div>
            <div className={`text-2xl font-bold ${periodChange.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {periodChange.amount >= 0 ? '+' : ''}{formatAmount(periodChange.amount)}
            </div>
            <div className={`text-xs ${periodChange.percent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {periodChange.percent >= 0 ? '+' : ''}{periodChange.percent.toFixed(2)}% overall
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Chart - Net Worth Trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Net Worth Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {performanceLoading ? (
            <div className="flex items-center justify-center h-72">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : netWorthChartData.length > 0 ? (
            <AreaChart
              data={netWorthChartData}
              xKey="name"
              yKeys={[
                { key: 'Net Worth', color: '#3b82f6', name: 'Net Worth' },
                { key: 'Investments', color: '#10b981', name: 'Investments' },
              ]}
              height={300}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-72 text-muted-foreground">
              <Calendar className="h-12 w-12 mb-4 opacity-50" />
              <p className="font-medium">Building history...</p>
              <p className="text-sm">Snapshots are captured automatically. Check back tomorrow for trends.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Investment Breakdown Trends */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Investment Category Trends</CardTitle>
        </CardHeader>
        <CardContent>
          {performanceLoading ? (
            <div className="flex items-center justify-center h-72">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : investmentTrendsData.length > 0 ? (
            <AreaChart
              data={investmentTrendsData}
              xKey="name"
              yKeys={[
                { key: 'US Stocks', color: '#10b981', name: 'US Stocks' },
                { key: 'India Stocks', color: '#6366f1', name: 'India Stocks' },
                { key: 'Mutual Funds', color: '#f59e0b', name: 'Mutual Funds' },
              ]}
              height={300}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-72 text-muted-foreground">
              <TrendingUp className="h-12 w-12 mb-4 opacity-50" />
              <p className="font-medium">Building history...</p>
              <p className="text-sm">Investment category trends will appear as data accumulates</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stock Performance Trends - 30-day historical based on current holdings */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Stock Performance (Last 30 Days)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Based on current holdings quantity × historical ticker prices
          </p>
        </CardHeader>
        <CardContent>
          {stockTrendsLoading ? (
            <div className="flex items-center justify-center h-72">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : stockTrendsChartData.length > 0 ? (
            <AreaChart
              data={stockTrendsChartData}
              xKey="name"
              yKeys={[
                { key: 'Total', color: '#3b82f6', name: 'Total Stocks' },
                { key: 'US Stocks', color: '#10b981', name: 'US Stocks' },
                { key: 'India Stocks', color: '#6366f1', name: 'India Stocks' },
              ]}
              height={300}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-72 text-muted-foreground">
              <TrendingUp className="h-12 w-12 mb-4 opacity-50" />
              <p className="font-medium">No stocks found</p>
              <p className="text-sm">Add stocks to see their historical performance trend</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent History - Compact Table */}
      {snapshots.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Snapshot History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {snapshots.slice(0, 10).map((snapshot, idx) => (
                <div
                  key={snapshot.id}
                  className={`flex items-center justify-between py-2 px-3 rounded ${idx % 2 === 0 ? 'bg-muted/30' : ''}`}
                >
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium w-24">
                      {format(new Date(snapshot.snapshotDate), 'MMM dd, yyyy')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {snapshot.snapshotTime?.substring(0, 5)}
                    </span>
                  </div>
                  <div className="flex items-center gap-6">
                    <span className="font-semibold">{formatAmount(snapshot.netWorth)}</span>
                    {snapshot.dayChangeAmount !== 0 && (
                      <span className={`text-sm flex items-center w-28 justify-end ${
                        snapshot.dayChangeAmount >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {snapshot.dayChangeAmount >= 0 ? (
                          <TrendingUp className="h-3 w-3 mr-1" />
                        ) : (
                          <TrendingDown className="h-3 w-3 mr-1" />
                        )}
                        {formatAmount(Math.abs(snapshot.dayChangeAmount))}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

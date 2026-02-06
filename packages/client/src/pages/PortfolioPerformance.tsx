import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  PiggyBank,
  CreditCard,
  Home,
  Car,
  Briefcase,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LineChart } from '@/components/charts/LineChart';
import { PieChart } from '@/components/charts/PieChart';
import { AreaChart } from '@/components/charts/AreaChart';
import { portfolioApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

interface PortfolioSummary {
  bankBalance: number;
  usStocksValue: number;
  indiaStocksValue: number;
  mutualFundsValue: number;
  fdValue: number;
  ppfValue: number;
  goldValue: number;
  cryptoValue: number;
  otherInvestmentsValue: number;
  realEstateValue: number;
  vehiclesValue: number;
  otherAssetsValue: number;
  loansGivenValue: number;
  homeLoanOutstanding: number;
  carLoanOutstanding: number;
  personalLoanOutstanding: number;
  otherLoansOutstanding: number;
  creditCardDues: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  totalInvestments: number;
  totalPhysicalAssets: number;
}

interface PortfolioSnapshot {
  id: string;
  snapshotDate: string;
  snapshotTime: string;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  totalInvestments: number;
  dayChangeAmount: number;
  dayChangePercent: number;
}

interface AllocationData {
  assets: { name: string; value: number; color: string }[];
  liabilities: { name: string; value: number; color: string }[];
  summary: { totalAssets: number; totalLiabilities: number; netWorth: number };
}

interface PerformanceData {
  labels: string[];
  netWorth: number[];
  totalInvestments: number[];
  totalLiabilities: number[];
  bankBalance: number[];
}

export function PortfolioPerformance() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'quarterly'>('daily');

  // Fetch portfolio summary
  const { data: summary, isLoading: summaryLoading } = useQuery<PortfolioSummary>({
    queryKey: ['portfolio', 'summary'],
    queryFn: portfolioApi.getSummary,
  });

  // Fetch latest snapshot
  const { data: latestSnapshot } = useQuery<PortfolioSnapshot>({
    queryKey: ['portfolio', 'latest'],
    queryFn: portfolioApi.getLatestSnapshot,
  });

  // Fetch allocation data
  const { data: allocation } = useQuery<AllocationData>({
    queryKey: ['portfolio', 'allocation'],
    queryFn: portfolioApi.getAllocation,
  });

  // Fetch performance data
  const { data: performance, isLoading: performanceLoading } = useQuery<PerformanceData>({
    queryKey: ['portfolio', 'performance', period],
    queryFn: () => portfolioApi.getPerformance({ period, limit: 30 }),
  });

  // Fetch snapshots
  const { data: snapshots = [] } = useQuery<PortfolioSnapshot[]>({
    queryKey: ['portfolio', 'snapshots'],
    queryFn: () => portfolioApi.getSnapshots({ limit: 90 }),
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

  // Check if initialized
  const isInitialized = snapshots.length > 0;

  // Format performance data for charts
  const netWorthChartData = performance?.labels.map((label, idx) => ({
    name: label,
    value: performance.netWorth[idx],
  })) || [];

  const investmentChartData = performance?.labels.map((label, idx) => ({
    name: label,
    investments: performance.totalInvestments[idx],
    liabilities: performance.totalLiabilities[idx],
  })) || [];

  const areaChartData = performance?.labels.map((label, idx) => ({
    name: label,
    'Net Worth': performance.netWorth[idx],
    'Investments': performance.totalInvestments[idx],
    'Bank Balance': performance.bankBalance[idx],
  })) || [];

  if (summaryLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Portfolio Performance</h1>
          <p className="text-muted-foreground">
            Track your net worth and portfolio changes over time
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isInitialized ? (
            <Button
              onClick={() => initializeMutation.mutate()}
              disabled={initializeMutation.isPending}
            >
              {initializeMutation.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <TrendingUp className="mr-2 h-4 w-4" />
              )}
              Initialize Tracking
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => captureMutation.mutate()}
              disabled={captureMutation.isPending}
            >
              {captureMutation.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Capture Snapshot
            </Button>
          )}
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Net Worth */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Worth</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(summary?.netWorth || 0)}
            </div>
            {latestSnapshot && (
              <div className={`flex items-center text-xs ${
                latestSnapshot.dayChangeAmount >= 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {latestSnapshot.dayChangeAmount >= 0 ? (
                  <ArrowUpRight className="h-3 w-3 mr-1" />
                ) : (
                  <ArrowDownRight className="h-3 w-3 mr-1" />
                )}
                {formatCurrency(Math.abs(latestSnapshot.dayChangeAmount))} (
                {latestSnapshot.dayChangePercent.toFixed(2)}%)
              </div>
            )}
          </CardContent>
        </Card>

        {/* Total Assets */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Assets</CardTitle>
            <PiggyBank className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(summary?.totalAssets || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Investments + Bank + Physical Assets
            </p>
          </CardContent>
        </Card>

        {/* Total Liabilities */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Liabilities</CardTitle>
            <CreditCard className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatCurrency(summary?.totalLiabilities || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Loans + Credit Card Dues
            </p>
          </CardContent>
        </Card>

        {/* Total Investments */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Investments</CardTitle>
            <Briefcase className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {formatCurrency(summary?.totalInvestments || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Stocks + MF + FD + Others
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Investment Breakdown */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">US Stocks</div>
            <div className="text-lg font-bold">{formatCurrency(summary?.usStocksValue || 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">India Stocks</div>
            <div className="text-lg font-bold">{formatCurrency(summary?.indiaStocksValue || 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Mutual Funds</div>
            <div className="text-lg font-bold">{formatCurrency(summary?.mutualFundsValue || 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Fixed Deposits</div>
            <div className="text-lg font-bold">{formatCurrency(summary?.fdValue || 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Gold</div>
            <div className="text-lg font-bold">{formatCurrency(summary?.goldValue || 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">PPF</div>
            <div className="text-lg font-bold">{formatCurrency(summary?.ppfValue || 0)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <Tabs defaultValue="networth" className="space-y-4">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="networth">Net Worth Trend</TabsTrigger>
            <TabsTrigger value="allocation">Asset Allocation</TabsTrigger>
            <TabsTrigger value="breakdown">Detailed Breakdown</TabsTrigger>
          </TabsList>
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
        </div>

        <TabsContent value="networth">
          <Card>
            <CardHeader>
              <CardTitle>Net Worth Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              {performanceLoading ? (
                <div className="flex items-center justify-center h-64">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : netWorthChartData.length > 0 ? (
                <AreaChart
                  data={areaChartData}
                  xKey="name"
                  yKeys={[
                    { key: 'Net Worth', color: '#3b82f6', name: 'Net Worth' },
                    { key: 'Investments', color: '#10b981', name: 'Investments' },
                    { key: 'Bank Balance', color: '#f59e0b', name: 'Bank Balance' },
                  ]}
                  height={350}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <TrendingUp className="h-12 w-12 mb-4" />
                  <p>No snapshot data available yet</p>
                  <p className="text-sm">Click "Initialize Tracking" to start</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="allocation">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Asset Allocation</CardTitle>
              </CardHeader>
              <CardContent>
                {allocation?.assets && allocation.assets.length > 0 ? (
                  <PieChart
                    data={allocation.assets}
                    height={300}
                  />
                ) : (
                  <div className="flex items-center justify-center h-64 text-muted-foreground">
                    No assets to display
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Liabilities Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                {allocation?.liabilities && allocation.liabilities.length > 0 ? (
                  <PieChart
                    data={allocation.liabilities}
                    height={300}
                  />
                ) : (
                  <div className="flex items-center justify-center h-64 text-muted-foreground">
                    No liabilities - Great!
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="breakdown">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Assets Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-green-600">Assets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bank Balance</span>
                  <span className="font-medium">{formatCurrency(summary?.bankBalance || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">US Stocks</span>
                  <span className="font-medium">{formatCurrency(summary?.usStocksValue || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">India Stocks</span>
                  <span className="font-medium">{formatCurrency(summary?.indiaStocksValue || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mutual Funds</span>
                  <span className="font-medium">{formatCurrency(summary?.mutualFundsValue || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fixed Deposits</span>
                  <span className="font-medium">{formatCurrency(summary?.fdValue || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">PPF</span>
                  <span className="font-medium">{formatCurrency(summary?.ppfValue || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gold</span>
                  <span className="font-medium">{formatCurrency(summary?.goldValue || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Crypto</span>
                  <span className="font-medium">{formatCurrency(summary?.cryptoValue || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Real Estate</span>
                  <span className="font-medium">{formatCurrency(summary?.realEstateValue || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vehicles</span>
                  <span className="font-medium">{formatCurrency(summary?.vehiclesValue || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Loans Given</span>
                  <span className="font-medium">{formatCurrency(summary?.loansGivenValue || 0)}</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-medium">Total Assets</span>
                  <span className="font-bold text-green-600">{formatCurrency(summary?.totalAssets || 0)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Liabilities Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-red-600">Liabilities</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Home Loan</span>
                  <span className="font-medium">{formatCurrency(summary?.homeLoanOutstanding || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Car Loan</span>
                  <span className="font-medium">{formatCurrency(summary?.carLoanOutstanding || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Personal Loan</span>
                  <span className="font-medium">{formatCurrency(summary?.personalLoanOutstanding || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Other Loans</span>
                  <span className="font-medium">{formatCurrency(summary?.otherLoansOutstanding || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Credit Card Dues</span>
                  <span className="font-medium">{formatCurrency(summary?.creditCardDues || 0)}</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-medium">Total Liabilities</span>
                  <span className="font-bold text-red-600">{formatCurrency(summary?.totalLiabilities || 0)}</span>
                </div>
                <div className="flex justify-between border-t pt-4 mt-4">
                  <span className="text-lg font-bold">Net Worth</span>
                  <span className={`text-lg font-bold ${(summary?.netWorth || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(summary?.netWorth || 0)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Recent Snapshots */}
      {snapshots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Snapshots</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {snapshots.slice(0, 5).map((snapshot) => (
                <div
                  key={snapshot.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div>
                    <div className="font-medium">
                      {format(new Date(snapshot.snapshotDate), 'MMM dd, yyyy')}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {snapshot.snapshotTime}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">{formatCurrency(snapshot.netWorth)}</div>
                    <div className={`text-sm flex items-center justify-end ${
                      snapshot.dayChangeAmount >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {snapshot.dayChangeAmount >= 0 ? (
                        <TrendingUp className="h-3 w-3 mr-1" />
                      ) : (
                        <TrendingDown className="h-3 w-3 mr-1" />
                      )}
                      {formatCurrency(Math.abs(snapshot.dayChangeAmount))}
                    </div>
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

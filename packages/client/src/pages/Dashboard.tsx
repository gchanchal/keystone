import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ShoppingCart,
  Receipt,
  CreditCard,
  Landmark,
  PiggyBank,
  LineChart as LineChartIcon,
  HandCoins,
  Building2,
  Calendar,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AreaChart } from '@/components/charts/AreaChart';
import { BarChart } from '@/components/charts/BarChart';
import { LineChart } from '@/components/charts/LineChart';
import { PieChart } from '@/components/charts/PieChart';
import { dashboardApi, loansApi, investmentsApi, mutualFundsApi, assetsApi, policiesApi, portfolioApi } from '@/lib/api';
import { formatDate, getMonthYear, parseMonthYear } from '@/lib/utils';
import { useCurrency } from '@/contexts/CurrencyContext';
import { format, addMonths, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import type { DashboardStats, ExpenseBreakdown } from '@/types';

type Granularity = 'daily' | 'weekly' | 'monthly';

export function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { formatAmount } = useCurrency();

  // Get mode from URL path (default to personal)
  const activeTab = location.pathname === '/gearup' ? 'business' : 'personal';

  // Date range state - read from localStorage, default to last 3 months
  const [startMonth, setStartMonth] = useState(() => {
    const stored = localStorage.getItem('keystone-date-start');
    if (stored) return stored;
    return format(subMonths(new Date(), 2), 'yyyy-MM');
  });
  const [endMonth, setEndMonth] = useState(() => {
    const stored = localStorage.getItem('keystone-date-end');
    if (stored) return stored;
    return getMonthYear();
  });
  const [granularity, setGranularity] = useState<Granularity>(() => {
    const stored = localStorage.getItem('keystone-dashboard-granularity');
    return (stored as Granularity) || 'weekly';
  });

  // Persist granularity to localStorage
  useEffect(() => {
    localStorage.setItem('keystone-dashboard-granularity', granularity);
  }, [granularity]);

  // Persist date range to localStorage
  useEffect(() => {
    localStorage.setItem('keystone-date-start', startMonth);
    localStorage.setItem('keystone-date-end', endMonth);
  }, [startMonth, endMonth]);

  const startMonthDate = parseMonthYear(startMonth);
  const endMonthDate = parseMonthYear(endMonth);
  const startDate = format(startOfMonth(startMonthDate), 'yyyy-MM-dd');
  const endDate = format(endOfMonth(endMonthDate), 'yyyy-MM-dd');

  // Navigation helpers
  const goToTransactions = (tab: string, filters?: Record<string, string>) => {
    const params = new URLSearchParams();
    params.set('startDate', startDate);
    params.set('endDate', endDate);
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        params.set(key, value);
      });
    }

    // GearUp business mode → navigate to Business Accounting Transactions
    if (activeTab === 'business') {
      params.set('tab', 'transactions');
      // Map vyapar transaction types to Business Accounting tile filters
      const txType = filters?.transactionType;
      if (txType === 'Sale') params.set('filter', 'income');
      else if (txType === 'Sale Order') params.set('filter', 'saleOrders');
      else if (txType === 'Expense') params.set('filter', 'expenses');
      navigate(`/gearup/accounting?${params.toString()}`);
    } else {
      params.set('tab', tab);
      navigate(`/transactions?${params.toString()}`);
    }
  };

  // ===== SHARED DATA =====
  // Fetch dashboard stats (includes total balance)
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats', endMonth],
    queryFn: () => dashboardApi.getStats(endMonth),
  });

  // Fetch portfolio summary (for consistent net worth calculation)
  const { data: portfolioSummary } = useQuery({
    queryKey: ['portfolio', 'summary'],
    queryFn: portfolioApi.getSummary,
  });

  // ===== PERSONAL TAB DATA =====
  // Fetch loans summary
  const { data: loansSummary } = useQuery({
    queryKey: ['loans-summary'],
    queryFn: () => loansApi.getSummary(),
  });

  // Fetch all investments (to calculate by country)
  const { data: investmentsData } = useQuery({
    queryKey: ['investments-all'],
    queryFn: () => investmentsApi.getAll(),
  });

  // Fetch exchange rate for USD to INR
  const { data: exchangeRateData } = useQuery({
    queryKey: ['exchange-rate', 'usd-inr'],
    queryFn: () => loansApi.getExchangeRate(),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  const exchangeRate = exchangeRateData?.rate || 83.5;

  // Fetch mutual funds summary
  const { data: mutualFundsSummary } = useQuery({
    queryKey: ['mutual-funds-summary'],
    queryFn: () => mutualFundsApi.getSummary(),
  });

  // Fetch assets summary
  const { data: assetsSummary } = useQuery({
    queryKey: ['assets-summary'],
    queryFn: () => assetsApi.getSummary(),
  });

  // Fetch policies summary
  const { data: policiesSummary } = useQuery({
    queryKey: ['policies-summary'],
    queryFn: () => policiesApi.getSummary(),
  });

  // Calculate investments by country
  const investmentsByCountry = (investmentsData || []).reduce(
    (acc: { india: number; indiaGainLoss: number; us: number; usGainLoss: number; usCost: number }, inv: any) => {
      const currentValue = inv.currentValue || (inv.quantity * (inv.currentPrice || inv.purchasePrice));
      const costBasis = inv.quantity * inv.purchasePrice;
      const gainLoss = currentValue - costBasis;

      if (inv.country === 'US') {
        acc.us += currentValue;
        acc.usCost += costBasis;
        acc.usGainLoss += gainLoss;
      } else {
        acc.india += currentValue;
        acc.indiaGainLoss += gainLoss;
      }
      return acc;
    },
    { india: 0, indiaGainLoss: 0, us: 0, usGainLoss: 0, usCost: 0 }
  );

  // Convert US investments to INR
  const usInvestmentsInINR = investmentsByCountry.us * exchangeRate;
  const usGainLossInINR = investmentsByCountry.usGainLoss * exchangeRate;

  // Total investments in INR (Funds only - India + US converted + Mutual Funds)
  const totalFundsINR = investmentsByCountry.india + usInvestmentsInINR + (mutualFundsSummary?.totalCurrentValue || 0);

  // Assets total (current value)
  const totalAssetsINR = assetsSummary?.totalCurrentValue || 0;

  // Policies total (total premium paid as investment value)
  const totalPoliciesINR = policiesSummary?.totalPremiumPaid || 0;

  // Total all investments in INR (Funds + Assets + Policies)
  const totalInvestmentsINR = totalFundsINR + totalAssetsINR + totalPoliciesINR;

  // ===== BUSINESS TAB DATA =====
  // Fetch Vyapar transaction trends (Sale, Sale Order, Expense only)
  const { data: trendsData, isLoading: trendsLoading } = useQuery({
    queryKey: ['dashboard-vyapar-trends', startDate, endDate, granularity],
    queryFn: () => dashboardApi.getVyaparTrends(startDate, endDate, granularity),
    enabled: activeTab === 'business',
  });

  // Fetch expense breakdown
  const { data: expenseData } = useQuery({
    queryKey: ['dashboard-expense', startDate, endDate],
    queryFn: () => dashboardApi.getExpenseBreakdown(startDate, endDate),
    enabled: activeTab === 'business',
  });

  // Fetch Vyapar summary
  const { data: vyaparData } = useQuery({
    queryKey: ['dashboard-vyapar', startDate, endDate],
    queryFn: () => dashboardApi.getVyaparSummary(startDate, endDate),
    enabled: activeTab === 'business',
  });

  // Navigation handlers
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

  const stats: DashboardStats = statsData || {
    totalBalance: 0,
    monthlyIncome: 0,
    monthlyExpense: 0,
    netProfit: 0,
    unreconciledCount: 0,
  };

  const expenseBreakdown: ExpenseBreakdown[] = expenseData || [];

  // Prepare trends data for charts
  const trendsChartData = (trendsData || []).map((item: any) => ({
    ...item,
    name: item.label,
  }));

  // Calculate totals
  const totalAssets = stats.totalBalance + totalInvestmentsINR + (loansSummary?.given?.outstanding || 0);
  const totalLiabilities = loansSummary?.taken?.outstanding || 0;
  const totalNetWorth = totalAssets - totalLiabilities;

  if (statsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Dashboard</h1>
        </div>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab}>
        {/* ===== PERSONAL TAB ===== */}
        <TabsContent value="personal" className="mt-0 space-y-6">
          {/* Row 1: Summary Cards - Net Worth, Bank Balance, Net Investments, Net Liabilities */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/20 border-blue-200 dark:border-blue-800">
              <CardContent className="flex items-center gap-3 p-4 md:p-5 lg:p-6">
                <div className="rounded-full p-2 md:p-3 bg-blue-500/20 flex-shrink-0">
                  <TrendingUp className="h-5 w-5 md:h-6 md:w-6 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">Net Worth</p>
                  <p className="text-lg md:text-xl lg:text-2xl font-bold truncate">{formatAmount(totalNetWorth)}</p>
                  <p className="text-xs text-muted-foreground">Assets - Liabilities</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-3 p-4 md:p-5 lg:p-6">
                <div className="rounded-full p-2 md:p-3 bg-emerald-500/10 flex-shrink-0">
                  <Landmark className="h-5 w-5 md:h-6 md:w-6 text-emerald-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">Bank Balance</p>
                  <p className="text-lg md:text-xl lg:text-2xl font-bold truncate">{formatAmount(stats.totalBalance)}</p>
                  <p className="text-xs text-muted-foreground">All accounts</p>
                </div>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => navigate('/investments')}
            >
              <CardContent className="flex items-center gap-3 p-4 md:p-5 lg:p-6">
                <div className="rounded-full p-2 md:p-3 bg-purple-500/10 flex-shrink-0">
                  <LineChartIcon className="h-5 w-5 md:h-6 md:w-6 text-purple-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">Net Investments</p>
                  <p className="text-lg md:text-xl lg:text-2xl font-bold truncate">{formatAmount(totalInvestmentsINR)}</p>
                  <p className="text-xs text-muted-foreground">
                    Stocks + MF + Assets + Policies
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-3 p-4 md:p-5 lg:p-6">
                <div className="rounded-full p-2 md:p-3 bg-red-500/10 flex-shrink-0">
                  <TrendingDown className="h-5 w-5 md:h-6 md:w-6 text-red-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">Net Liabilities</p>
                  <p className="text-lg md:text-xl lg:text-2xl font-bold text-red-600 truncate">{formatAmount(loansSummary?.taken?.outstanding || 0)}</p>
                  <p className="text-xs text-muted-foreground">Total loans taken</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Two Column Layout: Investments & Liabilities/Expenses */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left Column: Investments */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                  Investments Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* India Investments */}
                <div
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                  onClick={() => navigate('/investments?tab=funds')}
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-full p-2 bg-orange-500/10">
                      <TrendingUp className="h-4 w-4 text-orange-500" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">India Investments</p>
                      <p className="text-xs text-muted-foreground">Stocks, EPF, PPF, FD</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatAmount(investmentsByCountry.india)}</p>
                    {investmentsByCountry.indiaGainLoss !== 0 && (
                      <p className={`text-xs ${investmentsByCountry.indiaGainLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {investmentsByCountry.indiaGainLoss >= 0 ? '+' : ''}{formatAmount(investmentsByCountry.indiaGainLoss)}
                      </p>
                    )}
                  </div>
                </div>

                {/* US Stocks */}
                <div
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                  onClick={() => navigate('/investments?tab=funds')}
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-full p-2 bg-blue-500/10">
                      <LineChartIcon className="h-4 w-4 text-blue-500" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">US Stocks</p>
                      <p className="text-xs text-muted-foreground">
                        ${investmentsByCountry.us.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} USD
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatAmount(usInvestmentsInINR)}</p>
                    {investmentsByCountry.usGainLoss !== 0 && (
                      <p className={`text-xs ${investmentsByCountry.usGainLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {investmentsByCountry.usGainLoss >= 0 ? '+' : ''}${investmentsByCountry.usGainLoss.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </p>
                    )}
                  </div>
                </div>

                {/* Mutual Funds */}
                <div
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                  onClick={() => navigate('/mutual-funds')}
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-full p-2 bg-purple-500/10">
                      <PiggyBank className="h-4 w-4 text-purple-500" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Mutual Funds</p>
                      <p className="text-xs text-muted-foreground">
                        {mutualFundsSummary?.holdingsCount || 0} holdings
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatAmount(mutualFundsSummary?.totalCurrentValue || 0)}</p>
                    {mutualFundsSummary?.totalGainLoss !== undefined && mutualFundsSummary.totalGainLoss !== 0 && (
                      <p className={`text-xs ${mutualFundsSummary.totalGainLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {mutualFundsSummary.totalGainLoss >= 0 ? '+' : ''}{formatAmount(mutualFundsSummary.totalGainLoss)} ({mutualFundsSummary.totalGainLossPercent?.toFixed(1)}%)
                      </p>
                    )}
                  </div>
                </div>

                {/* Physical Assets */}
                <div
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                  onClick={() => navigate('/investments?tab=assets')}
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-full p-2 bg-teal-500/10">
                      <Building2 className="h-4 w-4 text-teal-500" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Physical Assets</p>
                      <p className="text-xs text-muted-foreground">
                        {assetsSummary?.count || 0} assets (Property, Gold, etc.)
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatAmount(assetsSummary?.totalCurrentValue || 0)}</p>
                    {(assetsSummary?.totalAppreciation || 0) !== 0 && (
                      <p className={`text-xs ${(assetsSummary?.totalAppreciation || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {(assetsSummary?.totalAppreciation || 0) >= 0 ? '+' : ''}{formatAmount(assetsSummary?.totalAppreciation || 0)} ({assetsSummary?.appreciationPercent?.toFixed(1) || 0}%)
                      </p>
                    )}
                  </div>
                </div>

                {/* Insurance Policies */}
                <div
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                  onClick={() => navigate('/investments?tab=policies')}
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-full p-2 bg-indigo-500/10">
                      <CreditCard className="h-4 w-4 text-indigo-500" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Insurance Policies</p>
                      <p className="text-xs text-muted-foreground">
                        {policiesSummary?.activePolicies || 0} active policies
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatAmount(policiesSummary?.totalPremiumPaid || 0)}</p>
                    <p className="text-xs text-muted-foreground">
                      Coverage: {formatAmount(policiesSummary?.totalCoverage || 0)}
                    </p>
                  </div>
                </div>

                {/* Loans Given (Receivables) */}
                <div
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                  onClick={() => navigate('/loans?tab=given')}
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-full p-2 bg-green-500/10">
                      <HandCoins className="h-4 w-4 text-green-500" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Loans Given</p>
                      <p className="text-xs text-muted-foreground">
                        {loansSummary?.given?.active || 0} active receivables
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-green-600">{formatAmount(loansSummary?.given?.outstanding || 0)}</p>
                    <p className="text-xs text-muted-foreground">
                      Total: {formatAmount(loansSummary?.given?.total || 0)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Right Column: Liabilities & Outflows */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <TrendingDown className="h-5 w-5 text-red-600" />
                  Liabilities & Outflows
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Loans Taken */}
                <div
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                  onClick={() => navigate('/loans?tab=taken')}
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-full p-2 bg-red-500/10">
                      <Landmark className="h-4 w-4 text-red-500" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Loans Taken</p>
                      <p className="text-xs text-muted-foreground">
                        {loansSummary?.taken?.active || 0} active loans
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-red-600">{formatAmount(loansSummary?.taken?.outstanding || 0)}</p>
                    <p className="text-xs text-muted-foreground">Outstanding</p>
                  </div>
                </div>

                {/* Fixed Obligations - Unified Section */}
                {(() => {
                  // Calculate pending items
                  // Monthly fixed expenses: show all unpaid for this month
                  const pendingMonthly = (loansSummary?.fixedExpenses?.monthlyExpensesList || [])
                    .filter((e: any) => !e.isPaid);
                  // Non-monthly: show overdue unpaid items
                  const pendingNonMonthly = (loansSummary?.fixedExpenses?.upcomingByMonth || [])
                    .flatMap((item: any) => item.expenses.filter((e: any) => !e.isPaid));
                  // Taken loans: show unpaid EMIs for this month
                  const pendingLoans = (loansSummary?.fixedExpenses?.takenLoansList || [])
                    .filter((l: any) => !l.isPaid);
                  const allPending = [...pendingMonthly, ...pendingNonMonthly, ...pendingLoans];
                  const totalPending = allPending.reduce((sum: number, e: any) => sum + e.amount, 0);
                  const surplus = stats.totalBalance - totalPending;
                  const isShortfall = surplus < 0;

                  return (
                    <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900 space-y-3">
                      {/* Part 1: Summary Totals */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="rounded-full p-2 bg-orange-500/20">
                            <Receipt className="h-4 w-4 text-orange-600" />
                          </div>
                          <p className="font-medium text-sm">Fixed Obligations</p>
                        </div>
                      </div>
                      <div className="flex gap-4 text-sm">
                        <div className="flex-1 p-2 rounded bg-white/50 dark:bg-black/20">
                          <p className="text-xs text-muted-foreground">Monthly</p>
                          <p className="font-semibold">{formatAmount(loansSummary?.taken?.totalEmi || 0)}</p>
                        </div>
                        <div className="flex-1 p-2 rounded bg-white/50 dark:bg-black/20">
                          <p className="text-xs text-muted-foreground">Yearly</p>
                          <p className="font-semibold">{formatAmount(loansSummary?.fixedExpenses?.yearlyTotal || 0)}</p>
                        </div>
                      </div>

                      {/* Part 2: Pending This Month */}
                      {allPending.length > 0 && (
                        <>
                          <div className="border-t border-orange-200 dark:border-orange-800 pt-3">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pending This Month</p>
                              <p className="font-semibold text-orange-600">{formatAmount(totalPending)}</p>
                            </div>
                            <div className="space-y-1">
                              {allPending.map((expense: any, idx: number) => (
                                <div key={idx} className="flex justify-between text-xs text-muted-foreground">
                                  <span className="truncate max-w-[180px]">{expense.name}</span>
                                  <span>{formatAmount(expense.amount)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          {/* Surplus/Shortfall */}
                          <div className={`flex items-center justify-between text-xs px-2 py-1.5 rounded ${isShortfall ? 'bg-red-100 dark:bg-red-950/30' : 'bg-green-100 dark:bg-green-950/30'}`}>
                            <span className="text-muted-foreground">
                              Bank Balance: {formatAmount(stats.totalBalance)}
                            </span>
                            <span className={`font-medium ${isShortfall ? 'text-red-600' : 'text-green-600'}`}>
                              {isShortfall ? 'Shortfall: ' : 'Surplus: '}{formatAmount(Math.abs(surplus))}
                            </span>
                          </div>
                        </>
                      )}

                      {allPending.length === 0 && (
                        <div className="border-t border-orange-200 dark:border-orange-800 pt-3">
                          <p className="text-xs text-green-600 flex items-center gap-1">
                            <span>All dues cleared for this month</span>
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Insurance Premiums */}
                <div
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                  onClick={() => navigate('/investments?tab=policies')}
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-full p-2 bg-indigo-500/10">
                      <CreditCard className="h-4 w-4 text-indigo-500" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Insurance Premiums</p>
                      <p className="text-xs text-muted-foreground">
                        {policiesSummary?.activePolicies || 0} active policies
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatAmount(policiesSummary?.yearlyPremium || 0)}</p>
                    <p className="text-xs text-muted-foreground">per year</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ===== BUSINESS TAB (GearUp Mods) ===== */}
        <TabsContent value="business" className="mt-6 space-y-6">
          {/* Date Range Selector */}
          <div className="flex flex-wrap items-center justify-end gap-4">
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
          </div>

          {/* Summary Stat Cards - Vyapar Based P&L */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => goToTransactions('vyapar', { transactionType: 'Sale' })}
            >
              <CardContent className="flex items-center gap-4 p-6">
                <div className="rounded-full p-3 bg-green-500/10">
                  <TrendingUp className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Sales Revenue</p>
                  <p className="text-2xl font-bold text-green-600">{formatAmount(vyaparData?.sales || 0)}</p>
                </div>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => goToTransactions('vyapar', { transactionType: 'Sale Order' })}
            >
              <CardContent className="flex items-center gap-4 p-6">
                <div className="rounded-full p-3 bg-yellow-500/10">
                  <Receipt className="h-6 w-6 text-yellow-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Pending Orders</p>
                  <p className="text-2xl font-bold text-yellow-600">{formatAmount(vyaparData?.saleOrders || 0)}</p>
                  <p className="text-xs text-muted-foreground">
                    {vyaparData?.saleOrdersCount || 0} orders
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => goToTransactions('vyapar', { transactionType: 'Expense' })}
            >
              <CardContent className="flex items-center gap-4 p-6">
                <div className="rounded-full p-3 bg-red-500/10">
                  <TrendingDown className="h-6 w-6 text-red-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Expenses</p>
                  <p className="text-2xl font-bold text-red-600">{formatAmount(vyaparData?.expenses || 0)}</p>
                </div>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:bg-muted/50 transition-colors bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/30 dark:to-emerald-900/20 border-emerald-200 dark:border-emerald-800"
              onClick={() => goToTransactions('vyapar')}
            >
              <CardContent className="flex items-center gap-4 p-6">
                <div className={`rounded-full p-3 ${(vyaparData?.sales || 0) - (vyaparData?.expenses || 0) >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                  {(vyaparData?.sales || 0) - (vyaparData?.expenses || 0) >= 0 ? (
                    <TrendingUp className="h-6 w-6 text-green-600" />
                  ) : (
                    <TrendingDown className="h-6 w-6 text-red-600" />
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Net Profit</p>
                  <p className={`text-2xl font-bold ${(vyaparData?.sales || 0) - (vyaparData?.expenses || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatAmount((vyaparData?.sales || 0) - (vyaparData?.expenses || 0))}
                  </p>
                  <p className="text-xs text-muted-foreground">Sales - Expenses</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Transaction Trends Chart */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Transaction Trends</CardTitle>
              <Tabs value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
                <TabsList>
                  <TabsTrigger value="daily">Daily</TabsTrigger>
                  <TabsTrigger value="weekly">Weekly</TabsTrigger>
                  <TabsTrigger value="monthly">Monthly</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              {trendsLoading ? (
                <div className="flex h-[300px] items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              ) : trendsChartData.length > 0 ? (
                <LineChart
                  data={trendsChartData}
                  xKey="label"
                  yKeys={[
                    { key: 'sale', color: '#22c55e', name: 'Sale' },
                    { key: 'saleOrder', color: '#eab308', name: 'Sale Order' },
                    { key: 'expense', color: '#ef4444', name: 'Expenses' },
                  ]}
                  height={300}
                />
              ) : (
                <div className="flex h-[300px] items-center justify-center text-muted-foreground">
                  No transaction data for this period
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Expense Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Expense Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                {expenseBreakdown.length > 0 ? (
                  <>
                    <PieChart
                      data={expenseBreakdown.slice(0, 6).map((item) => ({
                        name: item.category,
                        value: item.amount,
                        color: item.color,
                      }))}
                      height={220}
                      showLegend={false}
                    />
                    <div className="mt-4 space-y-2">
                      {expenseBreakdown.slice(0, 6).map((item) => (
                        <div key={item.category} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: item.color }}
                            />
                            <span className="truncate max-w-[100px]">{item.category}</span>
                          </div>
                          <span className="font-medium">{formatAmount(item.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex h-[300px] items-center justify-center text-muted-foreground">
                    No expense data
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Vyapar Summary */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Vyapar Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {vyaparData ? (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {vyaparData.sales > 0 && (
                        <div
                          className="rounded-lg bg-green-50 dark:bg-green-900/20 p-3 cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
                          onClick={() => goToTransactions('vyapar', { transactionType: 'Sale' })}
                        >
                          <div className="flex items-center gap-2 text-green-600">
                            <ShoppingCart className="h-4 w-4" />
                            <span className="text-xs font-medium">Sales ({vyaparData.salesCount})</span>
                          </div>
                          <p className="text-lg font-bold mt-1">{formatAmount(vyaparData.sales)}</p>
                        </div>
                      )}
                      {vyaparData.saleOrders > 0 && (
                        <div
                          className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 p-3 cursor-pointer hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-colors"
                          onClick={() => goToTransactions('vyapar', { transactionType: 'Sale Order' })}
                        >
                          <div className="flex items-center gap-2 text-yellow-600">
                            <Receipt className="h-4 w-4" />
                            <span className="text-xs font-medium">Orders ({vyaparData.saleOrdersCount})</span>
                          </div>
                          <p className="text-lg font-bold mt-1">{formatAmount(vyaparData.saleOrders)}</p>
                        </div>
                      )}
                      {vyaparData.paymentIn > 0 && (
                        <div
                          className="rounded-lg bg-purple-50 dark:bg-purple-900/20 p-3 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
                          onClick={() => goToTransactions('vyapar', { transactionType: 'Payment-In' })}
                        >
                          <div className="flex items-center gap-2 text-purple-600">
                            <CreditCard className="h-4 w-4" />
                            <span className="text-xs font-medium">Payment In</span>
                          </div>
                          <p className="text-lg font-bold mt-1">{formatAmount(vyaparData.paymentIn)}</p>
                        </div>
                      )}
                      {vyaparData.expenses > 0 && (
                        <div
                          className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                          onClick={() => goToTransactions('vyapar', { transactionType: 'Expense' })}
                        >
                          <div className="flex items-center gap-2 text-red-600">
                            <TrendingDown className="h-4 w-4" />
                            <span className="text-xs font-medium">Expenses ({vyaparData.expensesCount})</span>
                          </div>
                          <p className="text-lg font-bold mt-1">{formatAmount(vyaparData.expenses)}</p>
                        </div>
                      )}
                    </div>


                    <div className="border-t pt-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Inflow</span>
                        <span className="font-medium text-green-600">{formatAmount(vyaparData.totalInflow)}</span>
                      </div>
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-muted-foreground">Total Outflow</span>
                        <span className="font-medium text-red-600">{formatAmount(vyaparData.totalOutflow)}</span>
                      </div>
                      <div className="flex justify-between text-sm mt-2 pt-2 border-t">
                        <span className="font-medium">Net Cash Flow</span>
                        <span className={`font-bold ${vyaparData.totalInflow - vyaparData.totalOutflow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatAmount(vyaparData.totalInflow - vyaparData.totalOutflow)}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex h-[200px] items-center justify-center text-muted-foreground">
                    No Vyapar data
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Net Cash Flow Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Net Cash Flow ({granularity.charAt(0).toUpperCase() + granularity.slice(1)})</CardTitle>
            </CardHeader>
            <CardContent>
              {trendsChartData.length > 0 ? (
                <AreaChart
                  data={trendsChartData}
                  xKey="label"
                  yKeys={[
                    { key: 'net', color: '#3b82f6', name: 'Net Cash Flow' },
                  ]}
                  height={250}
                />
              ) : (
                <div className="flex h-[250px] items-center justify-center text-muted-foreground">
                  No data for this period
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

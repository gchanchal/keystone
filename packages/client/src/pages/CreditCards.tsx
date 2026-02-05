import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import {
  CreditCard,
  Calendar,
  Gift,
  TrendingUp,
  TrendingDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Filter,
  Upload,
  User,
  Wallet,
  Receipt,
  Check,
  Wifi,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PieChart } from '@/components/charts/PieChart';
import { LineChart } from '@/components/charts/LineChart';
import { BarChart } from '@/components/charts/BarChart';
import { creditCardsApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import type {
  CreditCardsSummary,
  CreditCardTransaction,
  CreditCardStatement,
  CreditCardAnalytics,
  CardHolder,
} from '@/types';

// Category colors
const CATEGORY_COLORS: Record<string, string> = {
  TRAVEL: '#3b82f6',
  DINING: '#f97316',
  SHOPPING: '#8b5cf6',
  FUEL: '#eab308',
  GROCERIES: '#22c55e',
  ENTERTAINMENT: '#ec4899',
  HEALTHCARE: '#ef4444',
  EDUCATION: '#14b8a6',
  UTILITIES: '#6366f1',
  INSURANCE: '#0ea5e9',
  RENT: '#a855f7',
  EMI: '#f43f5e',
  OTHER: '#64748b',
};

// Bank card gradients for visual cards
const BANK_CARD_STYLES: Record<string, { gradient: string; logo?: string }> = {
  hdfc: { gradient: 'from-blue-900 via-blue-800 to-blue-700' },
  icici: { gradient: 'from-orange-600 via-orange-500 to-amber-500' },
  sbi: { gradient: 'from-blue-600 via-blue-500 to-cyan-500' },
  axis: { gradient: 'from-purple-900 via-purple-700 to-pink-600' },
  kotak: { gradient: 'from-red-700 via-red-600 to-red-500' },
  amex: { gradient: 'from-slate-700 via-slate-600 to-slate-500' },
  citi: { gradient: 'from-blue-700 via-blue-600 to-blue-500' },
  rbl: { gradient: 'from-orange-700 via-orange-600 to-yellow-500' },
  yes: { gradient: 'from-blue-800 via-blue-700 to-blue-600' },
  indusind: { gradient: 'from-red-800 via-red-700 to-orange-600' },
  default: { gradient: 'from-gray-800 via-gray-700 to-gray-600' },
};

const getBankStyle = (bankName: string) => {
  const key = bankName.toLowerCase().split(' ')[0];
  return BANK_CARD_STYLES[key] || BANK_CARD_STYLES.default;
};

// Visual Credit Card Component
interface VisualCardProps {
  bankName: string;
  lastFour: string;
  cardHolder?: string;
  outstanding: number;
  creditLimit: number;
  dueDate?: string;
  isSelected?: boolean;
  onClick?: () => void;
}

function VisualCreditCard({ bankName, lastFour, cardHolder, outstanding, creditLimit, dueDate, isSelected, onClick }: VisualCardProps) {
  const style = getBankStyle(bankName);
  const utilization = creditLimit > 0 ? (outstanding / creditLimit) * 100 : 0;

  return (
    <div
      onClick={onClick}
      className={`relative w-full max-w-[320px] h-[190px] rounded-2xl p-5 cursor-pointer transition-all duration-200 bg-gradient-to-br ${style.gradient} text-white shadow-lg hover:shadow-xl hover:scale-[1.02] ${
        isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-background' : ''
      }`}
    >
      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute top-3 right-3 bg-white rounded-full p-1">
          <Check className="h-4 w-4 text-green-600" />
        </div>
      )}

      {/* Chip and wireless */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-7 bg-gradient-to-br from-yellow-300 to-yellow-500 rounded-md" />
        <Wifi className="h-5 w-5 rotate-90 opacity-80" />
      </div>

      {/* Card number */}
      <div className="text-lg tracking-widest font-mono mb-4 opacity-90">
        •••• •••• •••• {lastFour}
      </div>

      {/* Bank name and holder */}
      <div className="flex justify-between items-end">
        <div>
          <p className="text-xs opacity-70 uppercase tracking-wide">Card Holder</p>
          <p className="text-sm font-medium truncate max-w-[150px]">{cardHolder || 'Not Set'}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">{bankName}</p>
          {dueDate && (
            <p className="text-xs opacity-70">Due: {format(new Date(dueDate), 'dd MMM')}</p>
          )}
        </div>
      </div>

      {/* Utilization bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/20 rounded-b-2xl overflow-hidden">
        <div
          className={`h-full transition-all ${utilization > 80 ? 'bg-red-400' : utilization > 50 ? 'bg-yellow-400' : 'bg-green-400'}`}
          style={{ width: `${Math.min(utilization, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function CreditCards() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // State
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview');
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [cardSelectorOpen, setCardSelectorOpen] = useState(false);
  const [startMonth, setStartMonth] = useState(() =>
    format(subMonths(new Date(), 2), 'yyyy-MM')
  );
  const [endMonth, setEndMonth] = useState(() => format(new Date(), 'yyyy-MM'));
  const [searchQuery, setSearchQuery] = useState('');
  const [cardHolderFilter, setCardHolderFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [emiOnly, setEmiOnly] = useState(false);

  // Date calculations
  const startDate = format(startOfMonth(new Date(startMonth)), 'yyyy-MM-dd');
  const endDate = format(endOfMonth(new Date(endMonth)), 'yyyy-MM-dd');

  // Get first selected account for single-account queries (or undefined for all)
  const selectedAccountId = selectedAccountIds.length === 1 ? selectedAccountIds[0] : undefined;

  // Queries
  const { data: summary, isLoading: summaryLoading } = useQuery<CreditCardsSummary>({
    queryKey: ['credit-cards-summary'],
    queryFn: () => creditCardsApi.getSummary(),
  });

  // Toggle card selection
  const toggleCardSelection = (accountId: string) => {
    setSelectedAccountIds((prev) =>
      prev.includes(accountId)
        ? prev.filter((id) => id !== accountId)
        : [...prev, accountId]
    );
  };

  const selectAllCards = () => setSelectedAccountIds([]);
  const isAllSelected = selectedAccountIds.length === 0;

  const { data: transactionsData, isLoading: transactionsLoading } = useQuery({
    queryKey: [
      'credit-card-transactions',
      selectedAccountId,
      startDate,
      endDate,
      cardHolderFilter,
      categoryFilter,
      emiOnly,
      searchQuery,
    ],
    queryFn: () => {
      if (!selectedAccountId && summary?.accounts?.[0]?.id) {
        return creditCardsApi.getTransactions(summary.accounts[0].id, {
          startDate,
          endDate,
          cardHolder: cardHolderFilter !== 'all' ? cardHolderFilter : undefined,
          category: categoryFilter !== 'all' ? categoryFilter : undefined,
          emiOnly: emiOnly || undefined,
          search: searchQuery || undefined,
          limit: 100,
        });
      }
      if (selectedAccountId) {
        return creditCardsApi.getTransactions(selectedAccountId, {
          startDate,
          endDate,
          cardHolder: cardHolderFilter !== 'all' ? cardHolderFilter : undefined,
          category: categoryFilter !== 'all' ? categoryFilter : undefined,
          emiOnly: emiOnly || undefined,
          search: searchQuery || undefined,
          limit: 100,
        });
      }
      return { transactions: [], totalCount: 0, hasMore: false };
    },
    enabled: activeTab === 'transactions' && (!!selectedAccountId || !!summary?.accounts?.[0]?.id),
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery<CreditCardAnalytics>({
    queryKey: ['credit-cards-analytics', selectedAccountId, startDate, endDate],
    queryFn: () =>
      creditCardsApi.getAnalytics({
        accountId: selectedAccountId,
        startDate,
        endDate,
      }),
    enabled: activeTab === 'overview',
  });

  const { data: statements } = useQuery<CreditCardStatement[]>({
    queryKey: ['credit-card-statements', selectedAccountId],
    queryFn: () => {
      const accountId = selectedAccountId || summary?.accounts?.[0]?.id;
      if (accountId) {
        return creditCardsApi.getStatements(accountId);
      }
      return [];
    },
    enabled: activeTab === 'statements' && (!!selectedAccountId || !!summary?.accounts?.[0]?.id),
  });

  // Get all card holders across accounts for filter
  const allCardHolders = useMemo(() => {
    const holders: CardHolder[] = [];
    summary?.accounts?.forEach((account) => {
      account.cardHolders?.forEach((h) => {
        if (!holders.find((existing) => existing.name === h.name)) {
          holders.push(h);
        }
      });
    });
    return holders;
  }, [summary]);

  // Navigation handlers
  const handlePreviousStartMonth = () => {
    setStartMonth(format(subMonths(new Date(startMonth), 1), 'yyyy-MM'));
  };

  const handleNextStartMonth = () => {
    const newStart = format(subMonths(new Date(startMonth), -1), 'yyyy-MM');
    if (newStart <= endMonth) {
      setStartMonth(newStart);
    }
  };

  const handlePreviousEndMonth = () => {
    const newEnd = format(subMonths(new Date(endMonth), 1), 'yyyy-MM');
    if (newEnd >= startMonth) {
      setEndMonth(newEnd);
    }
  };

  const handleNextEndMonth = () => {
    setEndMonth(format(subMonths(new Date(endMonth), -1), 'yyyy-MM'));
  };

  // Prepare chart data
  const categoryChartData = useMemo(() => {
    if (!analytics?.categorySpend) return [];
    return analytics.categorySpend.slice(0, 8).map((item) => ({
      name: item.category,
      value: item.total,
      color: CATEGORY_COLORS[item.category] || CATEGORY_COLORS.OTHER,
    }));
  }, [analytics]);

  const monthlyTrendsData = useMemo(() => {
    if (!analytics?.monthlyTrends) return [];
    return analytics.monthlyTrends.map((item) => ({
      month: item.month,
      Spend: item.spend,
      Payments: item.payments,
    }));
  }, [analytics]);

  const holderSpendData = useMemo(() => {
    if (!analytics?.holderSpend) return [];
    return analytics.holderSpend.map((item) => ({
      name: item.cardHolder || 'Unknown',
      amount: item.total,
    }));
  }, [analytics]);

  // EMI transactions
  const emiTransactions = useMemo(() => {
    if (!analytics?.emiSummary) return [];
    return analytics.emiSummary;
  }, [analytics]);

  if (summaryLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const hasAccounts = summary && summary.accounts.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Credit Cards</h1>
          {summary?.nextDueDate && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Due: {formatDate(summary.nextDueDate)}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Multi-select Card Filter */}
          {summary && summary.accounts.length > 1 && (
            <Popover open={cardSelectorOpen} onOpenChange={setCardSelectorOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Filter className="h-4 w-4" />
                  {isAllSelected
                    ? 'All Cards'
                    : `${selectedAccountIds.length} Card${selectedAccountIds.length > 1 ? 's' : ''} Selected`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="end">
                <div className="space-y-1">
                  <Button
                    variant={isAllSelected ? 'secondary' : 'ghost'}
                    className="w-full justify-start text-sm"
                    onClick={selectAllCards}
                  >
                    <Check className={`h-4 w-4 mr-2 ${isAllSelected ? 'opacity-100' : 'opacity-0'}`} />
                    All Cards
                  </Button>
                  <div className="h-px bg-border my-1" />
                  {summary.accounts.map((account) => (
                    <Button
                      key={account.id}
                      variant={selectedAccountIds.includes(account.id) ? 'secondary' : 'ghost'}
                      className="w-full justify-start text-sm"
                      onClick={() => toggleCardSelection(account.id)}
                    >
                      <Check
                        className={`h-4 w-4 mr-2 ${
                          selectedAccountIds.includes(account.id) ? 'opacity-100' : 'opacity-0'
                        }`}
                      />
                      {account.bankName} •• {account.accountNumber?.slice(-4)}
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
          <Button onClick={() => navigate('/uploads')} className="gap-2">
            <Upload className="h-4 w-4" />
            Upload Statement
          </Button>
        </div>
      </div>

      {!hasAccounts ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Credit Card Accounts</h3>
            <p className="text-muted-foreground text-center mb-4">
              Add a credit card account and upload statements to track your spending.
            </p>
            <Button onClick={() => navigate('/accounts')}>Add Credit Card Account</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Visual Credit Cards Section */}
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-4 min-w-max">
              {summary?.accounts.map((account) => {
                const isSelected = selectedAccountIds.includes(account.id);
                const accountStatement = account.latestStatement;
                return (
                  <VisualCreditCard
                    key={account.id}
                    bankName={account.bankName}
                    lastFour={account.accountNumber?.slice(-4) || '****'}
                    cardHolder={account.cardHolders?.[0]?.name}
                    outstanding={accountStatement?.totalDue || Math.abs(account.currentBalance || 0)}
                    creditLimit={accountStatement?.creditLimit || 0}
                    dueDate={accountStatement?.dueDate}
                    isSelected={!isAllSelected && isSelected}
                    onClick={() => toggleCardSelection(account.id)}
                  />
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Click cards to filter • {isAllSelected ? 'Showing all cards' : `Showing ${selectedAccountIds.length} selected`}
            </p>
          </div>

          {/* Summary Stats */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950/30 dark:to-red-900/20 border-red-200 dark:border-red-800">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="rounded-full p-3 bg-red-500/20">
                  <TrendingDown className="h-6 w-6 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Outstanding</p>
                  <p className="text-2xl font-bold text-red-600">
                    {formatCurrency(summary?.totalOutstanding || 0)}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="rounded-full p-3 bg-green-500/10">
                  <Wallet className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Available Limit</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(summary?.totalAvailableLimit || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    of {formatCurrency(summary?.totalCreditLimit || 0)}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="rounded-full p-3 bg-orange-500/10">
                  <Calendar className="h-6 w-6 text-orange-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Next Due</p>
                  <p className="text-2xl font-bold">
                    {summary?.nextDueDate
                      ? format(new Date(summary.nextDueDate), 'dd MMM')
                      : '-'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(summary?.nextDueAmount || 0)}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="rounded-full p-3 bg-purple-500/10">
                  <Gift className="h-6 w-6 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Reward Points</p>
                  <p className="text-2xl font-bold">
                    {(summary?.totalRewardPoints || 0).toLocaleString()}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content with Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="transactions">Transactions</TabsTrigger>
                <TabsTrigger value="emi">EMI Tracker</TabsTrigger>
                <TabsTrigger value="statements">Statements</TabsTrigger>
              </TabsList>

              {/* Date Range Selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">From:</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handlePreviousStartMonth}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="w-20 text-center text-sm font-medium">
                  {format(new Date(startMonth), 'MMM yy')}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleNextStartMonth}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground ml-2">To:</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handlePreviousEndMonth}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="w-20 text-center text-sm font-medium">
                  {format(new Date(endMonth), 'MMM yy')}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleNextEndMonth}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6">
              {analyticsLoading ? (
                <div className="flex h-64 items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              ) : (
                <>
                  <div className="grid gap-6 lg:grid-cols-2">
                    {/* Spend by Category */}
                    <Card>
                      <CardHeader>
                        <CardTitle>Spend by Category</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {categoryChartData.length > 0 ? (
                          <>
                            <PieChart data={categoryChartData} height={220} showLegend={false} />
                            <div className="mt-4 space-y-2">
                              {analytics?.categorySpend.slice(0, 6).map((item) => (
                                <div
                                  key={item.category}
                                  className="flex items-center justify-between text-sm"
                                >
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="h-3 w-3 rounded-full"
                                      style={{
                                        backgroundColor:
                                          CATEGORY_COLORS[item.category] || CATEGORY_COLORS.OTHER,
                                      }}
                                    />
                                    <span className="truncate max-w-[120px]">{item.category}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{formatCurrency(item.total)}</span>
                                    <span className="text-muted-foreground text-xs">
                                      ({item.percentage.toFixed(0)}%)
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="flex h-[250px] items-center justify-center text-muted-foreground">
                            No spending data
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Monthly Trends */}
                    <Card>
                      <CardHeader>
                        <CardTitle>Monthly Trends</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {monthlyTrendsData.length > 0 ? (
                          <LineChart
                            data={monthlyTrendsData}
                            xKey="month"
                            yKeys={[
                              { key: 'Spend', color: '#ef4444', name: 'Spend' },
                              { key: 'Payments', color: '#22c55e', name: 'Payments' },
                            ]}
                            height={280}
                          />
                        ) : (
                          <div className="flex h-[280px] items-center justify-center text-muted-foreground">
                            No trend data
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-2">
                    {/* Spend by Card Holder */}
                    <Card>
                      <CardHeader>
                        <CardTitle>Spend by Card Holder</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {holderSpendData.length > 0 ? (
                          <BarChart
                            data={holderSpendData}
                            xKey="name"
                            yKeys={[{ key: 'amount', color: '#8b5cf6', name: 'Amount' }]}
                            height={250}
                          />
                        ) : (
                          <div className="flex h-[250px] items-center justify-center text-muted-foreground">
                            No card holder data
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Top Merchants */}
                    <Card>
                      <CardHeader>
                        <CardTitle>Top Merchants</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {analytics?.topMerchants && analytics.topMerchants.length > 0 ? (
                          <div className="space-y-3">
                            {analytics.topMerchants.slice(0, 8).map((merchant, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between text-sm"
                              >
                                <span className="truncate max-w-[200px]">{merchant.merchant}</span>
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary">{merchant.count}x</Badge>
                                  <span className="font-medium">
                                    {formatCurrency(merchant.total)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex h-[250px] items-center justify-center text-muted-foreground">
                            No merchant data
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Rewards Summary */}
                  {analytics?.rewardsSummary && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Gift className="h-5 w-5 text-purple-500" />
                          Rewards Summary
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-4 md:grid-cols-3">
                          <div className="p-4 rounded-lg bg-green-50 dark:bg-green-950/20">
                            <p className="text-sm text-muted-foreground">Points Earned</p>
                            <p className="text-2xl font-bold text-green-600">
                              +{analytics.rewardsSummary.totalEarned.toLocaleString()}
                            </p>
                          </div>
                          <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/20">
                            <p className="text-sm text-muted-foreground">Points Redeemed</p>
                            <p className="text-2xl font-bold text-red-600">
                              -{analytics.rewardsSummary.totalRedeemed.toLocaleString()}
                            </p>
                          </div>
                          <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-950/20">
                            <p className="text-sm text-muted-foreground">Current Balance</p>
                            <p className="text-2xl font-bold text-purple-600">
                              {(summary?.totalRewardPoints || 0).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </TabsContent>

            {/* Transactions Tab */}
            <TabsContent value="transactions" className="space-y-4">
              {/* Filters */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search transactions..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                      />
                    </div>

                    <Select value={cardHolderFilter} onValueChange={setCardHolderFilter}>
                      <SelectTrigger className="w-[180px]">
                        <User className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="Card Holder" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Card Holders</SelectItem>
                        {allCardHolders.map((holder) => (
                          <SelectItem key={holder.id} value={holder.name}>
                            {holder.name}
                            {holder.isPrimary && (
                              <Badge variant="secondary" className="ml-2 text-xs">
                                Primary
                              </Badge>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger className="w-[150px]">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {Object.keys(CATEGORY_COLORS).map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      variant={emiOnly ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setEmiOnly(!emiOnly)}
                    >
                      <Receipt className="h-4 w-4 mr-2" />
                      EMI Only
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Transactions Table */}
              <Card>
                <CardContent className="p-0">
                  {transactionsLoading ? (
                    <div className="flex h-64 items-center justify-center">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                    </div>
                  ) : transactionsData?.transactions?.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Card Holder</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>EMI</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Points</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {transactionsData.transactions.map((txn: CreditCardTransaction) => (
                          <TableRow key={txn.id}>
                            <TableCell className="whitespace-nowrap">
                              {formatDate(txn.date)}
                              {txn.transactionTime && (
                                <span className="text-xs text-muted-foreground ml-1">
                                  {txn.transactionTime}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="max-w-[300px] truncate" title={txn.description}>
                                {txn.description}
                              </div>
                              {txn.merchantLocation && (
                                <span className="text-xs text-muted-foreground">
                                  {txn.merchantLocation}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              {txn.cardHolderName && (
                                <Badge variant="outline">{txn.cardHolderName}</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {txn.piCategory && (
                                <Badge
                                  style={{
                                    backgroundColor: `${
                                      CATEGORY_COLORS[txn.piCategory] || CATEGORY_COLORS.OTHER
                                    }20`,
                                    color:
                                      CATEGORY_COLORS[txn.piCategory] || CATEGORY_COLORS.OTHER,
                                  }}
                                >
                                  {txn.piCategory}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {txn.isEmi && (
                                <Badge variant="secondary">
                                  EMI {txn.emiTenure && `(${txn.emiTenure}m)`}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${
                                txn.transactionType === 'credit'
                                  ? 'text-green-600'
                                  : 'text-red-600'
                              }`}
                            >
                              {txn.transactionType === 'credit' ? '+' : '-'}
                              {formatCurrency(txn.amount)}
                            </TableCell>
                            <TableCell
                              className={`text-right ${
                                txn.rewardPoints > 0
                                  ? 'text-green-600'
                                  : txn.rewardPoints < 0
                                  ? 'text-red-600'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              {txn.rewardPoints !== 0 &&
                                (txn.rewardPoints > 0 ? '+' : '') + txn.rewardPoints}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="flex h-64 items-center justify-center text-muted-foreground">
                      No transactions found
                    </div>
                  )}
                </CardContent>
              </Card>

              {transactionsData?.totalCount > 0 && (
                <div className="text-sm text-muted-foreground text-center">
                  Showing {transactionsData.transactions.length} of {transactionsData.totalCount}{' '}
                  transactions
                </div>
              )}
            </TabsContent>

            {/* EMI Tracker Tab */}
            <TabsContent value="emi" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Receipt className="h-5 w-5" />
                    Active EMIs
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {emiTransactions.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Merchant/Description</TableHead>
                          <TableHead>Tenure</TableHead>
                          <TableHead className="text-right">Total Amount</TableHead>
                          <TableHead className="text-right">Transactions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {emiTransactions.map((emi, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="max-w-[300px] truncate">
                              {emi.merchant}
                            </TableCell>
                            <TableCell>
                              {emi.emiTenure ? `${emi.emiTenure} months` : '-'}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(emi.totalAmount)}
                            </TableCell>
                            <TableCell className="text-right">
                              {emi.transactionCount}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="flex h-64 items-center justify-center text-muted-foreground">
                      No active EMIs found
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Statements Tab */}
            <TabsContent value="statements" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Statement History</CardTitle>
                </CardHeader>
                <CardContent>
                  {statements && statements.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Statement Date</TableHead>
                          <TableHead>Billing Period</TableHead>
                          <TableHead>Due Date</TableHead>
                          <TableHead className="text-right">Total Due</TableHead>
                          <TableHead className="text-right">Min Due</TableHead>
                          <TableHead className="text-right">Credit Limit</TableHead>
                          <TableHead className="text-right">Reward Points</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {statements.map((stmt) => (
                          <TableRow key={stmt.id}>
                            <TableCell>{formatDate(stmt.statementDate)}</TableCell>
                            <TableCell>
                              {formatDate(stmt.billingPeriodStart)} -{' '}
                              {formatDate(stmt.billingPeriodEnd)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  new Date(stmt.dueDate) < new Date() ? 'destructive' : 'outline'
                                }
                              >
                                {formatDate(stmt.dueDate)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium text-red-600">
                              {formatCurrency(stmt.totalDue)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(stmt.minimumDue)}
                            </TableCell>
                            <TableCell className="text-right">
                              {stmt.creditLimit ? formatCurrency(stmt.creditLimit) : '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              {stmt.rewardPointsBalance?.toLocaleString() || '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="flex h-64 items-center justify-center text-muted-foreground">
                      No statements found. Upload a credit card statement to see history.
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

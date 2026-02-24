import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, TrendingDown, TrendingUp, AlertTriangle, Repeat, Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { calendarApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const TYPE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  expense: { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', dot: 'bg-red-500' },
  emi: { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-500' },
  premium: { bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-700 dark:text-purple-400', dot: 'bg-purple-500' },
  income: { bg: 'bg-green-50 dark:bg-green-950/30', text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500' },
};

interface CalendarEvent {
  date: string;
  name: string;
  amount: number;
  type: 'expense' | 'emi' | 'premium' | 'income';
  category: string;
  sourceType: string;
  sourceId: string;
}

interface CalendarData {
  year: number;
  events: CalendarEvent[];
  monthlyTotals: Record<string, { expenses: number; income: number }>;
}

function formatCompact(amount: number): string {
  if (amount >= 100000) return `${(amount / 100000).toFixed(1).replace(/\.0$/, '')}L`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(amount);
}

export function Calendar() {
  const [year, setYear] = useState(new Date().getFullYear());

  const { data, isLoading } = useQuery<CalendarData>({
    queryKey: ['calendar', year],
    queryFn: () => calendarApi.getEvents(year),
  });

  // Compute baseline items (appear in >= 11 of 12 months), extras, and totals
  const { baselineItems, extrasByMonth, eventsByMonth, peakMonth, peakAmount, totalExpenses, totalIncome, baselineExpenseTotal, baselineIncomeTotal } = useMemo(() => {
    if (!data || data.events.length === 0) {
      return { baselineItems: [], extrasByMonth: {} as Record<number, CalendarEvent[]>, eventsByMonth: {} as Record<number, CalendarEvent[]>, peakMonth: 0, peakAmount: 0, totalExpenses: 0, totalIncome: 0, baselineExpenseTotal: 0, baselineIncomeTotal: 0 };
    }

    // Group events by month
    const byMonth: Record<number, CalendarEvent[]> = {};
    for (let m = 1; m <= 12; m++) byMonth[m] = [];
    for (const event of data.events) {
      const month = parseInt(event.date.split('-')[1], 10);
      byMonth[month].push(event);
    }

    // Count how many months each sourceId appears in
    const sourceIdMonthCount: Record<string, Set<number>> = {};
    for (const event of data.events) {
      if (!sourceIdMonthCount[event.sourceId]) sourceIdMonthCount[event.sourceId] = new Set();
      sourceIdMonthCount[event.sourceId].add(parseInt(event.date.split('-')[1], 10));
    }

    // Baseline = sourceIds that appear in >= 11 months
    const baselineSourceIds = new Set<string>();
    for (const [sourceId, months] of Object.entries(sourceIdMonthCount)) {
      if (months.size >= 11) baselineSourceIds.add(sourceId);
    }

    // Build baseline items list (deduplicated, one per sourceId)
    const baselineMap = new Map<string, CalendarEvent>();
    for (const event of data.events) {
      if (baselineSourceIds.has(event.sourceId) && !baselineMap.has(event.sourceId)) {
        baselineMap.set(event.sourceId, event);
      }
    }
    const baseline = Array.from(baselineMap.values()).sort((a, b) => {
      if (a.type === 'income' && b.type !== 'income') return 1;
      if (a.type !== 'income' && b.type === 'income') return -1;
      return b.amount - a.amount;
    });

    // Extras per month = events NOT in baseline
    const extras: Record<number, CalendarEvent[]> = {};
    for (let m = 1; m <= 12; m++) {
      extras[m] = byMonth[m]
        .filter(e => !baselineSourceIds.has(e.sourceId))
        .sort((a, b) => {
          if (a.type === 'income' && b.type !== 'income') return 1;
          if (a.type !== 'income' && b.type === 'income') return -1;
          return b.amount - a.amount;
        });
    }

    // Totals
    let totExp = 0;
    let totInc = 0;
    let peak = 0;
    let peakAmt = 0;
    for (let m = 1; m <= 12; m++) {
      const t = data.monthlyTotals[String(m)] || { expenses: 0, income: 0 };
      totExp += t.expenses;
      totInc += t.income;
      if (t.expenses > peakAmt) { peakAmt = t.expenses; peak = m; }
    }

    let blExpense = 0;
    let blIncome = 0;
    for (const item of baseline) {
      if (item.type === 'income') blIncome += item.amount;
      else blExpense += item.amount;
    }

    return {
      baselineItems: baseline,
      extrasByMonth: extras,
      eventsByMonth: byMonth,
      peakMonth: peak,
      peakAmount: peakAmt,
      totalExpenses: totExp,
      totalIncome: totInc,
      baselineExpenseTotal: blExpense,
      baselineIncomeTotal: blIncome,
    };
  }, [data]);

  const currentMonth = new Date().getFullYear() === year ? new Date().getMonth() + 1 : 0;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Financial Calendar</h1>
        </div>
        <div className="h-20 animate-pulse rounded-lg bg-muted" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top bar: year selector + summary */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Financial Calendar</h1>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setYear(year - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[4rem] text-center text-lg font-semibold">{year}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setYear(year + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
            <TrendingDown className="h-4 w-4 text-red-500" />
            <span className="text-muted-foreground">Outflow</span>
            <span className="font-semibold">{formatCurrency(totalExpenses)}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
            <TrendingUp className="h-4 w-4 text-green-500" />
            <span className="text-muted-foreground">Income</span>
            <span className="font-semibold">{formatCurrency(totalIncome)}</span>
          </div>
          {peakMonth > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm dark:border-amber-800 dark:bg-amber-950/30">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-muted-foreground">Peak</span>
              <span className="font-semibold">{MONTH_NAMES[peakMonth - 1]}</span>
            </div>
          )}
        </div>
      </div>

      {/* Monthly Recurring Baseline */}
      {baselineItems.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Repeat className="h-4 w-4" />
                Monthly Recurring
              </div>
              <div className="flex items-center gap-4 text-sm">
                {baselineExpenseTotal > 0 && (
                  <span className="text-red-600 dark:text-red-400 font-medium">{formatCurrency(baselineExpenseTotal)}/mo</span>
                )}
                {baselineIncomeTotal > 0 && (
                  <span className="text-green-600 dark:text-green-400 font-medium">+{formatCurrency(baselineIncomeTotal)}/mo</span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1.5">
              {baselineItems.map((item) => {
                const colors = TYPE_COLORS[item.type] || TYPE_COLORS.expense;
                return (
                  <div key={item.sourceId} className="flex items-center gap-1.5 text-xs">
                    <div className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${colors.dot}`} />
                    <span className="text-muted-foreground">{item.name}</span>
                    <span className={`font-medium ${colors.text}`}>
                      {item.type === 'income' ? '+' : ''}{formatCurrency(item.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
              Net monthly baseline:{' '}
              <span className={baselineIncomeTotal - baselineExpenseTotal >= 0 ? 'text-green-600 dark:text-green-400 font-medium' : 'text-red-600 dark:text-red-400 font-medium'}>
                {baselineIncomeTotal - baselineExpenseTotal >= 0 ? '+' : ''}{formatCurrency(baselineIncomeTotal - baselineExpenseTotal)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 12-month grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
          const totals = data?.monthlyTotals[String(month)] || { expenses: 0, income: 0 };
          const extras = extrasByMonth[month] || [];
          const allEvents = eventsByMonth[month] || [];
          const isPeak = month === peakMonth && peakAmount > 0;
          const isCurrent = month === currentMonth;
          const net = totals.income - totals.expenses;

          // Split all events for popover
          const incomeEvents = allEvents.filter(e => e.type === 'income').sort((a, b) => b.amount - a.amount);
          const expenseEvents = allEvents.filter(e => e.type !== 'income').sort((a, b) => b.amount - a.amount);

          return (
            <Popover key={month}>
              <PopoverTrigger asChild>
                <Card
                  className={`cursor-pointer transition-shadow hover:shadow-md ${
                    isPeak
                      ? 'border-amber-300 dark:border-amber-700'
                      : isCurrent
                        ? 'border-blue-300 dark:border-blue-700'
                        : ''
                  }`}
                >
                  <CardContent className="p-4">
                    {/* Header row */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold">{MONTH_SHORT[month - 1]}</span>
                        {isPeak && (
                          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 text-[9px] px-1.5 py-0 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                            Peak
                          </Badge>
                        )}
                        {isCurrent && (
                          <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 text-[9px] px-1.5 py-0 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
                            Now
                          </Badge>
                        )}
                      </div>
                      <Info className="h-3 w-3 text-muted-foreground/40" />
                    </div>

                    {/* Income vs Expense bar */}
                    {(totals.income > 0 || totals.expenses > 0) && (() => {
                      const total = totals.income + totals.expenses;
                      const incomePercent = total > 0 ? (totals.income / total) * 100 : 50;
                      return (
                        <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-muted mb-2">
                          <div
                            className="h-full bg-green-400 dark:bg-green-500"
                            style={{ width: `${incomePercent}%` }}
                          />
                          <div
                            className="h-full bg-red-400 dark:bg-red-500"
                            style={{ width: `${100 - incomePercent}%` }}
                          />
                        </div>
                      );
                    })()}

                    {/* Totals */}
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="text-xs text-muted-foreground">Outflow</span>
                      <span className="text-sm font-semibold">{formatCurrency(totals.expenses)}</span>
                    </div>
                    <div className="flex items-baseline justify-between mb-3">
                      <span className="text-xs text-muted-foreground">Net</span>
                      <span className={`text-xs font-medium ${net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {net >= 0 ? '+' : ''}{formatCurrency(net)}
                      </span>
                    </div>

                    {/* Extra count hint */}
                    {extras.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground/60 italic">Baseline only</p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground border-t pt-2">
                        +{extras.length} extra{extras.length > 1 ? 's' : ''} — click for details
                      </p>
                    )}
                  </CardContent>
                </Card>
              </PopoverTrigger>

              {/* Full breakdown popover */}
              <PopoverContent className="w-80 p-0" align="center">
                <div className="px-4 py-3 border-b">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{MONTH_NAMES[month - 1]} {year}</span>
                    <span className={`text-sm font-semibold ${net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      Net {net >= 0 ? '+' : ''}{formatCurrency(net)}
                    </span>
                  </div>
                </div>
                <div className="px-4 py-3 space-y-3 max-h-80 overflow-y-auto">
                  {/* Income section */}
                  {incomeEvents.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">Income</span>
                        <span className="text-xs font-medium text-green-600 dark:text-green-400">{formatCurrency(totals.income)}</span>
                      </div>
                      <div className="space-y-1">
                        {incomeEvents.map((event, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5 truncate">
                              <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-500" />
                              <span className="truncate">{event.name}</span>
                            </div>
                            <span className="ml-2 flex-shrink-0 font-medium text-green-700 dark:text-green-400">
                              +{formatCurrency(event.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Expenses section */}
                  {expenseEvents.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">Expenses</span>
                        <span className="text-xs font-medium text-red-600 dark:text-red-400">{formatCurrency(totals.expenses)}</span>
                      </div>
                      <div className="space-y-1">
                        {expenseEvents.map((event, idx) => {
                          const colors = TYPE_COLORS[event.type] || TYPE_COLORS.expense;
                          return (
                            <div key={idx} className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-1.5 truncate">
                                <div className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${colors.dot}`} />
                                <span className="truncate">{event.name}</span>
                              </div>
                              <span className={`ml-2 flex-shrink-0 font-medium ${colors.text}`}>
                                {formatCurrency(event.amount)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        {Object.entries(TYPE_COLORS).map(([type, colors]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className={`h-2 w-2 rounded-full ${colors.dot}`} />
            <span className="capitalize">{type === 'emi' ? 'EMI' : type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, ChevronLeft, ChevronRight, Package, TrendingUp, TrendingDown, Pencil, Check, X, Wand2, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { PieChart } from '@/components/charts/PieChart';
import { DataTable, ColumnDef } from '@/components/ui/data-table';
import { reportsApi, transactionsApi } from '@/lib/api';
import { formatCurrency, getMonthYear, parseMonthYear } from '@/lib/utils';
import { format, addMonths, subMonths, startOfMonth, endOfMonth } from 'date-fns';

interface VyaparItem {
  id: string;
  date: string;
  invoiceNumber: string | null;
  partyName: string | null;
  itemName: string;
  itemCode: string | null;
  category: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
  discount: number | null;
  tax: number | null;
  transactionType: string;
  amount: number;
}

export function Reports() {
  const [startMonth, setStartMonth] = useState(getMonthYear());
  const [endMonth, setEndMonth] = useState(getMonthYear());
  const [activeTab, setActiveTab] = useState('pl');

  const startMonthDate = parseMonthYear(startMonth);
  const endMonthDate = parseMonthYear(endMonth);
  const startDate = format(startOfMonth(startMonthDate), 'yyyy-MM-dd');
  const endDate = format(endOfMonth(endMonthDate), 'yyyy-MM-dd');

  const { data: plData } = useQuery({
    queryKey: ['reports', 'pl', startMonth, endMonth],
    queryFn: () => reportsApi.getPL(startMonth), // TODO: Update API to support date range
  });

  const { data: gstData } = useQuery({
    queryKey: ['reports', 'gst', startDate, endDate],
    queryFn: () => reportsApi.getGST(startDate, endDate),
  });

  const { data: categoryData } = useQuery({
    queryKey: ['reports', 'category', startDate, endDate],
    queryFn: () => reportsApi.getCategoryBreakdown(startDate, endDate),
  });

  // Vyapar Items data
  const { data: vyaparItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['vyapar-items', startDate, endDate],
    queryFn: () => transactionsApi.getVyaparItems({ startDate, endDate }),
  });

  const { data: itemCategories = [] } = useQuery({
    queryKey: ['vyapar-items-categories', startDate, endDate],
    queryFn: () => transactionsApi.getVyaparItemCategories({ startDate, endDate }),
    enabled: activeTab === 'items', // Only fetch when items tab is active
  });

  // Navigation for start month
  const handlePreviousStartMonth = () => {
    const newStart = format(subMonths(startMonthDate, 1), 'yyyy-MM');
    setStartMonth(newStart);
    // If start goes past end, move end too
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

  // Navigation for end month
  const handlePreviousEndMonth = () => {
    const newEnd = format(subMonths(endMonthDate, 1), 'yyyy-MM');
    if (newEnd >= startMonth) {
      setEndMonth(newEnd);
    }
  };

  const handleNextEndMonth = () => {
    setEndMonth(format(addMonths(endMonthDate, 1), 'yyyy-MM'));
  };

  const handleExportPL = async () => {
    const blob = await reportsApi.exportPL(startMonth, 'xlsx');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pl-report-${startMonth}-to-${endMonth}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportTransactions = async () => {
    const blob = await reportsApi.exportTransactions({
      startDate,
      endDate,
      type: 'all',
      format: 'xlsx',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${startMonth}-to-${endMonth}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const incomeItems = plData?.items?.filter((i: any) => i.type === 'income') || [];
  const expenseItems = plData?.items?.filter((i: any) => i.type === 'expense') || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Reports</h1>
        <div className="flex items-center gap-4">
          {/* Start Month */}
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">From:</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={handlePreviousStartMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="w-28 text-center font-medium text-sm">
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
            <span className="w-28 text-center font-medium text-sm">
              {format(endMonthDate, 'MMM yyyy')}
            </span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleNextEndMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pl">P&L Statement</TabsTrigger>
          <TabsTrigger value="gst">GST Summary</TabsTrigger>
          <TabsTrigger value="category">Category Analysis</TabsTrigger>
          <TabsTrigger value="items">Items & Expenses</TabsTrigger>
        </TabsList>

        {/* P&L Tab */}
        <TabsContent value="pl" className="mt-4 space-y-6">
          <div className="flex justify-end">
            <Button variant="outline" onClick={handleExportPL}>
              <Download className="mr-2 h-4 w-4" />
              Export P&L
            </Button>
          </div>

          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold text-green-500">
                  {formatCurrency(plData?.revenue || 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Total Expenses</p>
                <p className="text-2xl font-bold text-red-500">
                  {formatCurrency(plData?.expenses || 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Net Profit</p>
                <p
                  className={`text-2xl font-bold ${
                    (plData?.netProfit || 0) >= 0 ? 'text-green-500' : 'text-red-500'
                  }`}
                >
                  {formatCurrency(plData?.netProfit || 0)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* P&L Breakdown */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-green-500">Income</CardTitle>
              </CardHeader>
              <CardContent>
                {incomeItems.length > 0 ? (
                  <div className="space-y-3">
                    {incomeItems.map((item: any, index: number) => (
                      <div key={index} className="flex items-center justify-between">
                        <span className="text-sm">{item.category}</span>
                        <span className="font-medium">{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                    <div className="border-t pt-3">
                      <div className="flex items-center justify-between font-semibold">
                        <span>Total Income</span>
                        <span className="text-green-500">{formatCurrency(plData?.revenue || 0)}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground">No income data</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-red-500">Expenses</CardTitle>
              </CardHeader>
              <CardContent>
                {expenseItems.length > 0 ? (
                  <div className="space-y-3">
                    {expenseItems.map((item: any, index: number) => (
                      <div key={index} className="flex items-center justify-between">
                        <span className="text-sm">{item.category}</span>
                        <span className="font-medium">{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                    <div className="border-t pt-3">
                      <div className="flex items-center justify-between font-semibold">
                        <span>Total Expenses</span>
                        <span className="text-red-500">{formatCurrency(plData?.expenses || 0)}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground">No expense data</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* GST Tab */}
        <TabsContent value="gst" className="mt-4 space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Total Sales</p>
                <p className="text-2xl font-bold">{formatCurrency(gstData?.totalSales || 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Total Purchases</p>
                <p className="text-2xl font-bold">{formatCurrency(gstData?.totalPurchases || 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Output GST</p>
                <p className="text-2xl font-bold text-red-500">
                  {formatCurrency(gstData?.outputGST || 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Input GST</p>
                <p className="text-2xl font-bold text-green-500">
                  {formatCurrency(gstData?.inputGST || 0)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Net GST Liability</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-lg bg-muted p-6">
                <span className="text-lg">
                  {(gstData?.netGSTLiability || 0) >= 0
                    ? 'GST Payable'
                    : 'GST Refundable'}
                </span>
                <span
                  className={`text-3xl font-bold ${
                    (gstData?.netGSTLiability || 0) >= 0 ? 'text-red-500' : 'text-green-500'
                  }`}
                >
                  {formatCurrency(Math.abs(gstData?.netGSTLiability || 0))}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Based on {gstData?.transactionCount || 0} transactions
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Category Analysis Tab */}
        <TabsContent value="category" className="mt-4 space-y-6">
          <div className="flex justify-end">
            <Button variant="outline" onClick={handleExportTransactions}>
              <Download className="mr-2 h-4 w-4" />
              Export Transactions
            </Button>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Expense by Category</CardTitle>
              </CardHeader>
              <CardContent>
                {categoryData && categoryData.length > 0 ? (
                  <PieChart
                    data={categoryData.map((item: any) => ({
                      name: item.category,
                      value: item.amount,
                      color: item.color,
                    }))}
                    height={300}
                    showLegend={false}
                  />
                ) : (
                  <div className="flex h-[300px] items-center justify-center text-muted-foreground">
                    No data available
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Category Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                {categoryData && categoryData.length > 0 ? (
                  <div className="space-y-4">
                    {categoryData.map((item: any, index: number) => (
                      <div key={index} className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: item.color }}
                            />
                            <span>{item.category}</span>
                          </div>
                          <span className="font-medium">{formatCurrency(item.amount)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full transition-all"
                            style={{
                              width: `${item.percentage}%`,
                              backgroundColor: item.color,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-64 items-center justify-center text-muted-foreground">
                    No data available
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Items & Expenses Tab */}
        <TabsContent value="items" className="mt-4 space-y-6">
          <ItemsAnalysis
            items={vyaparItems}
            categories={itemCategories}
            isLoading={itemsLoading}
            startDate={startDate}
            endDate={endDate}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Category Rule interface
interface CategoryRule {
  id: string;
  pattern: string;
  category: string;
  caseSensitive: boolean;
}

// Default rules - common patterns
const DEFAULT_RULES: CategoryRule[] = [
  { id: '1', pattern: 'Petrol', category: 'Petrol', caseSensitive: false },
  { id: '2', pattern: 'Diesel', category: 'Fuel', caseSensitive: false },
  { id: '3', pattern: 'Toll', category: 'Travel', caseSensitive: false },
  { id: '4', pattern: 'Food', category: 'Food', caseSensitive: false },
  { id: '5', pattern: 'Tea', category: 'Food', caseSensitive: false },
  { id: '6', pattern: 'Chai', category: 'Food', caseSensitive: false },
  { id: '7', pattern: 'Lunch', category: 'Food', caseSensitive: false },
  { id: '8', pattern: 'Dinner', category: 'Food', caseSensitive: false },
  { id: '9', pattern: 'Stationery', category: 'Office Supplies', caseSensitive: false },
  { id: '10', pattern: 'Courier', category: 'Shipping', caseSensitive: false },
];

// Auto Categorize Dialog Component
function AutoCategorizeDialog({
  open,
  onOpenChange,
  onApply,
  existingCategories,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (rules: CategoryRule[], onlyUncategorized: boolean) => void;
  existingCategories: string[];
  isLoading: boolean;
}) {
  const [rules, setRules] = useState<CategoryRule[]>(() => {
    // Load from localStorage or use defaults
    const saved = localStorage.getItem('autoCategorizeRules');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return DEFAULT_RULES;
      }
    }
    return DEFAULT_RULES;
  });
  const [onlyUncategorized, setOnlyUncategorized] = useState(true);
  const [newPattern, setNewPattern] = useState('');
  const [newCategory, setNewCategory] = useState('');

  const saveRules = (newRules: CategoryRule[]) => {
    setRules(newRules);
    localStorage.setItem('autoCategorizeRules', JSON.stringify(newRules));
  };

  const addRule = () => {
    if (!newPattern.trim() || !newCategory.trim()) return;
    const newRule: CategoryRule = {
      id: Date.now().toString(),
      pattern: newPattern.trim(),
      category: newCategory.trim(),
      caseSensitive: false,
    };
    saveRules([...rules, newRule]);
    setNewPattern('');
    setNewCategory('');
  };

  const removeRule = (id: string) => {
    saveRules(rules.filter((r) => r.id !== id));
  };

  const updateRule = (id: string, field: keyof CategoryRule, value: string | boolean) => {
    saveRules(rules.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const handleApply = () => {
    onApply(rules, onlyUncategorized);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            Auto-Categorize Items
          </DialogTitle>
          <DialogDescription>
            Define patterns to automatically categorize items. If an item name contains the pattern, it will be assigned the category.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {/* Add new rule */}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs">Pattern (in item name)</Label>
              <Input
                placeholder="e.g., Petrol"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="flex-1">
              <Label className="text-xs">Category</Label>
              <Input
                placeholder="e.g., Fuel"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                list="existing-categories"
                className="h-9"
              />
              <datalist id="existing-categories">
                {existingCategories.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>
            <Button onClick={addRule} size="sm" className="h-9">
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Rules list */}
          <div className="border rounded-lg divide-y">
            {rules.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                No rules defined. Add a pattern above.
              </div>
            ) : (
              rules.map((rule) => (
                <div key={rule.id} className="flex items-center gap-2 p-2">
                  <Input
                    value={rule.pattern}
                    onChange={(e) => updateRule(rule.id, 'pattern', e.target.value)}
                    className="h-8 flex-1"
                    placeholder="Pattern"
                  />
                  <span className="text-muted-foreground">→</span>
                  <Input
                    value={rule.category}
                    onChange={(e) => updateRule(rule.id, 'category', e.target.value)}
                    className="h-8 flex-1"
                    placeholder="Category"
                    list="existing-categories"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                    onClick={() => removeRule(rule.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          {/* Options */}
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <Switch
              id="only-uncategorized"
              checked={onlyUncategorized}
              onCheckedChange={setOnlyUncategorized}
            />
            <div>
              <Label htmlFor="only-uncategorized" className="text-sm cursor-pointer">
                Only apply to uncategorized items
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Preserves categories from imports and manual edits
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={isLoading || rules.length === 0}>
            {isLoading ? (
              <>
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Applying...
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" />
                Apply Rules
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Editable Category Cell Component
function EditableCategoryCell({
  item,
  allCategories,
  onSave,
}: {
  item: VyaparItem;
  allCategories: string[];
  onSave: (id: string, category: string | null) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(item.category || '');

  const handleSave = () => {
    onSave(item.id, value || null);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setValue(item.category || '');
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-7 w-32 text-xs"
          placeholder="Category"
          list={`categories-${item.id}`}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') handleCancel();
          }}
        />
        <datalist id={`categories-${item.id}`}>
          {allCategories.map((cat) => (
            <option key={cat} value={cat} />
          ))}
        </datalist>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleSave}>
          <Check className="h-3 w-3 text-green-600" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleCancel}>
          <X className="h-3 w-3 text-red-600" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group">
      <Badge variant="outline" className="text-xs">
        {item.category || 'Uncategorized'}
      </Badge>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => setIsEditing(true)}
      >
        <Pencil className="h-3 w-3 text-muted-foreground" />
      </Button>
    </div>
  );
}

// Items Analysis Component
function ItemsAnalysis({
  items,
  isLoading,
  startDate,
  endDate,
}: {
  items: VyaparItem[];
  categories: any[];
  isLoading: boolean;
  startDate: string;
  endDate: string;
}) {
  const queryClient = useQueryClient();
  const [showAutoCategorize, setShowAutoCategorize] = useState(false);
  const [lastAutoResult, setLastAutoResult] = useState<{ updatedCount: number; totalChecked: number } | null>(null);
  const [autoUpdateNotification, setAutoUpdateNotification] = useState<{ count: number; category: string } | null>(null);

  // Mutation for updating category
  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, category }: { id: string; category: string | null }) =>
      transactionsApi.updateVyaparItemCategory(id, category),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['vyapar-items', startDate, endDate] });
      queryClient.invalidateQueries({ queryKey: ['vyapar-items-categories'] });

      // Show notification if items were auto-updated
      if (data.autoUpdated?.count > 0) {
        setAutoUpdateNotification({
          count: data.autoUpdated.count,
          category: data.category || '',
        });
        // Auto-hide after 5 seconds
        setTimeout(() => setAutoUpdateNotification(null), 5000);
      }
    },
  });

  // Mutation for auto-categorize
  const autoCategorizeaMutation = useMutation({
    mutationFn: ({ rules, onlyUncategorized }: { rules: CategoryRule[]; onlyUncategorized: boolean }) =>
      transactionsApi.autoCategorizeVyaparItems(
        rules.map((r) => ({ pattern: r.pattern, category: r.category, caseSensitive: r.caseSensitive })),
        onlyUncategorized
      ),
    onSuccess: (data) => {
      setLastAutoResult({ updatedCount: data.updatedCount, totalChecked: data.totalChecked });
      queryClient.invalidateQueries({ queryKey: ['vyapar-items', startDate, endDate] });
      queryClient.invalidateQueries({ queryKey: ['vyapar-items-categories'] });
      setShowAutoCategorize(false);
    },
  });

  const handleCategoryUpdate = (id: string, category: string | null) => {
    updateCategoryMutation.mutate({ id, category });
  };

  const handleAutoCategorize = (rules: CategoryRule[], onlyUncategorized: boolean) => {
    autoCategorizeaMutation.mutate({ rules, onlyUncategorized });
  };

  // Get all unique categories for suggestions
  const allCategories = Array.from(
    new Set(items.map((i) => i.category).filter(Boolean))
  ) as string[];
  // Calculate category summaries
  const expenseItems = items.filter((i) => ['Expense', 'Purchase'].includes(i.transactionType));
  const saleItems = items.filter((i) => ['Sale', 'Sale Order'].includes(i.transactionType));

  const expenseByCategory = expenseItems.reduce((acc, item) => {
    const cat = item.category || 'Uncategorized';
    acc[cat] = (acc[cat] || 0) + item.amount;
    return acc;
  }, {} as Record<string, number>);

  const salesByCategory = saleItems.reduce((acc, item) => {
    const cat = item.category || 'Uncategorized';
    acc[cat] = (acc[cat] || 0) + item.amount;
    return acc;
  }, {} as Record<string, number>);

  const totalExpenses = expenseItems.reduce((sum, i) => sum + i.amount, 0);
  const totalSales = saleItems.reduce((sum, i) => sum + i.amount, 0);

  // Prepare chart data
  const expenseChartData = Object.entries(expenseByCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], index) => ({
      name,
      value,
      color: `hsl(${(index * 40) % 360}, 70%, 50%)`,
    }));

  const salesChartData = Object.entries(salesByCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], index) => ({
      name,
      value,
      color: `hsl(${(index * 40 + 180) % 360}, 70%, 50%)`,
    }));

  // DataTable columns for items
  const columns: ColumnDef<VyaparItem>[] = [
    {
      id: 'date',
      header: 'Date',
      accessorKey: 'date',
      cell: (row) => format(new Date(row.date), 'dd MMM yyyy'),
      width: '100px',
    },
    {
      id: 'itemName',
      header: 'Item Name',
      accessorKey: 'itemName',
      cell: (row) => (
        <div className="max-w-[200px]">
          <span className="font-medium truncate block">{row.itemName}</span>
          {row.itemCode && (
            <span className="text-xs text-muted-foreground">{row.itemCode}</span>
          )}
        </div>
      ),
    },
    {
      id: 'category',
      header: 'Category',
      accessorKey: (row) => row.category || 'Uncategorized',
      cell: (row) => (
        <EditableCategoryCell
          item={row}
          allCategories={allCategories}
          onSave={handleCategoryUpdate}
        />
      ),
      filterType: 'select',
      filterOptions: [
        { label: 'Uncategorized', value: 'Uncategorized' },
        ...allCategories.map((cat) => ({
          label: cat,
          value: cat,
        })),
      ],
    },
    {
      id: 'transactionType',
      header: 'Type',
      accessorKey: 'transactionType',
      cell: (row) => {
        const isExpense = ['Expense', 'Purchase'].includes(row.transactionType);
        return (
          <Badge
            variant="secondary"
            className={
              isExpense
                ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
            }
          >
            {row.transactionType}
          </Badge>
        );
      },
      filterType: 'select',
      filterOptions: [
        { label: 'Sale', value: 'Sale' },
        { label: 'Sale Order', value: 'Sale Order' },
        { label: 'Purchase', value: 'Purchase' },
        { label: 'Expense', value: 'Expense' },
      ],
    },
    {
      id: 'partyName',
      header: 'Party',
      accessorKey: 'partyName',
      cell: (row) => (
        <span className="max-w-[150px] truncate block" title={row.partyName || ''}>
          {row.partyName || '-'}
        </span>
      ),
    },
    {
      id: 'quantity',
      header: 'Qty',
      accessorKey: 'quantity',
      cell: (row) => (
        <span>
          {row.quantity} {row.unit || ''}
        </span>
      ),
      align: 'right',
    },
    {
      id: 'unitPrice',
      header: 'Unit Price',
      accessorKey: 'unitPrice',
      cell: (row) => (row.unitPrice ? formatCurrency(row.unitPrice) : '-'),
      align: 'right',
    },
    {
      id: 'amount',
      header: 'Amount',
      accessorKey: 'amount',
      cell: (row) => {
        const isExpense = ['Expense', 'Purchase'].includes(row.transactionType);
        return (
          <span className={`font-medium ${isExpense ? 'text-red-600' : 'text-green-600'}`}>
            {isExpense ? '-' : '+'}
            {formatCurrency(row.amount)}
          </span>
        );
      },
      align: 'right',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Items</span>
            </div>
            <p className="text-2xl font-bold mt-1">{items.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <span className="text-sm text-muted-foreground">Total Sales</span>
            </div>
            <p className="text-2xl font-bold text-green-600 mt-1">{formatCurrency(totalSales)}</p>
            <p className="text-xs text-muted-foreground">{saleItems.length} items</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-500" />
              <span className="text-sm text-muted-foreground">Total Expenses</span>
            </div>
            <p className="text-2xl font-bold text-red-600 mt-1">{formatCurrency(totalExpenses)}</p>
            <p className="text-xs text-muted-foreground">{expenseItems.length} items</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-blue-500" />
              <span className="text-sm text-muted-foreground">Categories</span>
            </div>
            <p className="text-2xl font-bold mt-1">
              {new Set(items.map((i) => i.category || 'Uncategorized')).size}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Auto-categorize section */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => setShowAutoCategorize(true)}>
            <Wand2 className="mr-2 h-4 w-4" />
            Auto-Categorize Items
          </Button>
          {lastAutoResult && (
            <span className="text-sm text-muted-foreground">
              Last run: {lastAutoResult.updatedCount} of {lastAutoResult.totalChecked} items updated
            </span>
          )}
        </div>
        <span className="text-sm text-muted-foreground">
          {items.filter((i) => !i.category).length} uncategorized items
        </span>
      </div>

      {/* Auto-update notification */}
      {autoUpdateNotification && (
        <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-green-600" />
            <span className="text-sm text-green-800 dark:text-green-200">
              Auto-updated <strong>{autoUpdateNotification.count}</strong> similar item{autoUpdateNotification.count > 1 ? 's' : ''} to category "<strong>{autoUpdateNotification.category}</strong>"
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setAutoUpdateNotification(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600">Expenses by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {expenseChartData.length > 0 ? (
              <>
                <PieChart data={expenseChartData} height={250} showLegend={false} />
                <div className="mt-4 space-y-2">
                  {expenseChartData.slice(0, 5).map((item, index) => (
                    <div key={index} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="truncate max-w-[150px]">{item.name}</span>
                      </div>
                      <span className="font-medium">{formatCurrency(item.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-[250px] items-center justify-center text-muted-foreground">
                No expense data
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-green-600">Sales by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {salesChartData.length > 0 ? (
              <>
                <PieChart data={salesChartData} height={250} showLegend={false} />
                <div className="mt-4 space-y-2">
                  {salesChartData.slice(0, 5).map((item, index) => (
                    <div key={index} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="truncate max-w-[150px]">{item.name}</span>
                      </div>
                      <span className="font-medium">{formatCurrency(item.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-[250px] items-center justify-center text-muted-foreground">
                No sales data
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Items Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Items</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={items}
            columns={columns}
            isLoading={isLoading}
            emptyMessage="No items found for this period"
            getRowId={(row) => row.id}
            pageSize={20}
          />
        </CardContent>
      </Card>

      {/* Auto-Categorize Dialog */}
      <AutoCategorizeDialog
        open={showAutoCategorize}
        onOpenChange={setShowAutoCategorize}
        onApply={handleAutoCategorize}
        existingCategories={allCategories}
        isLoading={autoCategorizeaMutation.isPending}
      />
    </div>
  );
}

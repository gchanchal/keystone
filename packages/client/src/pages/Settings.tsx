import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Moon, Sun, Monitor, Plus, Pencil, Trash2, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Alert,
  AlertDescription,
} from '@/components/ui/alert';
import { useThemeStore } from '@/stores/useThemeStore';
import { categoriesApi, transactionsApi, accountsApi } from '@/lib/api';
import type { Category, Account } from '@/types';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { GmailSettings } from '@/components/gmail/GmailSettings';

const colorOptions = [
  { value: '#ef4444', label: 'Red' },
  { value: '#f97316', label: 'Orange' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#22c55e', label: 'Green' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#8b5cf6', label: 'Purple' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#6b7280', label: 'Gray' },
];

// Generate last 12 months for selection
function getLast12Months() {
  const months = [];
  for (let i = 0; i < 12; i++) {
    const date = subMonths(new Date(), i);
    months.push({
      value: format(date, 'yyyy-MM'),
      label: format(date, 'MMMM yyyy'),
    });
  }
  return months;
}

export function Settings() {
  const queryClient = useQueryClient();
  const { theme, setTheme } = useThemeStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: 'expense' as 'income' | 'expense',
    color: '#6b7280',
    icon: '',
  });

  // Bulk delete state
  const [deleteType, setDeleteType] = useState<'bank' | 'vyapar' | 'credit-card'>('bank');
  const [deleteAccountId, setDeleteAccountId] = useState<string>('all');
  const [deleteMonth, setDeleteMonth] = useState<string>('all');
  const [deleteCount, setDeleteCount] = useState<number | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);

  const months = getLast12Months();

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.getAll,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.getAll,
  });

  // Fetch count when filters change
  useEffect(() => {
    const fetchCount = async () => {
      try {
        let params: any = { type: deleteType };

        if (deleteAccountId !== 'all' && (deleteType === 'bank' || deleteType === 'credit-card')) {
          params.accountId = deleteAccountId;
        }

        if (deleteMonth !== 'all') {
          const monthDate = new Date(deleteMonth + '-01');
          params.startDate = format(startOfMonth(monthDate), 'yyyy-MM-dd');
          params.endDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');
        }

        const result = await transactionsApi.getCounts(params);
        setDeleteCount(result.count);
      } catch (error) {
        console.error('Error fetching count:', error);
        setDeleteCount(null);
      }
    };

    fetchCount();
  }, [deleteType, deleteAccountId, deleteMonth]);

  const handleBulkDelete = async () => {
    setIsDeleting(true);
    try {
      let params: any = {};

      if (deleteAccountId !== 'all') {
        params.accountId = deleteAccountId;
      }

      if (deleteMonth !== 'all') {
        const monthDate = new Date(deleteMonth + '-01');
        params.startDate = format(startOfMonth(monthDate), 'yyyy-MM-dd');
        params.endDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');
      }

      // If no filters, require explicit deleteAll
      if (deleteAccountId === 'all' && deleteMonth === 'all') {
        params.deleteAll = true;
      }

      if (deleteType === 'bank') {
        await transactionsApi.bulkDeleteBank(params);
      } else if (deleteType === 'vyapar') {
        await transactionsApi.bulkDeleteVyapar(params);
      } else {
        await transactionsApi.bulkDeleteCreditCard(params);
      }

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      setDeleteDialogOpen(false);
      setDeleteCount(0);
    } catch (error) {
      console.error('Error deleting transactions:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  // Filter accounts based on selected type
  const filteredAccounts = accounts.filter((a: Account) => {
    if (deleteType === 'bank') {
      return a.accountType === 'savings' || a.accountType === 'current';
    } else if (deleteType === 'credit-card') {
      return a.accountType === 'credit_card';
    }
    return true;
  });

  const createMutation = useMutation({
    mutationFn: categoriesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setDialogOpen(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => categoriesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setDialogOpen(false);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: categoriesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'expense',
      color: '#6b7280',
      icon: '',
    });
    setEditingCategory(null);
  };

  const handleEdit = (category: Category) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      type: category.type,
      color: category.color || '#6b7280',
      icon: category.icon || '',
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (editingCategory) {
      updateMutation.mutate({ id: editingCategory.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const incomeCategories = categories.filter((c: Category) => c.type === 'income');
  const expenseCategories = categories.filter((c: Category) => c.type === 'expense');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Theme Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Customize the look and feel of the application</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Theme</Label>
              <p className="text-sm text-muted-foreground">
                Select your preferred color scheme
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant={theme === 'light' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTheme('light')}
              >
                <Sun className="mr-2 h-4 w-4" />
                Light
              </Button>
              <Button
                variant={theme === 'dark' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTheme('dark')}
              >
                <Moon className="mr-2 h-4 w-4" />
                Dark
              </Button>
              <Button
                variant={theme === 'system' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTheme('system')}
              >
                <Monitor className="mr-2 h-4 w-4" />
                System
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Gmail Integration */}
      <GmailSettings />

      {/* Manage Transactions - Bulk Delete */}
      <Card>
        <CardHeader>
          <CardTitle>Manage Transactions</CardTitle>
          <CardDescription>Delete transactions by type, account, or date range</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Transaction Type</Label>
              <Select value={deleteType} onValueChange={(v: 'bank' | 'vyapar' | 'credit-card') => {
                setDeleteType(v);
                setDeleteAccountId('all');
              }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">Bank Transactions</SelectItem>
                  <SelectItem value="vyapar">Vyapar Transactions</SelectItem>
                  <SelectItem value="credit-card">Credit Card Transactions</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(deleteType === 'bank' || deleteType === 'credit-card') && (
              <div className="space-y-2">
                <Label>Account</Label>
                <Select value={deleteAccountId} onValueChange={setDeleteAccountId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Accounts</SelectItem>
                    {filteredAccounts.map((account: Account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name} ({account.bankName})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Month</Label>
              <Select value={deleteMonth} onValueChange={setDeleteMonth}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  {months.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-muted p-4">
            <div>
              <p className="font-medium">Transactions to delete</p>
              <p className="text-sm text-muted-foreground">
                {deleteType === 'bank' ? 'Bank' : deleteType === 'vyapar' ? 'Vyapar' : 'Credit Card'} transactions
                {deleteAccountId !== 'all' && ` from ${filteredAccounts.find((a: Account) => a.id === deleteAccountId)?.name}`}
                {deleteMonth !== 'all' && ` in ${months.find(m => m.value === deleteMonth)?.label}`}
              </p>
            </div>
            <Badge variant={deleteCount && deleteCount > 0 ? 'destructive' : 'secondary'} className="text-lg px-4 py-2">
              {deleteCount !== null ? deleteCount : '...'}
            </Badge>
          </div>

          <Button
            variant="destructive"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={!deleteCount || deleteCount === 0}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete {deleteCount || 0} Transactions
          </Button>
        </CardContent>
      </Card>

      {/* Data Management */}
      <Card>
        <CardHeader>
          <CardTitle>Data Management</CardTitle>
          <CardDescription>Backup and restore your data</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Database Location</Label>
              <p className="text-sm text-muted-foreground">data/finsync.db</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Your data is stored locally in a SQLite database. Back up this file regularly to
            prevent data loss.
          </p>
        </CardContent>
      </Card>

      {/* Category Management - Collapsible */}
      <Card>
        <CardHeader
          className="flex flex-row items-center justify-between cursor-pointer"
          onClick={() => setCategoriesExpanded(!categoriesExpanded)}
        >
          <div>
            <CardTitle className="flex items-center gap-2">
              Categories
              {categoriesExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </CardTitle>
            <CardDescription>
              Manage transaction categories ({incomeCategories.length + expenseCategories.length} total)
            </CardDescription>
          </div>
          {categoriesExpanded && (
            <Button onClick={(e) => { e.stopPropagation(); setDialogOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              Add Category
            </Button>
          )}
        </CardHeader>
        {categoriesExpanded && (
          <CardContent>
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Income Categories */}
              <div>
                <h3 className="mb-4 font-semibold text-green-500">Income Categories</h3>
                <div className="space-y-2">
                  {incomeCategories.map((category: Category) => (
                    <div
                      key={category.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="h-4 w-4 rounded-full"
                          style={{ backgroundColor: category.color || '#22c55e' }}
                        />
                        <span>{category.name}</span>
                        {category.isSystem && (
                          <Badge variant="secondary" className="text-xs">
                            System
                          </Badge>
                        )}
                      </div>
                      {!category.isSystem && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(category)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate(category.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Expense Categories */}
              <div>
                <h3 className="mb-4 font-semibold text-red-500">Expense Categories</h3>
                <div className="space-y-2">
                  {expenseCategories.map((category: Category) => (
                    <div
                      key={category.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="h-4 w-4 rounded-full"
                          style={{ backgroundColor: category.color || '#ef4444' }}
                        />
                        <span>{category.name}</span>
                        {category.isSystem && (
                          <Badge variant="secondary" className="text-xs">
                            System
                          </Badge>
                        )}
                      </div>
                      {!category.isSystem && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(category)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate(category.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Add/Edit Category Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? 'Edit Category' : 'Add Category'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Category name"
              />
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={formData.type}
                onValueChange={(value: 'income' | 'expense') =>
                  setFormData({ ...formData, type: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {colorOptions.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    className={`h-8 w-8 rounded-full border-2 transition-all ${
                      formData.color === color.value
                        ? 'border-foreground scale-110'
                        : 'border-transparent'
                    }`}
                    style={{ backgroundColor: color.value }}
                    onClick={() => setFormData({ ...formData, color: color.value })}
                    title={color.label}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              {editingCategory ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Confirm Deletion
            </DialogTitle>
          </DialogHeader>

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This action cannot be undone. You are about to permanently delete{' '}
              <strong>{deleteCount}</strong> {deleteType === 'bank' ? 'bank' : deleteType === 'vyapar' ? 'Vyapar' : 'credit card'} transactions
              {deleteAccountId !== 'all' && (
                <> from <strong>{filteredAccounts.find((a: Account) => a.id === deleteAccountId)?.name}</strong></>
              )}
              {deleteMonth !== 'all' && (
                <> for <strong>{months.find(m => m.value === deleteMonth)?.label}</strong></>
              )}
              .
            </AlertDescription>
          </Alert>

          <p className="text-sm text-muted-foreground">
            Any reconciliation links to these transactions will also be removed.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : `Delete ${deleteCount} Transactions`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

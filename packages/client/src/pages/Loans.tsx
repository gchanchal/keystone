import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  MoreVertical,
  Pencil,
  Trash2,
  DollarSign,
  Home,
  Calendar,
  TrendingDown,
  TrendingUp,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Clock,
  Repeat,
  School,
  Building,
  Wallet,
  Users,
  Briefcase,
  Banknote,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DataTable, ColumnDef } from '@/components/ui/data-table';
import { Progress } from '@/components/ui/progress';
import { loansApi, fixedExpensesApi, recurringIncomeApi } from '@/lib/api';
import { formatCurrency, formatDate, formatDayMonth } from '@/lib/utils';
import type { Loan } from '@/types';

interface LoanScheduleEntry {
  id: string;
  installmentNumber: number;
  dueDate: string;
  openingPrincipal: number;
  installmentAmount: number;
  principalAmount: number;
  interestAmount: number;
  closingPrincipal: number;
  interestRate: number;
  status: 'pending' | 'paid' | 'overdue' | 'partial';
  actualPaymentDate?: string;
  actualAmountPaid?: number;
}

interface LoanWithDetails extends Loan {
  payments?: any[];
  disbursements?: any[];
  financialSummary?: {
    totalPrincipalPaid: number;
    totalInterestPaid: number;
    totalChargesPaid: number;
    totalDisbursed: number;
    totalEmisPaid: number;
    preEmiInterestPaid: number;
  };
}

// Fixed expense category labels and icons
const expenseCategories = [
  { value: 'rent', label: 'Rent', icon: Building },
  { value: 'school_fees', label: 'School Fees', icon: School },
  { value: 'utilities', label: 'Utilities', icon: Wallet },
  { value: 'subscription', label: 'Subscription', icon: Repeat },
  { value: 'insurance', label: 'Insurance', icon: DollarSign },
  { value: 'maintenance', label: 'Maintenance', icon: Home },
  { value: 'other', label: 'Other', icon: Wallet },
];

const expenseFrequencies = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'half_yearly', label: 'Half Yearly' },
  { value: 'yearly', label: 'Yearly' },
];

// Income category labels and icons
const incomeCategories = [
  { value: 'salary', label: 'Salary', icon: Briefcase },
  { value: 'rental', label: 'Rental Income', icon: Building },
  { value: 'dividend', label: 'Dividend', icon: TrendingUp },
  { value: 'interest', label: 'Interest', icon: Banknote },
  { value: 'freelance', label: 'Freelance', icon: Wallet },
  { value: 'other', label: 'Other', icon: DollarSign },
];

const incomeFrequencies = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'half_yearly', label: 'Half Yearly' },
  { value: 'yearly', label: 'Yearly' },
];

export function Loans() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Main tab: 'income', 'fixed-expenses', or 'loans'
  const [mainTab, setMainTab] = useState('income');

  const [activeTab, setActiveTab] = useState(() => {
    const tab = searchParams.get('tab');
    return tab === 'given' || tab === 'taken' ? tab : 'given';
  });

  // Update tab when URL params change
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'given' || tab === 'taken') {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [selectedLoan, setSelectedLoan] = useState<LoanWithDetails | null>(null);
  const [formData, setFormData] = useState({
    type: 'given' as 'given' | 'taken',
    partyName: '',
    principalAmount: 0,
    interestRate: 0,
    emiAmount: 0,
    startDate: new Date().toISOString().split('T')[0],
    dueDate: '',
    maturityDate: '',
    notes: '',
  });
  const [paymentData, setPaymentData] = useState({
    date: new Date().toISOString().split('T')[0],
    amount: 0,
    notes: '',
  });

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ['loans'],
    queryFn: () => loansApi.getAll(),
  });

  const { data: summary } = useQuery({
    queryKey: ['loans', 'summary'],
    queryFn: loansApi.getSummary,
  });

  // Fetch selected loan details
  const { data: loanDetails } = useQuery({
    queryKey: ['loans', selectedLoan?.id],
    queryFn: () => (selectedLoan ? loansApi.getById(selectedLoan.id) : null),
    enabled: !!selectedLoan && detailDialogOpen,
  });

  // Fetch loan schedule
  const { data: scheduleData } = useQuery({
    queryKey: ['loans', selectedLoan?.id, 'schedule'],
    queryFn: async () => {
      if (!selectedLoan) return null;
      const response = await fetch(`/api/loans/${selectedLoan.id}/schedule`);
      return response.json();
    },
    enabled: !!selectedLoan && scheduleDialogOpen,
  });

  const createMutation = useMutation({
    mutationFn: loansApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      setDialogOpen(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => loansApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      setDialogOpen(false);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: loansApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    },
  });

  const markAsPaidMutation = useMutation({
    mutationFn: loansApi.markAsPaid,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      queryClient.invalidateQueries({ queryKey: ['loans', 'summary'] });
    },
  });

  const markAsUnpaidMutation = useMutation({
    mutationFn: loansApi.markAsUnpaid,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      queryClient.invalidateQueries({ queryKey: ['loans', 'summary'] });
    },
  });

  const addPaymentMutation = useMutation({
    mutationFn: ({ loanId, data }: { loanId: string; data: any }) =>
      loansApi.addPayment(loanId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      queryClient.invalidateQueries({ queryKey: ['loans', 'summary'] });
      setPaymentDialogOpen(false);
      setSelectedLoan(null);
      setPaymentData({ date: new Date().toISOString().split('T')[0], amount: 0, notes: '' });
    },
  });

  // ==================== FIXED EXPENSES ====================
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [expensePaymentDialogOpen, setExpensePaymentDialogOpen] = useState(false);
  const [selectedExpenseForPayment, setSelectedExpenseForPayment] = useState<any>(null);
  const [editingExpense, setEditingExpense] = useState<any>(null);
  const [expenseFormData, setExpenseFormData] = useState({
    name: '',
    category: 'rent' as string,
    amount: 0,
    frequency: 'monthly' as string,
    dueDay: 1,
    dueMonth: 1,
    beneficiary: '',
    forWhom: '',
    startDate: '',
    endDate: '',
    notes: '',
    status: 'active' as string,
  });
  const [expensePaymentData, setExpensePaymentData] = useState({
    paymentDate: new Date().toISOString().split('T')[0],
    amount: 0,
    forPeriod: '',
    paymentMode: '',
    referenceNumber: '',
    notes: '',
  });

  const { data: fixedExpenses = [] } = useQuery({
    queryKey: ['fixed-expenses'],
    queryFn: fixedExpensesApi.getAll,
  });

  const { data: expensesSummary } = useQuery({
    queryKey: ['fixed-expenses', 'summary'],
    queryFn: fixedExpensesApi.getSummary,
  });

  const createExpenseMutation = useMutation({
    mutationFn: fixedExpensesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fixed-expenses'] });
      setExpenseDialogOpen(false);
      resetExpenseForm();
    },
  });

  const updateExpenseMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => fixedExpensesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fixed-expenses'] });
      queryClient.invalidateQueries({ queryKey: ['loans', 'summary'] });
      setExpenseDialogOpen(false);
      resetExpenseForm();
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: fixedExpensesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fixed-expenses'] });
    },
  });

  const addExpensePaymentMutation = useMutation({
    mutationFn: ({ expenseId, data }: { expenseId: string; data: any }) =>
      fixedExpensesApi.addPayment(expenseId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fixed-expenses'] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      setExpensePaymentDialogOpen(false);
      setSelectedExpenseForPayment(null);
      setExpensePaymentData({
        paymentDate: new Date().toISOString().split('T')[0],
        amount: 0,
        forPeriod: '',
        paymentMode: '',
        referenceNumber: '',
        notes: '',
      });
    },
  });

  // ==================== RECURRING INCOME ====================
  const [incomeDialogOpen, setIncomeDialogOpen] = useState(false);
  const [incomeReceiptDialogOpen, setIncomeReceiptDialogOpen] = useState(false);
  const [selectedIncomeForReceipt, setSelectedIncomeForReceipt] = useState<any>(null);
  const [editingIncome, setEditingIncome] = useState<any>(null);
  const [incomeFormData, setIncomeFormData] = useState({
    name: '',
    category: 'salary' as string,
    amount: 0,
    frequency: 'monthly' as string,
    expectedDay: 1,
    expectedMonth: 1,
    source: '',
    forWhom: '',
    startDate: '',
    endDate: '',
    notes: '',
  });
  const [incomeReceiptData, setIncomeReceiptData] = useState({
    receiptDate: new Date().toISOString().split('T')[0],
    amount: 0,
    forPeriod: '',
    paymentMode: '',
    referenceNumber: '',
    notes: '',
  });

  const { data: recurringIncomes = [] } = useQuery({
    queryKey: ['recurring-income'],
    queryFn: recurringIncomeApi.getAll,
  });

  const { data: incomeSummary } = useQuery({
    queryKey: ['recurring-income', 'summary'],
    queryFn: recurringIncomeApi.getSummary,
  });

  const createIncomeMutation = useMutation({
    mutationFn: recurringIncomeApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-income'] });
      setIncomeDialogOpen(false);
      resetIncomeForm();
    },
  });

  const updateIncomeMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => recurringIncomeApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-income'] });
      setIncomeDialogOpen(false);
      resetIncomeForm();
    },
  });

  const deleteIncomeMutation = useMutation({
    mutationFn: recurringIncomeApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-income'] });
    },
  });

  const addIncomeReceiptMutation = useMutation({
    mutationFn: ({ incomeId, data }: { incomeId: string; data: any }) =>
      recurringIncomeApi.addReceipt(incomeId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-income'] });
      setIncomeReceiptDialogOpen(false);
      setSelectedIncomeForReceipt(null);
      setIncomeReceiptData({
        receiptDate: new Date().toISOString().split('T')[0],
        amount: 0,
        forPeriod: '',
        paymentMode: '',
        referenceNumber: '',
        notes: '',
      });
    },
  });

  const resetIncomeForm = () => {
    setIncomeFormData({
      name: '',
      category: 'salary',
      amount: 0,
      frequency: 'monthly',
      expectedDay: 1,
      expectedMonth: 1,
      source: '',
      forWhom: '',
      startDate: '',
      endDate: '',
      notes: '',
    });
    setEditingIncome(null);
  };

  const handleEditIncome = (income: any) => {
    setEditingIncome(income);
    setIncomeFormData({
      name: income.name,
      category: income.category,
      amount: income.amount,
      frequency: income.frequency,
      expectedDay: income.expectedDay || 1,
      expectedMonth: income.expectedMonth || 1,
      source: income.source || '',
      forWhom: income.forWhom || '',
      startDate: income.startDate || '',
      endDate: income.endDate || '',
      notes: income.notes || '',
    });
    setIncomeDialogOpen(true);
  };

  const handleIncomeSubmit = () => {
    if (editingIncome) {
      updateIncomeMutation.mutate({ id: editingIncome.id, data: incomeFormData });
    } else {
      createIncomeMutation.mutate(incomeFormData);
    }
  };

  const handleRecordReceipt = (income: any) => {
    setSelectedIncomeForReceipt(income);
    setIncomeReceiptData({
      receiptDate: new Date().toISOString().split('T')[0],
      amount: income.amount,
      forPeriod: getCurrentPeriod(income.frequency),
      paymentMode: '',
      referenceNumber: '',
      notes: '',
    });
    setIncomeReceiptDialogOpen(true);
  };

  // Check if income is received for current period
  const isIncomeReceivedForCurrentPeriod = (income: any): boolean => {
    if (!income.lastReceivedDate) return false;
    const lastReceived = new Date(income.lastReceivedDate);
    const now = new Date();

    if (income.frequency === 'yearly') {
      return lastReceived.getFullYear() === now.getFullYear();
    } else if (income.frequency === 'half_yearly') {
      const lastHalf = lastReceived.getMonth() < 6 ? 1 : 2;
      const currentHalf = now.getMonth() < 6 ? 1 : 2;
      return lastReceived.getFullYear() === now.getFullYear() && lastHalf === currentHalf;
    } else if (income.frequency === 'quarterly') {
      const lastQuarter = Math.floor(lastReceived.getMonth() / 3);
      const currentQuarter = Math.floor(now.getMonth() / 3);
      return lastReceived.getFullYear() === now.getFullYear() && lastQuarter === currentQuarter;
    }
    return false;
  };

  // Helper to get current period label based on frequency
  const getCurrentPeriod = (frequency: string): string => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    if (frequency === 'yearly') {
      return `${year}`;
    } else if (frequency === 'half_yearly') {
      return month < 6 ? `H1 ${year}` : `H2 ${year}`;
    } else if (frequency === 'quarterly') {
      const quarter = Math.floor(month / 3) + 1;
      return `Q${quarter} ${year}`;
    }
    return `${now.toLocaleString('default', { month: 'short' })} ${year}`;
  };

  // Check if expense is paid for current period
  const isExpensePaidForCurrentPeriod = (expense: any): boolean => {
    if (!expense.lastPaidDate) return false;
    const lastPaid = new Date(expense.lastPaidDate);
    const now = new Date();

    if (expense.frequency === 'monthly') {
      return lastPaid.getFullYear() === now.getFullYear() && lastPaid.getMonth() === now.getMonth();
    } else if (expense.frequency === 'yearly') {
      return lastPaid.getFullYear() === now.getFullYear();
    } else if (expense.frequency === 'half_yearly') {
      const lastHalf = lastPaid.getMonth() < 6 ? 1 : 2;
      const currentHalf = now.getMonth() < 6 ? 1 : 2;
      return lastPaid.getFullYear() === now.getFullYear() && lastHalf === currentHalf;
    } else if (expense.frequency === 'quarterly') {
      const lastQuarter = Math.floor(lastPaid.getMonth() / 3);
      const currentQuarter = Math.floor(now.getMonth() / 3);
      return lastPaid.getFullYear() === now.getFullYear() && lastQuarter === currentQuarter;
    }
    return false;
  };

  const handleMarkAsPaid = (expense: any) => {
    // Directly update lastPaidDate to today
    updateExpenseMutation.mutate({
      id: expense.id,
      data: { lastPaidDate: new Date().toISOString().split('T')[0] }
    });
  };

  const handleMarkAsPending = (expense: any) => {
    // Clear the lastPaidDate to mark as pending
    updateExpenseMutation.mutate({
      id: expense.id,
      data: { lastPaidDate: null }
    });
  };

  const resetExpenseForm = () => {
    setExpenseFormData({
      name: '',
      category: 'rent',
      amount: 0,
      frequency: 'monthly',
      dueDay: 1,
      dueMonth: 1,
      beneficiary: '',
      forWhom: '',
      startDate: '',
      endDate: '',
      notes: '',
      status: 'active',
    });
    setEditingExpense(null);
  };

  const handleEditExpense = (expense: any) => {
    setEditingExpense(expense);
    setExpenseFormData({
      name: expense.name,
      category: expense.category,
      amount: expense.amount,
      frequency: expense.frequency,
      dueDay: expense.dueDay || 1,
      dueMonth: expense.dueMonth || 1,
      beneficiary: expense.beneficiary || '',
      forWhom: expense.forWhom || '',
      startDate: expense.startDate || '',
      endDate: expense.endDate || '',
      notes: expense.notes || '',
      status: expense.status || 'active',
    });
    setExpenseDialogOpen(true);
  };

  const handleExpenseSubmit = () => {
    if (editingExpense) {
      updateExpenseMutation.mutate({ id: editingExpense.id, data: expenseFormData });
    } else {
      createExpenseMutation.mutate(expenseFormData);
    }
  };

  // Navigate to loan given details page
  const handleOpenGivenDetails = (loan: Loan) => {
    navigate(`/loans/${loan.id}/details`);
  };

  const resetForm = () => {
    setFormData({
      type: 'given',
      partyName: '',
      principalAmount: 0,
      interestRate: 0,
      emiAmount: 0,
      startDate: new Date().toISOString().split('T')[0],
      dueDate: '',
      maturityDate: '',
      notes: '',
    });
    setEditingLoan(null);
  };

  const handleEdit = (loan: Loan) => {
    setEditingLoan(loan);
    setFormData({
      type: loan.type,
      partyName: loan.partyName,
      principalAmount: loan.principalAmount,
      interestRate: loan.interestRate,
      emiAmount: (loan as any).emiAmount || 0,
      startDate: loan.startDate,
      dueDate: loan.dueDate || '',
      maturityDate: (loan as any).maturityDate || '',
      notes: loan.notes || '',
    });
    setDialogOpen(true);
  };

  // Mark loan as paid for current month (only sets lastPaidDate, does NOT change outstanding)
  const handleMarkLoanAsPaid = (loan: Loan) => {
    markAsPaidMutation.mutate(loan.id);
  };

  // Mark loan as unpaid (clears lastPaidDate)
  const handleMarkLoanAsUnpaid = (loan: Loan) => {
    markAsUnpaidMutation.mutate(loan.id);
  };

  // Check if loan is paid for current month
  const isLoanPaidThisMonth = (loan: Loan): boolean => {
    if (!loan.lastPaidDate) return false;
    const now = new Date();
    const [paidYear, paidMonth] = loan.lastPaidDate.split('-').map(Number);
    return paidYear === now.getFullYear() && paidMonth === now.getMonth() + 1;
  };

  const handleViewDetails = (loan: LoanWithDetails) => {
    setSelectedLoan(loan);
    setDetailDialogOpen(true);
  };

  const handleViewSchedule = (loan: LoanWithDetails) => {
    setSelectedLoan(loan);
    setScheduleDialogOpen(true);
  };

  const handleSubmit = () => {
    // For 'given' type loans, principalAmount starts at 0 (derived from details)
    const submitData = {
      ...formData,
      principalAmount: formData.type === 'given' ? 0 : formData.principalAmount,
    };

    if (editingLoan) {
      updateMutation.mutate({ id: editingLoan.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  // Filter loans by type - home loans are included in taken
  const givenLoans = loans.filter((loan: Loan) => loan.type === 'given');
  const takenLoans = loans.filter((loan: Loan) => loan.type === 'taken');

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Expenses & Income</h1>
        {mainTab === 'income' && (
          <Button onClick={() => setIncomeDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Recurring Income
          </Button>
        )}
        {mainTab === 'fixed-expenses' && (
          <Button onClick={() => setExpenseDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Fixed Expense
          </Button>
        )}
        {mainTab === 'loans' && (
          <Button
            onClick={() => {
              setFormData({ ...formData, type: activeTab === 'given' ? 'given' : 'taken' });
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Loan
          </Button>
        )}
      </div>

      {/* Main Tabs: Income, Fixed Expenses, and Loans */}
      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList>
          <TabsTrigger value="income">Income</TabsTrigger>
          <TabsTrigger value="fixed-expenses">Fixed Expenses</TabsTrigger>
          <TabsTrigger value="loans">Loans</TabsTrigger>
        </TabsList>

        {/* Loans Tab Content */}
        <TabsContent value="loans" className="mt-4 space-y-6">
          {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-green-500/10 p-3">
                <ArrowUpRight className="h-6 w-6 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Loans Given</p>
                <p className="text-2xl font-bold">{formatCurrency(summary?.given?.outstanding || 0)}</p>
                <p className="text-xs text-muted-foreground">
                  {summary?.given?.active || 0} active
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-red-500/10 p-3">
                <ArrowDownRight className="h-6 w-6 text-red-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Loans Taken</p>
                <p className="text-2xl font-bold">{formatCurrency(summary?.taken?.outstanding || 0)}</p>
                <p className="text-xs text-muted-foreground">
                  {summary?.taken?.active || 0} active
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950/30 dark:to-orange-900/20 border-orange-200 dark:border-orange-800">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-orange-500/20 p-3">
                <Calendar className="h-6 w-6 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Monthly EMI</p>
                <p className="text-2xl font-bold text-orange-600">{formatCurrency(summary?.taken?.totalEmi || 0)}</p>
                <p className="text-xs text-muted-foreground">
                  From {summary?.taken?.active || 0} loans
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <DollarSign className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Net Position</p>
                <p
                  className={`text-2xl font-bold ${
                    (summary?.netPosition || 0) >= 0 ? 'text-green-500' : 'text-red-500'
                  }`}
                >
                  {formatCurrency(summary?.netPosition || 0)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(summary?.netPosition || 0) >= 0 ? 'Net receivable' : 'Net payable'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="given">Given ({givenLoans.length})</TabsTrigger>
          <TabsTrigger value="taken">Taken ({takenLoans.length})</TabsTrigger>
        </TabsList>

        {/* Given Loans Tab */}
        <TabsContent value="given" className="mt-4">
          <LoansGrid
            loans={givenLoans}
            emptyMessage="No loans given yet"
            onEdit={handleEdit}
            onMarkAsPaid={handleMarkLoanAsPaid}
            onMarkAsUnpaid={handleMarkLoanAsUnpaid}
            onDelete={(id) => deleteMutation.mutate(id)}
            onRowClick={handleOpenGivenDetails}
          />
        </TabsContent>

        {/* Taken Loans Tab */}
        <TabsContent value="taken" className="mt-4">
          {takenLoans.length === 0 ? (
            <Card>
              <CardContent className="flex h-64 items-center justify-center text-muted-foreground">
                No loans taken yet
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Home Loans shown as cards */}
              {takenLoans.filter((l: LoanWithDetails) => l.loanType === 'home').length > 0 && (
                <div className="space-y-4">
                  {takenLoans
                    .filter((l: LoanWithDetails) => l.loanType === 'home')
                    .map((loan: LoanWithDetails) => (
                      <HomeLoanCard
                        key={loan.id}
                        loan={loan}
                        onViewDetails={() => handleViewDetails(loan)}
                        onViewSchedule={() => handleViewSchedule(loan)}
                        onMarkAsPaid={() => handleMarkLoanAsPaid(loan)}
                        onMarkAsUnpaid={() => handleMarkLoanAsUnpaid(loan)}
                        onEdit={() => handleEdit(loan)}
                        onDelete={() => deleteMutation.mutate(loan.id)}
                      />
                    ))}
                </div>
              )}
              {/* Other taken loans shown in table */}
              {takenLoans.filter((l: LoanWithDetails) => l.loanType !== 'home').length > 0 && (
                <LoansGrid
                  loans={takenLoans.filter((l: LoanWithDetails) => l.loanType !== 'home')}
                  emptyMessage=""
                  onEdit={handleEdit}
                  onMarkAsPaid={handleMarkLoanAsPaid}
                  onMarkAsUnpaid={handleMarkLoanAsUnpaid}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
        </TabsContent>

        {/* Fixed Expenses Tab Content */}
        <TabsContent value="fixed-expenses" className="mt-4 space-y-6">
          {/* Fixed Expenses Summary */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-purple-500/10 p-3">
                    <Repeat className="h-6 w-6 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Active Expenses</p>
                    <p className="text-2xl font-bold">{expensesSummary?.activeExpenses || 0}</p>
                    <p className="text-xs text-muted-foreground">recurring</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950/30 dark:to-orange-900/20 border-orange-200 dark:border-orange-800">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-orange-500/20 p-3">
                    <Calendar className="h-6 w-6 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Monthly Total</p>
                    <p className="text-2xl font-bold text-orange-600">{formatCurrency(expensesSummary?.monthlyTotal || 0)}</p>
                    <p className="text-xs text-muted-foreground">per month</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-blue-500/10 p-3">
                    <DollarSign className="h-6 w-6 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Yearly Total</p>
                    <p className="text-2xl font-bold">{formatCurrency(expensesSummary?.yearlyTotal || 0)}</p>
                    <p className="text-xs text-muted-foreground">per year</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-green-500/10 p-3">
                    <Users className="h-6 w-6 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">By Person</p>
                    <p className="text-lg font-bold">
                      {Object.keys(expensesSummary?.byPerson || {}).length} members
                    </p>
                    <p className="text-xs text-muted-foreground">tracked</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Fixed Expenses List */}
          {fixedExpenses.length === 0 ? (
            <Card>
              <CardContent className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                <Repeat className="mb-4 h-12 w-12 opacity-50" />
                <p>No fixed expenses added yet</p>
                <Button className="mt-4" onClick={() => setExpenseDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Your First Fixed Expense
                </Button>
              </CardContent>
            </Card>
          ) : (
            <DataTable
              data={fixedExpenses}
              columns={[
                {
                  id: 'name',
                  header: 'Name',
                  accessorKey: 'name',
                  cell: (expense: any) => (
                    <div>
                      <div className="font-medium">{expense.name}</div>
                      {expense.dueDay && (
                        <div className="text-xs text-muted-foreground">
                          Due: {expense.dueDay}{expense.dueDay === 1 ? 'st' : expense.dueDay === 2 ? 'nd' : expense.dueDay === 3 ? 'rd' : 'th'}
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  id: 'category',
                  header: 'Category',
                  accessorKey: 'category',
                  filterType: 'select',
                  filterOptions: expenseCategories.map(c => ({ label: c.label, value: c.value })),
                  cell: (expense: any) => (
                    <Badge variant="secondary">
                      {expenseCategories.find(c => c.value === expense.category)?.label || expense.category}
                    </Badge>
                  ),
                },
                {
                  id: 'forWhom',
                  header: 'For',
                  accessorKey: 'forWhom',
                  cell: (expense: any) => expense.forWhom || '-',
                },
                {
                  id: 'amount',
                  header: 'Amount',
                  accessorKey: 'amount',
                  align: 'right',
                  cell: (expense: any) => (
                    <span className="font-semibold">{formatCurrency(expense.amount)}</span>
                  ),
                },
                {
                  id: 'frequency',
                  header: 'Frequency',
                  accessorKey: 'frequency',
                  filterType: 'select',
                  filterOptions: expenseFrequencies.map(f => ({ label: f.label, value: f.value })),
                  cell: (expense: any) => (
                    <Badge variant="outline">
                      {expenseFrequencies.find(f => f.value === expense.frequency)?.label || expense.frequency}
                    </Badge>
                  ),
                },
                {
                  id: 'beneficiary',
                  header: 'Beneficiary',
                  accessorKey: 'beneficiary',
                  cell: (expense: any) => (
                    <span className="text-muted-foreground">{expense.beneficiary || '-'}</span>
                  ),
                },
                {
                  id: 'status',
                  header: 'Status',
                  sortable: false,
                  filterable: false,
                  cell: (expense: any) => {
                    const isNonMonthly = expense.frequency !== 'monthly';
                    const isPaid = isNonMonthly ? isExpensePaidForCurrentPeriod(expense) : null;
                    const currentPeriod = isNonMonthly ? getCurrentPeriod(expense.frequency) : null;

                    return isNonMonthly ? (
                      <div className="flex flex-col gap-1">
                        <Badge variant={isPaid ? 'default' : 'destructive'} className={isPaid ? 'bg-green-500' : ''}>
                          {isPaid ? (
                            <><CheckCircle2 className="mr-1 h-3 w-3" />Paid</>
                          ) : (
                            <><Clock className="mr-1 h-3 w-3" />Pending</>
                          )}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{currentPeriod}</span>
                      </div>
                    ) : (
                      <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950/30">
                        <Repeat className="mr-1 h-3 w-3" />Recurring
                      </Badge>
                    );
                  },
                },
                {
                  id: 'actions',
                  header: '',
                  sortable: false,
                  filterable: false,
                  width: '50px',
                  cell: (expense: any) => {
                    // Check if paid for current period (works for all frequencies)
                    const isPaid = isExpensePaidForCurrentPeriod(expense);

                    return (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {!isPaid && (
                            <DropdownMenuItem onClick={() => handleMarkAsPaid(expense)}>
                              <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />Mark as Paid
                            </DropdownMenuItem>
                          )}
                          {isPaid && (
                            <DropdownMenuItem onClick={() => handleMarkAsPending(expense)}>
                              <Clock className="mr-2 h-4 w-4 text-orange-500" />Mark as Pending
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handleEditExpense(expense)}>
                            <Pencil className="mr-2 h-4 w-4" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => deleteExpenseMutation.mutate(expense.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    );
                  },
                },
              ] as ColumnDef<any>[]}
              rowClassName={(expense: any) => {
                const isNonMonthly = expense.frequency !== 'monthly';
                const isPaid = isNonMonthly ? isExpensePaidForCurrentPeriod(expense) : null;
                return isNonMonthly && !isPaid ? 'bg-orange-50/50 dark:bg-orange-950/10' : '';
              }}
              getRowId={(expense: any) => expense.id}
              emptyMessage="No fixed expenses found"
            />
          )}
        </TabsContent>

        {/* Income Tab Content */}
        <TabsContent value="income" className="mt-4 space-y-6">
          {/* Income Summary */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-green-500/10 p-3">
                    <TrendingUp className="h-6 w-6 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Active Incomes</p>
                    <p className="text-2xl font-bold">{incomeSummary?.activeIncomes || 0}</p>
                    <p className="text-xs text-muted-foreground">recurring</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/30 dark:to-green-900/20 border-green-200 dark:border-green-800">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-green-500/20 p-3">
                    <Calendar className="h-6 w-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Monthly Total</p>
                    <p className="text-2xl font-bold text-green-600">{formatCurrency(incomeSummary?.monthlyTotal || 0)}</p>
                    <p className="text-xs text-muted-foreground">per month</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-blue-500/10 p-3">
                    <DollarSign className="h-6 w-6 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Yearly Total</p>
                    <p className="text-2xl font-bold">{formatCurrency(incomeSummary?.yearlyTotal || 0)}</p>
                    <p className="text-xs text-muted-foreground">per year</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-purple-500/10 p-3">
                    <Users className="h-6 w-6 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">By Person</p>
                    <p className="text-lg font-bold">
                      {Object.keys(incomeSummary?.byPerson || {}).length} members
                    </p>
                    <p className="text-xs text-muted-foreground">tracked</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recurring Income List */}
          {recurringIncomes.length === 0 ? (
            <Card>
              <CardContent className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                <TrendingUp className="mb-4 h-12 w-12 opacity-50" />
                <p>No recurring income added yet</p>
                <Button className="mt-4" onClick={() => setIncomeDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Your First Recurring Income
                </Button>
              </CardContent>
            </Card>
          ) : (
            <DataTable
              data={recurringIncomes}
              columns={[
                {
                  id: 'name',
                  header: 'Name',
                  accessorKey: 'name',
                  cell: (income: any) => (
                    <div>
                      <div className="font-medium">{income.name}</div>
                      {income.expectedDay && (
                        <div className="text-xs text-muted-foreground">
                          Expected: {income.expectedDay}{income.expectedDay === 1 ? 'st' : income.expectedDay === 2 ? 'nd' : income.expectedDay === 3 ? 'rd' : 'th'}
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  id: 'category',
                  header: 'Category',
                  accessorKey: 'category',
                  filterType: 'select',
                  filterOptions: incomeCategories.map(c => ({ label: c.label, value: c.value })),
                  cell: (income: any) => (
                    <Badge variant="secondary" className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">
                      {incomeCategories.find(c => c.value === income.category)?.label || income.category}
                    </Badge>
                  ),
                },
                {
                  id: 'forWhom',
                  header: 'For',
                  accessorKey: 'forWhom',
                  cell: (income: any) => income.forWhom || '-',
                },
                {
                  id: 'amount',
                  header: 'Amount',
                  accessorKey: 'amount',
                  align: 'right',
                  cell: (income: any) => (
                    <span className="font-semibold text-green-600">{formatCurrency(income.amount)}</span>
                  ),
                },
                {
                  id: 'frequency',
                  header: 'Frequency',
                  accessorKey: 'frequency',
                  filterType: 'select',
                  filterOptions: incomeFrequencies.map(f => ({ label: f.label, value: f.value })),
                  cell: (income: any) => (
                    <Badge variant="outline">
                      {incomeFrequencies.find(f => f.value === income.frequency)?.label || income.frequency}
                    </Badge>
                  ),
                },
                {
                  id: 'source',
                  header: 'Source',
                  accessorKey: 'source',
                  cell: (income: any) => (
                    <span className="text-muted-foreground">{income.source || '-'}</span>
                  ),
                },
                {
                  id: 'status',
                  header: 'Status',
                  sortable: false,
                  filterable: false,
                  cell: (income: any) => {
                    const isNonMonthly = income.frequency !== 'monthly';
                    const isReceived = isNonMonthly ? isIncomeReceivedForCurrentPeriod(income) : null;
                    const currentPeriod = isNonMonthly ? getCurrentPeriod(income.frequency) : null;

                    return isNonMonthly ? (
                      <div className="flex flex-col gap-1">
                        <Badge variant={isReceived ? 'default' : 'secondary'} className={isReceived ? 'bg-green-500' : 'bg-amber-100 text-amber-700'}>
                          {isReceived ? (
                            <><CheckCircle2 className="mr-1 h-3 w-3" />Received</>
                          ) : (
                            <><Clock className="mr-1 h-3 w-3" />Expected</>
                          )}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{currentPeriod}</span>
                      </div>
                    ) : (
                      <Badge variant="outline" className="bg-green-50 dark:bg-green-950/30">
                        <Repeat className="mr-1 h-3 w-3" />Recurring
                      </Badge>
                    );
                  },
                },
                {
                  id: 'actions',
                  header: '',
                  sortable: false,
                  filterable: false,
                  width: '50px',
                  cell: (income: any) => {
                    const isNonMonthly = income.frequency !== 'monthly';
                    const isReceived = isNonMonthly ? isIncomeReceivedForCurrentPeriod(income) : null;

                    return (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {isNonMonthly && !isReceived && (
                            <DropdownMenuItem onClick={() => handleRecordReceipt(income)}>
                              <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />Record Receipt
                            </DropdownMenuItem>
                          )}
                          {isNonMonthly && isReceived && (
                            <DropdownMenuItem onClick={() => handleRecordReceipt(income)}>
                              <DollarSign className="mr-2 h-4 w-4" />Record Another Receipt
                            </DropdownMenuItem>
                          )}
                          {!isNonMonthly && (
                            <DropdownMenuItem onClick={() => handleRecordReceipt(income)}>
                              <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />Record Receipt
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handleEditIncome(income)}>
                            <Pencil className="mr-2 h-4 w-4" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => deleteIncomeMutation.mutate(income.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    );
                  },
                },
              ] as ColumnDef<any>[]}
              rowClassName={(income: any) => {
                const isNonMonthly = income.frequency !== 'monthly';
                const isReceived = isNonMonthly ? isIncomeReceivedForCurrentPeriod(income) : null;
                return isNonMonthly && !isReceived ? 'bg-amber-50/50 dark:bg-amber-950/10' : '';
              }}
              getRowId={(income: any) => income.id}
              emptyMessage="No recurring income found"
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Add/Edit Loan Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLoan ? 'Edit Loan' : 'Add Loan'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={formData.type}
                onValueChange={(value: 'given' | 'taken') =>
                  setFormData({ ...formData, type: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="given">Given (Receivable)</SelectItem>
                  <SelectItem value="taken">Taken (Payable)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Party Name</Label>
              <Input
                value={formData.partyName}
                onChange={(e) => setFormData({ ...formData, partyName: e.target.value })}
                placeholder="Name of borrower/lender"
              />
            </div>

            {formData.type === 'taken' && (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Principal Amount</Label>
                    <Input
                      type="number"
                      value={formData.principalAmount}
                      onChange={(e) =>
                        setFormData({ ...formData, principalAmount: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Interest Rate (% p.a.)</Label>
                    <Input
                      type="number"
                      value={formData.interestRate}
                      onChange={(e) =>
                        setFormData({ ...formData, interestRate: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Monthly EMI</Label>
                    <Input
                      type="number"
                      value={formData.emiAmount}
                      onChange={(e) =>
                        setFormData({ ...formData, emiAmount: parseFloat(e.target.value) || 0 })
                      }
                      placeholder="Monthly EMI amount"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>End Date (Maturity)</Label>
                    <Input
                      type="date"
                      value={formData.maturityDate}
                      onChange={(e) => setFormData({ ...formData, maturityDate: e.target.value })}
                    />
                  </div>
                </div>
              </>
            )}

            {formData.type === 'given' && (
              <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                Principal and Outstanding amounts will be calculated from the details entries.
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Due Date (Optional)</Label>
                <Input
                  type="date"
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Input
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Additional notes"
              />
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
            <Button onClick={handleSubmit}>{editingLoan ? 'Update' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Payment</DialogTitle>
          </DialogHeader>

          {selectedLoan && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted p-3">
                <p className="text-sm text-muted-foreground">
                  Outstanding: {formatCurrency(selectedLoan.outstandingAmount)}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={paymentData.date}
                  onChange={(e) => setPaymentData({ ...paymentData, date: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Amount</Label>
                <Input
                  type="number"
                  value={paymentData.amount}
                  onChange={(e) =>
                    setPaymentData({ ...paymentData, amount: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Notes (Optional)</Label>
                <Input
                  value={paymentData.notes}
                  onChange={(e) => setPaymentData({ ...paymentData, notes: e.target.value })}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                selectedLoan &&
                addPaymentMutation.mutate({ loanId: selectedLoan.id, data: paymentData })
              }
            >
              Add Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loan Details Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Loan Details</DialogTitle>
          </DialogHeader>

          {loanDetails && (
            <div className="space-y-6">
              {/* Loan Info */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Lender</p>
                  <p className="font-semibold">{loanDetails.partyName}</p>
                </div>
                {loanDetails.agreementNumber && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Agreement Number</p>
                    <p className="font-semibold">{loanDetails.agreementNumber}</p>
                  </div>
                )}
                {loanDetails.borrowerName && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Borrower</p>
                    <p className="font-semibold">{loanDetails.borrowerName}</p>
                  </div>
                )}
                {loanDetails.coBorrowerName && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Co-Borrower</p>
                    <p className="font-semibold">{loanDetails.coBorrowerName}</p>
                  </div>
                )}
              </div>

              {/* Financial Summary */}
              {loanDetails.financialSummary && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Financial Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Total Disbursed</p>
                        <p className="text-xl font-bold">
                          {formatCurrency(loanDetails.financialSummary.totalDisbursed)}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Principal Paid</p>
                        <p className="text-xl font-bold text-green-600">
                          {formatCurrency(loanDetails.financialSummary.totalPrincipalPaid)}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Interest Paid</p>
                        <p className="text-xl font-bold text-amber-600">
                          {formatCurrency(loanDetails.financialSummary.totalInterestPaid)}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">EMIs Paid</p>
                        <p className="text-xl font-bold">
                          {loanDetails.financialSummary.totalEmisPaid}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Outstanding</p>
                        <p className="text-xl font-bold text-red-600">
                          {formatCurrency(loanDetails.outstandingAmount)}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Charges Paid</p>
                        <p className="text-xl font-bold">
                          {formatCurrency(loanDetails.financialSummary.totalChargesPaid)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* All Transactions */}
              {loanDetails.payments && loanDetails.payments.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      Payment History ({loanDetails.payments.length} transactions)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable
                      data={loanDetails.payments}
                      showPagination={false}
                      columns={[
                        {
                          id: 'date',
                          header: 'Date',
                          accessorKey: 'date',
                          cell: (payment: any) => (
                            <span className="whitespace-nowrap">{formatDate(payment.date)}</span>
                          ),
                        },
                        {
                          id: 'transactionType',
                          header: 'Type',
                          accessorKey: 'transactionType',
                          filterType: 'select',
                          filterOptions: [
                            { label: 'EMI', value: 'emi' },
                            { label: 'Pre-EMI Interest', value: 'pre_emi_interest' },
                            { label: 'Disbursement', value: 'disbursement' },
                          ],
                          cell: (payment: any) => (
                            <Badge
                              variant={
                                payment.transactionType === 'emi' ? 'default' :
                                payment.transactionType === 'pre_emi_interest' ? 'secondary' :
                                payment.transactionType === 'disbursement' ? 'outline' :
                                'outline'
                              }
                              className="text-xs"
                            >
                              {payment.transactionType?.replace(/_/g, ' ')}
                            </Badge>
                          ),
                        },
                        {
                          id: 'particulars',
                          header: 'Particulars',
                          accessorKey: 'particulars',
                          cell: (payment: any) => (
                            <span className="max-w-[200px] truncate text-xs text-muted-foreground">
                              {payment.particulars || '-'}
                            </span>
                          ),
                        },
                        {
                          id: 'amount',
                          header: 'Amount',
                          accessorKey: 'amount',
                          align: 'right',
                          cell: (payment: any) => (
                            <span className="font-medium">{formatCurrency(payment.amount)}</span>
                          ),
                        },
                        {
                          id: 'principalPaid',
                          header: 'Principal',
                          accessorKey: 'principalPaid',
                          align: 'right',
                          cell: (payment: any) => (
                            <span className="text-green-600">
                              {payment.principalPaid ? formatCurrency(payment.principalPaid) : '-'}
                            </span>
                          ),
                        },
                        {
                          id: 'interestPaid',
                          header: 'Interest',
                          accessorKey: 'interestPaid',
                          align: 'right',
                          cell: (payment: any) => (
                            <span className="text-amber-600">
                              {payment.interestPaid ? formatCurrency(payment.interestPaid) : '-'}
                            </span>
                          ),
                        },
                      ] as ColumnDef<any>[]}
                      getRowId={(payment: any) => payment.id}
                      emptyMessage="No payments found"
                    />
                  </CardContent>
                </Card>
              )}

              {/* Disbursements */}
              {loanDetails.disbursements && loanDetails.disbursements.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      Disbursements ({loanDetails.disbursements.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable
                      data={loanDetails.disbursements}
                      showPagination={false}
                      columns={[
                        {
                          id: 'date',
                          header: 'Date',
                          accessorKey: 'date',
                          cell: (d: any) => formatDate(d.date),
                        },
                        {
                          id: 'amount',
                          header: 'Amount',
                          accessorKey: 'amount',
                          align: 'right',
                          cell: (d: any) => (
                            <span className="font-medium">{formatCurrency(d.amount)}</span>
                          ),
                        },
                        {
                          id: 'runningTotal',
                          header: 'Running Total',
                          accessorKey: 'runningTotal',
                          align: 'right',
                          cell: (d: any) => (
                            <span className="text-muted-foreground">
                              {d.runningTotal ? formatCurrency(d.runningTotal) : '-'}
                            </span>
                          ),
                        },
                      ] as ColumnDef<any>[]}
                      getRowId={(d: any) => d.id}
                      emptyMessage="No disbursements found"
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Repayment Schedule Dialog */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Repayment Schedule</DialogTitle>
          </DialogHeader>

          {scheduleData && (
            <div className="space-y-6">
              {/* Progress Summary */}
              {scheduleData.progress && (
                <div className="grid gap-4 md:grid-cols-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                        <span className="text-sm text-muted-foreground">Paid</span>
                      </div>
                      <p className="text-2xl font-bold">{scheduleData.progress.paidCount}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2">
                        <Clock className="h-5 w-5 text-amber-500" />
                        <span className="text-sm text-muted-foreground">Pending</span>
                      </div>
                      <p className="text-2xl font-bold">{scheduleData.progress.pendingCount}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-red-500" />
                        <span className="text-sm text-muted-foreground">Overdue</span>
                      </div>
                      <p className="text-2xl font-bold">{scheduleData.progress.overdueCount}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2">
                        <TrendingDown className="h-5 w-5 text-blue-500" />
                        <span className="text-sm text-muted-foreground">Progress</span>
                      </div>
                      <p className="text-2xl font-bold">
                        {scheduleData.progress.progressPercent.toFixed(1)}%
                      </p>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Schedule Table */}
              <DataTable
                data={scheduleData.schedule || []}
                pageSize={24}
                showPagination={true}
                columns={[
                  {
                    id: 'installmentNumber',
                    header: '#',
                    accessorKey: 'installmentNumber',
                    width: '48px',
                  },
                  {
                    id: 'dueDate',
                    header: 'Due Date',
                    accessorKey: 'dueDate',
                    cell: (entry: LoanScheduleEntry) => formatDate(entry.dueDate),
                  },
                  {
                    id: 'installmentAmount',
                    header: 'EMI',
                    accessorKey: 'installmentAmount',
                    align: 'right',
                    cell: (entry: LoanScheduleEntry) => formatCurrency(entry.installmentAmount),
                  },
                  {
                    id: 'principalAmount',
                    header: 'Principal',
                    accessorKey: 'principalAmount',
                    align: 'right',
                    cell: (entry: LoanScheduleEntry) => formatCurrency(entry.principalAmount),
                  },
                  {
                    id: 'interestAmount',
                    header: 'Interest',
                    accessorKey: 'interestAmount',
                    align: 'right',
                    cell: (entry: LoanScheduleEntry) => formatCurrency(entry.interestAmount),
                  },
                  {
                    id: 'closingPrincipal',
                    header: 'Balance',
                    accessorKey: 'closingPrincipal',
                    align: 'right',
                    cell: (entry: LoanScheduleEntry) => formatCurrency(entry.closingPrincipal),
                  },
                  {
                    id: 'status',
                    header: 'Status',
                    accessorKey: 'status',
                    filterType: 'select',
                    filterOptions: [
                      { label: 'Paid', value: 'paid' },
                      { label: 'Pending', value: 'pending' },
                      { label: 'Overdue', value: 'overdue' },
                      { label: 'Partial', value: 'partial' },
                    ],
                    cell: (entry: LoanScheduleEntry) => (
                      <Badge
                        variant={
                          entry.status === 'paid'
                            ? 'success'
                            : entry.status === 'overdue'
                            ? 'destructive'
                            : 'outline'
                        }
                      >
                        {entry.status}
                      </Badge>
                    ),
                  },
                ] as ColumnDef<LoanScheduleEntry>[]}
                getRowId={(entry: LoanScheduleEntry) => entry.id}
                emptyMessage="No schedule entries found"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add/Edit Fixed Expense Dialog */}
      <Dialog open={expenseDialogOpen} onOpenChange={(open) => { setExpenseDialogOpen(open); if (!open) resetExpenseForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingExpense ? 'Edit Fixed Expense' : 'Add Fixed Expense'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Name</Label>
              <Input
                value={expenseFormData.name}
                onChange={(e) => setExpenseFormData({ ...expenseFormData, name: e.target.value })}
                placeholder="e.g., Ryan International School - Kid 1"
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={expenseFormData.category}
                onValueChange={(value) => setExpenseFormData({ ...expenseFormData, category: value })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {expenseCategories.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>For Whom</Label>
              <Input
                value={expenseFormData.forWhom}
                onChange={(e) => setExpenseFormData({ ...expenseFormData, forWhom: e.target.value })}
                placeholder="e.g., Kid 1, Kid 2, Family"
              />
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                value={expenseFormData.amount}
                onChange={(e) => setExpenseFormData({ ...expenseFormData, amount: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select
                value={expenseFormData.frequency}
                onValueChange={(value) => setExpenseFormData({ ...expenseFormData, frequency: value })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {expenseFrequencies.map((freq) => (
                    <SelectItem key={freq.value} value={freq.value}>{freq.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Due Day (1-31)</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={expenseFormData.dueDay}
                onChange={(e) => setExpenseFormData({ ...expenseFormData, dueDay: parseInt(e.target.value) || 1 })}
              />
            </div>
            {(expenseFormData.frequency === 'yearly' || expenseFormData.frequency === 'half_yearly') && (
              <div className="space-y-2">
                <Label>Due Month</Label>
                <Select
                  value={String(expenseFormData.dueMonth)}
                  onValueChange={(value) => setExpenseFormData({ ...expenseFormData, dueMonth: parseInt(value) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[
                      { value: '1', label: 'January' },
                      { value: '2', label: 'February' },
                      { value: '3', label: 'March' },
                      { value: '4', label: 'April' },
                      { value: '5', label: 'May' },
                      { value: '6', label: 'June' },
                      { value: '7', label: 'July' },
                      { value: '8', label: 'August' },
                      { value: '9', label: 'September' },
                      { value: '10', label: 'October' },
                      { value: '11', label: 'November' },
                      { value: '12', label: 'December' },
                    ].map((month) => (
                      <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Beneficiary (Optional)</Label>
              <Input
                value={expenseFormData.beneficiary}
                onChange={(e) => setExpenseFormData({ ...expenseFormData, beneficiary: e.target.value })}
                placeholder="Who receives payment"
              />
            </div>
            <div className="space-y-2">
              <Label>Start Date (Optional)</Label>
              <Input
                type="date"
                value={expenseFormData.startDate}
                onChange={(e) => setExpenseFormData({ ...expenseFormData, startDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>End Date (Optional)</Label>
              <Input
                type="date"
                value={expenseFormData.endDate}
                onChange={(e) => setExpenseFormData({ ...expenseFormData, endDate: e.target.value })}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Notes (Optional)</Label>
              <Input
                value={expenseFormData.notes}
                onChange={(e) => setExpenseFormData({ ...expenseFormData, notes: e.target.value })}
                placeholder="Any additional notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setExpenseDialogOpen(false); resetExpenseForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleExpenseSubmit} disabled={!expenseFormData.name || !expenseFormData.amount}>
              {editingExpense ? 'Update' : 'Add'} Expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Expense as Paid Dialog */}
      <Dialog open={expensePaymentDialogOpen} onOpenChange={setExpensePaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          {selectedExpenseForPayment && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-muted">
                <p className="font-medium">{selectedExpenseForPayment.name}</p>
                <p className="text-sm text-muted-foreground">
                  {expenseFrequencies.find(f => f.value === selectedExpenseForPayment.frequency)?.label} payment
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Payment Date</Label>
                  <Input
                    type="date"
                    value={expensePaymentData.paymentDate}
                    onChange={(e) => setExpensePaymentData({ ...expensePaymentData, paymentDate: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <Input
                    type="number"
                    value={expensePaymentData.amount}
                    onChange={(e) => setExpensePaymentData({ ...expensePaymentData, amount: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>For Period</Label>
                  <Input
                    value={expensePaymentData.forPeriod}
                    onChange={(e) => setExpensePaymentData({ ...expensePaymentData, forPeriod: e.target.value })}
                    placeholder="e.g., Q1 2026, H1 2026, 2026"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Payment Mode</Label>
                  <Select
                    value={expensePaymentData.paymentMode}
                    onValueChange={(value) => setExpensePaymentData({ ...expensePaymentData, paymentMode: value })}
                  >
                    <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Reference Number (Optional)</Label>
                  <Input
                    value={expensePaymentData.referenceNumber}
                    onChange={(e) => setExpensePaymentData({ ...expensePaymentData, referenceNumber: e.target.value })}
                    placeholder="Transaction ID or reference"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Notes (Optional)</Label>
                  <Input
                    value={expensePaymentData.notes}
                    onChange={(e) => setExpensePaymentData({ ...expensePaymentData, notes: e.target.value })}
                    placeholder="Any additional notes"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpensePaymentDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedExpenseForPayment) {
                  addExpensePaymentMutation.mutate({
                    expenseId: selectedExpenseForPayment.id,
                    data: expensePaymentData,
                  });
                }
              }}
              disabled={!expensePaymentData.paymentDate || !expensePaymentData.amount}
              className="bg-green-600 hover:bg-green-700"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Recurring Income Dialog */}
      <Dialog open={incomeDialogOpen} onOpenChange={(open) => { setIncomeDialogOpen(open); if (!open) resetIncomeForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingIncome ? 'Edit Recurring Income' : 'Add Recurring Income'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Name</Label>
              <Input
                value={incomeFormData.name}
                onChange={(e) => setIncomeFormData({ ...incomeFormData, name: e.target.value })}
                placeholder="e.g., Monthly Salary - Company"
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={incomeFormData.category}
                onValueChange={(value) => setIncomeFormData({ ...incomeFormData, category: value })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {incomeCategories.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>For Whom</Label>
              <Input
                value={incomeFormData.forWhom}
                onChange={(e) => setIncomeFormData({ ...incomeFormData, forWhom: e.target.value })}
                placeholder="e.g., Self, Spouse, Family"
              />
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                value={incomeFormData.amount}
                onChange={(e) => setIncomeFormData({ ...incomeFormData, amount: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select
                value={incomeFormData.frequency}
                onValueChange={(value) => setIncomeFormData({ ...incomeFormData, frequency: value })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {incomeFrequencies.map((freq) => (
                    <SelectItem key={freq.value} value={freq.value}>{freq.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Expected Day (1-31)</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={incomeFormData.expectedDay}
                onChange={(e) => setIncomeFormData({ ...incomeFormData, expectedDay: parseInt(e.target.value) || 1 })}
              />
            </div>
            {(incomeFormData.frequency === 'yearly' || incomeFormData.frequency === 'half_yearly') && (
              <div className="space-y-2">
                <Label>Expected Month</Label>
                <Select
                  value={String(incomeFormData.expectedMonth)}
                  onValueChange={(value) => setIncomeFormData({ ...incomeFormData, expectedMonth: parseInt(value) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[
                      { value: '1', label: 'January' },
                      { value: '2', label: 'February' },
                      { value: '3', label: 'March' },
                      { value: '4', label: 'April' },
                      { value: '5', label: 'May' },
                      { value: '6', label: 'June' },
                      { value: '7', label: 'July' },
                      { value: '8', label: 'August' },
                      { value: '9', label: 'September' },
                      { value: '10', label: 'October' },
                      { value: '11', label: 'November' },
                      { value: '12', label: 'December' },
                    ].map((month) => (
                      <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Source (Optional)</Label>
              <Input
                value={incomeFormData.source}
                onChange={(e) => setIncomeFormData({ ...incomeFormData, source: e.target.value })}
                placeholder="e.g., Employer name, Property address"
              />
            </div>
            <div className="space-y-2">
              <Label>Start Date (Optional)</Label>
              <Input
                type="date"
                value={incomeFormData.startDate}
                onChange={(e) => setIncomeFormData({ ...incomeFormData, startDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>End Date (Optional)</Label>
              <Input
                type="date"
                value={incomeFormData.endDate}
                onChange={(e) => setIncomeFormData({ ...incomeFormData, endDate: e.target.value })}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Notes (Optional)</Label>
              <Input
                value={incomeFormData.notes}
                onChange={(e) => setIncomeFormData({ ...incomeFormData, notes: e.target.value })}
                placeholder="Any additional notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIncomeDialogOpen(false); resetIncomeForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleIncomeSubmit} disabled={!incomeFormData.name || !incomeFormData.amount}>
              {editingIncome ? 'Update' : 'Add'} Income
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record Income Receipt Dialog */}
      <Dialog open={incomeReceiptDialogOpen} onOpenChange={setIncomeReceiptDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Receipt</DialogTitle>
          </DialogHeader>
          {selectedIncomeForReceipt && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30">
                <p className="font-medium">{selectedIncomeForReceipt.name}</p>
                <p className="text-sm text-muted-foreground">
                  {incomeFrequencies.find(f => f.value === selectedIncomeForReceipt.frequency)?.label} income
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Receipt Date</Label>
                  <Input
                    type="date"
                    value={incomeReceiptData.receiptDate}
                    onChange={(e) => setIncomeReceiptData({ ...incomeReceiptData, receiptDate: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <Input
                    type="number"
                    value={incomeReceiptData.amount}
                    onChange={(e) => setIncomeReceiptData({ ...incomeReceiptData, amount: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>For Period</Label>
                  <Input
                    value={incomeReceiptData.forPeriod}
                    onChange={(e) => setIncomeReceiptData({ ...incomeReceiptData, forPeriod: e.target.value })}
                    placeholder="e.g., Jan 2026, Q1 2026, H1 2026"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Payment Mode</Label>
                  <Select
                    value={incomeReceiptData.paymentMode}
                    onValueChange={(value) => setIncomeReceiptData({ ...incomeReceiptData, paymentMode: value })}
                  >
                    <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="direct_deposit">Direct Deposit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Reference Number (Optional)</Label>
                  <Input
                    value={incomeReceiptData.referenceNumber}
                    onChange={(e) => setIncomeReceiptData({ ...incomeReceiptData, referenceNumber: e.target.value })}
                    placeholder="Transaction ID or reference"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Notes (Optional)</Label>
                  <Input
                    value={incomeReceiptData.notes}
                    onChange={(e) => setIncomeReceiptData({ ...incomeReceiptData, notes: e.target.value })}
                    placeholder="Any additional notes"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncomeReceiptDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedIncomeForReceipt) {
                  addIncomeReceiptMutation.mutate({
                    incomeId: selectedIncomeForReceipt.id,
                    data: incomeReceiptData,
                  });
                }
              }}
              disabled={!incomeReceiptData.receiptDate || !incomeReceiptData.amount}
              className="bg-green-600 hover:bg-green-700"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Confirm Receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Home Loan Card Component
function HomeLoanCard({
  loan,
  onViewDetails,
  onViewSchedule,
  onMarkAsPaid,
  onMarkAsUnpaid,
  onEdit,
  onDelete,
}: {
  loan: LoanWithDetails;
  onViewDetails: () => void;
  onViewSchedule: () => void;
  onMarkAsPaid: () => void;
  onMarkAsUnpaid: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const progressPercent = loan.sanctionedAmount
    ? ((loan.totalPrincipalPaid || 0) / loan.sanctionedAmount) * 100
    : 0;

  // Check if loan is paid for current month
  const isLoanPaidThisMonth = (): boolean => {
    if (!loan.lastPaidDate) return false;
    const now = new Date();
    const [paidYear, paidMonth] = loan.lastPaidDate.split('-').map(Number);
    return paidYear === now.getFullYear() && paidMonth === now.getMonth() + 1;
  };

  return (
    <Card className="overflow-hidden">
      <div className="border-b bg-gradient-to-r from-blue-50 to-blue-100 p-6 dark:from-blue-950/30 dark:to-blue-900/20">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-blue-500/10 p-3">
              <Home className="h-8 w-8 text-blue-500" />
            </div>
            <div>
              <h3 className="text-xl font-bold">{loan.partyName}</h3>
              {loan.agreementNumber && (
                <p className="text-sm text-muted-foreground">
                  Agreement: {loan.agreementNumber}
                </p>
              )}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onViewDetails}>
                View Details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onViewSchedule}>
                <Calendar className="mr-2 h-4 w-4" />
                View Schedule
              </DropdownMenuItem>
              {isLoanPaidThisMonth() ? (
                <DropdownMenuItem onClick={onMarkAsUnpaid}>
                  <Clock className="mr-2 h-4 w-4 text-orange-500" />
                  Mark as Unpaid
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={onMarkAsPaid}>
                  <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                  Mark as Paid
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <CardContent className="p-6">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
          {/* Loan Amount */}
          <div>
            <p className="text-sm text-muted-foreground">Sanctioned Amount</p>
            <p className="text-2xl font-bold">
              {formatCurrency(loan.sanctionedAmount || loan.principalAmount)}
            </p>
            {loan.disbursedAmount && loan.disbursedAmount !== loan.sanctionedAmount && (
              <p className="text-xs text-muted-foreground">
                Disbursed: {formatCurrency(loan.disbursedAmount)}
              </p>
            )}
          </div>

          {/* Outstanding */}
          <div>
            <p className="text-sm text-muted-foreground">Outstanding</p>
            <p className="text-2xl font-bold text-red-600">
              {formatCurrency(loan.outstandingAmount)}
            </p>
            <p className="text-xs text-muted-foreground">
              @ {loan.interestRate}% p.a.
            </p>
          </div>

          {/* Principal Paid */}
          <div>
            <p className="text-sm text-muted-foreground">Principal Paid</p>
            <p className="text-2xl font-bold text-green-600">
              {formatCurrency(loan.totalPrincipalPaid || 0)}
            </p>
            <p className="text-xs text-muted-foreground">
              {progressPercent.toFixed(1)}% of loan
            </p>
          </div>

          {/* Interest Paid */}
          <div>
            <p className="text-sm text-muted-foreground">Interest Paid</p>
            <p className="text-2xl font-bold text-amber-600">
              {formatCurrency(loan.totalInterestPaid || 0)}
            </p>
          </div>

          {/* Monthly EMI */}
          <div>
            <p className="text-sm text-muted-foreground">Monthly EMI</p>
            <p className="text-2xl font-bold text-orange-600">
              {formatCurrency(loan.emiAmount || 0)}
            </p>
            {loan.maturityDate && (
              <p className="text-xs text-muted-foreground">
                Till {formatDayMonth(loan.maturityDate)}
              </p>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Loan Progress</span>
            <span className="font-medium">{progressPercent.toFixed(1)}% repaid</span>
          </div>
          <Progress value={progressPercent} className="h-3" />
          {loan.paidInstallments != null && loan.totalInstallments && (
            <p className="mt-2 text-xs text-muted-foreground text-right">
              {loan.paidInstallments} of {loan.totalInstallments} EMIs paid
              {loan.maturityDate && ` | Maturity: ${formatDate(loan.maturityDate)}`}
            </p>
          )}
        </div>

        {/* Quick Actions */}
        <div className="mt-6 flex gap-2">
          <Button variant="outline" size="sm" onClick={onViewDetails}>
            View Details
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={onViewSchedule}>
            <Calendar className="mr-2 h-4 w-4" />
            Schedule
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Regular Loans List Component (Row-based)
function LoansGrid({
  loans,
  emptyMessage,
  onEdit,
  onMarkAsPaid,
  onMarkAsUnpaid,
  onDelete,
  onRowClick,
}: {
  loans: Loan[];
  emptyMessage: string;
  onEdit: (loan: Loan) => void;
  onMarkAsPaid: (loan: Loan) => void;
  onMarkAsUnpaid: (loan: Loan) => void;
  onDelete: (id: string) => void;
  onRowClick?: (loan: Loan) => void;
}) {
  // Check if loan is paid for current month
  const isLoanPaidThisMonth = (loan: Loan): boolean => {
    if (!loan.lastPaidDate) return false;
    const now = new Date();
    const [paidYear, paidMonth] = loan.lastPaidDate.split('-').map(Number);
    return paidYear === now.getFullYear() && paidMonth === now.getMonth() + 1;
  };
  if (loans.length === 0) {
    return (
      <Card>
        <CardContent className="flex h-64 items-center justify-center text-muted-foreground">
          {emptyMessage}
        </CardContent>
      </Card>
    );
  }

  const loanColumns: ColumnDef<Loan>[] = [
    {
      id: 'partyName',
      header: 'Party Name',
      accessorKey: 'partyName',
      cell: (loan: Loan) => (
        <div>
          <p className="font-medium">{loan.partyName}</p>
          {loan.notes && (
            <p className="text-xs text-muted-foreground truncate max-w-[200px]">
              {loan.notes}
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'startDate',
      header: 'Start Date',
      accessorKey: 'startDate',
      cell: (loan: Loan) => (
        <span className="text-muted-foreground">{formatDate(loan.startDate)}</span>
      ),
    },
    {
      id: 'principalAmount',
      header: 'Principal',
      accessorKey: 'principalAmount',
      align: 'right',
      cell: (loan: Loan) => (
        <span className="font-medium">{formatCurrency(loan.principalAmount)}</span>
      ),
    },
    {
      id: 'outstandingAmount',
      header: 'Outstanding',
      accessorKey: 'outstandingAmount',
      align: 'right',
      cell: (loan: Loan) => (
        <span className="font-medium text-primary">{formatCurrency(loan.outstandingAmount)}</span>
      ),
    },
    {
      id: 'interestRate',
      header: 'Interest',
      accessorKey: 'interestRate',
      align: 'right',
      cell: (loan: Loan) => (
        <span>{loan.interestRate > 0 ? `${loan.interestRate}%` : '-'}</span>
      ),
    },
    {
      id: 'repaid',
      header: 'Repaid',
      sortable: false,
      filterable: false,
      align: 'right',
      accessorKey: (loan: Loan) => ((loan.principalAmount - loan.outstandingAmount) / loan.principalAmount) * 100,
      cell: (loan: Loan) => {
        const repaidPercent = ((loan.principalAmount - loan.outstandingAmount) / loan.principalAmount) * 100;
        return (
          <div className="flex items-center justify-end gap-2">
            <div className="w-16 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${repaidPercent}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground w-10">
              {repaidPercent.toFixed(0)}%
            </span>
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      filterType: 'select',
      filterOptions: [
        { label: 'Active', value: 'active' },
        { label: 'Closed', value: 'closed' },
        { label: 'Defaulted', value: 'defaulted' },
      ],
      cell: (loan: Loan) => {
        if (loan.status !== 'active') {
          return (
            <Badge variant={loan.status === 'closed' ? 'default' : 'destructive'} className={loan.status === 'closed' ? 'bg-green-500' : ''}>
              {loan.status}
            </Badge>
          );
        }
        return (
          <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950/30">
            <Repeat className="mr-1 h-3 w-3" />Recurring
          </Badge>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      sortable: false,
      filterable: false,
      width: '48px',
      cell: (loan: Loan) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isLoanPaidThisMonth(loan) ? (
                <DropdownMenuItem onClick={() => onMarkAsUnpaid(loan)}>
                  <Clock className="mr-2 h-4 w-4 text-orange-500" />
                  Mark as Unpaid
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => onMarkAsPaid(loan)}>
                  <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                  Mark as Paid
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onEdit(loan)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDelete(loan.id)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      data={loans}
      columns={loanColumns}
      onRowClick={onRowClick}
      getRowId={(loan) => loan.id}
      emptyMessage={emptyMessage || "No loans found"}
    />
  );
}

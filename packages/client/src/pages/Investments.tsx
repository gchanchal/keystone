import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  TrendingUp,
  TrendingDown,
  MoreVertical,
  Pencil,
  Trash2,
  RefreshCw,
  IndianRupee,
  DollarSign,
  ChevronRight,
  Building2,
  Home,
  Shield,
  MapPin,
  Calendar,
  Link2,
  FileText,
  Receipt,
  Upload,
  Lock,
  Loader2,
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { investmentsApi, mutualFundsApi, assetsApi, policiesApi, loansApi } from '@/lib/api';
import { formatCurrency, getCurrencyFromCountry, formatDayMonth } from '@/lib/utils';
import type { Investment, Asset, Policy, Loan } from '@/types';

interface MutualFundSummary {
  totalCostValue: number;
  totalCurrentValue: number;
  totalAbsoluteReturn: number;
  totalAbsoluteReturnPercent: number;
  holdingsCount: number;
  folioCount: number;
}

const investmentTypes = [
  { value: 'stocks', label: 'Stocks', color: '#3b82f6' },
  { value: 'mutual_funds', label: 'Mutual Funds', color: '#22c55e' },
  { value: 'fd', label: 'Fixed Deposit', color: '#f59e0b' },
  { value: 'ppf', label: 'PPF', color: '#8b5cf6' },
  { value: 'gold', label: 'Gold', color: '#eab308' },
  { value: 'crypto', label: 'Crypto', color: '#ef4444' },
  { value: 'real_estate', label: 'Real Estate', color: '#06b6d4' },
  { value: 'other', label: 'Other', color: '#6b7280' },
];

const assetTypes = [
  { value: 'house', label: 'House' },
  { value: 'apartment', label: 'Apartment' },
  { value: 'land', label: 'Land' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'gold', label: 'Gold' },
  { value: 'other', label: 'Other' },
];

const policyTypes = [
  { value: 'life', label: 'Life Insurance' },
  { value: 'term', label: 'Term Plan' },
  { value: 'health', label: 'Health Insurance' },
  { value: 'vehicle', label: 'Vehicle Insurance' },
  { value: 'home', label: 'Home Insurance' },
  { value: 'travel', label: 'Travel Insurance' },
  { value: 'other', label: 'Other' },
];

const premiumFrequencies = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'half_yearly', label: 'Half Yearly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'one_time', label: 'One Time' },
];

export function Investments() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Main tab state with URL persistence
  const mainTab = (searchParams.get('tab') || 'funds') as 'funds' | 'assets' | 'policies';
  const setMainTab = (tab: 'funds' | 'assets' | 'policies') => {
    setSearchParams({ tab });
  };

  const [fundTab, setFundTab] = useState<'IN' | 'US'>('IN');

  // Dialog states
  const [fundDialogOpen, setFundDialogOpen] = useState(false);
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [policyDialogOpen, setPolicyDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [linkLoanDialogOpen, setLinkLoanDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  // PDF upload state
  const [uploadingPolicy, setUploadingPolicy] = useState(false);
  const [pdfPassword, setPdfPassword] = useState('');
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
  const policyFileInputRef = useRef<HTMLInputElement>(null);

  const [editingInvestment, setEditingInvestment] = useState<Investment | null>(null);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [selectedPolicyForPayment, setSelectedPolicyForPayment] = useState<Policy | null>(null);
  const [selectedAssetForLoan, setSelectedAssetForLoan] = useState<Asset | null>(null);
  const [newPrice, setNewPrice] = useState('');

  // Fund form
  const [fundFormData, setFundFormData] = useState({
    name: '',
    type: 'stocks',
    symbol: '',
    platform: '',
    country: 'IN' as 'IN' | 'US',
    quantity: 1,
    purchasePrice: 0,
    purchaseDate: new Date().toISOString().split('T')[0],
    currentPrice: 0,
    notes: '',
  });

  // Asset form
  const [assetFormData, setAssetFormData] = useState({
    name: '',
    type: 'house' as Asset['type'],
    description: '',
    address: '',
    city: '',
    state: '',
    country: 'India',
    area: 0,
    areaUnit: 'sqft' as 'sqft' | 'sqm' | 'acres',
    registrationNumber: '',
    purchaseDate: '',
    purchaseValue: 0,
    currentValue: 0,
    ownershipType: 'self' as 'self' | 'joint' | 'family',
    ownershipPercentage: 100,
    status: 'owned' as 'owned' | 'sold' | 'under_construction',
    notes: '',
    // Loan details (optional)
    hasLoan: false,
    loanProvider: '',
    loanType: 'home' as 'home' | 'car' | 'personal' | 'business',
    principalAmount: 0,
    outstandingAmount: 0,
    interestRate: 0,
    emiAmount: 0,
    loanStartDate: '',
    loanEndDate: '',
    totalInstallments: 0,
    paidInstallments: 0,
  });

  // Policy form
  const [policyFormData, setPolicyFormData] = useState({
    name: '',
    type: 'life' as Policy['type'],
    provider: '',
    policyNumber: '',
    policyHolder: '',
    sumAssured: 0,
    coverageAmount: 0,
    premiumAmount: 0,
    premiumFrequency: 'yearly' as 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'one_time',
    nextPremiumDate: '',
    startDate: '',
    endDate: '',
    policyTerm: 0,
    nominees: '',
    status: 'active' as 'active' | 'lapsed' | 'matured' | 'surrendered' | 'claimed',
    notes: '',
  });

  // Payment form
  const [paymentFormData, setPaymentFormData] = useState({
    paymentDate: new Date().toISOString().split('T')[0],
    amount: 0,
    paymentMode: '',
    referenceNumber: '',
    notes: '',
  });

  // Queries
  const { data: investments = [], isLoading: investmentsLoading } = useQuery({
    queryKey: ['investments'],
    queryFn: investmentsApi.getAll,
  });

  const { data: mutualFundsSummary } = useQuery<MutualFundSummary>({
    queryKey: ['mutual-funds', 'summary'],
    queryFn: mutualFundsApi.getSummary,
  });

  const { data: assets = [], isLoading: assetsLoading } = useQuery({
    queryKey: ['assets'],
    queryFn: assetsApi.getAll,
  });

  const { data: assetsSummary } = useQuery({
    queryKey: ['assets', 'summary'],
    queryFn: assetsApi.getSummary,
  });

  const { data: policies = [], isLoading: policiesLoading } = useQuery({
    queryKey: ['policies'],
    queryFn: policiesApi.getAll,
  });

  const { data: policiesSummary } = useQuery({
    queryKey: ['policies', 'summary'],
    queryFn: policiesApi.getSummary,
  });

  const { data: takenLoans = [] } = useQuery({
    queryKey: ['loans', 'taken'],
    queryFn: () => loansApi.getAll({ type: 'taken' }),
  });

  // Mutations for investments
  const createInvestmentMutation = useMutation({
    mutationFn: investmentsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investments'] });
      setFundDialogOpen(false);
      resetFundForm();
    },
  });

  const updateInvestmentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => investmentsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investments'] });
      setFundDialogOpen(false);
      resetFundForm();
    },
  });

  const updatePriceMutation = useMutation({
    mutationFn: ({ id, price }: { id: string; price: number }) => investmentsApi.updatePrice(id, price),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investments'] });
      setPriceDialogOpen(false);
      setEditingInvestment(null);
      setNewPrice('');
    },
  });

  const deleteInvestmentMutation = useMutation({
    mutationFn: investmentsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investments'] });
    },
  });

  const syncPricesMutation = useMutation({
    mutationFn: investmentsApi.syncPrices,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investments'] });
    },
  });

  // Mutations for assets
  const createAssetMutation = useMutation({
    mutationFn: assetsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setAssetDialogOpen(false);
      resetAssetForm();
    },
  });

  const updateAssetMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => assetsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setAssetDialogOpen(false);
      resetAssetForm();
    },
  });

  const deleteAssetMutation = useMutation({
    mutationFn: assetsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });

  const linkLoanMutation = useMutation({
    mutationFn: ({ id, loanId }: { id: string; loanId: string | null }) => assetsApi.linkLoan(id, loanId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setLinkLoanDialogOpen(false);
      setSelectedAssetForLoan(null);
    },
  });

  // Mutations for policies
  const createPolicyMutation = useMutation({
    mutationFn: policiesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      setPolicyDialogOpen(false);
      resetPolicyForm();
    },
  });

  const updatePolicyMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => policiesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      setPolicyDialogOpen(false);
      resetPolicyForm();
    },
  });

  const deletePolicyMutation = useMutation({
    mutationFn: policiesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
    },
  });

  const addPaymentMutation = useMutation({
    mutationFn: ({ policyId, data }: { policyId: string; data: any }) => policiesApi.addPayment(policyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      setPaymentDialogOpen(false);
      setSelectedPolicyForPayment(null);
      resetPaymentForm();
    },
  });

  // Live quotes for US stocks
  const [liveQuotes, setLiveQuotes] = useState<Record<string, {
    symbol: string;
    price: number;
    change: number;
    changePercent: number;
    previousClose: number;
  }>>({});
  const [isLiveEnabled, setIsLiveEnabled] = useState(true);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const usInvestments = investments.filter((inv: Investment) => inv.country === 'US');
  const indiaInvestments = investments.filter((inv: Investment) => (inv.country || 'IN') === 'IN');

  useEffect(() => {
    const fetchQuotes = async () => {
      try {
        const quotes = await investmentsApi.getLiveQuotes();
        setLiveQuotes(quotes);
      } catch (error) {
        console.error('Error fetching live quotes:', error);
      }
    };

    if (mainTab === 'funds' && fundTab === 'US' && isLiveEnabled && usInvestments.some((inv: Investment) => inv.symbol)) {
      fetchQuotes();
      intervalRef.current = setInterval(fetchQuotes, 1000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [mainTab, fundTab, isLiveEnabled, usInvestments]);

  // Reset functions
  const resetFundForm = () => {
    setFundFormData({
      name: '',
      type: 'stocks',
      symbol: '',
      platform: '',
      country: fundTab,
      quantity: 1,
      purchasePrice: 0,
      purchaseDate: new Date().toISOString().split('T')[0],
      currentPrice: 0,
      notes: '',
    });
    setEditingInvestment(null);
  };

  const resetAssetForm = () => {
    setAssetFormData({
      name: '',
      type: 'house',
      description: '',
      address: '',
      city: '',
      state: '',
      country: 'India',
      area: 0,
      areaUnit: 'sqft',
      registrationNumber: '',
      purchaseDate: '',
      purchaseValue: 0,
      currentValue: 0,
      ownershipType: 'self',
      ownershipPercentage: 100,
      status: 'owned',
      notes: '',
      hasLoan: false,
      loanProvider: '',
      loanType: 'home',
      principalAmount: 0,
      outstandingAmount: 0,
      interestRate: 0,
      emiAmount: 0,
      loanStartDate: '',
      loanEndDate: '',
      totalInstallments: 0,
      paidInstallments: 0,
    });
    setEditingAsset(null);
  };

  const resetPolicyForm = () => {
    setPolicyFormData({
      name: '',
      type: 'life',
      provider: '',
      policyNumber: '',
      policyHolder: '',
      sumAssured: 0,
      coverageAmount: 0,
      premiumAmount: 0,
      premiumFrequency: 'yearly',
      nextPremiumDate: '',
      startDate: '',
      endDate: '',
      policyTerm: 0,
      nominees: '',
      status: 'active',
      notes: '',
    });
    setEditingPolicy(null);
  };

  const resetPaymentForm = () => {
    setPaymentFormData({
      paymentDate: new Date().toISOString().split('T')[0],
      amount: 0,
      paymentMode: '',
      referenceNumber: '',
      notes: '',
    });
  };

  // Edit handlers
  const handleEditInvestment = (investment: Investment) => {
    setEditingInvestment(investment);
    setFundFormData({
      name: investment.name,
      type: investment.type,
      symbol: investment.symbol || '',
      platform: investment.platform || '',
      country: investment.country || 'IN',
      quantity: investment.quantity,
      purchasePrice: investment.purchasePrice,
      purchaseDate: investment.purchaseDate,
      currentPrice: investment.currentPrice || investment.purchasePrice,
      notes: investment.notes || '',
    });
    setFundDialogOpen(true);
  };

  const handleEditAsset = (asset: Asset) => {
    setEditingAsset(asset);
    const linkedLoan = asset.linkedLoan;
    setAssetFormData({
      name: asset.name,
      type: asset.type,
      description: asset.description || '',
      address: asset.address || '',
      city: asset.city || '',
      state: asset.state || '',
      country: asset.country || 'India',
      area: asset.area || 0,
      areaUnit: asset.areaUnit || 'sqft',
      registrationNumber: asset.registrationNumber || '',
      purchaseDate: asset.purchaseDate || '',
      purchaseValue: asset.purchaseValue,
      currentValue: asset.currentValue || asset.purchaseValue,
      ownershipType: asset.ownershipType || 'self',
      ownershipPercentage: asset.ownershipPercentage || 100,
      status: asset.status || 'owned',
      notes: asset.notes || '',
      hasLoan: !!linkedLoan,
      loanProvider: linkedLoan?.partyName || '',
      loanType: linkedLoan?.loanType || 'home',
      principalAmount: linkedLoan?.principalAmount || 0,
      outstandingAmount: linkedLoan?.outstandingAmount || 0,
      interestRate: linkedLoan?.interestRate || 0,
      emiAmount: linkedLoan?.emiAmount || 0,
      loanStartDate: linkedLoan?.startDate || '',
      loanEndDate: linkedLoan?.maturityDate || '',
      totalInstallments: linkedLoan?.totalInstallments || 0,
      paidInstallments: linkedLoan?.paidInstallments || 0,
    });
    setAssetDialogOpen(true);
  };

  const handleEditPolicy = (policy: Policy) => {
    setEditingPolicy(policy);
    setPolicyFormData({
      name: policy.name,
      type: policy.type,
      provider: policy.provider,
      policyNumber: policy.policyNumber || '',
      policyHolder: policy.policyHolder || '',
      sumAssured: policy.sumAssured || 0,
      coverageAmount: policy.coverageAmount || 0,
      premiumAmount: policy.premiumAmount || 0,
      premiumFrequency: policy.premiumFrequency || 'yearly',
      nextPremiumDate: policy.nextPremiumDate || '',
      startDate: policy.startDate || '',
      endDate: policy.endDate || '',
      policyTerm: policy.policyTerm || 0,
      nominees: policy.nominees || '',
      status: policy.status || 'active',
      notes: policy.notes || '',
    });
    setPolicyDialogOpen(true);
  };

  const handleUpdatePrice = (investment: Investment) => {
    setEditingInvestment(investment);
    setNewPrice(String(investment.currentPrice || investment.purchasePrice));
    setPriceDialogOpen(true);
  };

  // Submit handlers
  const handleSubmitFund = () => {
    if (editingInvestment) {
      updateInvestmentMutation.mutate({ id: editingInvestment.id, data: fundFormData });
    } else {
      createInvestmentMutation.mutate(fundFormData);
    }
  };

  const handleSubmitAsset = () => {
    if (editingAsset) {
      updateAssetMutation.mutate({ id: editingAsset.id, data: assetFormData });
    } else {
      createAssetMutation.mutate(assetFormData);
    }
  };

  const handleSubmitPolicy = () => {
    if (editingPolicy) {
      updatePolicyMutation.mutate({ id: editingPolicy.id, data: policyFormData });
    } else {
      createPolicyMutation.mutate(policyFormData);
    }
  };

  const handleSubmitPayment = () => {
    if (selectedPolicyForPayment) {
      addPaymentMutation.mutate({ policyId: selectedPolicyForPayment.id, data: paymentFormData });
    }
  };

  // Handle policy PDF upload
  const handlePolicyFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset file input
    if (policyFileInputRef.current) {
      policyFileInputRef.current.value = '';
    }

    setUploadingPolicy(true);
    try {
      const data = await policiesApi.extractFromPdf(file);
      // Pre-fill the policy form with extracted data
      setPolicyFormData({
        name: data.name || '',
        type: data.type || 'life',
        provider: data.provider || '',
        policyNumber: data.policyNumber || '',
        policyHolder: data.policyHolder || '',
        sumAssured: data.sumAssured || 0,
        coverageAmount: data.coverageAmount || 0,
        premiumAmount: data.premiumAmount || 0,
        premiumFrequency: data.premiumFrequency || 'yearly',
        nextPremiumDate: data.nextPremiumDate || '',
        startDate: data.startDate || '',
        endDate: data.endDate || '',
        policyTerm: data.policyTerm || 0,
        nominees: '',
        status: 'active',
        notes: '',
      });
      setPolicyDialogOpen(true);
    } catch (error: any) {
      if (error.response?.status === 401 && error.response?.data?.needsPassword) {
        // PDF is password protected, ask for password
        setPendingPdfFile(file);
        setPasswordDialogOpen(true);
      } else {
        console.error('Error extracting policy:', error);
        alert(error.response?.data?.error || 'Failed to extract policy data from PDF');
      }
    } finally {
      setUploadingPolicy(false);
    }
  };

  // Handle password submission for protected PDF
  const handlePasswordSubmit = async () => {
    if (!pendingPdfFile || !pdfPassword) return;

    setUploadingPolicy(true);
    setPasswordDialogOpen(false);
    try {
      const data = await policiesApi.extractFromPdf(pendingPdfFile, pdfPassword);
      // Pre-fill the policy form with extracted data
      setPolicyFormData({
        name: data.name || '',
        type: data.type || 'life',
        provider: data.provider || '',
        policyNumber: data.policyNumber || '',
        policyHolder: data.policyHolder || '',
        sumAssured: data.sumAssured || 0,
        coverageAmount: data.coverageAmount || 0,
        premiumAmount: data.premiumAmount || 0,
        premiumFrequency: data.premiumFrequency || 'yearly',
        nextPremiumDate: data.nextPremiumDate || '',
        startDate: data.startDate || '',
        endDate: data.endDate || '',
        policyTerm: data.policyTerm || 0,
        nominees: '',
        status: 'active',
        notes: '',
      });
      setPolicyDialogOpen(true);
    } catch (error: any) {
      console.error('Error extracting policy:', error);
      alert(error.response?.data?.error || 'Failed to extract policy data from PDF. Please check the password.');
    } finally {
      setUploadingPolicy(false);
      setPendingPdfFile(null);
      setPdfPassword('');
    }
  };

  // Fetch exchange rate for USD to INR
  const { data: exchangeRateData } = useQuery({
    queryKey: ['exchange-rate', 'usd-inr'],
    queryFn: () => loansApi.getExchangeRate(),
    staleTime: 10 * 60 * 1000,
  });
  const exchangeRate = exchangeRateData?.rate || 83.5;

  // Calculate summaries
  const calculateFundSummary = (invList: Investment[]) => {
    const totalInvested = invList.reduce((sum, inv) => sum + inv.purchasePrice * inv.quantity, 0);
    const totalCurrentValue = invList.reduce((sum, inv) => sum + (inv.currentValue || inv.purchasePrice * inv.quantity), 0);
    const totalGain = totalCurrentValue - totalInvested;
    const totalGainPercent = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;
    return { totalInvested, totalCurrentValue, totalGain, totalGainPercent };
  };

  const indiaFundSummary = calculateFundSummary(indiaInvestments);
  const usFundSummary = calculateFundSummary(usInvestments);

  // Convert US investments to INR for grand total
  const usInvestedInINR = usFundSummary.totalInvested * exchangeRate;
  const usCurrentInINR = usFundSummary.totalCurrentValue * exchangeRate;

  // Funds total (India + US converted + Mutual Funds)
  const fundsInvested = indiaFundSummary.totalInvested + usInvestedInINR + (mutualFundsSummary?.totalCostValue || 0);
  const fundsCurrentValue = indiaFundSummary.totalCurrentValue + usCurrentInINR + (mutualFundsSummary?.totalCurrentValue || 0);

  // Assets total
  const assetsInvested = assets.reduce((sum: number, a: Asset) => sum + a.purchaseValue, 0);
  const assetsCurrentValue = assets.reduce((sum: number, a: Asset) => sum + (a.currentValue || a.purchaseValue), 0);

  // Policies total (premium paid as invested, maturity benefit as current value for life/term)
  const policiesInvested = policies.reduce((sum: number, p: Policy) => sum + (p.totalPremiumPaid || 0), 0);
  const policiesCurrentValue = policies.reduce((sum: number, p: Policy) => {
    // For life insurance with maturity benefit, use that as current value
    if ((p.type === 'life' || p.type === 'term') && p.maturityBenefit) {
      return sum + p.maturityBenefit + (p.bonusAccrued || 0);
    }
    // For other policies, use total premium paid (no appreciation)
    return sum + (p.totalPremiumPaid || 0);
  }, 0);

  // Grand totals (all categories combined)
  const grandTotalInvested = fundsInvested + assetsInvested + policiesInvested;
  const grandTotalCurrentValue = fundsCurrentValue + assetsCurrentValue + policiesCurrentValue;
  const grandTotalGain = grandTotalCurrentValue - grandTotalInvested;
  const grandTotalGainPercent = grandTotalInvested > 0 ? (grandTotalGain / grandTotalInvested) * 100 : 0;

  // India summary includes mutual funds (for funds tab display)
  const indiaSummary = {
    totalInvested: indiaFundSummary.totalInvested + (mutualFundsSummary?.totalCostValue || 0),
    totalCurrentValue: indiaFundSummary.totalCurrentValue + (mutualFundsSummary?.totalCurrentValue || 0),
    totalGain: indiaFundSummary.totalGain + (mutualFundsSummary?.totalAbsoluteReturn || 0),
    totalGainPercent: 0,
  };
  indiaSummary.totalGainPercent = indiaSummary.totalInvested > 0
    ? (indiaSummary.totalGain / indiaSummary.totalInvested) * 100
    : 0;

  const currentFundSummary = fundTab === 'IN' ? indiaSummary : usFundSummary;
  const currentCurrency = getCurrencyFromCountry(fundTab);

  const isLoading = investmentsLoading || assetsLoading || policiesLoading;

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
        <h1 className="text-2xl font-bold">Investments</h1>
      </div>

      {/* Grand Total Summary Cards - Above Tabs */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/20 border-blue-200 dark:border-blue-800">
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Total Invested</p>
            <p className="text-2xl font-bold">{formatCurrency(grandTotalInvested)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Funds + Assets + Policies
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Current Value</p>
            <p className="text-2xl font-bold">{formatCurrency(grandTotalCurrentValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Total Gain/Loss</p>
            <p className={`text-2xl font-bold ${grandTotalGain >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {grandTotalGain >= 0 ? '+' : ''}{formatCurrency(grandTotalGain)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Returns</p>
            <p className={`text-2xl font-bold ${grandTotalGainPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {grandTotalGainPercent >= 0 ? '+' : ''}{grandTotalGainPercent.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs: Funds, Assets, Policies */}
      <Tabs value={mainTab} onValueChange={(val) => setMainTab(val as 'funds' | 'assets' | 'policies')}>
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="funds" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Funds
          </TabsTrigger>
          <TabsTrigger value="assets" className="flex items-center gap-2">
            <Home className="h-4 w-4" />
            Assets
          </TabsTrigger>
          <TabsTrigger value="policies" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Policies
          </TabsTrigger>
        </TabsList>

        {/* FUNDS TAB */}
        <TabsContent value="funds" className="mt-4 space-y-6">
          <div className="flex items-center justify-between">
            <Tabs value={fundTab} onValueChange={(val) => setFundTab(val as 'IN' | 'US')}>
              <TabsList>
                <TabsTrigger value="IN" className="flex items-center gap-2">
                  <IndianRupee className="h-4 w-4" />
                  India ({indiaInvestments.length})
                </TabsTrigger>
                <TabsTrigger value="US" className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  US ({usInvestments.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex gap-2">
              {fundTab === 'US' && usInvestments.filter((inv: Investment) => inv.type === 'stocks' && inv.symbol).length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => syncPricesMutation.mutate()}
                  disabled={syncPricesMutation.isPending}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${syncPricesMutation.isPending ? 'animate-spin' : ''}`} />
                  Sync Prices
                </Button>
              )}
              <Button onClick={() => {
                setFundFormData(prev => ({ ...prev, country: fundTab }));
                setFundDialogOpen(true);
              }}>
                <Plus className="mr-2 h-4 w-4" />
                Add Investment
              </Button>
            </div>
          </div>

          {/* Mutual Funds Card - Only in India tab */}
          {fundTab === 'IN' && (
            <Card
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => navigate('/investments/mutual-funds')}
            >
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="rounded-lg bg-green-500/10 p-3">
                      <Building2 className="h-6 w-6 text-green-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold">Mutual Funds - India</h3>
                      <p className="text-sm text-muted-foreground">
                        {mutualFundsSummary?.holdingsCount || 0} schemes across {mutualFundsSummary?.folioCount || 0} folios
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Current Value</p>
                      <p className="text-lg font-semibold">{formatCurrency(mutualFundsSummary?.totalCurrentValue || 0)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Returns</p>
                      <p className={`text-lg font-semibold ${(mutualFundsSummary?.totalAbsoluteReturnPercent || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {(mutualFundsSummary?.totalAbsoluteReturnPercent || 0) >= 0 ? '+' : ''}
                        {(mutualFundsSummary?.totalAbsoluteReturnPercent || 0).toFixed(2)}%
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* India Holdings Table */}
          {fundTab === 'IN' && (
            <Card>
              <CardHeader>
                <CardTitle>India Holdings (₹)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {indiaInvestments.length === 0 ? (
                  <div className="flex h-32 items-center justify-center text-muted-foreground">
                    No India investments yet. Add EPF, PPF, Stocks, FD, etc.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="border-b bg-muted/50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
                          <th className="px-4 py-3 text-left text-sm font-medium">Type</th>
                          <th className="px-4 py-3 text-right text-sm font-medium">Qty</th>
                          <th className="px-4 py-3 text-right text-sm font-medium">Invested</th>
                          <th className="px-4 py-3 text-right text-sm font-medium">Current</th>
                          <th className="px-4 py-3 text-right text-sm font-medium">Gain/Loss</th>
                          <th className="px-4 py-3 text-center text-sm font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {indiaInvestments.map((inv: Investment) => {
                          const invested = inv.purchasePrice * inv.quantity;
                          const current = inv.currentValue || invested;
                          const gain = current - invested;
                          const gainPercent = invested > 0 ? (gain / invested) * 100 : 0;
                          const typeInfo = investmentTypes.find(t => t.value === inv.type);

                          return (
                            <tr key={inv.id} className="hover:bg-muted/50">
                              <td className="px-4 py-3">
                                <div>
                                  <p className="font-medium">{inv.name}</p>
                                  {inv.platform && <p className="text-xs text-muted-foreground">{inv.platform}</p>}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant="secondary" style={{ backgroundColor: typeInfo?.color + '20', color: typeInfo?.color }}>
                                  {typeInfo?.label || inv.type}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-right text-sm tabular-nums">{inv.quantity}</td>
                              <td className="px-4 py-3 text-right text-sm">{formatCurrency(invested)}</td>
                              <td className="px-4 py-3 text-right text-sm">{formatCurrency(current)}</td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {gain >= 0 ? <TrendingUp className="h-4 w-4 text-green-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />}
                                  <div className="text-right">
                                    <p className={`text-sm font-medium ${gain >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                      {gain >= 0 ? '+' : ''}{formatCurrency(gain)}
                                    </p>
                                    <p className={`text-xs ${gain >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                      {gainPercent >= 0 ? '+' : ''}{gainPercent.toFixed(1)}%
                                    </p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => handleUpdatePrice(inv)}>
                                      <RefreshCw className="mr-2 h-4 w-4" />Update Price
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleEditInvestment(inv)}>
                                      <Pencil className="mr-2 h-4 w-4" />Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem className="text-destructive" onClick={() => deleteInvestmentMutation.mutate(inv.id)}>
                                      <Trash2 className="mr-2 h-4 w-4" />Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* US Holdings Table */}
          {fundTab === 'US' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>US Holdings ($)</span>
                  <div className="flex items-center gap-2 text-sm font-normal">
                    <span className="text-muted-foreground">Live</span>
                    <button
                      onClick={() => setIsLiveEnabled(!isLiveEnabled)}
                      className={`h-2 w-2 rounded-full ${isLiveEnabled ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}
                      title={isLiveEnabled ? 'Live updates ON' : 'Live updates OFF'}
                    />
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {usInvestments.length === 0 ? (
                  <div className="flex h-32 items-center justify-center text-muted-foreground">
                    No US investments yet
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="border-b bg-muted/50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
                          <th className="px-4 py-3 text-right text-sm font-medium">Price</th>
                          <th className="px-4 py-3 text-right text-sm font-medium">Qty</th>
                          <th className="px-4 py-3 text-right text-sm font-medium">Delta</th>
                          <th className="px-4 py-3 text-right text-sm font-medium">Invested</th>
                          <th className="px-4 py-3 text-right text-sm font-medium">Current</th>
                          <th className="px-4 py-3 text-right text-sm font-medium">Gain/Loss</th>
                          <th className="px-4 py-3 text-center text-sm font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {usInvestments.map((inv: Investment) => {
                          const invested = inv.purchasePrice * inv.quantity;
                          const current = inv.currentValue || invested;
                          const gain = current - invested;
                          const gainPercent = invested > 0 ? (gain / invested) * 100 : 0;

                          return (
                            <tr key={inv.id} className="hover:bg-muted/50">
                              <td className="px-4 py-3">
                                <div>
                                  <p className="font-medium">{inv.name}</p>
                                  {inv.symbol && <p className="text-xs text-muted-foreground">{inv.symbol}</p>}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right text-sm tabular-nums">
                                {inv.symbol && liveQuotes[inv.symbol]
                                  ? `$${liveQuotes[inv.symbol].price.toFixed(2)}`
                                  : inv.currentPrice ? `$${inv.currentPrice.toFixed(2)}` : '-'}
                              </td>
                              <td className="px-4 py-3 text-right text-sm tabular-nums">{inv.quantity}</td>
                              <td className="px-4 py-3 text-right">
                                {inv.symbol && liveQuotes[inv.symbol] ? (
                                  <div className="flex items-center justify-end gap-1">
                                    {liveQuotes[inv.symbol].change >= 0 ? (
                                      <TrendingUp className="h-3 w-3 text-green-500" />
                                    ) : (
                                      <TrendingDown className="h-3 w-3 text-red-500" />
                                    )}
                                    <div className="text-right">
                                      <p className={`text-sm font-medium tabular-nums ${liveQuotes[inv.symbol].change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                        {liveQuotes[inv.symbol].change >= 0 ? '+' : ''}{liveQuotes[inv.symbol].changePercent.toFixed(2)}%
                                      </p>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{inv.symbol ? '...' : 'N/A'}</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right text-sm">{formatCurrency(invested, 'USD')}</td>
                              <td className="px-4 py-3 text-right text-sm">{formatCurrency(current, 'USD')}</td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {gain >= 0 ? <TrendingUp className="h-4 w-4 text-green-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />}
                                  <span className={`text-sm font-medium ${gain >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    {gainPercent >= 0 ? '+' : ''}{gainPercent.toFixed(2)}%
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => handleUpdatePrice(inv)}>
                                      <RefreshCw className="mr-2 h-4 w-4" />Update Price
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleEditInvestment(inv)}>
                                      <Pencil className="mr-2 h-4 w-4" />Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem className="text-destructive" onClick={() => deleteInvestmentMutation.mutate(inv.id)}>
                                      <Trash2 className="mr-2 h-4 w-4" />Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ASSETS TAB */}
        <TabsContent value="assets" className="mt-4 space-y-6">
          <div className="flex items-center justify-end">
            <Button onClick={() => setAssetDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Asset
            </Button>
          </div>

          {/* Assets Summary */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Total Assets</p>
                <p className="text-2xl font-bold">{assetsSummary?.count || 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Purchase Value</p>
                <p className="text-2xl font-bold">{formatCurrency(assetsSummary?.totalPurchaseValue || 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Current Value</p>
                <p className="text-2xl font-bold">{formatCurrency(assetsSummary?.totalCurrentValue || 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Net Equity</p>
                <p className="text-2xl font-bold text-green-500">{formatCurrency(assetsSummary?.netEquity || 0)}</p>
                {assetsSummary?.totalLoanOutstanding > 0 && (
                  <p className="text-xs text-muted-foreground">Loan: {formatCurrency(assetsSummary.totalLoanOutstanding)}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Assets List */}
          {assets.length === 0 ? (
            <Card>
              <CardContent className="flex h-32 items-center justify-center text-muted-foreground">
                No assets added yet
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {assets.map((asset: Asset) => (
                <Card key={asset.id} className="overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{asset.name}</CardTitle>
                        <Badge variant="secondary" className="mt-1">{asset.type}</Badge>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => {
                            setSelectedAssetForLoan(asset);
                            setLinkLoanDialogOpen(true);
                          }}>
                            <Link2 className="mr-2 h-4 w-4" />Link Loan
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEditAsset(asset)}>
                            <Pencil className="mr-2 h-4 w-4" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => deleteAssetMutation.mutate(asset.id)}>
                            <Trash2 className="mr-2 h-4 w-4" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {asset.address && (
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>{asset.address}{asset.city ? `, ${asset.city}` : ''}</span>
                      </div>
                    )}
                    {asset.purchaseDate && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        <span>Purchased: {new Date(asset.purchaseDate).toLocaleDateString()}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                      <div>
                        <p className="text-xs text-muted-foreground">Purchase Value</p>
                        <p className="font-semibold">{formatCurrency(asset.purchaseValue)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Current Value</p>
                        <p className="font-semibold">{formatCurrency(asset.currentValue || asset.purchaseValue)}</p>
                      </div>
                    </div>
                    {asset.linkedLoan && (
                      <div className="bg-muted/50 rounded-lg p-3 mt-2">
                        <div className="flex items-center gap-2 text-sm">
                          <Link2 className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{asset.linkedLoan.partyName}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          Outstanding: {formatCurrency(asset.linkedLoan.outstandingAmount)}
                        </p>
                      </div>
                    )}
                    {((asset.currentValue || asset.purchaseValue) - asset.purchaseValue) !== 0 && (
                      <div className={`text-sm font-medium ${(asset.currentValue || asset.purchaseValue) >= asset.purchaseValue ? 'text-green-500' : 'text-red-500'}`}>
                        {(asset.currentValue || asset.purchaseValue) >= asset.purchaseValue ? '+' : ''}
                        {formatCurrency((asset.currentValue || asset.purchaseValue) - asset.purchaseValue)}
                        ({(((asset.currentValue || asset.purchaseValue) - asset.purchaseValue) / asset.purchaseValue * 100).toFixed(1)}%)
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* POLICIES TAB */}
        <TabsContent value="policies" className="mt-4 space-y-6">
          <div className="flex items-center justify-end gap-2">
            <input
              type="file"
              ref={policyFileInputRef}
              accept=".pdf"
              className="hidden"
              onChange={handlePolicyFileUpload}
            />
            <Button
              variant="outline"
              onClick={() => policyFileInputRef.current?.click()}
              disabled={uploadingPolicy}
            >
              {uploadingPolicy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Upload Policy PDF
            </Button>
            <Button onClick={() => setPolicyDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Policy
            </Button>
          </div>

          {/* Policies Summary */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Active Policies</p>
                <p className="text-2xl font-bold">{policiesSummary?.activePolicies || 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Total Coverage</p>
                <p className="text-2xl font-bold">{formatCurrency(policiesSummary?.totalCoverage || 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Yearly Premium</p>
                <p className="text-2xl font-bold">{formatCurrency(policiesSummary?.yearlyPremium || 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Total Premium Paid</p>
                <p className="text-2xl font-bold">{formatCurrency(policiesSummary?.totalPremiumPaid || 0)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Policies List */}
          {policies.length === 0 ? (
            <Card>
              <CardContent className="flex h-32 items-center justify-center text-muted-foreground">
                No policies added yet
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {policies.map((policy: Policy) => (
                <Card key={policy.id} className="overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{policy.name}</CardTitle>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary">{policyTypes.find(t => t.value === policy.type)?.label || policy.type}</Badge>
                          <Badge variant={policy.status === 'active' ? 'default' : 'outline'}>{policy.status}</Badge>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => {
                            setSelectedPolicyForPayment(policy);
                            setPaymentFormData(prev => ({ ...prev, amount: policy.premiumAmount || 0 }));
                            setPaymentDialogOpen(true);
                          }}>
                            <Receipt className="mr-2 h-4 w-4" />Add Payment
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEditPolicy(policy)}>
                            <Pencil className="mr-2 h-4 w-4" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => deletePolicyMutation.mutate(policy.id)}>
                            <Trash2 className="mr-2 h-4 w-4" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <FileText className="h-4 w-4" />
                      <span>{policy.provider}</span>
                      {policy.policyNumber && <span className="text-xs">#{policy.policyNumber}</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                      <div>
                        <p className="text-xs text-muted-foreground">Coverage</p>
                        <p className="font-semibold">{formatCurrency((policy.sumAssured || 0) + (policy.coverageAmount || 0))}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Premium</p>
                        <p className="font-semibold">
                          {formatCurrency(policy.premiumAmount || 0)}
                          <span className="text-xs text-muted-foreground ml-1">
                            /{policy.premiumFrequency === 'monthly' ? 'mo' :
                              policy.premiumFrequency === 'quarterly' ? 'qtr' :
                              policy.premiumFrequency === 'half_yearly' ? '6mo' :
                              policy.premiumFrequency === 'one_time' ? 'once' : 'yr'}
                          </span>
                        </p>
                      </div>
                    </div>
                    {policy.nextPremiumDate && (
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span>Next due: {formatDayMonth(policy.nextPremiumDate)}</span>
                      </div>
                    )}
                    <div className="text-sm text-muted-foreground">
                      Total paid: {formatCurrency(policy.totalPremiumPaid || 0)}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Fund Add/Edit Dialog */}
      <Dialog open={fundDialogOpen} onOpenChange={(open) => { setFundDialogOpen(open); if (!open) resetFundForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingInvestment ? 'Edit Investment' : 'Add Investment'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={fundFormData.name} onChange={(e) => setFundFormData({ ...fundFormData, name: e.target.value })} placeholder="e.g., HDFC Bank Shares" />
            </div>
            <div className="space-y-2">
              <Label>Country/Region</Label>
              <Select value={fundFormData.country} onValueChange={(value: 'IN' | 'US') => setFundFormData({ ...fundFormData, country: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN"><div className="flex items-center gap-2"><IndianRupee className="h-4 w-4" />India (₹)</div></SelectItem>
                  <SelectItem value="US"><div className="flex items-center gap-2"><DollarSign className="h-4 w-4" />United States ($)</div></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={fundFormData.type} onValueChange={(value) => setFundFormData({ ...fundFormData, type: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {investmentTypes.map((type) => (<SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Symbol (Optional)</Label>
              <Input value={fundFormData.symbol} onChange={(e) => setFundFormData({ ...fundFormData, symbol: e.target.value })} placeholder={fundFormData.country === 'US' ? 'e.g., AAPL' : 'e.g., HDFCBANK'} />
            </div>
            <div className="space-y-2">
              <Label>Platform (Optional)</Label>
              <Input value={fundFormData.platform} onChange={(e) => setFundFormData({ ...fundFormData, platform: e.target.value })} placeholder={fundFormData.country === 'US' ? 'e.g., ETrade' : 'e.g., Zerodha'} />
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input type="number" value={fundFormData.quantity} onChange={(e) => setFundFormData({ ...fundFormData, quantity: parseFloat(e.target.value) || 1 })} />
            </div>
            <div className="space-y-2">
              <Label>Purchase Price (per unit)</Label>
              <Input type="number" value={fundFormData.purchasePrice} onChange={(e) => setFundFormData({ ...fundFormData, purchasePrice: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="space-y-2">
              <Label>Purchase Date</Label>
              <Input type="date" value={fundFormData.purchaseDate} onChange={(e) => setFundFormData({ ...fundFormData, purchaseDate: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Current Price (per unit)</Label>
              <Input type="number" value={fundFormData.currentPrice} onChange={(e) => setFundFormData({ ...fundFormData, currentPrice: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFundDialogOpen(false); resetFundForm(); }}>Cancel</Button>
            <Button onClick={handleSubmitFund}>{editingInvestment ? 'Update' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Asset Add/Edit Dialog */}
      <Dialog open={assetDialogOpen} onOpenChange={(open) => { setAssetDialogOpen(open); if (!open) resetAssetForm(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAsset ? 'Edit Asset' : 'Add Asset'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={assetFormData.name} onChange={(e) => setAssetFormData({ ...assetFormData, name: e.target.value })} placeholder="e.g., Flat in Gurgaon" />
            </div>
            <div className="space-y-2">
              <Label>Type *</Label>
              <Select value={assetFormData.type} onValueChange={(value: Asset['type']) => setAssetFormData({ ...assetFormData, type: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {assetTypes.map((type) => (<SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Address</Label>
              <Input value={assetFormData.address} onChange={(e) => setAssetFormData({ ...assetFormData, address: e.target.value })} placeholder="Full address" />
            </div>
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={assetFormData.city} onChange={(e) => setAssetFormData({ ...assetFormData, city: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Input value={assetFormData.state} onChange={(e) => setAssetFormData({ ...assetFormData, state: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Area</Label>
              <div className="flex gap-2">
                <Input type="number" value={assetFormData.area} onChange={(e) => setAssetFormData({ ...assetFormData, area: parseFloat(e.target.value) || 0 })} className="flex-1" />
                <Select value={assetFormData.areaUnit} onValueChange={(value: 'sqft' | 'sqm' | 'acres') => setAssetFormData({ ...assetFormData, areaUnit: value })}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sqft">sq ft</SelectItem>
                    <SelectItem value="sqm">sq m</SelectItem>
                    <SelectItem value="acres">acres</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Registration Number</Label>
              <Input value={assetFormData.registrationNumber} onChange={(e) => setAssetFormData({ ...assetFormData, registrationNumber: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Purchase Date</Label>
              <Input type="date" value={assetFormData.purchaseDate} onChange={(e) => setAssetFormData({ ...assetFormData, purchaseDate: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Purchase Value *</Label>
              <Input type="number" value={assetFormData.purchaseValue} onChange={(e) => setAssetFormData({ ...assetFormData, purchaseValue: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="space-y-2">
              <Label>Current Value</Label>
              <Input type="number" value={assetFormData.currentValue} onChange={(e) => setAssetFormData({ ...assetFormData, currentValue: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="space-y-2">
              <Label>Ownership</Label>
              <Select value={assetFormData.ownershipType} onValueChange={(value: 'self' | 'joint' | 'family') => setAssetFormData({ ...assetFormData, ownershipType: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">Self</SelectItem>
                  <SelectItem value="joint">Joint</SelectItem>
                  <SelectItem value="family">Family</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={assetFormData.status} onValueChange={(value: 'owned' | 'sold' | 'under_construction') => setAssetFormData({ ...assetFormData, status: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="owned">Owned</SelectItem>
                  <SelectItem value="sold">Sold</SelectItem>
                  <SelectItem value="under_construction">Under Construction</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Notes</Label>
              <Textarea value={assetFormData.notes} onChange={(e) => setAssetFormData({ ...assetFormData, notes: e.target.value })} rows={2} />
            </div>

            {/* Loan Details Section */}
            <div className="md:col-span-2 border-t pt-4 mt-2">
              <div className="flex items-center justify-between mb-4">
                <Label className="text-base font-semibold">Linked Loan</Label>
                <div className="flex items-center gap-2">
                  <Label htmlFor="hasLoan" className="text-sm text-muted-foreground">Has Loan</Label>
                  <Switch
                    id="hasLoan"
                    checked={assetFormData.hasLoan}
                    onCheckedChange={(checked) => setAssetFormData({ ...assetFormData, hasLoan: checked })}
                  />
                </div>
              </div>

              {assetFormData.hasLoan && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Lender / Bank</Label>
                    <Input value={assetFormData.loanProvider} onChange={(e) => setAssetFormData({ ...assetFormData, loanProvider: e.target.value })} placeholder="e.g., SBI, HDFC Bank" />
                  </div>
                  <div className="space-y-2">
                    <Label>Loan Type</Label>
                    <Select value={assetFormData.loanType} onValueChange={(value: 'home' | 'car' | 'personal' | 'business') => setAssetFormData({ ...assetFormData, loanType: value })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="home">Home Loan</SelectItem>
                        <SelectItem value="car">Car Loan</SelectItem>
                        <SelectItem value="personal">Personal Loan</SelectItem>
                        <SelectItem value="business">Business Loan</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Principal Amount</Label>
                    <Input type="number" value={assetFormData.principalAmount} onChange={(e) => setAssetFormData({ ...assetFormData, principalAmount: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Outstanding Amount</Label>
                    <Input type="number" value={assetFormData.outstandingAmount} onChange={(e) => setAssetFormData({ ...assetFormData, outstandingAmount: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Interest Rate (%)</Label>
                    <Input type="number" step="0.01" value={assetFormData.interestRate} onChange={(e) => setAssetFormData({ ...assetFormData, interestRate: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-2">
                    <Label>EMI Amount</Label>
                    <Input type="number" value={assetFormData.emiAmount} onChange={(e) => setAssetFormData({ ...assetFormData, emiAmount: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Loan Start Date</Label>
                    <Input type="date" value={assetFormData.loanStartDate} onChange={(e) => setAssetFormData({ ...assetFormData, loanStartDate: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Loan End Date</Label>
                    <Input type="date" value={assetFormData.loanEndDate} onChange={(e) => setAssetFormData({ ...assetFormData, loanEndDate: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Total Installments</Label>
                    <Input type="number" value={assetFormData.totalInstallments} onChange={(e) => setAssetFormData({ ...assetFormData, totalInstallments: parseInt(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Paid Installments</Label>
                    <Input type="number" value={assetFormData.paidInstallments} onChange={(e) => setAssetFormData({ ...assetFormData, paidInstallments: parseInt(e.target.value) || 0 })} />
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssetDialogOpen(false); resetAssetForm(); }}>Cancel</Button>
            <Button onClick={handleSubmitAsset}>{editingAsset ? 'Update' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Policy Add/Edit Dialog */}
      <Dialog open={policyDialogOpen} onOpenChange={(open) => { setPolicyDialogOpen(open); if (!open) resetPolicyForm(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPolicy ? 'Edit Policy' : 'Add Policy'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={policyFormData.name} onChange={(e) => setPolicyFormData({ ...policyFormData, name: e.target.value })} placeholder="e.g., LIC Term Plan" />
            </div>
            <div className="space-y-2">
              <Label>Type *</Label>
              <Select value={policyFormData.type} onValueChange={(value: Policy['type']) => setPolicyFormData({ ...policyFormData, type: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {policyTypes.map((type) => (<SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Provider *</Label>
              <Input value={policyFormData.provider} onChange={(e) => setPolicyFormData({ ...policyFormData, provider: e.target.value })} placeholder="e.g., LIC, HDFC Life" />
            </div>
            <div className="space-y-2">
              <Label>Policy Number</Label>
              <Input value={policyFormData.policyNumber} onChange={(e) => setPolicyFormData({ ...policyFormData, policyNumber: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Policy Holder</Label>
              <Input value={policyFormData.policyHolder} onChange={(e) => setPolicyFormData({ ...policyFormData, policyHolder: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Sum Assured (Life/Term)</Label>
              <Input type="number" value={policyFormData.sumAssured} onChange={(e) => setPolicyFormData({ ...policyFormData, sumAssured: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="space-y-2">
              <Label>Coverage Amount (Health)</Label>
              <Input type="number" value={policyFormData.coverageAmount} onChange={(e) => setPolicyFormData({ ...policyFormData, coverageAmount: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="space-y-2">
              <Label>Premium Amount</Label>
              <Input type="number" value={policyFormData.premiumAmount} onChange={(e) => setPolicyFormData({ ...policyFormData, premiumAmount: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="space-y-2">
              <Label>Premium Frequency</Label>
              <Select value={policyFormData.premiumFrequency} onValueChange={(value: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'one_time') => setPolicyFormData({ ...policyFormData, premiumFrequency: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {premiumFrequencies.map((freq) => (<SelectItem key={freq.value} value={freq.value}>{freq.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={policyFormData.startDate} onChange={(e) => setPolicyFormData({ ...policyFormData, startDate: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>End Date / Maturity</Label>
              <Input type="date" value={policyFormData.endDate} onChange={(e) => setPolicyFormData({ ...policyFormData, endDate: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Next Premium Date</Label>
              <Input type="date" value={policyFormData.nextPremiumDate} onChange={(e) => setPolicyFormData({ ...policyFormData, nextPremiumDate: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Policy Term (Years)</Label>
              <Input type="number" value={policyFormData.policyTerm} onChange={(e) => setPolicyFormData({ ...policyFormData, policyTerm: parseInt(e.target.value) || 0 })} />
            </div>
            <div className="space-y-2">
              <Label>Nominees</Label>
              <Input value={policyFormData.nominees} onChange={(e) => setPolicyFormData({ ...policyFormData, nominees: e.target.value })} placeholder="e.g., Spouse - 50%, Child - 50%" />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={policyFormData.status} onValueChange={(value: 'active' | 'lapsed' | 'matured' | 'surrendered' | 'claimed') => setPolicyFormData({ ...policyFormData, status: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="lapsed">Lapsed</SelectItem>
                  <SelectItem value="matured">Matured</SelectItem>
                  <SelectItem value="surrendered">Surrendered</SelectItem>
                  <SelectItem value="claimed">Claimed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Notes</Label>
              <Textarea value={policyFormData.notes} onChange={(e) => setPolicyFormData({ ...policyFormData, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPolicyDialogOpen(false); resetPolicyForm(); }}>Cancel</Button>
            <Button onClick={handleSubmitPolicy}>{editingPolicy ? 'Update' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={(open) => { setPaymentDialogOpen(open); if (!open) { setSelectedPolicyForPayment(null); resetPaymentForm(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Premium Payment</DialogTitle>
            {selectedPolicyForPayment && <p className="text-sm text-muted-foreground">{selectedPolicyForPayment.name}</p>}
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Payment Date *</Label>
              <Input type="date" value={paymentFormData.paymentDate} onChange={(e) => setPaymentFormData({ ...paymentFormData, paymentDate: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Amount *</Label>
              <Input type="number" value={paymentFormData.amount} onChange={(e) => setPaymentFormData({ ...paymentFormData, amount: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="space-y-2">
              <Label>Payment Mode</Label>
              <Input value={paymentFormData.paymentMode} onChange={(e) => setPaymentFormData({ ...paymentFormData, paymentMode: e.target.value })} placeholder="e.g., Online, Cheque" />
            </div>
            <div className="space-y-2">
              <Label>Reference Number</Label>
              <Input value={paymentFormData.referenceNumber} onChange={(e) => setPaymentFormData({ ...paymentFormData, referenceNumber: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={paymentFormData.notes} onChange={(e) => setPaymentFormData({ ...paymentFormData, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPaymentDialogOpen(false); setSelectedPolicyForPayment(null); resetPaymentForm(); }}>Cancel</Button>
            <Button onClick={handleSubmitPayment}>Add Payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link Loan Dialog */}
      <Dialog open={linkLoanDialogOpen} onOpenChange={(open) => { setLinkLoanDialogOpen(open); if (!open) setSelectedAssetForLoan(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Loan to Asset</DialogTitle>
            {selectedAssetForLoan && <p className="text-sm text-muted-foreground">{selectedAssetForLoan.name}</p>}
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm">Select a loan to link to this asset, or remove existing link.</p>
            <div className="space-y-2">
              {takenLoans.length === 0 ? (
                <p className="text-sm text-muted-foreground">No loans available to link</p>
              ) : (
                <div className="space-y-2">
                  {selectedAssetForLoan?.linkedLoanId && (
                    <Button variant="outline" className="w-full justify-start" onClick={() => {
                      if (selectedAssetForLoan) {
                        linkLoanMutation.mutate({ id: selectedAssetForLoan.id, loanId: null });
                      }
                    }}>
                      <Link2 className="mr-2 h-4 w-4 text-muted-foreground" />
                      Remove Link
                    </Button>
                  )}
                  {takenLoans.map((loan: Loan) => (
                    <Button
                      key={loan.id}
                      variant={selectedAssetForLoan?.linkedLoanId === loan.id ? 'default' : 'outline'}
                      className="w-full justify-start"
                      onClick={() => {
                        if (selectedAssetForLoan) {
                          linkLoanMutation.mutate({ id: selectedAssetForLoan.id, loanId: loan.id });
                        }
                      }}
                    >
                      <div className="flex flex-col items-start">
                        <span>{loan.partyName}</span>
                        <span className="text-xs text-muted-foreground">
                          Outstanding: {formatCurrency(loan.outstandingAmount)}
                        </span>
                      </div>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setLinkLoanDialogOpen(false); setSelectedAssetForLoan(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Price Dialog */}
      <Dialog open={priceDialogOpen} onOpenChange={setPriceDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Update Price</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Current Price (per unit)</Label>
            <Input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="Enter new price" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => editingInvestment && updatePriceMutation.mutate({ id: editingInvestment.id, price: parseFloat(newPrice) || 0 })}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PDF Password Dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={(open) => {
        setPasswordDialogOpen(open);
        if (!open) {
          setPendingPdfFile(null);
          setPdfPassword('');
        }
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Password Protected PDF
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This PDF is password protected. Please enter the password to extract policy details.
            </p>
            <div className="space-y-2">
              <Label>PDF Password</Label>
              <Input
                type="password"
                value={pdfPassword}
                onChange={(e) => setPdfPassword(e.target.value)}
                placeholder="Enter PDF password"
                onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setPasswordDialogOpen(false);
              setPendingPdfFile(null);
              setPdfPassword('');
            }}>Cancel</Button>
            <Button onClick={handlePasswordSubmit} disabled={!pdfPassword}>
              Extract Policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

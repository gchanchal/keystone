import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { Plus, Building2, CreditCard, Wallet, MoreVertical, Pencil, Trash2, Upload, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { accountsApi, uploadsApi } from '@/lib/api';
import { SmartImportProgress } from '@/components/SmartImportProgress';
import { formatCurrency } from '@/lib/utils';
import type { Account } from '@/types';
import { getCardsForBank, getCardGradient, CARD_NETWORKS, type CardVariant } from '@/config/credit-card-variants';

const accountTypeIcons: Record<string, typeof Wallet> = {
  savings: Wallet,
  current: Building2,
  credit_card: CreditCard,
  loan: Building2, // Use Building2 for loan accounts
};

const accountTypeLabels: Record<string, string> = {
  savings: 'Savings',
  current: 'Current',
  credit_card: 'Credit Card',
  loan: 'Loan Account',
};

export function Accounts() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlightedAccountId, setHighlightedAccountId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    bankName: '',
    accountNumber: '',
    accountType: 'savings' as 'savings' | 'current' | 'credit_card' | 'loan',
    openingBalance: 0,
    // Bank account metadata
    ifscCode: '',
    branchName: '',
    accountHolderName: '',
    address: '',
    accountStatus: '',
    // Credit card fields
    cardName: '',
    cardNetwork: '',
  });

  // Smart upload state
  const [isSmartImporting, setIsSmartImporting] = useState(false);
  const [smartImportResult, setSmartImportResult] = useState<any>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Handle highlight param from smart import
  useEffect(() => {
    const highlightId = searchParams.get('highlight');
    if (highlightId) {
      setHighlightedAccountId(highlightId);
      // Clear the URL param
      setSearchParams({}, { replace: true });
      // Remove highlight after 3 seconds
      const timer = setTimeout(() => {
        setHighlightedAccountId(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [searchParams, setSearchParams]);

  // Quick upload handler
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0];
    setUploadError(null);
    setIsSmartImporting(true);

    try {
      const importResult = await uploadsApi.smartImport(file);
      setSmartImportResult(importResult);

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['uploads'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['credit-cards'] });
    } catch (error: any) {
      console.error('Smart import failed:', error);
      setIsSmartImporting(false);
      setUploadError(error?.response?.data?.error || 'Import failed. Try using Upload Center for more options.');
    }
  }, [queryClient]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/pdf': ['.pdf'],
    },
    multiple: false,
    maxFiles: 1,
  });

  const handleSmartImportComplete = useCallback((accountId: string) => {
    setHighlightedAccountId(accountId);
    setIsSmartImporting(false);
    setSmartImportResult(null);
    // Remove highlight after 3 seconds
    setTimeout(() => {
      setHighlightedAccountId(null);
    }, 3000);
  }, []);

  // Get available cards based on selected bank
  const availableCards = useMemo(() => {
    if (formData.accountType !== 'credit_card' || !formData.bankName) return [];
    return getCardsForBank(formData.bankName);
  }, [formData.bankName, formData.accountType]);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.getAll,
  });

  const createMutation = useMutation({
    mutationFn: accountsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setDialogOpen(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => accountsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setDialogOpen(false);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: accountsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      bankName: '',
      accountNumber: '',
      accountType: 'savings',
      openingBalance: 0,
      ifscCode: '',
      branchName: '',
      accountHolderName: '',
      address: '',
      accountStatus: '',
      cardName: '',
      cardNetwork: '',
    });
    setEditingAccount(null);
  };

  const handleEdit = (account: Account) => {
    setEditingAccount(account);
    setFormData({
      name: account.name,
      bankName: account.bankName,
      accountNumber: account.accountNumber || '',
      accountType: account.accountType,
      openingBalance: account.openingBalance,
      ifscCode: account.ifscCode || '',
      branchName: account.branchName || '',
      accountHolderName: account.accountHolderName || '',
      address: account.address || '',
      accountStatus: account.accountStatus || '',
      cardName: account.cardName || '',
      cardNetwork: account.cardNetwork || '',
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (editingAccount) {
      updateMutation.mutate({ id: editingAccount.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const activeAccounts = accounts.filter((a: Account) => a.isActive);

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
        <h1 className="text-2xl font-bold">Bank Accounts</h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Account
        </Button>
      </div>

      {activeAccounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium">No accounts yet</p>
            <p className="text-sm text-muted-foreground">Add your first bank account to get started</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {activeAccounts.map((account: Account) => {
            const Icon = accountTypeIcons[account.accountType];
            const isHighlighted = highlightedAccountId === account.id;

            const cardContent = (
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-primary/10 p-3">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">{account.name}</p>
                      <p className="text-sm text-muted-foreground">{account.bankName}</p>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit(account)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => deleteMutation.mutate(account.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Current Balance</span>
                    <span className="text-xl font-bold">{formatCurrency(account.currentBalance)}</span>
                  </div>
                  {account.accountNumber && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Account Number</span>
                      <span className="text-sm">****{account.accountNumber.slice(-4)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Type</span>
                    <Badge variant="secondary">{accountTypeLabels[account.accountType]}</Badge>
                  </div>
                </div>
              </CardContent>
            );

            return isHighlighted ? (
              <motion.div
                key={account.id}
                initial={{ scale: 1 }}
                animate={{
                  scale: [1, 1.02, 1],
                  boxShadow: [
                    '0 0 0 0 rgba(59, 130, 246, 0)',
                    '0 0 20px 4px rgba(59, 130, 246, 0.5)',
                    '0 0 30px 8px rgba(59, 130, 246, 0.3)',
                    '0 0 20px 4px rgba(59, 130, 246, 0.5)',
                    '0 0 0 0 rgba(59, 130, 246, 0)',
                  ],
                }}
                transition={{
                  duration: 2,
                  repeat: 1,
                  ease: 'easeInOut',
                }}
                className="rounded-lg"
              >
                <Card className="border-primary/50 bg-primary/5">
                  {cardContent}
                </Card>
              </motion.div>
            ) : (
              <Card key={account.id}>
                {cardContent}
              </Card>
            );
          })}
        </div>
      )}

      {/* Quick Upload Section */}
      <Card>
        <CardContent className="p-4">
          <div
            {...getRootProps()}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
              isDragActive
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-primary/50'
            }`}
          >
            <input {...getInputProps()} />
            <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              {isDragActive ? 'Drop to import' : 'Quick Import Statement'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Drop bank or credit card statement (PDF, XLS, XLSX)
            </p>
          </div>
          {uploadError && (
            <p className="mt-2 text-sm text-destructive text-center">{uploadError}</p>
          )}
        </CardContent>
      </Card>

      {/* Smart Import Progress */}
      <SmartImportProgress
        isOpen={isSmartImporting}
        result={smartImportResult}
        onComplete={handleSmartImportComplete}
      />

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingAccount ? 'Edit Account' : 'Add Account'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Account Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Primary Savings"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bankName">Bank Name</Label>
              <Input
                id="bankName"
                value={formData.bankName}
                onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                placeholder="e.g., HDFC Bank"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="accountNumber">Account Number (Optional)</Label>
              <Input
                id="accountNumber"
                value={formData.accountNumber}
                onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                placeholder="e.g., 1234567890"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="accountHolderName">Account Holder Name</Label>
              <Input
                id="accountHolderName"
                value={formData.accountHolderName}
                onChange={(e) => setFormData({ ...formData, accountHolderName: e.target.value })}
                placeholder="e.g., John Doe"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ifscCode">IFSC Code</Label>
                <Input
                  id="ifscCode"
                  value={formData.ifscCode}
                  onChange={(e) => setFormData({ ...formData, ifscCode: e.target.value.toUpperCase() })}
                  placeholder="e.g., HDFC0001234"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branchName">Branch Name</Label>
                <Input
                  id="branchName"
                  value={formData.branchName}
                  onChange={(e) => setFormData({ ...formData, branchName: e.target.value })}
                  placeholder="e.g., Andheri West"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="e.g., 123 Main Street, City"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="accountStatus">Account Status</Label>
              <Select
                value={formData.accountStatus || undefined}
                onValueChange={(value) => setFormData({ ...formData, accountStatus: value === '_none' ? '' : value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">-- Select Status --</SelectItem>
                  <SelectItem value="Individual">Individual</SelectItem>
                  <SelectItem value="Joint">Joint</SelectItem>
                  <SelectItem value="Corporate">Corporate</SelectItem>
                  <SelectItem value="Proprietary">Proprietary</SelectItem>
                  <SelectItem value="Partnership">Partnership</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="accountType">Account Type</Label>
              <Select
                value={formData.accountType}
                onValueChange={(value: any) => setFormData({ ...formData, accountType: value, cardName: '', cardNetwork: '' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="savings">Savings</SelectItem>
                  <SelectItem value="current">Current</SelectItem>
                  <SelectItem value="credit_card">Credit Card</SelectItem>
                  <SelectItem value="loan">Loan Account</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Credit Card specific fields */}
            {formData.accountType === 'credit_card' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="cardName">Card Variant</Label>
                  <Select
                    value={formData.cardName || undefined}
                    onValueChange={(value) => setFormData({ ...formData, cardName: value === '_none' ? '' : value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select card variant" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">-- Select Card --</SelectItem>
                      {availableCards.length > 0 ? (
                        availableCards.map((card) => (
                          <SelectItem key={card.id} value={card.name}>
                            <div className="flex items-center gap-2">
                              <div className={`w-4 h-2.5 rounded-sm bg-gradient-to-r ${card.gradient}`} />
                              {card.name}
                              {card.tier && (
                                <span className="text-xs text-muted-foreground capitalize">({card.tier})</span>
                              )}
                            </div>
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="_hint" disabled>
                          Enter bank name to see card options
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {formData.cardName && (
                    <div className="mt-2">
                      <div className={`w-full h-24 rounded-lg bg-gradient-to-br ${getCardGradient(formData.bankName, formData.cardName)} flex items-end justify-between p-3 text-white`}>
                        <div>
                          <p className="text-xs opacity-70">Card Preview</p>
                          <p className="font-semibold">{formData.cardName}</p>
                        </div>
                        <p className="text-sm font-medium">{formData.bankName}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cardNetwork">Card Network</Label>
                  <Select
                    value={formData.cardNetwork || undefined}
                    onValueChange={(value) => setFormData({ ...formData, cardNetwork: value === '_none' ? '' : value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select network" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">-- Select Network --</SelectItem>
                      {CARD_NETWORKS.map((network) => (
                        <SelectItem key={network} value={network}>
                          {network}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="openingBalance">Opening Balance</Label>
              <Input
                id="openingBalance"
                type="number"
                value={formData.openingBalance}
                onChange={(e) => setFormData({ ...formData, openingBalance: parseFloat(e.target.value) || 0 })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
              {editingAccount ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

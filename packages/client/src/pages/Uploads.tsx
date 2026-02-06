import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Upload,
  FileSpreadsheet,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Trash2,
  Loader2,
  Sparkles,
  AlertCircle,
  Plus,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { uploadsApi, accountsApi } from '@/lib/api';
import { formatDate, formatCurrency } from '@/lib/utils';
import type { Upload as UploadType, Account } from '@/types';
import { SmartImportProgress } from '@/components/SmartImportProgress';

type UploadStep = 'select' | 'detecting' | 'configure' | 'preview' | 'confirm';

interface DetectionResult {
  fileType: string;
  bankName: string | null;
  confidence: 'high' | 'medium' | 'low';
  details: string;
}

const BANK_DISPLAY_NAMES: Record<string, string> = {
  hdfc: 'HDFC Bank',
  kotak: 'Kotak Mahindra Bank',
  icici: 'ICICI Bank',
  sbi: 'State Bank of India',
  axis: 'Axis Bank',
  other: 'Other',
};

export function Uploads() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [uploadStep, setUploadStep] = useState<UploadStep>('select');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadType, setUploadType] = useState<string>('');
  const [bankName, setBankName] = useState<string>('');
  const [accountId, setAccountId] = useState<string>('');
  const [previewData, setPreviewData] = useState<any>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);

  // Smart import state
  const [isSmartImporting, setIsSmartImporting] = useState(false);
  const [smartImportResult, setSmartImportResult] = useState<any>(null);

  // New account creation state
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountNumber, setNewAccountNumber] = useState('');
  const [newAccountType, setNewAccountType] = useState<'savings' | 'current' | 'credit_card' | 'loan'>('savings');
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [noMatchingAccount, setNoMatchingAccount] = useState(false);

  // CAMS password state
  const [pdfPassword, setPdfPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Smart import password dialog state
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [smartImportPassword, setSmartImportPassword] = useState('');
  const [smartImportPasswordError, setSmartImportPasswordError] = useState('');
  const [pendingSmartImportFile, setPendingSmartImportFile] = useState<File | null>(null);

  const { data: uploads = [], isLoading } = useQuery({
    queryKey: ['uploads'],
    queryFn: uploadsApi.getAll,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.getAll,
  });

  const deleteMutation = useMutation({
    mutationFn: uploadsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uploads'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const createAccountMutation = useMutation({
    mutationFn: accountsApi.create,
    onSuccess: (newAccount) => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setAccountId(newAccount.id);
      setShowCreateAccount(false);
      setNoMatchingAccount(false);
      setAutoDetected(true);
    },
  });

  // Find the first matching account for a bank
  const findAccountForBank = useCallback((bank: string): string | null => {
    const bankLower = bank.toLowerCase();
    const matchingAccount = accounts.find((a: Account) => {
      if (!a.isActive) return false;
      const accountBankLower = (a.bankName || '').toLowerCase();
      if (bankLower === 'hdfc' && accountBankLower.includes('hdfc')) return true;
      if (bankLower === 'kotak' && accountBankLower.includes('kotak')) return true;
      if (bankLower === 'icici' && accountBankLower.includes('icici')) return true;
      if (bankLower === 'sbi' && (accountBankLower.includes('sbi') || accountBankLower.includes('state bank'))) return true;
      if (bankLower === 'axis' && accountBankLower.includes('axis')) return true;
      return false;
    });
    return matchingAccount?.id || null;
  }, [accounts]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    // Support multiple files for home loans
    if (acceptedFiles.length > 1) {
      setSelectedFiles(acceptedFiles);
      setSelectedFile(acceptedFiles[0]);
    } else {
      setSelectedFile(acceptedFiles[0]);
      setSelectedFiles([acceptedFiles[0]]);
    }

    setUploadStep('detecting');
    setDetection(null);
    setAutoDetected(false);

    try {
      // Auto-detect file type from first file
      const file = acceptedFiles[0];
      const result = await uploadsApi.detectFileType(file);
      setDetection(result.detection);

      // If file needs password, show password dialog immediately
      if (result.needsPassword) {
        setUploadStep('select'); // Reset step
        setPendingSmartImportFile(file);
        setShowPasswordDialog(true);
        setSmartImportPasswordError('');
        return;
      }

      // For bank statements with high confidence, use smart import
      if (result.uploadType === 'bank_statement' && result.detection?.confidence === 'high') {
        // Use smart import - no dialogs, just progress
        setIsSmartImporting(true);
        setUploadStep('select'); // Reset step so we don't show configure dialog

        try {
          const importResult = await uploadsApi.smartImport(file);
          setSmartImportResult(importResult);

          // Invalidate queries to refresh data
          queryClient.invalidateQueries({ queryKey: ['uploads'] });
          queryClient.invalidateQueries({ queryKey: ['accounts'] });
          queryClient.invalidateQueries({ queryKey: ['transactions'] });
        } catch (importError: any) {
          console.error('Smart import failed:', importError);

          // Check if password is needed
          if (importError?.response?.data?.needsPassword) {
            setIsSmartImporting(false);
            setPendingSmartImportFile(file);
            setShowPasswordDialog(true);
            setSmartImportPasswordError('');
            return;
          }

          // Fall back to manual flow on error
          setIsSmartImporting(false);
          setUploadType(result.uploadType);
          if (result.bankName) {
            setBankName(result.bankName);
          }
          setUploadStep('configure');
        }
        return;
      }

      // Auto-fill based on detection
      if (result.uploadType) {
        setUploadType(result.uploadType);
      }
      if (result.bankName) {
        setBankName(result.bankName);
        // Try to auto-select account
        const matchedAccountId = findAccountForBank(result.bankName);
        if (matchedAccountId) {
          setAccountId(matchedAccountId);
          setAutoDetected(true);
          setNoMatchingAccount(false);
        } else {
          // No matching account - prompt to create one
          setNoMatchingAccount(true);
          // Pre-fill new account details
          const displayName = BANK_DISPLAY_NAMES[result.bankName] || result.bankName.toUpperCase();
          setNewAccountName(`${displayName} Account`);
          setNewAccountType(result.uploadType === 'credit_card' ? 'credit_card' : 'savings');
        }
      }

      // For Vyapar and ETrade, no account/bank needed - can go directly to preview
      if (result.uploadType === 'vyapar_report' || result.uploadType === 'etrade_portfolio') {
        setAutoDetected(true);
        setNoMatchingAccount(false);
      }

      // For CAMS statements, no bank/account needed
      if (result.uploadType === 'cams_statement') {
        setAutoDetected(true);
        setNoMatchingAccount(false);
      }

      // For home loan statements, no extra config needed
      if (result.uploadType === 'home_loan_statement') {
        setAutoDetected(true);
        setNoMatchingAccount(false);
      }

      setUploadStep('configure');
    } catch (error) {
      console.error('Detection failed:', error);
      // Fall back to manual configuration
      setUploadStep('configure');
    }
  }, [findAccountForBank, queryClient]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/pdf': ['.pdf'],
      'text/csv': ['.csv'],
    },
    multiple: true, // Allow multiple files for home loans
    maxFiles: 10,
  });

  const handlePreview = async () => {
    if (!selectedFile || isPreviewing) return;

    setIsPreviewing(true);
    setPasswordError('');
    try {
      let result;
      if (uploadType === 'bank_statement') {
        result = await uploadsApi.previewBankStatement(selectedFile, bankName, accountId);
      } else if (uploadType === 'vyapar_report') {
        result = await uploadsApi.previewVyapar(selectedFile);
      } else if (uploadType === 'credit_card') {
        result = await uploadsApi.previewCreditCard(selectedFile, accountId, bankName);
      } else if (uploadType === 'etrade_portfolio') {
        result = await uploadsApi.previewETrade(selectedFile);
      } else if (uploadType === 'home_loan_statement') {
        result = await uploadsApi.previewHomeLoan(selectedFile);
      } else if (uploadType === 'cams_statement') {
        if (!pdfPassword) {
          setPasswordError('Please enter the PDF password');
          setIsPreviewing(false);
          return;
        }
        result = await uploadsApi.previewCAMS(selectedFile, pdfPassword);
      }

      setPreviewData(result);
      setUploadStep('preview');
    } catch (error: any) {
      console.error('Preview error:', error);
      // Handle password error for CAMS
      if (error?.response?.data?.isPasswordError) {
        setPasswordError('Invalid password. Please try again.');
      }
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleConfirm = async () => {
    if (!previewData || isConfirming) return;

    setIsConfirming(true);
    try {
      if (uploadType === 'bank_statement') {
        await uploadsApi.confirmBankStatement(
          previewData.uploadId,
          accountId,
          previewData.allTransactions
        );
      } else if (uploadType === 'vyapar_report') {
        await uploadsApi.confirmVyapar(
          previewData.uploadId,
          previewData.allTransactions,
          previewData.itemDetails?.allItems
        );
      } else if (uploadType === 'credit_card') {
        await uploadsApi.confirmCreditCard(
          previewData.uploadId,
          accountId,
          previewData.allTransactions
        );
      } else if (uploadType === 'etrade_portfolio') {
        await uploadsApi.confirmETrade(previewData.uploadId, previewData.allHoldings);
      } else if (uploadType === 'home_loan_statement') {
        await uploadsApi.confirmHomeLoan(
          previewData.uploadId,
          previewData.loan,
          previewData.payments,
          previewData.disbursements
        );
      } else if (uploadType === 'cams_statement') {
        await uploadsApi.confirmCAMS(
          previewData.uploadId,
          previewData.investorName,
          previewData.email,
          previewData.panNumber,
          previewData.holdings
        );
      }

      queryClient.invalidateQueries({ queryKey: ['uploads'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['investments'] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      queryClient.invalidateQueries({ queryKey: ['mutual-funds'] });
      resetUpload();
    } catch (error: any) {
      // Handle already processed error gracefully
      if (error?.response?.data?.alreadyImported) {
        console.log('Upload already processed');
        resetUpload();
      } else {
        console.error('Confirm error:', error);
      }
    } finally {
      setIsConfirming(false);
    }
  };

  const resetUpload = () => {
    setUploadStep('select');
    setSelectedFile(null);
    setSelectedFiles([]);
    setUploadType('');
    setBankName('');
    setAccountId('');
    setPreviewData(null);
    setIsConfirming(false);
    setIsPreviewing(false);
    setDetection(null);
    setAutoDetected(false);
    setShowCreateAccount(false);
    setNewAccountName('');
    setNewAccountNumber('');
    setNewAccountType('savings');
    setNoMatchingAccount(false);
    setPdfPassword('');
    setPasswordError('');
    setIsSmartImporting(false);
    setSmartImportResult(null);
    setShowPasswordDialog(false);
    setSmartImportPassword('');
    setSmartImportPasswordError('');
    setPendingSmartImportFile(null);
  };

  // Handle password submission for smart import
  const handleSmartImportWithPassword = async () => {
    if (!pendingSmartImportFile || !smartImportPassword) return;

    setSmartImportPasswordError('');
    setShowPasswordDialog(false);
    setIsSmartImporting(true);

    try {
      const importResult = await uploadsApi.smartImport(pendingSmartImportFile, smartImportPassword);
      setSmartImportResult(importResult);

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['uploads'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });

      // Clear password state
      setPendingSmartImportFile(null);
      setSmartImportPassword('');
    } catch (importError: any) {
      console.error('Smart import with password failed:', importError);

      // Check if password is wrong
      if (importError?.response?.data?.needsPassword) {
        setIsSmartImporting(false);
        setShowPasswordDialog(true);
        setSmartImportPasswordError('Incorrect password. Please try again.');
        return;
      }

      // Other error - fall back to manual flow
      setIsSmartImporting(false);
      setPendingSmartImportFile(null);
      setSmartImportPassword('');
      setUploadStep('configure');
    }
  };

  // Memoized callback to prevent effect re-runs in SmartImportProgress
  const handleSmartImportComplete = useCallback((accountId: string) => {
    console.log('Smart import complete, navigating to account:', accountId);
    // Use window.location for reliable navigation
    window.location.href = `/accounts?highlight=${accountId}`;
  }, []);

  const handleCreateAccount = async () => {
    if (!newAccountName) return;

    setIsCreatingAccount(true);
    try {
      // For home loans or when bankName isn't set, derive bank name from account name or use a default
      const displayBankName = bankName
        ? (BANK_DISPLAY_NAMES[bankName] || bankName)
        : (newAccountName.includes('Axis') ? 'Axis Bank'
          : newAccountName.includes('HDFC') ? 'HDFC Bank'
          : newAccountName.includes('ICICI') ? 'ICICI Bank'
          : newAccountName.includes('Kotak') ? 'Kotak Mahindra Bank'
          : newAccountName.includes('SBI') ? 'State Bank of India'
          : 'Bank');

      await createAccountMutation.mutateAsync({
        name: newAccountName,
        bankName: displayBankName,
        accountNumber: newAccountNumber || undefined,
        accountType: newAccountType,
        currency: 'INR',
        openingBalance: 0,
      });
    } catch (error) {
      console.error('Error creating account:', error);
    } finally {
      setIsCreatingAccount(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('pdf')) {
      return <FileText className="h-8 w-8 text-red-500" />;
    }
    return <FileSpreadsheet className="h-8 w-8 text-green-500" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Upload Center</h1>
      </div>

      {/* Dropzone */}
      <Card>
        <CardContent className="p-6">
          {uploadStep === 'detecting' ? (
            <div className="rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 p-12 text-center">
              <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-primary" />
              <p className="text-lg font-medium">Analyzing file...</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Auto-detecting file type and bank
              </p>
            </div>
          ) : (
            <div
              {...getRootProps()}
              className={`cursor-pointer rounded-lg border-2 border-dashed p-12 text-center transition-colors ${
                isDragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-primary/50'
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-lg font-medium">
                {isDragActive ? 'Drop the files here' : 'Drag & drop files here'}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                or click to select (XLS, XLSX, PDF, CSV)
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                File type and bank will be auto-detected. For home loans, you can upload multiple related files.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload History */}
      <Card>
        <CardHeader>
          <CardTitle>Upload History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : uploads.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              No uploads yet
            </div>
          ) : (
            <div className="space-y-4">
              {uploads.map((upload: UploadType) => (
                <div
                  key={upload.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="flex items-center gap-4">
                    {getFileIcon(upload.mimeType)}
                    <div>
                      <p className="font-medium">{upload.originalName}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(upload.createdAt)} • {upload.transactionCount} transactions
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge variant="secondary">{upload.uploadType.replace('_', ' ')}</Badge>
                    {getStatusIcon(upload.status)}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMutation.mutate(upload.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Configure Dialog */}
      <Dialog open={uploadStep === 'configure'} onOpenChange={(open) => !open && resetUpload()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure Upload</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>File{selectedFiles.length > 1 ? 's' : ''}</Label>
              {selectedFiles.length > 1 ? (
                <div className="space-y-1">
                  {selectedFiles.map((file, index) => (
                    <p key={index} className="text-sm text-muted-foreground">
                      {index + 1}. {file.name}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{selectedFile?.name}</p>
              )}
            </div>

            {/* Detection Status Banner */}
            {detection && (
              <div className={`flex items-start gap-3 rounded-lg p-3 ${
                detection.confidence === 'high'
                  ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                  : detection.confidence === 'medium'
                    ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                    : 'bg-muted'
              }`}>
                {detection.confidence === 'high' ? (
                  <Sparkles className="h-5 w-5 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                )}
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {detection.confidence === 'high'
                      ? 'Auto-detected'
                      : detection.confidence === 'medium'
                        ? 'Partially detected'
                        : 'Could not auto-detect'}
                  </p>
                  <p className="text-xs opacity-80">{detection.details}</p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Upload Type {autoDetected && detection?.confidence === 'high' && <Badge variant="secondary" className="ml-2 text-xs">Auto</Badge>}</Label>
              <Select value={uploadType} onValueChange={(value) => {
                setUploadType(value);
                setBankName('');
                setAccountId('');
                setAutoDetected(false);
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_statement">Bank Statement</SelectItem>
                  <SelectItem value="vyapar_report">Vyapar Report</SelectItem>
                  <SelectItem value="credit_card">Credit Card Statement</SelectItem>
                  <SelectItem value="home_loan_statement">Home Loan Statement</SelectItem>
                  <SelectItem value="cams_statement">CAMS Mutual Fund Statement</SelectItem>
                  <SelectItem value="etrade_portfolio">ETrade Portfolio</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* CAMS Password Input */}
            {uploadType === 'cams_statement' && (
              <div className="space-y-2">
                <Label>PDF Password</Label>
                <Input
                  type="password"
                  value={pdfPassword}
                  onChange={(e) => {
                    setPdfPassword(e.target.value);
                    setPasswordError('');
                  }}
                  placeholder="Enter PDF password"
                />
                {passwordError && (
                  <p className="text-sm text-destructive">{passwordError}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  CAMS statements are password protected. The password is usually your PAN (first 5 letters in caps) followed by Date of Birth (DDMMYYYY).
                </p>
              </div>
            )}

            {(uploadType === 'bank_statement' || uploadType === 'credit_card') && (
              <>
                <div className="space-y-2">
                  <Label>Bank {autoDetected && detection?.bankName && <Badge variant="secondary" className="ml-2 text-xs">Auto</Badge>}</Label>
                  <Select value={bankName} onValueChange={(value) => {
                    setBankName(value);
                    setAccountId(''); // Reset account when bank changes
                    // Try to auto-select account for the new bank
                    const matchedAccountId = findAccountForBank(value);
                    if (matchedAccountId) {
                      setAccountId(matchedAccountId);
                    }
                  }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select bank" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hdfc">HDFC Bank</SelectItem>
                      <SelectItem value="kotak">Kotak Mahindra Bank</SelectItem>
                      <SelectItem value="icici">ICICI Bank</SelectItem>
                      <SelectItem value="sbi">SBI</SelectItem>
                      <SelectItem value="axis">Axis Bank</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Account {autoDetected && accountId && <Badge variant="secondary" className="ml-2 text-xs">Auto</Badge>}</Label>
                  {noMatchingAccount && bankName && !accountId ? (
                    // No matching account - show create option
                    <div className="rounded-lg border border-dashed border-yellow-500/50 bg-yellow-500/10 p-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                            No {BANK_DISPLAY_NAMES[bankName] || bankName} account found
                          </p>
                          <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-1">
                            Create a new account to import these transactions
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={() => setShowCreateAccount(true)}
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            Create {BANK_DISPLAY_NAMES[bankName] || bankName} Account
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Select value={accountId} onValueChange={setAccountId} disabled={!bankName}>
                      <SelectTrigger>
                        <SelectValue placeholder={bankName ? "Select account" : "Select bank first"} />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts
                          .filter((a: Account) => {
                            if (!a.isActive) return false;
                            // Filter accounts based on selected bank
                            const bankNameLower = bankName.toLowerCase();
                            const accountBankLower = (a.bankName || '').toLowerCase();

                            // Match bank names
                            if (bankNameLower === 'hdfc' && accountBankLower.includes('hdfc')) return true;
                            if (bankNameLower === 'kotak' && accountBankLower.includes('kotak')) return true;
                            if (bankNameLower === 'icici' && accountBankLower.includes('icici')) return true;
                            if (bankNameLower === 'sbi' && (accountBankLower.includes('sbi') || accountBankLower.includes('state bank'))) return true;
                            if (bankNameLower === 'axis' && accountBankLower.includes('axis')) return true;
                            if (bankNameLower === 'other') return true; // Show all for "other"

                            return false;
                          })
                          .map((account: Account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.name} ({account.accountType})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetUpload}>
              Cancel
            </Button>
            <Button
              onClick={handlePreview}
              disabled={
                isPreviewing ||
                !uploadType ||
                ((uploadType === 'bank_statement' || uploadType === 'credit_card') &&
                  (!bankName || !accountId)) ||
                (uploadType === 'cams_statement' && !pdfPassword)
              }
            >
              {isPreviewing ? 'Loading...' : 'Preview'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={uploadStep === 'preview'} onOpenChange={(open) => !open && resetUpload()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Preview Import</DialogTitle>
          </DialogHeader>

          {previewData && (
            <div className="space-y-4">
              {uploadType === 'cams_statement' ? (
                /* CAMS Mutual Fund Preview */
                <>
                  <div className="rounded-lg bg-muted p-4 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Investor</span>
                      <span className="font-medium">{previewData.investorName || '-'}</span>
                    </div>
                    {previewData.email && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Email</span>
                        <span className="font-medium">{previewData.email}</span>
                      </div>
                    )}
                    {previewData.panNumber && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">PAN</span>
                        <span className="font-medium">{previewData.panNumber}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Holdings</span>
                      <span className="font-medium">{previewData.holdingsCount}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-blue-500/10 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Cost Value</p>
                      <p className="font-semibold text-blue-600">{formatCurrency(previewData.totalCostValue || 0)}</p>
                    </div>
                    <div className="rounded-lg bg-green-500/10 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Current Value</p>
                      <p className="font-semibold text-green-600">{formatCurrency(previewData.totalCurrentValue || 0)}</p>
                    </div>
                    <div className={`rounded-lg p-3 text-center ${previewData.totalAbsoluteReturn >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                      <p className="text-xs text-muted-foreground">Returns</p>
                      <p className={`font-semibold ${previewData.totalAbsoluteReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {previewData.totalAbsoluteReturn >= 0 ? '+' : ''}{previewData.totalAbsoluteReturnPercent?.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto rounded-lg border">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-muted">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium">Scheme</th>
                          <th className="px-3 py-2 text-right text-xs font-medium">Units</th>
                          <th className="px-3 py-2 text-right text-xs font-medium">Value</th>
                          <th className="px-3 py-2 text-right text-xs font-medium">Return</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y text-sm">
                        {previewData.holdings?.slice(0, 10).map((h: any, i: number) => (
                          <tr key={i}>
                            <td className="px-3 py-2">
                              <div className="max-w-[200px] truncate" title={h.schemeName}>
                                {h.schemeName}
                              </div>
                              <div className="text-xs text-muted-foreground">{h.amcName}</div>
                            </td>
                            <td className="px-3 py-2 text-right">{h.units?.toFixed(3)}</td>
                            <td className="px-3 py-2 text-right">{formatCurrency(h.currentValue)}</td>
                            <td className={`px-3 py-2 text-right ${h.absoluteReturnPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {h.absoluteReturnPercent >= 0 ? '+' : ''}{h.absoluteReturnPercent?.toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {previewData.holdingsCount > 10 && (
                    <p className="text-center text-sm text-muted-foreground">
                      Showing 10 of {previewData.holdingsCount} holdings
                    </p>
                  )}
                </>
              ) : uploadType === 'home_loan_statement' ? (
                /* Home Loan Preview */
                <>
                  {previewData.isUpdate && (
                    <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-3 mb-4">
                      <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                        Existing loan found - will update with latest data
                      </p>
                    </div>
                  )}
                  <div className="rounded-lg bg-muted p-4 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Agreement No.</span>
                      <span className="font-medium">{previewData.loan?.agreementNumber || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Borrower</span>
                      <span className="font-medium">{previewData.loan?.borrowerName || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Sanctioned Amount</span>
                      <span className="font-medium">{formatCurrency(previewData.loan?.sanctionedAmount || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Outstanding</span>
                      <span className="font-medium text-orange-600">{formatCurrency(previewData.loan?.outstandingAmount || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Interest Rate</span>
                      <span className="font-medium">{previewData.loan?.interestRate || 0}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">EMI Amount</span>
                      <span className="font-medium">{formatCurrency(previewData.loan?.emiAmount || 0)}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-green-500/10 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Principal Paid</p>
                      <p className="font-semibold text-green-600">{formatCurrency(previewData.summary?.totalPrincipalPaid || 0)}</p>
                    </div>
                    <div className="rounded-lg bg-blue-500/10 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Interest Paid</p>
                      <p className="font-semibold text-blue-600">{formatCurrency(previewData.summary?.totalInterestPaid || 0)}</p>
                    </div>
                    <div className="rounded-lg bg-purple-500/10 p-3 text-center">
                      <p className="text-xs text-muted-foreground">Payments</p>
                      <p className="font-semibold text-purple-600">{previewData.paymentCount || 0}</p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between rounded-lg bg-muted p-4">
                  <span>{uploadType === 'etrade_portfolio' ? 'Total Holdings' : 'Total Transactions'}</span>
                  <Badge>{uploadType === 'etrade_portfolio' ? previewData.holdingsCount : previewData.transactionCount}</Badge>
                </div>
              )}

              {uploadType === 'etrade_portfolio' && previewData.accountInfo && (
                <div className="flex items-center justify-between rounded-lg bg-green-500/10 p-4">
                  <span>Account Value</span>
                  <span className="font-semibold">{formatCurrency(previewData.accountInfo.netAccountValue)}</span>
                </div>
              )}

              {uploadType === 'vyapar_report' && previewData.itemDetails && previewData.itemDetails.count > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-lg bg-blue-500/10 p-4">
                    <span>Item Details (Expenses/Sales breakdown)</span>
                    <Badge variant="secondary">{previewData.itemDetails.count} items</Badge>
                  </div>
                  {previewData.itemDetails.categories && previewData.itemDetails.categories.length > 0 && (
                    <div className="rounded-lg bg-muted/50 p-3">
                      <span className="text-sm text-muted-foreground">Categories found: </span>
                      <span className="text-sm font-medium">{previewData.itemDetails.categories.join(', ')}</span>
                    </div>
                  )}
                </div>
              )}

              {uploadType !== 'home_loan_statement' && (
                <div className="max-h-[400px] overflow-y-auto rounded-lg border">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-muted">
                      {uploadType === 'etrade_portfolio' ? (
                        <tr>
                          <th className="px-4 py-2 text-left text-sm font-medium">Symbol</th>
                          <th className="px-4 py-2 text-right text-sm font-medium">Quantity</th>
                          <th className="px-4 py-2 text-right text-sm font-medium">Price</th>
                          <th className="px-4 py-2 text-right text-sm font-medium">Value</th>
                          <th className="px-4 py-2 text-right text-sm font-medium">Gain %</th>
                        </tr>
                      ) : (
                        <tr>
                          <th className="px-4 py-2 text-left text-sm font-medium">Date</th>
                          <th className="px-4 py-2 text-left text-sm font-medium">Description</th>
                          <th className="px-4 py-2 text-right text-sm font-medium">Amount</th>
                        </tr>
                      )}
                    </thead>
                    <tbody className="divide-y">
                      {uploadType === 'etrade_portfolio' ? (
                        previewData.preview?.map((holding: any, index: number) => (
                          <tr key={index}>
                            <td className="px-4 py-2 text-sm font-medium">{holding.symbol}</td>
                            <td className="px-4 py-2 text-right text-sm">{holding.quantity}</td>
                            <td className="px-4 py-2 text-right text-sm">{formatCurrency(holding.currentPrice)}</td>
                            <td className="px-4 py-2 text-right text-sm">{formatCurrency(holding.currentValue)}</td>
                            <td className={`px-4 py-2 text-right text-sm ${holding.totalGainPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {holding.totalGainPercent >= 0 ? '+' : ''}{holding.totalGainPercent.toFixed(2)}%
                            </td>
                          </tr>
                        ))
                      ) : (
                        previewData.preview?.map((txn: any, index: number) => (
                          <tr key={index}>
                            <td className="px-4 py-2 text-sm">{txn.date}</td>
                            <td className="px-4 py-2 text-sm">
                              {txn.narration || txn.description || txn.partyName || '-'}
                            </td>
                            <td className="px-4 py-2 text-right text-sm">
                              {formatCurrency(txn.amount)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {uploadType !== 'home_loan_statement' && ((uploadType === 'etrade_portfolio' && previewData.holdingsCount > 10) ||
                (uploadType !== 'etrade_portfolio' && previewData.transactionCount > 10)) && (
                <p className="text-center text-sm text-muted-foreground">
                  Showing first 10 of {uploadType === 'etrade_portfolio' ? previewData.holdingsCount : previewData.transactionCount} {uploadType === 'etrade_portfolio' ? 'holdings' : 'transactions'}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={resetUpload} disabled={isConfirming}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={isConfirming}>
              {isConfirming
                ? 'Importing...'
                : uploadType === 'etrade_portfolio'
                  ? `Import ${previewData?.holdingsCount} Holdings`
                  : uploadType === 'home_loan_statement'
                    ? previewData?.isUpdate ? 'Update Home Loan' : 'Import Home Loan'
                    : uploadType === 'cams_statement'
                      ? `Import ${previewData?.holdingsCount} Mutual Fund Holdings`
                      : uploadType === 'vyapar_report' && previewData?.itemDetails?.count > 0
                        ? `Import ${previewData?.transactionCount} Transactions + ${previewData.itemDetails.count} Items`
                        : `Import ${previewData?.transactionCount} Transactions`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Account Dialog */}
      <Dialog open={showCreateAccount} onOpenChange={setShowCreateAccount}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Account</DialogTitle>
            <DialogDescription>
              Create a {BANK_DISPLAY_NAMES[bankName] || bankName} account to import your transactions
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Account Name</Label>
              <Input
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder="e.g., ICICI Savings Account"
              />
            </div>

            <div className="space-y-2">
              <Label>Account Number (Optional)</Label>
              <Input
                value={newAccountNumber}
                onChange={(e) => setNewAccountNumber(e.target.value)}
                placeholder="Last 4 digits for reference"
              />
            </div>

            <div className="space-y-2">
              <Label>Account Type</Label>
              <Select value={newAccountType} onValueChange={(v) => setNewAccountType(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="savings">Savings Account</SelectItem>
                  <SelectItem value="current">Current Account</SelectItem>
                  <SelectItem value="credit_card">Credit Card</SelectItem>
                  <SelectItem value="loan">Loan Account</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateAccount(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateAccount}
              disabled={isCreatingAccount || !newAccountName}
            >
              {isCreatingAccount ? 'Creating...' : 'Create Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Smart Import Progress */}
      <SmartImportProgress
        isOpen={isSmartImporting}
        result={smartImportResult}
        onComplete={handleSmartImportComplete}
      />

      {/* Password Dialog for Protected PDFs */}
      <Dialog open={showPasswordDialog} onOpenChange={(open) => {
        if (!open) {
          setShowPasswordDialog(false);
          setPendingSmartImportFile(null);
          setSmartImportPassword('');
          setSmartImportPasswordError('');
          resetUpload();
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password Required</DialogTitle>
            <DialogDescription>
              This PDF is password protected. Please enter the password to continue.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>PDF Password</Label>
              <Input
                type="password"
                value={smartImportPassword}
                onChange={(e) => {
                  setSmartImportPassword(e.target.value);
                  setSmartImportPasswordError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && smartImportPassword) {
                    handleSmartImportWithPassword();
                  }
                }}
                placeholder="Enter PDF password"
                autoFocus
              />
              {smartImportPasswordError && (
                <p className="text-sm text-destructive">{smartImportPasswordError}</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Common password formats: PAN number (first 5 letters in caps + DOB as DDMMYYYY),
              or customer ID, or date of birth.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowPasswordDialog(false);
              setPendingSmartImportFile(null);
              setSmartImportPassword('');
              setSmartImportPasswordError('');
              resetUpload();
            }}>
              Cancel
            </Button>
            <Button
              onClick={handleSmartImportWithPassword}
              disabled={!smartImportPassword}
            >
              Unlock & Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

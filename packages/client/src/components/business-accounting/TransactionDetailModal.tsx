import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  FileText,
  Upload,
  Trash2,
  Eye,
  X,
  Save,
  Loader2,
  Plus,
  Check,
  Link2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { businessAccountingApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import type { BusinessTransaction, BizType, VendorPaymentHistory } from '@/types';

const BIZ_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'SALARY', label: 'Salary' },
  { value: 'PETROL', label: 'Petrol/Fuel' },
  { value: 'PORTER', label: 'Porter/Delivery' },
  { value: 'HELPER', label: 'Helper' },
  { value: 'VENDOR', label: 'Vendor Payment' },
  { value: 'SALES_INCOME', label: 'Sales Income' },
  { value: 'RENT', label: 'Rent' },
  { value: 'UTILITIES', label: 'Utilities' },
  { value: 'TRANSPORT', label: 'Transport' },
  { value: 'SUPPLIES', label: 'Supplies' },
  { value: 'MARKETING', label: 'Marketing' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
];

interface TransactionDetailModalProps {
  transaction: BusinessTransaction;
  onClose: () => void;
  onUpdate: () => void;
}

export function TransactionDetailModal({
  transaction,
  onClose,
  onUpdate,
}: TransactionDetailModalProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    bizType: transaction.bizType || 'OTHER',
    bizDescription: transaction.bizDescription || '',
    vendorName: transaction.vendorName || '',
    needsInvoice: transaction.needsInvoice || false,
    gstAmount: transaction.gstAmount || 0,
    cgstAmount: transaction.cgstAmount || 0,
    sgstAmount: transaction.sgstAmount || 0,
    igstAmount: transaction.igstAmount || 0,
    gstType: transaction.gstType || null,
    notes: transaction.notes || '',
  });

  const [isDirty, setIsDirty] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showCustomType, setShowCustomType] = useState(false);
  const [customType, setCustomType] = useState('');
  const [extractedInfo, setExtractedInfo] = useState<{
    gstAmount?: number;
    cgstAmount?: number;
    sgstAmount?: number;
    igstAmount?: number;
    invoiceNumber?: string;
    invoiceDate?: string;
    gstinVendor?: string;
  } | null>(null);

  // Fetch all matching transactions (full history based on narration pattern)
  const { data: matchingData } = useQuery<{
    transaction: any;
    matches: Array<{
      month: string;
      transactions: any[];
      totalAmount: number;
      creditAmount: number;
      debitAmount: number;
    }>;
    summary: {
      totalMatches: number;
      totalCredit: number;
      totalDebit: number;
      firstDate: string | null;
      lastDate: string | null;
    };
    extractedKey: string | null;
    extractedNames: string[];
  }>({
    queryKey: ['matching-transactions', transaction.id],
    queryFn: () => businessAccountingApi.getMatchingTransactions(transaction.id),
  });

  // Fetch unlinked invoices for this vendor (only if no invoice attached)
  const vendorName = formData.vendorName || transaction.vendorName;
  const { data: vendorInvoices, refetch: refetchVendorInvoices } = useQuery<any[]>({
    queryKey: ['vendor-invoices', vendorName],
    queryFn: () => businessAccountingApi.getInvoicesByVendor(vendorName || ''),
    enabled: !transaction.invoiceFileId && !!vendorName,
  });

  // Link invoice mutation
  const linkInvoiceMutation = useMutation({
    mutationFn: (invoiceId: string) =>
      businessAccountingApi.linkInvoice(invoiceId, transaction.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['gst-invoices'] });
      onUpdate();
    },
  });

  const [propagatedMessage, setPropagatedMessage] = useState<string | null>(null);

  // Update transaction mutation
  const updateMutation = useMutation({
    mutationFn: () => businessAccountingApi.updateTransaction(transaction.id, formData),
    onSuccess: (data: any) => {
      setIsDirty(false);
      if (data.propagatedCount && data.propagatedCount > 0) {
        setPropagatedMessage(`Updated ${data.propagatedCount} similar transaction${data.propagatedCount > 1 ? 's' : ''}`);
        setTimeout(() => setPropagatedMessage(null), 5000);
      }
      onUpdate();
    },
  });

  // Upload invoice mutation
  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      businessAccountingApi.uploadInvoice(transaction.id, file, {
        vendorName: formData.vendorName,
        gstAmount: formData.gstAmount,
      }),
    onSuccess: (data) => {
      setSelectedFile(null);
      // Update form with extracted GST info if available
      if (data.extracted) {
        setExtractedInfo(data.extracted);
        const { gstAmount, cgstAmount, sgstAmount, igstAmount } = data.extracted;
        const totalGst = gstAmount || ((cgstAmount || 0) + (sgstAmount || 0) + (igstAmount || 0));
        if (totalGst > 0 || cgstAmount || sgstAmount || igstAmount) {
          setFormData(prev => ({
            ...prev,
            gstAmount: totalGst,
            cgstAmount: cgstAmount || 0,
            sgstAmount: sgstAmount || 0,
            igstAmount: igstAmount || 0,
            gstType: 'input',
          }));
          setIsDirty(true);
        }
      }
      onUpdate();
    },
  });

  // Delete invoice mutation
  const deleteMutation = useMutation({
    mutationFn: () => businessAccountingApi.deleteInvoice(transaction.invoiceFileId!),
    onSuccess: () => {
      onUpdate();
    },
  });

  const handleChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
  };

  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
      if (allowedTypes.includes(file.type)) {
        setSelectedFile(file);
      }
    }
  }, []);

  const handleUpload = () => {
    if (selectedFile) {
      uploadMutation.mutate(selectedFile);
    }
  };

  const handleSave = () => {
    updateMutation.mutate();
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transaction Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Original Transaction Info */}
          <div className="rounded-lg border p-4 bg-muted/50">
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Date</span>
                <span className="font-medium">
                  {transaction.date ? format(new Date(transaction.date), 'dd MMM yyyy') : '-'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span
                  className={`font-medium ${
                    transaction.transactionType === 'credit' ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {transaction.transactionType === 'credit' ? '+' : '-'}
                  {formatCurrency(transaction.amount)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Original Narration</span>
                <p className="mt-1 text-xs bg-background p-2 rounded border break-all">
                  {transaction.narration}
                </p>
              </div>
            </div>
          </div>

          {/* Business Details Form */}
          <div className="space-y-4">
            <h3 className="font-semibold">Business Details</h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bizType">Type</Label>
                {showCustomType ? (
                  <div className="flex gap-2">
                    <Input
                      value={customType}
                      onChange={(e) => setCustomType(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                      placeholder="e.g. PACKAGING"
                      className="flex-1"
                      autoFocus
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={() => {
                        if (customType.trim()) {
                          handleChange('bizType', customType.trim());
                          setShowCustomType(false);
                          setCustomType('');
                        }
                      }}
                      disabled={!customType.trim()}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setShowCustomType(false);
                        setCustomType('');
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Select
                      value={BIZ_TYPE_OPTIONS.find(o => o.value === formData.bizType) ? formData.bizType : ''}
                      onValueChange={(value) => handleChange('bizType', value)}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={formData.bizType || 'Select type'} />
                      </SelectTrigger>
                      <SelectContent>
                        {BIZ_TYPE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={() => setShowCustomType(true)}
                      title="Add custom type"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {formData.bizType && !BIZ_TYPE_OPTIONS.find(o => o.value === formData.bizType) && (
                  <p className="text-xs text-muted-foreground">
                    Custom type: {formData.bizType}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="vendorName">Vendor Name</Label>
                <Input
                  id="vendorName"
                  value={formData.vendorName}
                  onChange={(e) => handleChange('vendorName', e.target.value)}
                  placeholder="Enter vendor name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bizDescription">Description (for CA)</Label>
              <Textarea
                id="bizDescription"
                value={formData.bizDescription}
                onChange={(e) => handleChange('bizDescription', e.target.value)}
                placeholder="Enter business description"
                rows={2}
              />
            </div>

            {/* GST Details */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">GST Details</Label>
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label htmlFor="cgstAmount" className="text-xs text-muted-foreground">CGST</Label>
                  <Input
                    id="cgstAmount"
                    type="number"
                    value={formData.cgstAmount || ''}
                    onChange={(e) => {
                      const cgst = parseFloat(e.target.value) || 0;
                      handleChange('cgstAmount', cgst);
                      // Auto-calculate total
                      const total = cgst + (formData.sgstAmount || 0) + (formData.igstAmount || 0);
                      setFormData(prev => ({ ...prev, gstAmount: total }));
                    }}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sgstAmount" className="text-xs text-muted-foreground">SGST</Label>
                  <Input
                    id="sgstAmount"
                    type="number"
                    value={formData.sgstAmount || ''}
                    onChange={(e) => {
                      const sgst = parseFloat(e.target.value) || 0;
                      handleChange('sgstAmount', sgst);
                      // Auto-calculate total
                      const total = (formData.cgstAmount || 0) + sgst + (formData.igstAmount || 0);
                      setFormData(prev => ({ ...prev, gstAmount: total }));
                    }}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="igstAmount" className="text-xs text-muted-foreground">IGST</Label>
                  <Input
                    id="igstAmount"
                    type="number"
                    value={formData.igstAmount || ''}
                    onChange={(e) => {
                      const igst = parseFloat(e.target.value) || 0;
                      handleChange('igstAmount', igst);
                      // Auto-calculate total
                      const total = (formData.cgstAmount || 0) + (formData.sgstAmount || 0) + igst;
                      setFormData(prev => ({ ...prev, gstAmount: total }));
                    }}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gstAmount" className="text-xs text-muted-foreground">Total GST</Label>
                  <Input
                    id="gstAmount"
                    type="number"
                    value={formData.gstAmount || ''}
                    onChange={(e) => handleChange('gstAmount', parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="font-medium"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="gstType">GST Type</Label>
                <Select
                  value={formData.gstType || 'none'}
                  onValueChange={(value) => handleChange('gstType', value === 'none' ? null : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="input">Input (Purchase)</SelectItem>
                    <SelectItem value="output">Output (Sale)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="needsInvoice"
                checked={formData.needsInvoice}
                onCheckedChange={(checked) => handleChange('needsInvoice', checked)}
              />
              <Label htmlFor="needsInvoice">Needs Invoice</Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => handleChange('notes', e.target.value)}
                placeholder="Additional notes..."
                rows={2}
              />
            </div>

            <div className="flex items-center gap-4">
              {isDirty && (
                <Button onClick={handleSave} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save Changes
                </Button>
              )}
              {propagatedMessage && (
                <span className="text-sm text-green-600 dark:text-green-400 animate-in fade-in">
                  ✓ {propagatedMessage}
                </span>
              )}
            </div>
          </div>

          {/* Invoice Section */}
          <div className="space-y-4">
            <h3 className="font-semibold">Invoice</h3>

            {transaction.invoiceFileId ? (
              <>
                <Card>
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <FileText className="h-8 w-8 text-blue-500" />
                      <div>
                        <p className="font-medium">Invoice Attached</p>
                        <p className="text-sm text-muted-foreground">Click to view</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          window.open(
                            businessAccountingApi.getInvoiceUrl(transaction.invoiceFileId!),
                            '_blank'
                          )
                        }
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deleteMutation.mutate()}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Show extracted GST info */}
                {extractedInfo && (extractedInfo.gstAmount || extractedInfo.cgstAmount || extractedInfo.sgstAmount) && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
                    <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-2">
                      GST Extracted from Invoice
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {extractedInfo.cgstAmount && (
                        <div>
                          <span className="text-muted-foreground">CGST:</span>{' '}
                          <span className="font-medium">{formatCurrency(extractedInfo.cgstAmount)}</span>
                        </div>
                      )}
                      {extractedInfo.sgstAmount && (
                        <div>
                          <span className="text-muted-foreground">SGST:</span>{' '}
                          <span className="font-medium">{formatCurrency(extractedInfo.sgstAmount)}</span>
                        </div>
                      )}
                      {extractedInfo.igstAmount && (
                        <div>
                          <span className="text-muted-foreground">IGST:</span>{' '}
                          <span className="font-medium">{formatCurrency(extractedInfo.igstAmount)}</span>
                        </div>
                      )}
                      {extractedInfo.gstAmount && (
                        <div>
                          <span className="text-muted-foreground">Total GST:</span>{' '}
                          <span className="font-medium">{formatCurrency(extractedInfo.gstAmount)}</span>
                        </div>
                      )}
                      {extractedInfo.gstinVendor && (
                        <div className="col-span-2">
                          <span className="text-muted-foreground">Vendor GSTIN:</span>{' '}
                          <span className="font-medium font-mono">{extractedInfo.gstinVendor}</span>
                        </div>
                      )}
                      {extractedInfo.invoiceNumber && (
                        <div>
                          <span className="text-muted-foreground">Invoice #:</span>{' '}
                          <span className="font-medium">{extractedInfo.invoiceNumber}</span>
                        </div>
                      )}
                      {extractedInfo.invoiceDate && (
                        <div>
                          <span className="text-muted-foreground">Date:</span>{' '}
                          <span className="font-medium">{extractedInfo.invoiceDate}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <Card
                className={`border-dashed transition-colors ${
                  isDragging
                    ? 'border-primary bg-primary/5 border-2'
                    : 'hover:border-muted-foreground/50'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col items-center gap-4">
                    {selectedFile ? (
                      <div className="flex items-center gap-4 w-full">
                        <FileText className="h-8 w-8 text-blue-500" />
                        <div className="flex-1">
                          <p className="font-medium">{selectedFile.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {(selectedFile.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedFile(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <label
                        className={`flex flex-col items-center gap-2 cursor-pointer p-4 w-full text-center rounded-lg transition-colors ${
                          isDragging ? 'pointer-events-none' : ''
                        }`}
                      >
                        <Upload className={`h-8 w-8 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span className={`text-sm ${isDragging ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                          {isDragging ? 'Drop invoice here' : 'Drag & drop or click to upload (PDF, JPG, PNG)'}
                        </span>
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          className="hidden"
                          onChange={handleFileChange}
                        />
                      </label>
                    )}
                    {selectedFile && (
                      <Button onClick={handleUpload} disabled={uploadMutation.isPending}>
                        {uploadMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="mr-2 h-4 w-4" />
                        )}
                        Upload Invoice
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Show unlinked invoices from same vendor */}
            {!transaction.invoiceFileId && vendorInvoices && vendorInvoices.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Unlinked invoices from {vendorName}:
                </p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {vendorInvoices.map((invoice: any) => (
                    <div
                      key={invoice.id}
                      className="flex items-center justify-between p-2 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {invoice.invoiceNumber || 'No Invoice #'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {invoice.invoiceDate ? format(new Date(invoice.invoiceDate), 'dd MMM yyyy') : '-'} • {formatCurrency(invoice.totalAmount || 0)}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {invoice.filename && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              window.open(
                                businessAccountingApi.getInvoiceUrl(invoice.id),
                                '_blank'
                              )
                            }
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => linkInvoiceMutation.mutate(invoice.id)}
                          disabled={linkInvoiceMutation.isPending}
                        >
                          {linkInvoiceMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Link2 className="h-4 w-4" />
                          )}
                          <span className="ml-1">Link</span>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Matching Transaction History */}
          {matchingData && matchingData.matches.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">
                  Similar Transactions
                  {matchingData.extractedNames.length > 0 && (
                    <span className="font-normal text-muted-foreground ml-2 text-sm">
                      ({matchingData.extractedNames.join(', ')})
                    </span>
                  )}
                </h3>
                <span className="text-sm text-muted-foreground">
                  {matchingData.summary.totalMatches} found
                </span>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-green-50 dark:bg-green-950 p-2">
                  <p className="text-xs text-muted-foreground">Total Received</p>
                  <p className="font-semibold text-green-600 dark:text-green-400">
                    {formatCurrency(matchingData.summary.totalCredit)}
                  </p>
                </div>
                <div className="rounded-lg bg-red-50 dark:bg-red-950 p-2">
                  <p className="text-xs text-muted-foreground">Total Paid</p>
                  <p className="font-semibold text-red-600 dark:text-red-400">
                    {formatCurrency(matchingData.summary.totalDebit)}
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <p className="text-xs text-muted-foreground">Net</p>
                  <p className={`font-semibold ${
                    matchingData.summary.totalCredit - matchingData.summary.totalDebit >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {formatCurrency(matchingData.summary.totalCredit - matchingData.summary.totalDebit)}
                  </p>
                </div>
              </div>

              {/* Monthly breakdown */}
              <Card>
                <CardContent className="p-0 max-h-64 overflow-y-auto">
                  <div className="divide-y">
                    {matchingData.matches.map((monthData) => (
                      <div key={monthData.month} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-medium">
                            {monthData.month ? format(new Date(monthData.month + '-01'), 'MMM yyyy') : '-'}
                          </p>
                          <div className="flex gap-3 text-sm">
                            {monthData.creditAmount > 0 && (
                              <span className="text-green-600 dark:text-green-400">
                                +{formatCurrency(monthData.creditAmount)}
                              </span>
                            )}
                            {monthData.debitAmount > 0 && (
                              <span className="text-red-600 dark:text-red-400">
                                -{formatCurrency(monthData.debitAmount)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-1">
                          {monthData.transactions.slice(0, 3).map((t: any) => (
                            <div key={t.id} className="flex justify-between">
                              <span className="truncate flex-1 mr-2">
                                {t.date ? format(new Date(t.date), 'dd MMM') : '-'}: {t.bizDescription || t.narration.substring(0, 40)}
                              </span>
                              <span className={t.transactionType === 'credit' ? 'text-green-600' : 'text-red-600'}>
                                {t.transactionType === 'credit' ? '+' : '-'}{formatCurrency(t.amount)}
                              </span>
                            </div>
                          ))}
                          {monthData.transactions.length > 3 && (
                            <p className="text-muted-foreground/70">
                              +{monthData.transactions.length - 3} more
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

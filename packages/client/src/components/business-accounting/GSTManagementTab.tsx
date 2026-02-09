import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Plus,
  Upload,
  FileText,
  Trash2,
  Edit2,
  Check,
  X,
  ArrowUp,
  ArrowDown,
  CheckSquare,
  Square,
  Wrench,
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  Link2,
  Search,
  Filter,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { businessAccountingApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import type { BusinessInvoice, GSTLedger } from '@/types';

interface GSTManagementTabProps {
  startDate: string;
  endDate: string;
}

export function GSTManagementTab({ startDate, endDate }: GSTManagementTabProps) {
  const queryClient = useQueryClient();
  const [activeSubTab, setActiveSubTab] = useState('ledger');
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<BusinessInvoice | null>(null);
  const [bulkGstType, setBulkGstType] = useState<string>('');

  // Fetch GST ledger
  const { data: ledger, isLoading: ledgerLoading } = useQuery<GSTLedger>({
    queryKey: ['gst-ledger', startDate, endDate],
    queryFn: () => businessAccountingApi.getGSTLedger({ startDate, endDate }),
  });

  // Fetch all GST invoices
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<BusinessInvoice[]>({
    queryKey: ['gst-invoices', startDate, endDate],
    queryFn: () => businessAccountingApi.getGSTInvoices({ startDate, endDate }),
  });

  // Mutations
  const deleteMutation = useMutation({
    mutationFn: (id: string) => businessAccountingApi.deleteGSTInvoice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gst-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['gst-ledger'] });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: ({ ids, updates }: { ids: string[]; updates: any }) =>
      businessAccountingApi.bulkUpdateGSTInvoices(ids, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gst-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['gst-ledger'] });
      setSelectedInvoices(new Set());
      setBulkGstType('');
    },
  });

  const fixInvoicesMutation = useMutation({
    mutationFn: () => businessAccountingApi.fixOldInvoices(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['gst-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['gst-ledger'] });
      alert(`Fixed ${data.fixed} invoices`);
    },
  });

  const autoMatchMutation = useMutation({
    mutationFn: () => businessAccountingApi.autoMatchInvoices(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['gst-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['gst-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['business-transactions'] });
      if (data.matched > 0) {
        alert(`Matched ${data.matched} invoices to transactions!\n\n${data.details?.map((d: any) => `• ${d.invoiceNumber || 'Invoice'} → ${d.partyName}`).join('\n') || ''}`);
      } else {
        alert('No invoices could be matched. Try uploading invoices with matching vendor names and amounts.');
      }
    },
  });

  const csvInputRef = useRef<HTMLInputElement>(null);
  const importCSVMutation = useMutation({
    mutationFn: (file: File) => businessAccountingApi.importAmazonCSV(file),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['gst-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['gst-ledger'] });
      alert(`Imported ${data.summary.itemCount} items from Amazon\nTotal GST: ₹${data.summary.totalGST.toFixed(2)}`);
    },
    onError: (error: any) => {
      alert(`Import failed: ${error.response?.data?.error || error.message}`);
    },
  });

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      importCSVMutation.mutate(file);
      e.target.value = ''; // Reset input
    }
  };

  const inputInvoices = useMemo(() => invoices.filter(i => i.gstType === 'input'), [invoices]);
  const outputInvoices = useMemo(() => invoices.filter(i => i.gstType === 'output'), [invoices]);

  const toggleInvoice = (id: string) => {
    const newSet = new Set(selectedInvoices);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedInvoices(newSet);
  };

  const selectAll = (type: 'input' | 'output') => {
    const list = type === 'input' ? inputInvoices : outputInvoices;
    const allSelected = list.every(i => selectedInvoices.has(i.id));
    const newSet = new Set(selectedInvoices);
    if (allSelected) {
      list.forEach(i => newSet.delete(i.id));
    } else {
      list.forEach(i => newSet.add(i.id));
    }
    setSelectedInvoices(newSet);
  };

  const handleBulkUpdate = () => {
    if (selectedInvoices.size === 0 || !bulkGstType) return;
    bulkUpdateMutation.mutate({
      ids: Array.from(selectedInvoices),
      updates: { gstType: bulkGstType },
    });
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ArrowDown className="h-4 w-4 text-green-500" />
              Input GST (Credit)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(ledger?.inputTotals.totalGst || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {ledger?.inputTotals.count || 0} invoices
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ArrowUp className="h-4 w-4 text-red-500" />
              Output GST (Liability)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatCurrency(ledger?.outputTotals.totalGst || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {ledger?.outputTotals.count || 0} invoices
            </p>
          </CardContent>
        </Card>

        <Card className={ledger?.netLiability.status === 'payable' ? 'border-red-200' : 'border-green-200'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Net GST Position</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${
              ledger?.netLiability.status === 'payable' ? 'text-red-600' : 'text-green-600'
            }`}>
              {formatCurrency(Math.abs(ledger?.netLiability.total || 0))}
            </div>
            <Badge variant={ledger?.netLiability.status === 'payable' ? 'destructive' : 'default'}>
              {ledger?.netLiability.status === 'payable' ? 'To Pay' : 'Credit Available'}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogTrigger asChild>
                <Button size="sm" className="w-full">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Invoice
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <AddGSTInvoiceForm
                  onSuccess={() => {
                    setShowAddDialog(false);
                    queryClient.invalidateQueries({ queryKey: ['gst-invoices'] });
                    queryClient.invalidateQueries({ queryKey: ['gst-ledger'] });
                  }}
                />
              </DialogContent>
            </Dialog>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => autoMatchMutation.mutate()}
              disabled={autoMatchMutation.isPending}
            >
              <Link2 className="mr-2 h-4 w-4" />
              {autoMatchMutation.isPending ? 'Matching...' : 'Auto-Match Invoices'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => fixInvoicesMutation.mutate()}
              disabled={fixInvoicesMutation.isPending}
            >
              <Wrench className="mr-2 h-4 w-4" />
              {fixInvoicesMutation.isPending ? 'Fixing...' : 'Fix Old Invoices'}
            </Button>
            <input
              type="file"
              ref={csvInputRef}
              accept=".csv"
              className="hidden"
              onChange={handleCSVUpload}
            />
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => csvInputRef.current?.click()}
              disabled={importCSVMutation.isPending}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              {importCSVMutation.isPending ? 'Importing...' : 'Import Amazon CSV'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Sub-tabs */}
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList>
          <TabsTrigger value="ledger">GST Ledger</TabsTrigger>
          <TabsTrigger value="input">Input Invoices ({inputInvoices.length})</TabsTrigger>
          <TabsTrigger value="output">Output Invoices ({outputInvoices.length})</TabsTrigger>
        </TabsList>

        {/* Ledger Tab */}
        <TabsContent value="ledger" className="space-y-4">
          {/* Monthly breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly GST Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Month</th>
                      <th className="text-right py-2 px-3">Input GST</th>
                      <th className="text-right py-2 px-3">Output GST</th>
                      <th className="text-right py-2 px-3">Net</th>
                      <th className="text-center py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger?.months.map((month) => (
                      <tr key={month.month} className="border-b">
                        <td className="py-2 px-3 font-medium">
                          {month.month !== 'unknown' ? format(new Date(month.month + '-01'), 'MMM yyyy') : 'Unknown'}
                        </td>
                        <td className="py-2 px-3 text-right text-green-600">
                          {formatCurrency(month.input.totalGst)}
                          <span className="text-xs text-muted-foreground ml-1">({month.input.count})</span>
                        </td>
                        <td className="py-2 px-3 text-right text-red-600">
                          {formatCurrency(month.output.totalGst)}
                          <span className="text-xs text-muted-foreground ml-1">({month.output.count})</span>
                        </td>
                        <td className={`py-2 px-3 text-right font-medium ${month.net > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {formatCurrency(Math.abs(month.net))}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <Badge variant={month.net > 0 ? 'destructive' : 'default'} className="text-xs">
                            {month.net > 0 ? 'Pay' : 'Credit'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/50 font-medium">
                      <td className="py-2 px-3">Total</td>
                      <td className="py-2 px-3 text-right text-green-600">
                        {formatCurrency(ledger?.inputTotals.totalGst || 0)}
                      </td>
                      <td className="py-2 px-3 text-right text-red-600">
                        {formatCurrency(ledger?.outputTotals.totalGst || 0)}
                      </td>
                      <td className={`py-2 px-3 text-right ${
                        (ledger?.netLiability.total || 0) > 0 ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {formatCurrency(Math.abs(ledger?.netLiability.total || 0))}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <Badge variant={ledger?.netLiability.status === 'payable' ? 'destructive' : 'default'}>
                          {ledger?.netLiability.status === 'payable' ? 'To Pay' : 'Credit'}
                        </Badge>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* CGST/SGST/IGST breakdown */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Input Tax Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">CGST:</span>
                    <span className="font-medium">{formatCurrency(ledger?.inputTotals.cgst || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">SGST:</span>
                    <span className="font-medium">{formatCurrency(ledger?.inputTotals.sgst || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">IGST:</span>
                    <span className="font-medium">{formatCurrency(ledger?.inputTotals.igst || 0)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="font-medium">Total Input:</span>
                    <span className="font-bold text-green-600">{formatCurrency(ledger?.inputTotals.totalGst || 0)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Output Tax Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">CGST:</span>
                    <span className="font-medium">{formatCurrency(ledger?.outputTotals.cgst || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">SGST:</span>
                    <span className="font-medium">{formatCurrency(ledger?.outputTotals.sgst || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">IGST:</span>
                    <span className="font-medium">{formatCurrency(ledger?.outputTotals.igst || 0)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="font-medium">Total Output:</span>
                    <span className="font-bold text-red-600">{formatCurrency(ledger?.outputTotals.totalGst || 0)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Input Invoices Tab */}
        <TabsContent value="input" className="space-y-4">
          <InvoiceList
            invoices={inputInvoices}
            type="input"
            selectedInvoices={selectedInvoices}
            onToggle={toggleInvoice}
            onSelectAll={() => selectAll('input')}
            onDelete={(id) => deleteMutation.mutate(id)}
            onEdit={setEditingInvoice}
            onUploadSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['gst-invoices'] });
              queryClient.invalidateQueries({ queryKey: ['gst-ledger'] });
            }}
          />
        </TabsContent>

        {/* Output Invoices Tab */}
        <TabsContent value="output" className="space-y-4">
          <InvoiceList
            invoices={outputInvoices}
            type="output"
            selectedInvoices={selectedInvoices}
            onToggle={toggleInvoice}
            onSelectAll={() => selectAll('output')}
            onDelete={(id) => deleteMutation.mutate(id)}
            onEdit={setEditingInvoice}
            onUploadSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['gst-invoices'] });
              queryClient.invalidateQueries({ queryKey: ['gst-ledger'] });
            }}
          />
        </TabsContent>
      </Tabs>

      {/* Bulk Actions Bar */}
      {selectedInvoices.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-background border rounded-lg shadow-lg p-4 flex items-center gap-4">
          <span className="text-sm font-medium">{selectedInvoices.size} selected</span>
          <Select value={bulkGstType} onValueChange={setBulkGstType}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Change type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="input">Input</SelectItem>
              <SelectItem value="output">Output</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={handleBulkUpdate}
            disabled={!bulkGstType || bulkUpdateMutation.isPending}
          >
            Apply
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedInvoices(new Set())}>
            Cancel
          </Button>
        </div>
      )}

      {/* Edit Invoice Dialog */}
      {editingInvoice && (
        <Dialog open={!!editingInvoice} onOpenChange={() => setEditingInvoice(null)}>
          <DialogContent className="max-w-lg">
            <EditGSTInvoiceForm
              invoice={editingInvoice}
              onSuccess={() => {
                setEditingInvoice(null);
                queryClient.invalidateQueries({ queryKey: ['gst-invoices'] });
                queryClient.invalidateQueries({ queryKey: ['gst-ledger'] });
              }}
              onCancel={() => setEditingInvoice(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// Quick Upload Component
interface UploadResult {
  file: string;
  status: 'success' | 'duplicate' | 'error';
  invoiceNumber?: string;
  partyName?: string;
  amount?: number;
  error?: string;
  autoMatched?: boolean;
}

function QuickUploadSection({
  type,
  onSuccess,
}: {
  type: 'input' | 'output';
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isCSV = (f: File) => f.type === 'text/csv' || f.name.toLowerCase().endsWith('.csv');
  const isPDF = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
  const isImage = (f: File) => f.type.startsWith('image/') || /\.(jpg|jpeg|png|gif)$/i.test(f.name);
  const isValidFile = (f: File) => isPDF(f) || isImage(f) || isCSV(f);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    const validFiles = droppedFiles.filter(isValidFile);
    const invalidCount = droppedFiles.length - validFiles.length;

    if (invalidCount > 0) {
      alert(`${invalidCount} file(s) skipped - only PDF, images, and CSV files are supported.`);
    }

    setFiles(prev => [...prev, ...validFiles]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const validFiles = selectedFiles.filter(isValidFile);
    setFiles(prev => [...prev, ...validFiles]);
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearFiles = () => {
    setFiles([]);
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setIsUploading(true);
    setUploadProgress({ current: 0, total: files.length });
    setUploadResults([]);

    const results: UploadResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress({ current: i + 1, total: files.length });

      try {
        // Handle CSV files differently - import as Amazon orders
        if (isCSV(file)) {
          const result = await businessAccountingApi.importAmazonCSV(file);
          results.push({
            file: file.name,
            status: 'success',
            invoiceNumber: `Amazon CSV (${result.summary.itemCount} items)`,
            amount: result.summary.totalGST,
          });
          continue;
        }

        // Regular PDF/image upload
        const formData = new FormData();
        formData.append('file', file);
        formData.append('gstType', type);
        formData.append('invoiceDate', format(new Date(), 'yyyy-MM-dd'));

        const result = await businessAccountingApi.createGSTInvoice(formData);
        results.push({
          file: file.name,
          status: 'success',
          invoiceNumber: result.invoiceNumber || 'N/A',
          partyName: result.partyName || 'Unknown',
          amount: result.totalAmount || 0,
          autoMatched: result.autoMatched || false,
        });
      } catch (error: any) {
        if (error.response?.status === 409) {
          const data = error.response.data;
          results.push({
            file: file.name,
            status: 'duplicate',
            invoiceNumber: data.error?.match(/#([^\s]+)/)?.[1] || 'Unknown',
            partyName: data.existingPartyName || 'Unknown',
          });
        } else {
          results.push({
            file: file.name,
            status: 'error',
            error: error.response?.data?.error || error.message || 'Upload failed',
          });
        }
      }
    }

    setUploadResults(results);
    setShowResults(true);
    setIsUploading(false);
    setFiles([]);

    // Refresh data
    queryClient.invalidateQueries({ queryKey: ['gst-invoices'] });
    queryClient.invalidateQueries({ queryKey: ['gst-ledger'] });
    onSuccess();
  };

  const successCount = uploadResults.filter(r => r.status === 'success').length;
  const duplicateCount = uploadResults.filter(r => r.status === 'duplicate').length;
  const errorCount = uploadResults.filter(r => r.status === 'error').length;

  return (
    <>
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Upload {type === 'input' ? 'Purchase' : 'Sales'} Invoices
            {files.length > 0 && (
              <Badge variant="secondary" className="ml-2">{files.length} file{files.length > 1 ? 's' : ''}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Drop zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.csv"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <div className="text-sm text-muted-foreground">
                Drop files here or <span className="text-primary underline">browse</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                PDF, Images, or Amazon CSV • Multiple files supported
              </div>
            </div>

            {/* Selected files list */}
            {files.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Selected Files</span>
                  <Button variant="ghost" size="sm" onClick={clearFiles} className="h-6 text-xs">
                    Clear All
                  </Button>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1 bg-muted/30 rounded-lg p-2">
                  {files.map((file, index) => (
                    <div key={index} className="flex items-center gap-2 p-1.5 bg-background rounded">
                      {isCSV(file) ? (
                        <FileSpreadsheet className="h-4 w-4 text-green-600 flex-shrink-0" />
                      ) : (
                        <FileText className="h-4 w-4 text-blue-600 flex-shrink-0" />
                      )}
                      <span className="text-sm truncate flex-1">{file.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(0)} KB
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(index)}
                        className="h-6 w-6 p-0"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upload button */}
            {files.length > 0 && (
              <Button
                onClick={handleUpload}
                disabled={isUploading}
                className="w-full"
              >
                {isUploading ? (
                  <>Uploading {uploadProgress.current} of {uploadProgress.total}...</>
                ) : (
                  <>Upload {files.length} Invoice{files.length > 1 ? 's' : ''}</>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Upload Results Modal */}
      {showResults && uploadResults.length > 0 && (
        <Dialog open={showResults} onOpenChange={setShowResults}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                Upload Summary
              </DialogTitle>
            </DialogHeader>

            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-600">{successCount}</div>
                <div className="text-xs text-green-700">Imported</div>
              </div>
              <div className="bg-amber-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-amber-600">{duplicateCount}</div>
                <div className="text-xs text-amber-700">Duplicates</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-600">{errorCount}</div>
                <div className="text-xs text-red-700">Errors</div>
              </div>
            </div>

            {/* Detailed Results */}
            <div className="max-h-64 overflow-y-auto space-y-2">
              {uploadResults.map((result, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-lg border ${
                    result.status === 'success' ? 'bg-green-50 border-green-200' :
                    result.status === 'duplicate' ? 'bg-amber-50 border-amber-200' :
                    'bg-red-50 border-red-200'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {result.status === 'success' ? (
                      <Check className="h-4 w-4 text-green-600 mt-0.5" />
                    ) : result.status === 'duplicate' ? (
                      <FileText className="h-4 w-4 text-amber-600 mt-0.5" />
                    ) : (
                      <X className="h-4 w-4 text-red-600 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{result.file}</div>
                      {result.status === 'success' && (
                        <div className="text-xs text-muted-foreground">
                          {result.invoiceNumber} • {result.partyName}
                          {result.amount ? ` • ${formatCurrency(result.amount)}` : ''}
                          {result.autoMatched && (
                            <span className="ml-2 text-blue-600 font-medium">✓ Auto-linked to transaction</span>
                          )}
                        </div>
                      )}
                      {result.status === 'duplicate' && (
                        <div className="text-xs text-amber-700">
                          Already exists: #{result.invoiceNumber} - {result.partyName}
                        </div>
                      )}
                      {result.status === 'error' && (
                        <div className="text-xs text-red-700">{result.error}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end mt-4">
              <Button onClick={() => setShowResults(false)}>Close</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// Invoice Preview Modal
function InvoicePreviewModal({
  invoice,
  onClose,
  onEdit,
}: {
  invoice: BusinessInvoice;
  onClose: () => void;
  onEdit: () => void;
}) {
  const hasFile = invoice.filename && invoice.filename.length > 0;
  const isPDF = invoice.mimeType === 'application/pdf' || invoice.filename?.endsWith('.pdf');
  const isCSV = invoice.mimeType === 'text/csv' || invoice.filename?.endsWith('.csv');
  const isImage = invoice.mimeType?.startsWith('image/');
  const fileUrl = hasFile ? `/api/business-accounting/invoice/${invoice.id}` : null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {invoice.partyName || invoice.vendorName || 'Invoice'} - {invoice.invoiceNumber || 'No Number'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Invoice Details */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Party Name</Label>
                  <p className="font-medium">{invoice.partyName || invoice.vendorName || '-'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Invoice Number</Label>
                  <p className="font-medium">{invoice.invoiceNumber || '-'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Invoice Date</Label>
                  <p className="font-medium">
                    {invoice.invoiceDate ? format(new Date(invoice.invoiceDate), 'dd MMM yyyy') : '-'}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">GSTIN</Label>
                  <p className="font-mono text-sm">{invoice.partyGstin || '-'}</p>
                </div>
              </div>

              <div className="border-t pt-4">
                <Label className="text-xs text-muted-foreground mb-2 block">Amount Breakdown</Label>
                <div className="space-y-2 bg-muted/50 rounded-lg p-4">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Taxable Amount</span>
                    <span className="font-medium">{formatCurrency(invoice.taxableAmount || 0)}</span>
                  </div>
                  {(invoice.cgstAmount || 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">CGST</span>
                      <span>{formatCurrency(invoice.cgstAmount || 0)}</span>
                    </div>
                  )}
                  {(invoice.sgstAmount || 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">SGST</span>
                      <span>{formatCurrency(invoice.sgstAmount || 0)}</span>
                    </div>
                  )}
                  {(invoice.igstAmount || 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">IGST</span>
                      <span>{formatCurrency(invoice.igstAmount || 0)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-muted-foreground">Total GST</span>
                    <span className="font-medium text-amber-600">{formatCurrency(invoice.gstAmount || 0)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="font-medium">Grand Total</span>
                    <span className="font-bold text-lg">{formatCurrency(invoice.totalAmount || 0)}</span>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">GST Type</Label>
                  <Badge variant={invoice.gstType === 'input' ? 'default' : 'destructive'}>
                    {invoice.gstType === 'input' ? 'Input (Credit)' : 'Output (Liability)'}
                  </Badge>
                  {!invoice.transactionId && (
                    <Badge variant="outline">External</Badge>
                  )}
                </div>
              </div>

              {invoice.notes && (
                <div className="border-t pt-4">
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <p className="text-sm mt-1 whitespace-pre-wrap bg-muted/30 rounded p-3">{invoice.notes}</p>
                </div>
              )}

              <div className="border-t pt-4 flex gap-2">
                <Button onClick={onEdit} className="flex-1">
                  <Edit2 className="h-4 w-4 mr-2" />
                  Edit Invoice
                </Button>
                {fileUrl && (
                  <Button variant="outline" asChild>
                    <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                      <Upload className="h-4 w-4 mr-2" />
                      Download
                    </a>
                  </Button>
                )}
              </div>
            </div>

            {/* File Preview */}
            <div className="border rounded-lg bg-muted/20 min-h-[400px] flex items-center justify-center">
              {!hasFile ? (
                <div className="text-center text-muted-foreground p-8">
                  <FileText className="h-16 w-16 mx-auto mb-4 opacity-30" />
                  <p>No file attached</p>
                </div>
              ) : isCSV ? (
                <div className="text-center text-muted-foreground p-8">
                  <FileSpreadsheet className="h-16 w-16 mx-auto mb-4 text-green-500" />
                  <p className="font-medium">CSV File</p>
                  <p className="text-sm">{invoice.originalName || invoice.filename}</p>
                  <Button variant="outline" size="sm" className="mt-4" asChild>
                    <a href={fileUrl!} target="_blank" rel="noopener noreferrer">
                      Download CSV
                    </a>
                  </Button>
                </div>
              ) : isPDF ? (
                <iframe
                  src={fileUrl!}
                  className="w-full h-full min-h-[500px] rounded"
                  title="Invoice PDF"
                />
              ) : isImage ? (
                <img
                  src={fileUrl!}
                  alt="Invoice"
                  className="max-w-full max-h-[500px] object-contain rounded"
                />
              ) : (
                <div className="text-center text-muted-foreground p-8">
                  <FileText className="h-16 w-16 mx-auto mb-4" />
                  <p>{invoice.originalName || invoice.filename}</p>
                  <Button variant="outline" size="sm" className="mt-4" asChild>
                    <a href={fileUrl!} target="_blank" rel="noopener noreferrer">
                      Download File
                    </a>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Invoice List Component
function InvoiceList({
  invoices,
  type,
  selectedInvoices,
  onToggle,
  onSelectAll,
  onDelete,
  onEdit,
  onUploadSuccess,
}: {
  invoices: BusinessInvoice[];
  type: 'input' | 'output';
  selectedInvoices: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onDelete: (id: string) => void;
  onEdit: (invoice: BusinessInvoice) => void;
  onUploadSuccess: () => void;
}) {
  const [previewInvoice, setPreviewInvoice] = useState<BusinessInvoice | null>(null);
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [docTypeFilter, setDocTypeFilter] = useState<'all' | 'invoice' | 'estimate'>('all');
  const [hasGstinFilter, setHasGstinFilter] = useState<'all' | 'yes' | 'no'>('all');

  // Helper to detect if invoice is an estimate
  const isEstimateInvoice = (invoice: BusinessInvoice) => {
    const invoiceNum = (invoice.invoiceNumber || '').toLowerCase();
    const notes = (invoice.notes || '').toLowerCase();
    const filename = (invoice.filename || '').toLowerCase();
    const docType = (invoice.documentType || '').toLowerCase();
    return docType === 'estimate' || docType === 'proforma' || docType === 'quotation' ||
      invoiceNum.includes('estimate') || invoiceNum.includes('est/') ||
      invoiceNum.includes('proforma') || invoiceNum.includes('quote') ||
      notes.includes('estimate') || notes.includes('proforma') ||
      filename.includes('estimate') || filename.includes('proforma');
  };

  // Filter invoices
  const filteredInvoices = useMemo(() => {
    return invoices.filter(invoice => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          (invoice.partyName || '').toLowerCase().includes(query) ||
          (invoice.vendorName || '').toLowerCase().includes(query) ||
          (invoice.invoiceNumber || '').toLowerCase().includes(query) ||
          (invoice.partyGstin || '').toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Document type filter
      if (docTypeFilter !== 'all') {
        const isEstimate = isEstimateInvoice(invoice);
        if (docTypeFilter === 'estimate' && !isEstimate) return false;
        if (docTypeFilter === 'invoice' && isEstimate) return false;
      }

      // GSTIN filter
      if (hasGstinFilter !== 'all') {
        const hasGstin = !!invoice.partyGstin;
        if (hasGstinFilter === 'yes' && !hasGstin) return false;
        if (hasGstinFilter === 'no' && hasGstin) return false;
      }

      return true;
    });
  }, [invoices, searchQuery, docTypeFilter, hasGstinFilter]);

  const allSelected = filteredInvoices.length > 0 && filteredInvoices.every(i => selectedInvoices.has(i.id));

  // Group invoices by vendor/party name
  const groupedInvoices = useMemo(() => {
    const groups: Record<string, {
      vendorName: string;
      invoices: BusinessInvoice[];
      totalGst: number;
      totalAmount: number;
      totalTaxable: number;
      cgst: number;
      sgst: number;
      igst: number;
    }> = {};

    filteredInvoices.forEach(invoice => {
      const vendorName = invoice.partyName || invoice.vendorName || 'Unknown';
      if (!groups[vendorName]) {
        groups[vendorName] = {
          vendorName,
          invoices: [],
          totalGst: 0,
          totalAmount: 0,
          totalTaxable: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
        };
      }
      groups[vendorName].invoices.push(invoice);
      groups[vendorName].totalGst += invoice.gstAmount || 0;
      groups[vendorName].totalAmount += invoice.totalAmount || 0;
      groups[vendorName].totalTaxable += invoice.taxableAmount || 0;
      groups[vendorName].cgst += invoice.cgstAmount || 0;
      groups[vendorName].sgst += invoice.sgstAmount || 0;
      groups[vendorName].igst += invoice.igstAmount || 0;
    });

    // Sort by total amount descending
    return Object.values(groups).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [filteredInvoices]);

  const toggleVendorExpand = (vendorName: string) => {
    const newSet = new Set(expandedVendors);
    if (newSet.has(vendorName)) {
      newSet.delete(vendorName);
    } else {
      newSet.add(vendorName);
    }
    setExpandedVendors(newSet);
  };

  const toggleVendorSelection = (vendorName: string) => {
    const group = groupedInvoices.find(g => g.vendorName === vendorName);
    if (!group) return;

    const allInGroupSelected = group.invoices.every(i => selectedInvoices.has(i.id));
    group.invoices.forEach(invoice => {
      if (allInGroupSelected) {
        onToggle(invoice.id); // Deselect
      } else if (!selectedInvoices.has(invoice.id)) {
        onToggle(invoice.id); // Select
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Quick Upload Section */}
      <QuickUploadSection type={type} onSuccess={onUploadSuccess} />

      {/* Invoice List */}
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">
              {type === 'input' ? 'Input Invoices (Purchases)' : 'Output Invoices (Sales)'}
              <span className="text-muted-foreground font-normal ml-2">
                ({groupedInvoices.length} vendors, {filteredInvoices.length} invoices)
                {filteredInvoices.length !== invoices.length && (
                  <span className="text-xs"> (filtered from {invoices.length})</span>
                )}
              </span>
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={onSelectAll}>
              {allSelected ? <CheckSquare className="h-4 w-4 mr-2" /> : <Square className="h-4 w-4 mr-2" />}
              {allSelected ? 'Deselect All' : 'Select All'}
            </Button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search vendor, invoice #, GSTIN..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64"
            />
            <Select value={docTypeFilter} onValueChange={(v: 'all' | 'invoice' | 'estimate') => setDocTypeFilter(v)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Document Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Documents</SelectItem>
                <SelectItem value="invoice">Tax Invoices Only</SelectItem>
                <SelectItem value="estimate">Estimates Only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={hasGstinFilter} onValueChange={(v: 'all' | 'yes' | 'no') => setHasGstinFilter(v)}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="GSTIN" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="yes">Has GSTIN</SelectItem>
                <SelectItem value="no">No GSTIN</SelectItem>
              </SelectContent>
            </Select>
            {(searchQuery || docTypeFilter !== 'all' || hasGstinFilter !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setDocTypeFilter('all');
                  setHasGstinFilter('all');
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No {type} invoices found</p>
          ) : (
            <div className="space-y-2">
              {groupedInvoices.map((group) => {
                const isExpanded = expandedVendors.has(group.vendorName);
                const allInGroupSelected = group.invoices.every(i => selectedInvoices.has(i.id));
                const someInGroupSelected = group.invoices.some(i => selectedInvoices.has(i.id));

                return (
                  <div key={group.vendorName} className="border rounded-lg overflow-hidden">
                    {/* Vendor Group Header */}
                    <div
                      className={`flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/50 ${
                        isExpanded ? 'bg-muted/30 border-b' : ''
                      }`}
                      onClick={() => toggleVendorExpand(group.vendorName)}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleVendorSelection(group.vendorName); }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        {allInGroupSelected ? (
                          <CheckSquare className="h-5 w-5 text-primary" />
                        ) : someInGroupSelected ? (
                          <Square className="h-5 w-5 text-primary/50" />
                        ) : (
                          <Square className="h-5 w-5" />
                        )}
                      </button>

                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{group.vendorName}</span>
                          <Badge variant="secondary" className="text-xs">
                            {group.invoices.length} invoice{group.invoices.length > 1 ? 's' : ''}
                          </Badge>
                        </div>
                      </div>

                      {/* Summary amounts */}
                      <div className="hidden sm:flex items-center gap-8 text-sm ml-auto">
                        <div className="text-right w-28">
                          <div className="text-xs text-muted-foreground">Total</div>
                          <div className="font-semibold">{formatCurrency(group.totalAmount)}</div>
                        </div>
                        <div className="text-right w-28">
                          <div className="text-xs text-muted-foreground">Taxable</div>
                          <div>{formatCurrency(group.totalTaxable)}</div>
                        </div>
                        <div className="text-right w-28">
                          <div className="text-xs text-muted-foreground">GST</div>
                          <div className="font-medium text-amber-600">{formatCurrency(group.totalGst)}</div>
                          <div className="text-xs text-muted-foreground">
                            {group.cgst > 0 && group.sgst > 0 ? (
                              <span>C+S: {formatCurrency(group.cgst + group.sgst)}</span>
                            ) : group.igst > 0 ? (
                              <span>IGST: {formatCurrency(group.igst)}</span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {/* Mobile summary */}
                      <div className="sm:hidden text-right">
                        <div className="font-bold">{formatCurrency(group.totalAmount)}</div>
                        <div className="text-xs text-amber-600">GST: {formatCurrency(group.totalGst)}</div>
                      </div>
                    </div>

                    {/* Expanded Invoice List */}
                    {isExpanded && (
                      <div className="divide-y">
                        {group.invoices.map((invoice) => {
                          const isEstimate = isEstimateInvoice(invoice);
                          const hasNoGSTIN = !invoice.partyGstin;

                          return (
                            <div
                              key={invoice.id}
                              className={`p-3 pl-12 cursor-pointer hover:bg-muted/50 ${
                                selectedInvoices.has(invoice.id) ? 'bg-primary/5' : ''
                              } ${isEstimate ? 'bg-amber-50/30 dark:bg-amber-900/10 border-l-4 border-l-amber-400' : 'border-l-4 border-l-green-500'}`}
                              onClick={() => setPreviewInvoice(invoice)}
                            >
                              <div className="flex items-center gap-3">
                                <button
                                  onClick={(e) => { e.stopPropagation(); onToggle(invoice.id); }}
                                  className="text-muted-foreground hover:text-foreground"
                                >
                                  {selectedInvoices.has(invoice.id) ? (
                                    <CheckSquare className="h-4 w-4 text-primary" />
                                  ) : (
                                    <Square className="h-4 w-4" />
                                  )}
                                </button>

                                {/* Invoice Date - prominent */}
                                <div className="w-24 text-center flex-shrink-0">
                                  <div className="text-sm font-medium">
                                    {invoice.invoiceDate ? format(new Date(invoice.invoiceDate), 'dd MMM') : '-'}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {invoice.invoiceDate ? format(new Date(invoice.invoiceDate), 'yyyy') : ''}
                                  </div>
                                </div>

                                {/* Document Type Badge */}
                                <div className="w-20 flex-shrink-0">
                                  {isEstimate ? (
                                    <Badge variant="outline" className="text-xs bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400">
                                      Estimate
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-xs bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400">
                                      Tax Inv
                                    </Badge>
                                  )}
                                </div>

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium">
                                      {invoice.invoiceNumber || 'No Invoice #'}
                                    </span>
                                    {hasNoGSTIN && !isEstimate && (
                                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">No GSTIN</Badge>
                                    )}
                                    {!invoice.transactionId && (
                                      <Badge variant="outline" className="text-xs">External</Badge>
                                    )}
                                    {invoice.filename && (
                                      <FileText className="h-3 w-3 text-blue-500" />
                                    )}
                                  </div>
                                  {invoice.partyGstin && (
                                    <div className="text-xs text-muted-foreground font-mono">{invoice.partyGstin}</div>
                                  )}
                                </div>

                                <div className="hidden sm:flex items-center gap-8 text-sm">
                                  <div className="text-right w-28">
                                    <div className="font-medium">{formatCurrency(invoice.totalAmount || 0)}</div>
                                  </div>
                                  <div className="text-right w-28">
                                    <div className="text-muted-foreground">{formatCurrency(invoice.taxableAmount || 0)}</div>
                                  </div>
                                  <div className="text-right w-28">
                                    <div className="text-amber-600">{formatCurrency(invoice.gstAmount || 0)}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {(invoice.cgstAmount || 0) > 0 ? `C+S` : (invoice.igstAmount || 0) > 0 ? 'IGST' : ''}
                                    </div>
                                  </div>
                                </div>

                                <div className="sm:hidden text-right">
                                  <div className="font-medium text-sm">{formatCurrency(invoice.totalAmount || 0)}</div>
                                </div>

                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={(e) => { e.stopPropagation(); onEdit(invoice); }}
                                  >
                                    <Edit2 className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-red-500"
                                    onClick={(e) => { e.stopPropagation(); onDelete(invoice.id); }}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invoice Preview Modal */}
      {previewInvoice && (
        <InvoicePreviewModal
          invoice={previewInvoice}
          onClose={() => setPreviewInvoice(null)}
          onEdit={() => {
            setPreviewInvoice(null);
            onEdit(previewInvoice);
          }}
        />
      )}
    </div>
  );
}

// Add Invoice Form
function AddGSTInvoiceForm({ onSuccess }: { onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    invoiceDate: format(new Date(), 'yyyy-MM-dd'),
    invoiceNumber: '',
    partyName: '',
    partyGstin: '',
    gstType: 'input' as 'input' | 'output',
    taxableAmount: '',
    cgstAmount: '',
    sgstAmount: '',
    igstAmount: '',
    notes: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const gstAmount = (parseFloat(formData.cgstAmount) || 0) + (parseFloat(formData.sgstAmount) || 0) + (parseFloat(formData.igstAmount) || 0);
  const totalAmount = (parseFloat(formData.taxableAmount) || 0) + gstAmount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const data = new FormData();
      data.append('invoiceDate', formData.invoiceDate);
      data.append('invoiceNumber', formData.invoiceNumber);
      data.append('partyName', formData.partyName);
      data.append('partyGstin', formData.partyGstin);
      data.append('gstType', formData.gstType);
      data.append('taxableAmount', formData.taxableAmount || '0');
      data.append('cgstAmount', formData.cgstAmount || '0');
      data.append('sgstAmount', formData.sgstAmount || '0');
      data.append('igstAmount', formData.igstAmount || '0');
      data.append('gstAmount', String(gstAmount));
      data.append('totalAmount', String(totalAmount));
      data.append('notes', formData.notes);
      if (file) {
        data.append('file', file);
      }

      await businessAccountingApi.createGSTInvoice(data);
      onSuccess();
    } catch (error) {
      console.error('Error creating invoice:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Add GST Invoice</DialogTitle>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Invoice Date</Label>
          <Input
            type="date"
            value={formData.invoiceDate}
            onChange={(e) => setFormData({ ...formData, invoiceDate: e.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Invoice Number</Label>
          <Input
            value={formData.invoiceNumber}
            onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
            placeholder="INV-001"
            required
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Party Name</Label>
          <Input
            value={formData.partyName}
            onChange={(e) => setFormData({ ...formData, partyName: e.target.value })}
            placeholder="Vendor/Customer name"
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Party GSTIN</Label>
          <Input
            value={formData.partyGstin}
            onChange={(e) => setFormData({ ...formData, partyGstin: e.target.value.toUpperCase() })}
            placeholder="29XXXXX0000X1Z5"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>GST Type</Label>
        <Select value={formData.gstType} onValueChange={(v: 'input' | 'output') => setFormData({ ...formData, gstType: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="input">Input (Purchase - Credit)</SelectItem>
            <SelectItem value="output">Output (Sale - Liability)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Taxable Amount</Label>
        <Input
          type="number"
          step="0.01"
          value={formData.taxableAmount}
          onChange={(e) => setFormData({ ...formData, taxableAmount: e.target.value })}
          placeholder="0.00"
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>CGST</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.cgstAmount}
            onChange={(e) => setFormData({ ...formData, cgstAmount: e.target.value })}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-2">
          <Label>SGST</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.sgstAmount}
            onChange={(e) => setFormData({ ...formData, sgstAmount: e.target.value })}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-2">
          <Label>IGST</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.igstAmount}
            onChange={(e) => setFormData({ ...formData, igstAmount: e.target.value })}
            placeholder="0.00"
          />
        </div>
      </div>

      <div className="p-3 bg-muted rounded-lg">
        <div className="flex justify-between text-sm">
          <span>Total GST:</span>
          <span className="font-medium">{formatCurrency(gstAmount)}</span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span>Grand Total:</span>
          <span className="font-bold">{formatCurrency(totalAmount)}</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Invoice File (Optional)</Label>
        <Input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </div>

      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Optional notes..."
          rows={2}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Creating...' : 'Create Invoice'}
      </Button>
    </form>
  );
}

// Edit Invoice Form
function EditGSTInvoiceForm({
  invoice,
  onSuccess,
  onCancel,
}: {
  invoice: BusinessInvoice;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    invoiceDate: invoice.invoiceDate || '',
    invoiceNumber: invoice.invoiceNumber || '',
    partyName: invoice.partyName || invoice.vendorName || '',
    partyGstin: invoice.partyGstin || '',
    gstType: invoice.gstType || 'input',
    taxableAmount: String(invoice.taxableAmount || ''),
    cgstAmount: String(invoice.cgstAmount || ''),
    sgstAmount: String(invoice.sgstAmount || ''),
    igstAmount: String(invoice.igstAmount || ''),
    notes: invoice.notes || '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const gstAmount = (parseFloat(formData.cgstAmount) || 0) + (parseFloat(formData.sgstAmount) || 0) + (parseFloat(formData.igstAmount) || 0);
  const totalAmount = (parseFloat(formData.taxableAmount) || 0) + gstAmount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await businessAccountingApi.updateGSTInvoice(invoice.id, {
        invoiceDate: formData.invoiceDate,
        invoiceNumber: formData.invoiceNumber,
        partyName: formData.partyName,
        partyGstin: formData.partyGstin,
        gstType: formData.gstType,
        taxableAmount: parseFloat(formData.taxableAmount) || 0,
        cgstAmount: parseFloat(formData.cgstAmount) || 0,
        sgstAmount: parseFloat(formData.sgstAmount) || 0,
        igstAmount: parseFloat(formData.igstAmount) || 0,
        gstAmount,
        totalAmount,
        notes: formData.notes,
      });
      onSuccess();
    } catch (error) {
      console.error('Error updating invoice:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Edit Invoice</DialogTitle>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Invoice Date</Label>
          <Input
            type="date"
            value={formData.invoiceDate}
            onChange={(e) => setFormData({ ...formData, invoiceDate: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Invoice Number</Label>
          <Input
            value={formData.invoiceNumber}
            onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Party Name</Label>
          <Input
            value={formData.partyName}
            onChange={(e) => setFormData({ ...formData, partyName: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Party GSTIN</Label>
          <Input
            value={formData.partyGstin}
            onChange={(e) => setFormData({ ...formData, partyGstin: e.target.value.toUpperCase() })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>GST Type</Label>
        <Select value={formData.gstType} onValueChange={(v: string) => setFormData({ ...formData, gstType: v as 'input' | 'output' })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="input">Input (Purchase)</SelectItem>
            <SelectItem value="output">Output (Sale)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Taxable Amount</Label>
        <Input
          type="number"
          step="0.01"
          value={formData.taxableAmount}
          onChange={(e) => setFormData({ ...formData, taxableAmount: e.target.value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>CGST</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.cgstAmount}
            onChange={(e) => setFormData({ ...formData, cgstAmount: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>SGST</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.sgstAmount}
            onChange={(e) => setFormData({ ...formData, sgstAmount: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>IGST</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.igstAmount}
            onChange={(e) => setFormData({ ...formData, igstAmount: e.target.value })}
          />
        </div>
      </div>

      <div className="p-3 bg-muted rounded-lg">
        <div className="flex justify-between text-sm">
          <span>Total GST:</span>
          <span className="font-medium">{formatCurrency(gstAmount)}</span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span>Grand Total:</span>
          <span className="font-bold">{formatCurrency(totalAmount)}</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          rows={2}
        />
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </form>
  );
}

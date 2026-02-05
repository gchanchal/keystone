import { useState, useMemo, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Plus,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  X,
  Check,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { loansApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { LoanGivenDetail } from '@/types';

type SortField = 'particular' | 'toGet' | 'toGive' | 'date' | 'details' | 'notes' | 'currency';
type SortDirection = 'asc' | 'desc';

// Format currency with symbol
function formatWithSymbol(amount: number, currency: 'INR' | 'USD') {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount);
  }
  return formatCurrency(amount);
}

// Editable cell component
function EditableCell({
  value,
  onChange,
  onSave,
  type = 'text',
  className = '',
  displayValue,
  autoFocus = false,
  onCancel,
}: {
  value: string | number;
  onChange: (value: string | number) => void;
  onSave: (value: string | number) => void;
  type?: 'text' | 'number' | 'date';
  className?: string;
  displayValue?: string;
  autoFocus?: boolean;
  onCancel?: () => void;
}) {
  const [isEditing, setIsEditing] = useState(autoFocus);
  const [localValue, setLocalValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync local value when prop changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
    setLocalValue(newValue);
    onChange(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setIsEditing(false);
      onSave(localValue);
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setLocalValue(value); // Reset to original
      onCancel?.();
    }
  };

  const handleBlur = () => {
    setIsEditing(false);
    onSave(localValue);
  };

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        type={type}
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={`h-8 ${className}`}
      />
    );
  }

  return (
    <div
      className={`cursor-pointer hover:bg-muted/50 px-2 py-1 rounded min-h-[32px] flex items-center ${className}`}
      onClick={() => setIsEditing(true)}
    >
      {displayValue ?? value ?? '-'}
    </div>
  );
}

// Currency select component
function CurrencySelect({
  value,
  onChange,
  onSave,
}: {
  value: 'INR' | 'USD';
  onChange: (value: 'INR' | 'USD') => void;
  onSave: (value: 'INR' | 'USD') => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => {
        const newValue = e.target.value as 'INR' | 'USD';
        onChange(newValue);
        onSave(newValue);
      }}
      className="h-8 rounded-md border border-input bg-background px-2 text-sm cursor-pointer"
    >
      <option value="INR">INR</option>
      <option value="USD">USD</option>
    </select>
  );
}

export function LoanGivenDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterToGet, setFilterToGet] = useState<'all' | 'hasValue' | 'zero'>('all');
  const [filterToGive, setFilterToGive] = useState<'all' | 'hasValue' | 'zero'>('all');

  // Track inline edits per row
  const [editedRows, setEditedRows] = useState<Record<string, Partial<LoanGivenDetail>>>({});

  // New row being added inline
  const [newRow, setNewRow] = useState<{
    particular: string;
    toGet: number;
    toGive: number;
    currency: 'INR' | 'USD';
    details: string;
    date: string;
    notes: string;
  } | null>(null);

  // Ref to track current newRow for save function (avoids stale closure)
  const newRowRef = useRef(newRow);

  // Fetch exchange rate
  const { data: exchangeRateData, refetch: refetchExchangeRate } = useQuery({
    queryKey: ['exchange-rate', 'usd-inr'],
    queryFn: () => loansApi.getExchangeRate(),
    staleTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
  });

  const exchangeRate = exchangeRateData?.rate || 83.5; // Fallback rate

  // Fetch loan details
  const { data: loan } = useQuery({
    queryKey: ['loans', id],
    queryFn: () => loansApi.getById(id!),
    enabled: !!id,
  });

  // Fetch loan given details
  const { data: givenDetailsData, isLoading } = useQuery({
    queryKey: ['loans', id, 'given-details'],
    queryFn: () => loansApi.getGivenDetails(id!),
    enabled: !!id,
  });

  const addGivenDetailMutation = useMutation({
    mutationFn: ({ loanId, data }: { loanId: string; data: any }) => {
      console.log('Calling API with:', { loanId, data });
      return loansApi.addGivenDetail(loanId, data);
    },
    onSuccess: (response) => {
      console.log('Add detail success:', response);
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      queryClient.invalidateQueries({ queryKey: ['loans', id, 'given-details'] });
      newRowRef.current = null;
      setNewRow(null);
    },
    onError: (error: any) => {
      console.error('Add detail error:', error);
      console.error('Error response:', error.response?.data);
    },
  });

  const updateGivenDetailMutation = useMutation({
    mutationFn: ({ loanId, detailId, data }: { loanId: string; detailId: string; data: any }) => {
      console.log('Calling update API:', { loanId, detailId, data });
      return loansApi.updateGivenDetail(loanId, detailId, data);
    },
    onSuccess: (response, variables) => {
      console.log('Update success:', response);
      // Clear edited state for this row
      setEditedRows((prev) => {
        const next = { ...prev };
        delete next[variables.detailId];
        return next;
      });
      // Force refetch to update UI
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      queryClient.invalidateQueries({ queryKey: ['loans', id, 'given-details'] });
    },
    onError: (error: any) => {
      console.error('Update failed:', error);
      console.error('Error response:', error.response?.data);
      console.error('Error status:', error.response?.status);
    },
  });

  const deleteGivenDetailMutation = useMutation({
    mutationFn: ({ loanId, detailId }: { loanId: string; detailId: string }) =>
      loansApi.deleteGivenDetail(loanId, detailId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      queryClient.invalidateQueries({ queryKey: ['loans', id, 'given-details'] });
    },
  });

  // Calculate totals in INR (converting USD amounts)
  const totals = useMemo(() => {
    if (!givenDetailsData?.details) {
      return { totalToGetINR: 0, totalToGiveINR: 0, netAmountINR: 0 };
    }

    let totalToGetINR = 0;
    let totalToGiveINR = 0;

    for (const detail of givenDetailsData.details) {
      const currency = detail.currency || 'INR';
      const toGet = detail.toGet || 0;
      const toGive = detail.toGive || 0;

      if (currency === 'USD') {
        totalToGetINR += toGet * exchangeRate;
        totalToGiveINR += toGive * exchangeRate;
      } else {
        totalToGetINR += toGet;
        totalToGiveINR += toGive;
      }
    }

    return {
      totalToGetINR,
      totalToGiveINR,
      netAmountINR: totalToGetINR - totalToGiveINR,
    };
  }, [givenDetailsData?.details, exchangeRate]);

  // Add a new empty row for inline editing
  const handleAddRow = () => {
    const emptyRow = {
      particular: '',
      toGet: 0,
      toGive: 0,
      currency: 'INR' as const,
      details: '',
      date: new Date().toISOString().split('T')[0],
      notes: '',
    };
    newRowRef.current = emptyRow;
    setNewRow(emptyRow);
  };

  // Save the new row - reads from ref to get latest values
  const saveNewRow = () => {
    if (!id) {
      console.log('No loan ID, cannot save');
      return;
    }

    // Read from ref to get the most up-to-date values
    const currentRow = newRowRef.current;
    if (!currentRow) {
      console.log('newRow is null, cannot save');
      return;
    }

    // Only save if at least particular is filled
    if (!currentRow.particular.trim()) {
      console.log('Particular is empty, not saving. Current particular:', currentRow.particular);
      return;
    }

    // Build the data to send
    const dataToSend = {
      particular: currentRow.particular.trim(),
      toGet: currentRow.toGet || 0,
      toGive: currentRow.toGive || 0,
      currency: currentRow.currency || 'INR',
      details: currentRow.details || '',
      date: currentRow.date,
      notes: currentRow.notes || '',
    };

    console.log('Saving new row with data:', dataToSend);
    addGivenDetailMutation.mutate({
      loanId: id,
      data: dataToSend,
    });
  };

  // Cancel adding new row
  const cancelNewRow = () => {
    newRowRef.current = null;
    setNewRow(null);
  };

  // Update a field in the new row - also syncs to ref for immediate access
  const updateNewRowField = (field: keyof NonNullable<typeof newRow>, value: any) => {
    if (!newRow) return;
    const updated = { ...newRow, [field]: value };
    newRowRef.current = updated; // Sync update (immediate)
    setNewRow(updated); // Async update (for re-render)
  };

  // Update a field in the edited rows state
  const updateEditedField = (detailId: string, field: keyof LoanGivenDetail, value: any) => {
    setEditedRows((prev) => ({
      ...prev,
      [detailId]: {
        ...prev[detailId],
        [field]: value,
      },
    }));
  };

  // Save inline edits for a row - now receives field and value directly
  const saveRowEdits = (detail: LoanGivenDetail, field: keyof LoanGivenDetail, value: any) => {
    if (!id) return;

    // Build update data - only include non-null string values
    // Zod schema expects strings, not null
    const updatedData: Record<string, any> = {
      particular: field === 'particular' ? String(value || '') : detail.particular,
      toGet: field === 'toGet' ? Number(value) || 0 : (detail.toGet || 0),
      toGive: field === 'toGive' ? Number(value) || 0 : (detail.toGive || 0),
      currency: field === 'currency' ? value : (detail.currency || 'INR'),
      date: field === 'date' ? value : detail.date,
    };

    // Only include details/notes if they have values (as strings)
    const detailsValue = field === 'details' ? value : detail.details;
    if (detailsValue) {
      updatedData.details = String(detailsValue);
    }

    const notesValue = field === 'notes' ? value : detail.notes;
    if (notesValue) {
      updatedData.notes = String(notesValue);
    }

    console.log('Saving field:', field, 'value:', value, 'data:', updatedData);

    updateGivenDetailMutation.mutate({
      loanId: id,
      detailId: detail.id,
      data: updatedData,
    });
  };

  // Get current value (edited or original)
  const getValue = (detail: LoanGivenDetail, field: keyof LoanGivenDetail) => {
    return editedRows[detail.id]?.[field] ?? detail[field];
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="ml-2 h-4 w-4 text-muted-foreground" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="ml-2 h-4 w-4" />
    ) : (
      <ArrowDown className="ml-2 h-4 w-4" />
    );
  };

  // Filter and sort the data
  const filteredAndSortedDetails = useMemo(() => {
    if (!givenDetailsData?.details) return [];

    let filtered = [...givenDetailsData.details];

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (d) =>
          d.particular.toLowerCase().includes(term) ||
          d.details?.toLowerCase().includes(term) ||
          d.notes?.toLowerCase().includes(term)
      );
    }

    // To Get filter
    if (filterToGet === 'hasValue') {
      filtered = filtered.filter((d) => d.toGet && d.toGet > 0);
    } else if (filterToGet === 'zero') {
      filtered = filtered.filter((d) => !d.toGet || d.toGet === 0);
    }

    // To Give filter
    if (filterToGive === 'hasValue') {
      filtered = filtered.filter((d) => d.toGive && d.toGive > 0);
    } else if (filterToGive === 'zero') {
      filtered = filtered.filter((d) => !d.toGive || d.toGive === 0);
    }

    // Sort
    filtered.sort((a, b) => {
      let aVal: any, bVal: any;

      switch (sortField) {
        case 'particular':
          aVal = a.particular.toLowerCase();
          bVal = b.particular.toLowerCase();
          break;
        case 'toGet':
          aVal = a.toGet || 0;
          bVal = b.toGet || 0;
          break;
        case 'toGive':
          aVal = a.toGive || 0;
          bVal = b.toGive || 0;
          break;
        case 'currency':
          aVal = a.currency || 'INR';
          bVal = b.currency || 'INR';
          break;
        case 'date':
          aVal = a.date;
          bVal = b.date;
          break;
        case 'details':
          aVal = (a.details || '').toLowerCase();
          bVal = (b.details || '').toLowerCase();
          break;
        case 'notes':
          aVal = (a.notes || '').toLowerCase();
          bVal = (b.notes || '').toLowerCase();
          break;
        default:
          aVal = a.date;
          bVal = b.date;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [givenDetailsData?.details, searchTerm, filterToGet, filterToGive, sortField, sortDirection]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/loans?tab=given')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{loan?.partyName}</h1>
          <p className="text-sm text-muted-foreground">Loan Details - Click any cell to edit</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>USD/INR: {exchangeRate.toFixed(2)}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => refetchExchangeRate()}
            title="Refresh exchange rate"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">To Get (Principal)</p>
            <p className="text-2xl font-bold text-green-600">
              {formatCurrency(totals.totalToGetINR)}
            </p>
            <p className="text-xs text-muted-foreground">Converted to INR</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">To Give</p>
            <p className="text-2xl font-bold text-red-600">
              {formatCurrency(totals.totalToGiveINR)}
            </p>
            <p className="text-xs text-muted-foreground">Converted to INR</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Net Outstanding</p>
            <p
              className={`text-2xl font-bold ${
                totals.netAmountINR >= 0 ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {formatCurrency(totals.netAmountINR)}
            </p>
            <p className="text-xs text-muted-foreground">Converted to INR</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Actions */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-4">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search particulars, details, notes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
            {searchTerm && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
                onClick={() => setSearchTerm('')}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* To Get Filter */}
          <select
            value={filterToGet}
            onChange={(e) => setFilterToGet(e.target.value as any)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All To Get</option>
            <option value="hasValue">Has To Get</option>
            <option value="zero">No To Get</option>
          </select>

          {/* To Give Filter */}
          <select
            value={filterToGive}
            onChange={(e) => setFilterToGive(e.target.value as any)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All To Give</option>
            <option value="hasValue">Has To Give</option>
            <option value="zero">No To Give</option>
          </select>
        </div>
      </div>

      {/* Details Table */}
      <Card>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead
                className="cursor-pointer select-none w-[200px] min-w-[200px]"
                onClick={() => handleSort('particular')}
              >
                <div className="flex items-center">
                  Particular
                  {getSortIcon('particular')}
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer select-none w-[120px] min-w-[120px]"
                onClick={() => handleSort('toGet')}
              >
                <div className="flex items-center">
                  To Get
                  {getSortIcon('toGet')}
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer select-none w-[120px] min-w-[120px]"
                onClick={() => handleSort('toGive')}
              >
                <div className="flex items-center">
                  To Give
                  {getSortIcon('toGive')}
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer select-none w-[80px] min-w-[80px]"
                onClick={() => handleSort('currency')}
              >
                <div className="flex items-center">
                  Curr
                  {getSortIcon('currency')}
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer select-none w-[150px] min-w-[150px]"
                onClick={() => handleSort('details')}
              >
                <div className="flex items-center">
                  Details
                  {getSortIcon('details')}
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer select-none w-[110px] min-w-[110px]"
                onClick={() => handleSort('date')}
              >
                <div className="flex items-center">
                  Date
                  {getSortIcon('date')}
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer select-none min-w-[120px]"
                onClick={() => handleSort('notes')}
              >
                <div className="flex items-center">
                  Notes
                  {getSortIcon('notes')}
                </div>
              </TableHead>
              <TableHead className="w-[50px] min-w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSortedDetails.length === 0 && !newRow ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  {searchTerm || filterToGet !== 'all' || filterToGive !== 'all'
                    ? 'No entries match your filters.'
                    : 'No entries yet. Click "Add Entry" below to add details.'}
                </TableCell>
              </TableRow>
            ) : (
              filteredAndSortedDetails.map((detail: LoanGivenDetail) => {
                const currency = (getValue(detail, 'currency') as 'INR' | 'USD') || 'INR';
                return (
                  <TableRow key={detail.id} className="group">
                    <TableCell className="p-1">
                      <EditableCell
                        value={getValue(detail, 'particular') as string}
                        onChange={(v) => updateEditedField(detail.id, 'particular', v)}
                        onSave={(v) => saveRowEdits(detail, 'particular', v)}
                        className="font-medium"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <EditableCell
                        value={getValue(detail, 'toGet') as number}
                        onChange={(v) => updateEditedField(detail.id, 'toGet', v)}
                        onSave={(v) => saveRowEdits(detail, 'toGet', v)}
                        type="number"
                        className="text-green-600"
                        displayValue={getValue(detail, 'toGet') ? formatWithSymbol(getValue(detail, 'toGet') as number, currency) : '-'}
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <EditableCell
                        value={getValue(detail, 'toGive') as number}
                        onChange={(v) => updateEditedField(detail.id, 'toGive', v)}
                        onSave={(v) => saveRowEdits(detail, 'toGive', v)}
                        type="number"
                        className="text-red-600"
                        displayValue={getValue(detail, 'toGive') ? formatWithSymbol(getValue(detail, 'toGive') as number, currency) : '-'}
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <CurrencySelect
                        value={currency}
                        onChange={(v) => updateEditedField(detail.id, 'currency', v)}
                        onSave={(v) => saveRowEdits(detail, 'currency', v)}
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <EditableCell
                        value={(getValue(detail, 'details') as string) || ''}
                        onChange={(v) => updateEditedField(detail.id, 'details', v)}
                        onSave={(v) => saveRowEdits(detail, 'details', v)}
                        displayValue={(getValue(detail, 'details') as string) || '-'}
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <EditableCell
                        value={getValue(detail, 'date') as string}
                        onChange={(v) => updateEditedField(detail.id, 'date', v)}
                        onSave={(v) => saveRowEdits(detail, 'date', v)}
                        type="date"
                        displayValue={formatDate(getValue(detail, 'date') as string)}
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <EditableCell
                        value={(getValue(detail, 'notes') as string) || ''}
                        onChange={(v) => updateEditedField(detail.id, 'notes', v)}
                        onSave={(v) => saveRowEdits(detail, 'notes', v)}
                        displayValue={(getValue(detail, 'notes') as string) || '-'}
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() =>
                          deleteGivenDetailMutation.mutate({
                            loanId: id!,
                            detailId: detail.id,
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
            {/* New row being added - appears at the bottom */}
            {newRow && (
              <TableRow className="bg-muted/30">
                <TableCell className="p-1">
                  <Input
                    value={newRow.particular}
                    onChange={(e) => updateNewRowField('particular', e.target.value)}
                    placeholder="Enter particular..."
                    className="h-8"
                    autoFocus
                  />
                </TableCell>
                <TableCell className="p-1">
                  <Input
                    type="number"
                    value={newRow.toGet || ''}
                    onChange={(e) => updateNewRowField('toGet', parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="h-8 text-green-600"
                  />
                </TableCell>
                <TableCell className="p-1">
                  <Input
                    type="number"
                    value={newRow.toGive || ''}
                    onChange={(e) => updateNewRowField('toGive', parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="h-8 text-red-600"
                  />
                </TableCell>
                <TableCell className="p-1">
                  <select
                    value={newRow.currency}
                    onChange={(e) => updateNewRowField('currency', e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="INR">INR</option>
                    <option value="USD">USD</option>
                  </select>
                </TableCell>
                <TableCell className="p-1">
                  <Input
                    value={newRow.details}
                    onChange={(e) => updateNewRowField('details', e.target.value)}
                    placeholder="Details..."
                    className="h-8"
                  />
                </TableCell>
                <TableCell className="p-1">
                  <Input
                    type="date"
                    value={newRow.date}
                    onChange={(e) => updateNewRowField('date', e.target.value)}
                    className="h-8"
                  />
                </TableCell>
                <TableCell className="p-1">
                  <Input
                    value={newRow.notes}
                    onChange={(e) => updateNewRowField('notes', e.target.value)}
                    placeholder="Notes..."
                    className="h-8"
                  />
                </TableCell>
                <TableCell className="p-1">
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-green-600"
                      onClick={saveNewRow}
                      disabled={!newRow.particular.trim()}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={cancelNewRow}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* Filtered Results Summary */}
        {(searchTerm || filterToGet !== 'all' || filterToGive !== 'all') && (
          <div className="border-t px-4 py-2 text-sm text-muted-foreground">
            Showing {filteredAndSortedDetails.length} of {givenDetailsData?.details?.length || 0}{' '}
            entries
          </div>
        )}
      </Card>

      {/* Add Row Button - Below table */}
      <div className="flex justify-start">
        <Button onClick={handleAddRow} disabled={newRow !== null} variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          Add Entry
        </Button>
      </div>

    </div>
  );
}

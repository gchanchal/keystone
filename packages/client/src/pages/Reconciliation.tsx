import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Wand2,
  Download,
  Check,
  X,
  Link,
  Unlink,
  Info,
  Search,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { Input } from '@/components/ui/input';
import { reconciliationApi, accountsApi } from '@/lib/api';
import { formatCurrency, formatDate, getMonthYear, parseMonthYear } from '@/lib/utils';
import { format, addMonths, subMonths } from 'date-fns';
import type { BankTransaction, VyaparTransaction, Account, ReconciliationMatch } from '@/types';

type FilterStatus = 'all' | 'matched' | 'unmatched';

export function Reconciliation() {
  const queryClient = useQueryClient();
  const [startMonth, setStartMonth] = useState(getMonthYear());
  const [endMonth, setEndMonth] = useState(getMonthYear());
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [selectedBankIds, setSelectedBankIds] = useState<string[]>([]);
  const [selectedVyaparIds, setSelectedVyaparIds] = useState<string[]>([]);
  const [pendingMatches, setPendingMatches] = useState<ReconciliationMatch[]>([]);
  const [autoMatchRan, setAutoMatchRan] = useState(false);
  const [bankFilter, setBankFilter] = useState<FilterStatus>('unmatched');
  const [vyaparFilter, setVyaparFilter] = useState<FilterStatus>('unmatched');
  const [bankSearch, setBankSearch] = useState('');
  const [vyaparSearch, setVyaparSearch] = useState('');
  // State to track which matched transaction is selected to highlight its counterpart
  const [highlightedMatchBankId, setHighlightedMatchBankId] = useState<string | null>(null);
  const [highlightedMatchVyaparId, setHighlightedMatchVyaparId] = useState<string | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.getAll,
  });

  const { data: reconciliationData, isLoading } = useQuery({
    queryKey: ['reconciliation', startMonth, endMonth, selectedAccount],
    queryFn: () =>
      reconciliationApi.getData(
        startMonth,
        endMonth,
        selectedAccount !== 'all' ? selectedAccount : undefined
      ),
  });

  const autoMatchMutation = useMutation({
    mutationFn: () =>
      reconciliationApi.autoMatch(
        startMonth,
        endMonth,
        selectedAccount !== 'all' ? [selectedAccount] : undefined,
        false
      ),
    onSuccess: (data) => {
      setPendingMatches(data.matches || []);
      setAutoMatchRan(true);
    },
  });

  const applyMatchesMutation = useMutation({
    mutationFn: (matches: Array<{ bankTransactionId: string; vyaparTransactionId: string }>) =>
      reconciliationApi.applyMatches(matches),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
      setPendingMatches([]);
    },
  });

  const multiMatchMutation = useMutation({
    mutationFn: ({ bankIds, vyaparIds }: { bankIds: string[]; vyaparIds: string[] }) =>
      reconciliationApi.multiMatch(bankIds, vyaparIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
      setSelectedBankIds([]);
      setSelectedVyaparIds([]);
    },
  });

  const unmatchMutation = useMutation({
    mutationFn: reconciliationApi.unmatch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
    },
  });

  const handleExport = async () => {
    const blob = await reconciliationApi.exportReport(
      startMonth,
      endMonth,
      selectedAccount !== 'all' ? selectedAccount : undefined
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation-${startMonth}-to-${endMonth}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePreviousStartMonth = () => {
    const date = parseMonthYear(startMonth);
    const newStart = format(subMonths(date, 1), 'yyyy-MM');
    setStartMonth(newStart);
    // If end month is before new start, adjust it
    if (newStart > endMonth) {
      setEndMonth(newStart);
    }
  };

  const handleNextStartMonth = () => {
    const date = parseMonthYear(startMonth);
    const newStart = format(addMonths(date, 1), 'yyyy-MM');
    setStartMonth(newStart);
    // If new start is after end month, adjust end month
    if (newStart > endMonth) {
      setEndMonth(newStart);
    }
  };

  const handlePreviousEndMonth = () => {
    const date = parseMonthYear(endMonth);
    const newEnd = format(subMonths(date, 1), 'yyyy-MM');
    // Only allow if it's not before start month
    if (newEnd >= startMonth) {
      setEndMonth(newEnd);
    }
  };

  const handleNextEndMonth = () => {
    const date = parseMonthYear(endMonth);
    setEndMonth(format(addMonths(date, 1), 'yyyy-MM'));
  };

  const handleManualMatch = () => {
    if (selectedBankIds.length > 0 && selectedVyaparIds.length > 0) {
      // Use multi-match for any selection (works for 1:1, 1:many, many:1, many:many)
      multiMatchMutation.mutate({ bankIds: selectedBankIds, vyaparIds: selectedVyaparIds });
    }
  };

  const toggleBankSelection = (id: string) => {
    setSelectedBankIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleVyaparSelection = (id: string) => {
    setSelectedVyaparIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Define data first before using in calculations
  const bank = reconciliationData?.bank || { matched: [], unmatched: [], total: 0 };

  // Filter out Payment-In and Sale Order from Vyapar (they don't need bank reconciliation)
  // Sale Order = pending payment (not yet received)
  // Payment-In = internal payment record
  const rawVyapar = reconciliationData?.vyapar || { matched: [], unmatched: [], total: 0 };
  const excludedTypes = ['Payment-In', 'Sale Order'];
  const vyapar = {
    matched: rawVyapar.matched.filter((t: VyaparTransaction) => !excludedTypes.includes(t.transactionType)),
    unmatched: rawVyapar.unmatched.filter((t: VyaparTransaction) => !excludedTypes.includes(t.transactionType)),
    total: rawVyapar.total,
  };
  const summary = reconciliationData?.summary || {
    matchedCount: 0,
    unmatchedBankCount: 0,
    unmatchedVyaparCount: 0,
  };

  // Calculate totals for selected transactions
  const selectedBankTotal = selectedBankIds.reduce((sum, id) => {
    const txn = [...bank.matched, ...bank.unmatched].find(t => t.id === id);
    return sum + (txn?.amount || 0);
  }, 0);

  const selectedVyaparTotal = selectedVyaparIds.reduce((sum, id) => {
    const txn = [...vyapar.matched, ...vyapar.unmatched].find(t => t.id === id);
    return sum + (txn?.amount || 0);
  }, 0);

  // Filter bank transactions based on search
  const filterBankTxn = (txn: BankTransaction) => {
    if (!bankSearch) return true;
    const searchLower = bankSearch.toLowerCase();
    const narration = (txn.narration || '').toLowerCase();
    // Clean search term - remove commas, currency symbols, spaces
    const cleanedSearch = bankSearch.replace(/[₹,\s]/g, '');
    // Check against both raw amount and formatted amount
    const amountStr = txn.amount.toString();
    const formattedAmount = formatCurrency(txn.amount).replace(/[₹,\s]/g, '');
    return narration.includes(searchLower) ||
           amountStr.includes(cleanedSearch) ||
           formattedAmount.includes(cleanedSearch);
  };

  const filteredBankMatched = bank.matched.filter(filterBankTxn);
  const filteredBankUnmatched = bank.unmatched.filter(filterBankTxn);

  // Filter vyapar transactions based on search
  const filterVyaparTxn = (txn: VyaparTransaction) => {
    if (!vyaparSearch) return true;
    const searchLower = vyaparSearch.toLowerCase();
    const partyName = (txn.partyName || '').toLowerCase();
    const invoiceNumber = (txn.invoiceNumber || '').toLowerCase();
    // Clean search term - remove commas, currency symbols, spaces
    const cleanedSearch = vyaparSearch.replace(/[₹,\s]/g, '');
    // Check against both raw amount and formatted amount
    const amountStr = txn.amount.toString();
    const formattedAmount = formatCurrency(txn.amount).replace(/[₹,\s]/g, '');
    return partyName.includes(searchLower) ||
           invoiceNumber.includes(searchLower) ||
           amountStr.includes(cleanedSearch) ||
           formattedAmount.includes(cleanedSearch);
  };

  const filteredVyaparMatched = vyapar.matched.filter(filterVyaparTxn);
  const filteredVyaparUnmatched = vyapar.unmatched.filter(filterVyaparTxn);

  // Handle clicking on a matched bank transaction to show its Vyapar counterpart
  const handleBankMatchClick = (txn: BankTransaction) => {
    if (highlightedMatchBankId === txn.id) {
      // Clear highlight if clicking the same item
      clearMatchHighlight();
    } else {
      setHighlightedMatchBankId(txn.id);
      setHighlightedMatchVyaparId(txn.reconciledWithId || null);
      // Switch Vyapar side to matched view to show the counterpart
      setVyaparFilter('matched');
    }
  };

  // Handle clicking on a matched Vyapar transaction to show its Bank counterpart
  const handleVyaparMatchClick = (txn: VyaparTransaction) => {
    // Find the bank transaction that is reconciled with this Vyapar transaction
    const bankMatch = bank.matched.find((b: BankTransaction) => b.reconciledWithId === txn.id);
    if (highlightedMatchVyaparId === txn.id) {
      // Clear highlight if clicking the same item
      clearMatchHighlight();
    } else {
      setHighlightedMatchVyaparId(txn.id);
      setHighlightedMatchBankId(bankMatch?.id || null);
      // Switch Bank side to matched view to show the counterpart
      setBankFilter('matched');
    }
  };

  // Clear match highlighting
  const clearMatchHighlight = () => {
    setHighlightedMatchBankId(null);
    setHighlightedMatchVyaparId(null);
  };

  // Filter matched transactions based on highlight selection
  const displayedBankMatched = highlightedMatchBankId
    ? filteredBankMatched.filter((t: BankTransaction) => t.id === highlightedMatchBankId)
    : filteredBankMatched;

  const displayedVyaparMatched = highlightedMatchVyaparId
    ? filteredVyaparMatched.filter((t: VyaparTransaction) => t.id === highlightedMatchVyaparId)
    : filteredVyaparMatched;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reconciliation</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Date Range Selector and Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Start Month */}
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground mr-1">From:</span>
              <Button variant="outline" size="icon" onClick={handlePreviousStartMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="w-28 text-center font-medium text-sm">
                {format(parseMonthYear(startMonth), 'MMM yyyy')}
              </span>
              <Button variant="outline" size="icon" onClick={handleNextStartMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* End Month */}
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground mr-1">To:</span>
              <Button variant="outline" size="icon" onClick={handlePreviousEndMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="w-28 text-center font-medium text-sm">
                {format(parseMonthYear(endMonth), 'MMM yyyy')}
              </span>
              <Button variant="outline" size="icon" onClick={handleNextEndMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Accounts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Accounts</SelectItem>
                {accounts.map((account: Account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={() => autoMatchMutation.mutate()} disabled={autoMatchMutation.isPending}>
            <Wand2 className="mr-2 h-4 w-4" />
            Auto Match
          </Button>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Matched</span>
              <Badge variant="success">{summary.matchedCount}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Unmatched Bank</span>
              <Badge variant="destructive">{summary.unmatchedBankCount}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Unmatched Vyapar</span>
              <Badge variant="warning">{summary.unmatchedVyaparCount}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Auto-Match Results */}
      {autoMatchRan && pendingMatches.length === 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Auto-match found no new matches. All reconcilable transactions may already be matched,
            or there are no matching amounts between bank and Vyapar transactions.
            <Button
              variant="ghost"
              size="sm"
              className="ml-2"
              onClick={() => setAutoMatchRan(false)}
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Pending Matches */}
      {pendingMatches.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Suggested Matches ({pendingMatches.length})</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setPendingMatches([]); setAutoMatchRan(false); }}>
                Clear
              </Button>
              <Button
                onClick={() =>
                  applyMatchesMutation.mutate(
                    pendingMatches.map((m) => ({
                      bankTransactionId: m.bankTransactionId,
                      vyaparTransactionId: m.vyaparTransactionId,
                    }))
                  )
                }
              >
                Apply All
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingMatches.slice(0, 5).map((match) => (
                <div
                  key={match.bankTransactionId}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-4">
                    <Badge
                      variant={match.confidence >= 90 ? 'success' : 'warning'}
                    >
                      {match.confidence}%
                    </Badge>
                    <div>
                      <p className="text-sm font-medium">
                        {formatCurrency(match.bankAmount)} ↔ {formatCurrency(match.vyaparAmount)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(match.bankDate)} ↔ {formatDate(match.vyaparDate)}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setPendingMatches((prev) =>
                          prev.filter((m) => m.bankTransactionId !== match.bankTransactionId)
                        )
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        applyMatchesMutation.mutate([
                          {
                            bankTransactionId: match.bankTransactionId,
                            vyaparTransactionId: match.vyaparTransactionId,
                          },
                        ])
                      }
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* How to Reconcile Guide */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>How to reconcile manually:</strong> Click on transactions to select them. You can select multiple bank transactions and/or multiple Vyapar transactions to match together (many-to-many). The difference in totals is shown when both sides are selected. Click "Match Selected" when ready, or use "Auto Match" for automatic 1:1 matching.
        </AlertDescription>
      </Alert>

      {/* Manual Match Action */}
      {(selectedBankIds.length > 0 || selectedVyaparIds.length > 0) && (
        <Card className="border-primary">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className={`rounded-lg p-2 ${selectedBankIds.length > 0 ? 'bg-blue-500/10 text-blue-500' : 'bg-muted text-muted-foreground'}`}>
                <span className="text-sm font-medium">
                  {selectedBankIds.length > 0
                    ? `${selectedBankIds.length} Bank (${formatCurrency(selectedBankTotal)})`
                    : 'Select Bank Txn'}
                </span>
              </div>
              <span className="text-muted-foreground">↔</span>
              <div className={`rounded-lg p-2 ${selectedVyaparIds.length > 0 ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground'}`}>
                <span className="text-sm font-medium">
                  {selectedVyaparIds.length > 0
                    ? `${selectedVyaparIds.length} Vyapar (${formatCurrency(selectedVyaparTotal)})`
                    : 'Select Vyapar Txn'}
                </span>
              </div>
              {selectedBankIds.length > 0 && selectedVyaparIds.length > 0 && (
                <Badge
                  variant={Math.abs(selectedBankTotal - selectedVyaparTotal) < 1 ? 'success' : 'warning'}
                  className="ml-2"
                >
                  Diff: {formatCurrency(Math.abs(selectedBankTotal - selectedVyaparTotal))}
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedBankIds([]);
                  setSelectedVyaparIds([]);
                }}
              >
                Clear Selection
              </Button>
              <Button
                onClick={handleManualMatch}
                disabled={selectedBankIds.length === 0 || selectedVyaparIds.length === 0 || multiMatchMutation.isPending}
              >
                <Link className="mr-2 h-4 w-4" />
                {multiMatchMutation.isPending ? 'Matching...' : 'Match Selected'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Match Pair Viewer */}
      {(highlightedMatchBankId || highlightedMatchVyaparId) && (
        <Alert className="border-blue-500 bg-blue-500/10">
          <Info className="h-4 w-4 text-blue-500" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              Viewing matched pair. Click the highlighted item again or use the button to clear.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={clearMatchHighlight}
              className="ml-4"
            >
              <X className="mr-1 h-3 w-3" />
              Clear Filter
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Split View */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Bank Transactions */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle>Bank Transactions</CardTitle>
            </div>
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name or amount..."
                value={bankSearch}
                onChange={(e) => setBankSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Tabs value={bankFilter} onValueChange={(v) => { setBankFilter(v as FilterStatus); if (v !== 'matched') clearMatchHighlight(); }} className="mt-2">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="all">
                  All ({bank.matched.length + bank.unmatched.length})
                </TabsTrigger>
                <TabsTrigger value="matched">
                  Matched ({highlightedMatchBankId ? `1/${bank.matched.length}` : bank.matched.length})
                </TabsTrigger>
                <TabsTrigger value="unmatched">
                  Unmatched ({bank.unmatched.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex h-64 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : (
              <div className="max-h-[500px] overflow-y-auto">
                {/* Show unmatched transactions */}
                {(bankFilter === 'all' || bankFilter === 'unmatched') &&
                  filteredBankUnmatched.map((txn: BankTransaction) => (
                    <div
                      key={txn.id}
                      className={`flex cursor-pointer items-center justify-between border-b p-4 hover:bg-muted/50 ${
                        selectedBankIds.includes(txn.id) ? 'bg-primary/10 ring-2 ring-primary' : ''
                      }`}
                      onClick={() => toggleBankSelection(txn.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="destructive" className="text-xs">Unmatched</Badge>
                          {selectedBankIds.includes(txn.id) && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                        </div>
                        <p className="text-sm font-medium line-clamp-1 mt-1">{txn.narration}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(txn.date)}</p>
                      </div>
                      <span
                        className={`font-medium ml-2 ${
                          txn.transactionType === 'credit' ? 'text-green-500' : 'text-red-500'
                        }`}
                      >
                        {formatCurrency(txn.amount)}
                      </span>
                    </div>
                  ))}

                {/* Show matched transactions */}
                {(bankFilter === 'all' || bankFilter === 'matched') &&
                  displayedBankMatched.map((txn: BankTransaction) => (
                    <div
                      key={txn.id}
                      className={`flex items-center justify-between border-b p-4 cursor-pointer hover:bg-green-500/10 ${
                        highlightedMatchBankId === txn.id ? 'bg-blue-500/20 ring-2 ring-blue-500' : 'bg-green-500/5'
                      }`}
                      onClick={() => handleBankMatchClick(txn)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="success" className="text-xs">Matched</Badge>
                          {highlightedMatchBankId === txn.id && (
                            <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-500 border-blue-500">
                              Showing Match →
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm font-medium line-clamp-1 mt-1">{txn.narration}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(txn.date)}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        <span
                          className={`font-medium ${
                            txn.transactionType === 'credit' ? 'text-green-500' : 'text-red-500'
                          }`}
                        >
                          {formatCurrency(txn.amount)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => { e.stopPropagation(); unmatchMutation.mutate(txn.id); }}
                          title="Unmatch"
                        >
                          <Unlink className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}

                {/* Empty state */}
                {((bankFilter === 'unmatched' && filteredBankUnmatched.length === 0) ||
                  (bankFilter === 'matched' && filteredBankMatched.length === 0) ||
                  (bankFilter === 'all' && filteredBankMatched.length === 0 && filteredBankUnmatched.length === 0)) && (
                  <div className="flex h-32 items-center justify-center text-muted-foreground">
                    {bankSearch ? 'No matching transactions found' :
                     bankFilter === 'unmatched' ? 'All transactions matched!' :
                     bankFilter === 'matched' ? 'No matched transactions' :
                     'No transactions found'}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Vyapar Transactions */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle>Vyapar Transactions</CardTitle>
            </div>
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by party, invoice or amount..."
                value={vyaparSearch}
                onChange={(e) => setVyaparSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Tabs value={vyaparFilter} onValueChange={(v) => { setVyaparFilter(v as FilterStatus); if (v !== 'matched') clearMatchHighlight(); }} className="mt-2">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="all">
                  All ({vyapar.matched.length + vyapar.unmatched.length})
                </TabsTrigger>
                <TabsTrigger value="matched">
                  Matched ({highlightedMatchVyaparId ? `1/${vyapar.matched.length}` : vyapar.matched.length})
                </TabsTrigger>
                <TabsTrigger value="unmatched">
                  Unmatched ({vyapar.unmatched.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex h-64 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : (
              <div className="max-h-[500px] overflow-y-auto">
                {/* Show unmatched transactions */}
                {(vyaparFilter === 'all' || vyaparFilter === 'unmatched') &&
                  filteredVyaparUnmatched.map((txn: VyaparTransaction) => (
                    <div
                      key={txn.id}
                      className={`flex cursor-pointer items-center justify-between border-b p-4 hover:bg-muted/50 ${
                        selectedVyaparIds.includes(txn.id) ? 'bg-primary/10 ring-2 ring-primary' : ''
                      }`}
                      onClick={() => toggleVyaparSelection(txn.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="warning" className="text-xs">Unmatched</Badge>
                          <Badge variant="secondary" className="text-xs">{txn.transactionType}</Badge>
                          {selectedVyaparIds.includes(txn.id) && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                        </div>
                        <p className="text-sm font-medium line-clamp-1 mt-1">
                          {txn.partyName || txn.invoiceNumber || '-'}
                        </p>
                        <p className="text-xs text-muted-foreground">{formatDate(txn.date)}</p>
                      </div>
                      <span className="font-medium ml-2">{formatCurrency(txn.amount)}</span>
                    </div>
                  ))}

                {/* Show matched transactions */}
                {(vyaparFilter === 'all' || vyaparFilter === 'matched') &&
                  displayedVyaparMatched.map((txn: VyaparTransaction) => (
                    <div
                      key={txn.id}
                      className={`flex items-center justify-between border-b p-4 cursor-pointer hover:bg-green-500/10 ${
                        highlightedMatchVyaparId === txn.id ? 'bg-blue-500/20 ring-2 ring-blue-500' : 'bg-green-500/5'
                      }`}
                      onClick={() => handleVyaparMatchClick(txn)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="success" className="text-xs">Matched</Badge>
                          <Badge variant="secondary" className="text-xs">{txn.transactionType}</Badge>
                          {highlightedMatchVyaparId === txn.id && (
                            <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-500 border-blue-500">
                              ← Showing Match
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm font-medium line-clamp-1 mt-1">
                          {txn.partyName || txn.invoiceNumber || '-'}
                        </p>
                        <p className="text-xs text-muted-foreground">{formatDate(txn.date)}</p>
                      </div>
                      <span className="font-medium ml-2">{formatCurrency(txn.amount)}</span>
                    </div>
                  ))}

                {/* Empty state */}
                {((vyaparFilter === 'unmatched' && filteredVyaparUnmatched.length === 0) ||
                  (vyaparFilter === 'matched' && filteredVyaparMatched.length === 0) ||
                  (vyaparFilter === 'all' && filteredVyaparMatched.length === 0 && filteredVyaparUnmatched.length === 0)) && (
                  <div className="flex h-32 items-center justify-center text-muted-foreground">
                    {vyaparSearch ? 'No matching transactions found' :
                     vyaparFilter === 'unmatched' ? 'All transactions matched!' :
                     vyaparFilter === 'matched' ? 'No matched transactions' :
                     'No transactions found'}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

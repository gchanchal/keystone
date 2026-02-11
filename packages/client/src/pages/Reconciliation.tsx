import { useState, useMemo } from 'react';
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
  UserX,
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
import { ItemDetailsPopover } from '@/components/reconciliation/ItemDetailsPopover';
import { BankDetailsPopover } from '@/components/reconciliation/BankDetailsPopover';
import { reconciliationApi, accountsApi, transactionsApi } from '@/lib/api';
import { formatCurrency, formatDate, getMonthYear, parseMonthYear } from '@/lib/utils';
import { format, addMonths, subMonths, parseISO, differenceInDays } from 'date-fns';
import type { BankTransaction, VyaparTransaction, Account, ReconciliationMatch } from '@/types';

type FilterStatus = 'all' | 'matched' | 'unmatched';
type ViewMode = 'split' | 'matched-pairs';

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
  // State to track which matched transaction is selected to show details
  // We now use a single state to track either bankId or vyaparId being viewed
  const [viewingMatchBankId, setViewingMatchBankId] = useState<string | null>(null);
  const [viewingMatchVyaparId, setViewingMatchVyaparId] = useState<string | null>(null);
  // View mode: 'split' shows side-by-side lists, 'matched-pairs' shows all matched pairs together
  const [viewMode, setViewMode] = useState<ViewMode>('split');

  // Fetch match details when viewing a matched transaction
  const { data: matchDetails, isLoading: matchDetailsLoading } = useQuery({
    queryKey: ['match-details', viewingMatchBankId, viewingMatchVyaparId],
    queryFn: () => {
      if (viewingMatchBankId) {
        return reconciliationApi.getMatchDetails({ bankId: viewingMatchBankId });
      } else if (viewingMatchVyaparId) {
        return reconciliationApi.getMatchDetails({ vyaparId: viewingMatchVyaparId });
      }
      return null;
    },
    enabled: !!(viewingMatchBankId || viewingMatchVyaparId),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.getAll,
  });

  // Create account lookup map for displaying account names
  const accountMap = useMemo(() => {
    return new Map<string, string>(accounts.map((a: Account) => [a.id, a.name]));
  }, [accounts]);

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
      clearMatchHighlight();
    },
  });

  const unmatchVyaparMutation = useMutation({
    mutationFn: reconciliationApi.unmatchVyapar,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
      clearMatchHighlight();
    },
  });

  // Mark bank transaction as personal (removes it from business reconciliation)
  const markPersonalMutation = useMutation({
    mutationFn: (bankId: string) => transactionsApi.updateBankPurpose(bankId, 'personal'),
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

  // Handle clicking on a matched bank transaction to show match details
  const handleBankMatchClick = (txn: BankTransaction) => {
    if (viewingMatchBankId === txn.id) {
      // Clear if clicking the same item
      clearMatchHighlight();
    } else {
      setViewingMatchBankId(txn.id);
      setViewingMatchVyaparId(null);
    }
  };

  // Handle clicking on a matched Vyapar transaction to show match details
  const handleVyaparMatchClick = (txn: VyaparTransaction) => {
    if (viewingMatchVyaparId === txn.id) {
      // Clear if clicking the same item
      clearMatchHighlight();
    } else {
      setViewingMatchVyaparId(txn.id);
      setViewingMatchBankId(null);
    }
  };

  // Clear match viewing
  const clearMatchHighlight = () => {
    setViewingMatchBankId(null);
    setViewingMatchVyaparId(null);
  };

  // Filter matched transactions based on highlight selection
  const displayedBankMatched = viewingMatchBankId
    ? filteredBankMatched.filter((t: BankTransaction) => t.id === viewingMatchBankId)
    : filteredBankMatched;

  const displayedVyaparMatched = viewingMatchVyaparId
    ? filteredVyaparMatched.filter((t: VyaparTransaction) => t.id === viewingMatchVyaparId)
    : filteredVyaparMatched;

  // ============================================
  // Smart Match Suggestions
  // ============================================

  // Determine if Vyapar transaction type means money coming IN or going OUT
  const isVyaparIncoming = (txnType: string): boolean => {
    // Sale = money coming in (customer pays us)
    return txnType === 'Sale';
  };

  const isVyaparOutgoing = (txnType: string): boolean => {
    // Expense, Purchase, Payment-Out = money going out (we pay someone)
    return ['Expense', 'Purchase', 'Payment-Out'].includes(txnType);
  };

  // Check if bank and vyapar transaction directions are compatible
  const areDirectionsCompatible = (bankTxnType: string, vyaparTxnType: string): boolean => {
    const bankIsCredit = bankTxnType === 'credit'; // Money coming in
    const vyaparIsIncoming = isVyaparIncoming(vyaparTxnType); // Sale = money coming in
    const vyaparIsOutgoing = isVyaparOutgoing(vyaparTxnType); // Expense/Purchase = money going out

    // Credit (money in) should match with Sale (money in)
    if (bankIsCredit && vyaparIsIncoming) return true;
    // Debit (money out) should match with Expense/Purchase/Payment-Out (money out)
    if (!bankIsCredit && vyaparIsOutgoing) return true;

    return false;
  };

  // Calculate potential match score (higher = better match)
  const calculateMatchScore = (amount1: number, date1: string, amount2: number, date2: string): number => {
    // Amount similarity (within 25% is good, exact is best)
    const amountDelta = Math.abs(amount1 - amount2) / Math.max(amount1, amount2);
    if (amountDelta > 0.30) return 0; // More than 30% difference = not a match

    // Date proximity (within 7 days is good)
    const daysDiff = Math.abs(differenceInDays(parseISO(date1), parseISO(date2)));
    if (daysDiff > 14) return 0; // More than 14 days apart = not a match

    // Score: exact amount = 100 base, exact date adds 50, fuzzy reduces
    let score = 100 - (amountDelta * 200); // 0% delta = 100, 25% delta = 50
    score += Math.max(0, 50 - (daysDiff * 5)); // Same day = +50, 7 days = +15

    return Math.round(score);
  };

  // Get the first selected bank transaction for matching suggestions
  const primarySelectedBank = selectedBankIds.length > 0
    ? [...bank.unmatched, ...bank.matched].find(t => t.id === selectedBankIds[0])
    : null;

  // Get the first selected vyapar transaction for matching suggestions
  const primarySelectedVyapar = selectedVyaparIds.length > 0
    ? [...vyapar.unmatched, ...vyapar.matched].find(t => t.id === selectedVyaparIds[0])
    : null;

  // Calculate potential matches for Vyapar side when bank is selected
  const vyaparPotentialMatches = new Map<string, number>();
  if (primarySelectedBank) {
    filteredVyaparUnmatched.forEach((vyaparTxn: VyaparTransaction) => {
      // Check direction compatibility first
      if (!areDirectionsCompatible(primarySelectedBank.transactionType, vyaparTxn.transactionType)) {
        return; // Skip - directions don't match (e.g., credit vs expense)
      }

      const score = calculateMatchScore(
        primarySelectedBank.amount,
        primarySelectedBank.date,
        vyaparTxn.amount,
        vyaparTxn.date
      );
      if (score > 0) {
        vyaparPotentialMatches.set(vyaparTxn.id, score);
      }
    });
  }

  // Calculate potential matches for Bank side when vyapar is selected
  const bankPotentialMatches = new Map<string, number>();
  if (primarySelectedVyapar) {
    filteredBankUnmatched.forEach((bankTxn: BankTransaction) => {
      // Check direction compatibility first
      if (!areDirectionsCompatible(bankTxn.transactionType, primarySelectedVyapar.transactionType)) {
        return; // Skip - directions don't match (e.g., debit vs sale)
      }

      const score = calculateMatchScore(
        primarySelectedVyapar.amount,
        primarySelectedVyapar.date,
        bankTxn.amount,
        bankTxn.date
      );
      if (score > 0) {
        bankPotentialMatches.set(bankTxn.id, score);
      }
    });
  }

  // Sort unmatched transactions: potential matches first (by score), then by date
  const sortedBankUnmatched = [...filteredBankUnmatched].sort((a, b) => {
    const scoreA = bankPotentialMatches.get(a.id) || 0;
    const scoreB = bankPotentialMatches.get(b.id) || 0;
    if (scoreA !== scoreB) return scoreB - scoreA; // Higher score first
    return new Date(b.date).getTime() - new Date(a.date).getTime(); // Then by date desc
  });

  const sortedVyaparUnmatched = [...filteredVyaparUnmatched].sort((a, b) => {
    const scoreA = vyaparPotentialMatches.get(a.id) || 0;
    const scoreB = vyaparPotentialMatches.get(b.id) || 0;
    if (scoreA !== scoreB) return scoreB - scoreA; // Higher score first
    return new Date(b.date).getTime() - new Date(a.date).getTime(); // Then by date desc
  });

  // Helper to get match quality label
  const getMatchQuality = (score: number): { label: string; variant: 'success' | 'warning' | 'secondary' } => {
    if (score >= 130) return { label: 'Likely Match', variant: 'success' };
    if (score >= 80) return { label: 'Possible Match', variant: 'warning' };
    return { label: 'Weak Match', variant: 'secondary' };
  };

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
      <div className="grid gap-4 md:grid-cols-4">
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
        <Card
          className={`cursor-pointer transition-colors ${viewMode === 'matched-pairs' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
          onClick={() => setViewMode(viewMode === 'matched-pairs' ? 'split' : 'matched-pairs')}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {viewMode === 'matched-pairs' ? 'Back to Split View' : 'View All Pairs'}
              </span>
              <Link className={`h-4 w-4 ${viewMode === 'matched-pairs' ? 'text-primary' : 'text-muted-foreground'}`} />
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

      {/* Match Pair Detail Panel - shows both sides of a matched pair */}
      {(viewingMatchBankId || viewingMatchVyaparId) && (
        <Card className="border-blue-500 bg-blue-500/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-blue-500 flex items-center gap-2">
                <Link className="h-5 w-5" />
                Matched Pair Details
                {matchDetails?.matchType === 'multi' && (
                  <Badge variant="secondary" className="ml-2">Multi-Match</Badge>
                )}
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={clearMatchHighlight}
              >
                <X className="mr-1 h-3 w-3" />
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {matchDetailsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="ml-2 text-muted-foreground">Loading match details...</span>
              </div>
            ) : matchDetails ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Bank Transactions Side */}
                  <div className="rounded-lg border border-blue-300 bg-blue-50 dark:bg-blue-950/30 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Badge className="bg-blue-500">Bank</Badge>
                      {matchDetails.bankTransactions.length > 1 && (
                        <Badge variant="outline">{matchDetails.bankTransactions.length} transactions</Badge>
                      )}
                    </div>
                    {matchDetails.bankTransactions.length > 0 ? (
                      <div className="space-y-3 max-h-64 overflow-y-auto">
                        {matchDetails.bankTransactions.map((txn: BankTransaction) => (
                          <div key={txn.id} className="border-b border-blue-200 pb-2 last:border-0 last:pb-0">
                            <div className="flex items-center justify-between">
                              <Badge variant={txn.transactionType === 'credit' ? 'success' : 'destructive'} className="text-xs">
                                {txn.transactionType === 'credit' ? 'Credit' : 'Debit'}
                              </Badge>
                              <p className={`font-bold ${txn.transactionType === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                                {formatCurrency(txn.amount)}
                              </p>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{formatDate(txn.date)}</p>
                            <p className="text-sm line-clamp-2 mt-1">{txn.narration}</p>
                          </div>
                        ))}
                        <div className="pt-2 border-t border-blue-200">
                          <p className="text-xs text-muted-foreground">Total</p>
                          <p className="font-bold text-blue-600">
                            {formatCurrency(matchDetails.bankTransactions.reduce((sum: number, t: BankTransaction) => sum + t.amount, 0))}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No bank transactions found</p>
                    )}
                  </div>

                  {/* Vyapar Transactions Side */}
                  <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Badge className="bg-green-600">Vyapar</Badge>
                      {matchDetails.vyaparTransactions.length > 1 && (
                        <Badge variant="outline">{matchDetails.vyaparTransactions.length} transactions</Badge>
                      )}
                    </div>
                    {matchDetails.vyaparTransactions.length > 0 ? (
                      <div className="space-y-3 max-h-64 overflow-y-auto">
                        {matchDetails.vyaparTransactions.map((txn: VyaparTransaction) => (
                          <div key={txn.id} className="border-b border-green-200 pb-2 last:border-0 last:pb-0">
                            <div className="flex items-center justify-between">
                              <Badge variant="secondary" className="text-xs">{txn.transactionType}</Badge>
                              <p className="font-bold">{formatCurrency(txn.amount)}</p>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{formatDate(txn.date)}</p>
                            <p className="text-sm font-medium line-clamp-1 mt-1">{txn.partyName || '-'}</p>
                            {txn.invoiceNumber && (
                              <p className="text-xs text-muted-foreground">Invoice: {txn.invoiceNumber}</p>
                            )}
                          </div>
                        ))}
                        <div className="pt-2 border-t border-green-200">
                          <p className="text-xs text-muted-foreground">Total</p>
                          <p className="font-bold text-green-600">
                            {formatCurrency(matchDetails.vyaparTransactions.reduce((sum: number, t: VyaparTransaction) => sum + t.amount, 0))}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No Vyapar transactions found</p>
                    )}
                  </div>
                </div>

                {/* Amount difference indicator */}
                {matchDetails.bankTransactions.length > 0 && matchDetails.vyaparTransactions.length > 0 && (() => {
                  const bankTotal = matchDetails.bankTransactions.reduce((sum: number, t: BankTransaction) => sum + t.amount, 0);
                  const vyaparTotal = matchDetails.vyaparTransactions.reduce((sum: number, t: VyaparTransaction) => sum + t.amount, 0);
                  const diff = Math.abs(bankTotal - vyaparTotal);
                  return (
                    <div className="mt-4 text-center">
                      {diff < 1 ? (
                        <Badge variant="success" className="text-sm">
                          <Check className="mr-1 h-3 w-3" />
                          Totals Match Exactly
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="text-sm">
                          Difference: {formatCurrency(diff)}
                        </Badge>
                      )}
                    </div>
                  );
                })()}

                {/* Unmatch button */}
                <div className="mt-4 flex justify-center">
                  {matchDetails.matchGroupId ? (
                    <Button
                      variant="outline"
                      className="text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
                      onClick={() => {
                        unmatchMutation.mutate(matchDetails.bankTransactions[0]?.id);
                        clearMatchHighlight();
                      }}
                    >
                      <Unlink className="mr-2 h-4 w-4" />
                      Unmatch All
                    </Button>
                  ) : matchDetails.bankTransactions[0] && (
                    <Button
                      variant="outline"
                      className="text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
                      onClick={() => {
                        unmatchMutation.mutate(matchDetails.bankTransactions[0].id);
                        clearMatchHighlight();
                      }}
                    >
                      <Unlink className="mr-2 h-4 w-4" />
                      Unmatch
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-center py-4">Could not load match details</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Matched Pairs View */}
      {viewMode === 'matched-pairs' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link className="h-5 w-5" />
              All Matched Pairs ({bank.matched.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {bank.matched.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No matched transactions yet. Use the split view to manually match or run Auto Match.
                </div>
              ) : (
                bank.matched.map((bankTxn: BankTransaction) => {
                  const vyaparTxn = vyapar.matched.find((v: VyaparTransaction) => v.id === bankTxn.reconciledWithId);
                  return (
                    <div
                      key={bankTxn.id}
                      className="rounded-lg border p-4 hover:bg-muted/30 transition-colors"
                    >
                      <div className="grid gap-4 md:grid-cols-2">
                        {/* Bank Side */}
                        <div className="space-y-1 border-r pr-4">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-blue-500 text-xs">Bank</Badge>
                            <Badge variant={bankTxn.transactionType === 'credit' ? 'success' : 'destructive'} className="text-xs">
                              {bankTxn.transactionType === 'credit' ? 'Credit' : 'Debit'}
                            </Badge>
                          </div>
                          <p className={`text-lg font-bold ${bankTxn.transactionType === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(bankTxn.amount)}
                          </p>
                          <p className="text-sm text-muted-foreground">{formatDate(bankTxn.date)}</p>
                          <p className="text-sm line-clamp-1">{bankTxn.narration}</p>
                        </div>

                        {/* Vyapar Side */}
                        <div className="space-y-1 pl-4">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-green-600 text-xs">Vyapar</Badge>
                            {vyaparTxn && <Badge variant="secondary" className="text-xs">{vyaparTxn.transactionType}</Badge>}
                          </div>
                          {vyaparTxn ? (
                            <>
                              <p className="text-lg font-bold">{formatCurrency(vyaparTxn.amount)}</p>
                              <p className="text-sm text-muted-foreground">{formatDate(vyaparTxn.date)}</p>
                              <p className="text-sm font-medium line-clamp-1">
                                {vyaparTxn.partyName || vyaparTxn.invoiceNumber || '-'}
                              </p>
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">Vyapar record not found (ID: {bankTxn.reconciledWithId})</p>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between mt-3 pt-3 border-t">
                        <div>
                          {vyaparTxn && Math.abs(bankTxn.amount - vyaparTxn.amount) < 1 ? (
                            <Badge variant="outline" className="text-green-600 border-green-600 text-xs">
                              <Check className="mr-1 h-3 w-3" />
                              Exact Match
                            </Badge>
                          ) : vyaparTxn ? (
                            <Badge variant="outline" className="text-amber-600 border-amber-600 text-xs">
                              Diff: {formatCurrency(Math.abs(bankTxn.amount - vyaparTxn.amount))}
                            </Badge>
                          ) : null}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => unmatchMutation.mutate(bankTxn.id)}
                        >
                          <Unlink className="mr-1 h-3 w-3" />
                          Unmatch
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Split View */}
      {viewMode === 'split' && <div className="grid gap-6 lg:grid-cols-2">
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
                  Matched ({viewingMatchBankId ? `1/${bank.matched.length}` : bank.matched.length})
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
                  sortedBankUnmatched.map((txn: BankTransaction) => {
                    const matchScore = bankPotentialMatches.get(txn.id);
                    const matchQuality = matchScore ? getMatchQuality(matchScore) : null;
                    return (
                      <div
                        key={txn.id}
                        className={`flex cursor-pointer items-center justify-between border-b p-4 hover:bg-muted/50 ${
                          selectedBankIds.includes(txn.id) ? 'bg-primary/10 ring-2 ring-primary' :
                          matchScore ? 'bg-amber-500/5 border-l-2 border-l-amber-500' : ''
                        }`}
                        onClick={() => toggleBankSelection(txn.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="destructive" className="text-xs">Unmatched</Badge>
                            {matchQuality && (
                              <Badge variant={matchQuality.variant} className="text-xs">
                                {matchQuality.label}
                              </Badge>
                            )}
                            {selectedBankIds.includes(txn.id) && (
                              <Check className="h-4 w-4 text-primary" />
                            )}
                          </div>
                          <p className="text-sm font-medium line-clamp-1 mt-1">{txn.narration}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-xs text-muted-foreground">{formatDate(txn.date)}</p>
                            <BankDetailsPopover
                              narration={txn.narration}
                              date={txn.date}
                              amount={txn.amount}
                              transactionType={txn.transactionType as 'credit' | 'debit'}
                              balance={txn.balance}
                              accountName={accountMap.get(txn.accountId)}
                            />
                          </div>
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
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-orange-600"
                            onClick={(e) => {
                              e.stopPropagation();
                              markPersonalMutation.mutate(txn.id);
                            }}
                            title="Mark as Personal (exclude from business)"
                          >
                            <UserX className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}

                {/* Show matched transactions */}
                {(bankFilter === 'all' || bankFilter === 'matched') &&
                  displayedBankMatched.map((txn: BankTransaction) => (
                    <div
                      key={txn.id}
                      className={`flex items-center justify-between border-b p-4 cursor-pointer hover:bg-green-500/10 ${
                        viewingMatchBankId === txn.id ? 'bg-blue-500/20 ring-2 ring-blue-500' : 'bg-green-500/5'
                      }`}
                      onClick={() => handleBankMatchClick(txn)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="success" className="text-xs">Matched</Badge>
                          {viewingMatchBankId === txn.id && (
                            <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-500 border-blue-500">
                              Showing Match →
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm font-medium line-clamp-1 mt-1">{txn.narration}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-xs text-muted-foreground">{formatDate(txn.date)}</p>
                          <BankDetailsPopover
                            narration={txn.narration}
                            date={txn.date}
                            amount={txn.amount}
                            transactionType={txn.transactionType as 'credit' | 'debit'}
                            balance={txn.balance}
                            accountName={accountMap.get(txn.accountId)}
                          />
                        </div>
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
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive border-destructive/50 hover:bg-destructive hover:text-destructive-foreground"
                          onClick={(e) => { e.stopPropagation(); unmatchMutation.mutate(txn.id); }}
                          title="Unmatch this transaction"
                        >
                          <Unlink className="h-3 w-3 mr-1" />
                          Unmatch
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
                  Matched ({viewingMatchVyaparId ? `1/${vyapar.matched.length}` : vyapar.matched.length})
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
                  sortedVyaparUnmatched.map((txn: VyaparTransaction) => {
                    const matchScore = vyaparPotentialMatches.get(txn.id);
                    const matchQuality = matchScore ? getMatchQuality(matchScore) : null;
                    return (
                      <div
                        key={txn.id}
                        className={`flex cursor-pointer items-center justify-between border-b p-4 hover:bg-muted/50 ${
                          selectedVyaparIds.includes(txn.id) ? 'bg-primary/10 ring-2 ring-primary' :
                          matchScore ? 'bg-amber-500/5 border-l-2 border-l-amber-500' : ''
                        }`}
                        onClick={() => toggleVyaparSelection(txn.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="warning" className="text-xs">Unmatched</Badge>
                            <Badge variant="secondary" className="text-xs">{txn.transactionType}</Badge>
                            {matchQuality && (
                              <Badge variant={matchQuality.variant} className="text-xs">
                                {matchQuality.label}
                              </Badge>
                            )}
                            {selectedVyaparIds.includes(txn.id) && (
                              <Check className="h-4 w-4 text-primary" />
                            )}
                          </div>
                          <p className="text-sm font-medium line-clamp-1 mt-1">
                            {txn.partyName || txn.invoiceNumber || '-'}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-xs text-muted-foreground">{formatDate(txn.date)}</p>
                            <ItemDetailsPopover
                              invoiceNumber={txn.invoiceNumber}
                              transactionType={txn.transactionType}
                              partyName={txn.partyName || undefined}
                              date={txn.date}
                            />
                          </div>
                        </div>
                        <span className="font-medium ml-2">{formatCurrency(txn.amount)}</span>
                      </div>
                    );
                  })}

                {/* Show matched transactions */}
                {(vyaparFilter === 'all' || vyaparFilter === 'matched') &&
                  displayedVyaparMatched.map((txn: VyaparTransaction) => (
                    <div
                      key={txn.id}
                      className={`flex items-center justify-between border-b p-4 cursor-pointer hover:bg-green-500/10 ${
                        viewingMatchVyaparId === txn.id ? 'bg-blue-500/20 ring-2 ring-blue-500' : 'bg-green-500/5'
                      }`}
                      onClick={() => handleVyaparMatchClick(txn)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="success" className="text-xs">Matched</Badge>
                          <Badge variant="secondary" className="text-xs">{txn.transactionType}</Badge>
                          {viewingMatchVyaparId === txn.id && (
                            <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-500 border-blue-500">
                              ← Showing Match
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm font-medium line-clamp-1 mt-1">
                          {txn.partyName || txn.invoiceNumber || '-'}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-xs text-muted-foreground">{formatDate(txn.date)}</p>
                          <ItemDetailsPopover
                            invoiceNumber={txn.invoiceNumber}
                            transactionType={txn.transactionType}
                            partyName={txn.partyName || undefined}
                            date={txn.date}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        <span className="font-medium">{formatCurrency(txn.amount)}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive border-destructive/50 hover:bg-destructive hover:text-destructive-foreground"
                          onClick={(e) => { e.stopPropagation(); unmatchVyaparMutation.mutate(txn.id); }}
                          title="Unmatch this transaction"
                        >
                          <Unlink className="h-3 w-3 mr-1" />
                          Unmatch
                        </Button>
                      </div>
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
      </div>}
    </div>
  );
}

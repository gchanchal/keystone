import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  MoreVertical,
  Trash2,
  Building2,
  Upload,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PieChart } from '@/components/charts/PieChart';
import { BarChart } from '@/components/charts/BarChart';
import { mutualFundsApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

// Function to categorize fund as Equity or Debt based on scheme name
function categorizeFund(schemeName: string): 'Equity' | 'Debt' | 'Hybrid' {
  const lower = schemeName.toLowerCase();
  if (lower.includes('liquid') || lower.includes('debt') || lower.includes('gilt') ||
      lower.includes('bond') || lower.includes('money market') || lower.includes('overnight') ||
      lower.includes('ultra short') || lower.includes('low duration') || lower.includes('corporate bond')) {
    return 'Debt';
  }
  if (lower.includes('hybrid') || lower.includes('balanced') || lower.includes('dynamic asset') ||
      lower.includes('equity savings') || lower.includes('arbitrage')) {
    return 'Hybrid';
  }
  return 'Equity';
}

interface MutualFundHolding {
  id: string;
  folioId: string;
  schemeName: string;
  schemeCode: string | null;
  isin: string | null;
  schemeType: string | null;
  schemeCategory: string | null;
  units: number;
  costValue: number;
  currentValue: number | null;
  nav: number | null;
  navDate: string | null;
  absoluteReturn: number | null;
  absoluteReturnPercent: number | null;
  xirr: number | null;
  isActive: boolean;
  lastUpdated: string | null;
  createdAt: string;
  folioNumber: string;
  amcName: string;
  registrar: string | null;
}

interface MutualFundSummary {
  totalCostValue: number;
  totalCurrentValue: number;
  totalAbsoluteReturn: number;
  totalAbsoluteReturnPercent: number;
  holdingsCount: number;
  folioCount: number;
  byAmc: Array<{
    amcName: string;
    totalValue: number;
    totalCost: number;
    holdingsCount: number;
  }>;
}

// AMC color mapping
const amcColors: Record<string, string> = {
  'ICICI Prudential': '#004B8D',
  'Kotak Mahindra': '#ED1C24',
  'Mirae Asset': '#0066B3',
  'Motilal Oswal': '#00A650',
  'Nippon India': '#E31837',
  'Parag Parikh': '#1E3A5F',
  'SBI Mutual Fund': '#003366',
  'HDFC Mutual Fund': '#004C8F',
  'Axis Mutual Fund': '#97144D',
  'Aditya Birla': '#F7A800',
  'DSP Mutual Fund': '#003B73',
  'UTI Mutual Fund': '#F47920',
};

const getAmcColor = (amc: string): string => {
  for (const [key, color] of Object.entries(amcColors)) {
    if (amc.toLowerCase().includes(key.toLowerCase().split(' ')[0])) {
      return color;
    }
  }
  return '#6b7280';
};

export function MutualFunds() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('all');
  const [navDialogOpen, setNavDialogOpen] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState<MutualFundHolding | null>(null);
  const [newNav, setNewNav] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [holdingToDelete, setHoldingToDelete] = useState<MutualFundHolding | null>(null);

  const { data: holdings = [], isLoading } = useQuery({
    queryKey: ['mutual-funds', 'holdings'],
    queryFn: mutualFundsApi.getHoldings,
  });

  const { data: summary } = useQuery<MutualFundSummary>({
    queryKey: ['mutual-funds', 'summary'],
    queryFn: mutualFundsApi.getSummary,
  });

  const updateNavMutation = useMutation({
    mutationFn: ({ id, nav }: { id: string; nav: number }) =>
      mutualFundsApi.updateNAV(id, nav),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mutual-funds'] });
      setNavDialogOpen(false);
      setSelectedHolding(null);
      setNewNav('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: mutualFundsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mutual-funds'] });
      setDeleteDialogOpen(false);
      setHoldingToDelete(null);
    },
  });

  const [syncResult, setSyncResult] = useState<{ updated: number; failed: number; errors: string[] } | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);

  const syncNavMutation = useMutation({
    mutationFn: mutualFundsApi.syncNAV,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['mutual-funds'] });
      setSyncResult(data);
      setSyncDialogOpen(true);
    },
  });

  // Group holdings by AMC
  const holdingsByAmc = holdings.reduce((acc: Record<string, MutualFundHolding[]>, h: MutualFundHolding) => {
    const key = h.amcName || 'Other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(h);
    return acc;
  }, {});

  const amcNames = Object.keys(holdingsByAmc).sort();

  // Prepare bar chart data for AMC allocation
  const amcBarData = summary?.byAmc?.map((amc) => ({
    name: amc.amcName.split(' ')[0], // Shorten name for chart
    value: amc.totalValue,
  })) || [];

  // Prepare Equity vs Debt data
  const equityDebtData = holdings.reduce((acc: Record<string, number>, h: MutualFundHolding) => {
    const category = categorizeFund(h.schemeName);
    acc[category] = (acc[category] || 0) + (h.currentValue || h.costValue);
    return acc;
  }, {});

  const equityDebtPieData = Object.entries(equityDebtData).map(([name, value]) => ({
    name,
    value,
    color: name === 'Equity' ? '#22c55e' : name === 'Debt' ? '#3b82f6' : '#f59e0b',
  }));

  const handleUpdateNav = (holding: MutualFundHolding) => {
    setSelectedHolding(holding);
    setNewNav(String(holding.nav || 0));
    setNavDialogOpen(true);
  };

  const handleDelete = (holding: MutualFundHolding) => {
    setHoldingToDelete(holding);
    setDeleteDialogOpen(true);
  };

  const renderHoldingsTable = (holdingsList: MutualFundHolding[]) => (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium">Scheme</th>
            <th className="px-4 py-3 text-right text-sm font-medium">Units</th>
            <th className="px-4 py-3 text-right text-sm font-medium">NAV</th>
            <th className="px-4 py-3 text-right text-sm font-medium">Cost</th>
            <th className="px-4 py-3 text-right text-sm font-medium">Current</th>
            <th className="px-4 py-3 text-right text-sm font-medium">Return</th>
            <th className="px-4 py-3 text-center text-sm font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {holdingsList.map((h) => {
            const returnPercent = h.absoluteReturnPercent || 0;
            const returnAmount = h.absoluteReturn || 0;
            const isPositive = returnPercent >= 0;

            return (
              <tr key={h.id} className="hover:bg-muted/50">
                <td className="px-4 py-3">
                  <div className="max-w-[300px]">
                    <p className="font-medium truncate" title={h.schemeName}>
                      {h.schemeName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Folio: {h.folioNumber} {h.registrar && `| ${h.registrar}`}
                    </p>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-sm">
                  {h.units.toFixed(3)}
                </td>
                <td className="px-4 py-3 text-right text-sm">
                  <div>
                    {h.nav?.toFixed(4)}
                    {h.navDate && (
                      <p className="text-xs text-muted-foreground">{h.navDate}</p>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-sm">
                  {formatCurrency(h.costValue)}
                </td>
                <td className="px-4 py-3 text-right text-sm font-medium">
                  {formatCurrency(h.currentValue || h.costValue)}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {isPositive ? (
                      <TrendingUp className="h-4 w-4 text-green-500" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-500" />
                    )}
                    <div>
                      <p className={`text-sm font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                        {isPositive ? '+' : ''}{returnPercent.toFixed(2)}%
                      </p>
                      <p className={`text-xs ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                        {isPositive ? '+' : ''}{formatCurrency(returnAmount)}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleUpdateNav(h)}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Update NAV
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => handleDelete(h)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
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
  );

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/investments')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Mutual Funds - India</h1>
            <p className="text-sm text-muted-foreground">
              {summary?.holdingsCount || 0} schemes across {summary?.folioCount || 0} folios
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => syncNavMutation.mutate()}
            disabled={syncNavMutation.isPending || holdings.length === 0}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${syncNavMutation.isPending ? 'animate-spin' : ''}`} />
            {syncNavMutation.isPending ? 'Syncing...' : 'Sync NAV'}
          </Button>
          <Button onClick={() => navigate('/uploads')}>
            <Upload className="mr-2 h-4 w-4" />
            Import CAMS Statement
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Total Invested</p>
            <p className="text-2xl font-bold">
              {formatCurrency(summary?.totalCostValue || 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Current Value</p>
            <p className="text-2xl font-bold">
              {formatCurrency(summary?.totalCurrentValue || 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Total Gain/Loss</p>
            <p className={`text-2xl font-bold ${
              (summary?.totalAbsoluteReturn || 0) >= 0 ? 'text-green-500' : 'text-red-500'
            }`}>
              {(summary?.totalAbsoluteReturn || 0) >= 0 ? '+' : ''}
              {formatCurrency(summary?.totalAbsoluteReturn || 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Returns</p>
            <p className={`text-2xl font-bold ${
              (summary?.totalAbsoluteReturnPercent || 0) >= 0 ? 'text-green-500' : 'text-red-500'
            }`}>
              {(summary?.totalAbsoluteReturnPercent || 0) >= 0 ? '+' : ''}
              {(summary?.totalAbsoluteReturnPercent || 0).toFixed(2)}%
            </p>
          </CardContent>
        </Card>
      </div>

      {holdings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Mutual Fund Holdings</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Import your CAMS or KFINTECH statement to see your mutual fund portfolio
            </p>
            <Button onClick={() => navigate('/uploads')}>
              <Upload className="mr-2 h-4 w-4" />
              Import Statement
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Charts Row */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* AMC Allocation Bar Chart */}
            <Card>
              <CardHeader>
                <CardTitle>AMC Allocation</CardTitle>
              </CardHeader>
              <CardContent>
                {amcBarData.length > 0 ? (
                  <BarChart
                    data={amcBarData}
                    xKey="name"
                    yKeys={[{ key: 'value', color: '#6366f1', name: 'Value' }]}
                    height={250}
                  />
                ) : (
                  <div className="flex h-[250px] items-center justify-center text-muted-foreground">
                    No data available
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Equity vs Debt Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Equity vs Debt</CardTitle>
              </CardHeader>
              <CardContent>
                {equityDebtPieData.length > 0 ? (
                  <>
                    <PieChart data={equityDebtPieData} height={200} showLegend={false} />
                    <div className="mt-4 flex justify-center gap-6">
                      {equityDebtPieData.map((item) => (
                        <div key={item.name} className="flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="text-sm">{item.name}</span>
                          <span className="text-sm font-medium">
                            {formatCurrency(item.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex h-[250px] items-center justify-center text-muted-foreground">
                    No data available
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Holdings Full Width */}
          <Card>
            <CardHeader className="pb-0">
              <CardTitle>Holdings</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="px-6 pt-4">
                  <TabsList className="w-full overflow-x-auto flex justify-start">
                    <TabsTrigger value="all">
                      All ({holdings.length})
                    </TabsTrigger>
                    {amcNames.slice(0, 5).map((amc) => (
                      <TabsTrigger key={amc} value={amc}>
                        {amc.split(' ')[0]} ({holdingsByAmc[amc].length})
                      </TabsTrigger>
                    ))}
                    {amcNames.length > 5 && (
                      <TabsTrigger value="other">
                        Others ({amcNames.slice(5).reduce((sum, amc) => sum + holdingsByAmc[amc].length, 0)})
                      </TabsTrigger>
                    )}
                  </TabsList>
                </div>

                <TabsContent value="all" className="m-0">
                  {renderHoldingsTable(holdings)}
                </TabsContent>

                {amcNames.map((amc) => (
                  <TabsContent key={amc} value={amc} className="m-0">
                    {renderHoldingsTable(holdingsByAmc[amc])}
                  </TabsContent>
                ))}

                {amcNames.length > 5 && (
                  <TabsContent value="other" className="m-0">
                    {renderHoldingsTable(
                      amcNames.slice(5).flatMap((amc) => holdingsByAmc[amc])
                    )}
                  </TabsContent>
                )}
              </Tabs>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Update NAV Dialog */}
      <Dialog open={navDialogOpen} onOpenChange={setNavDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Update NAV</DialogTitle>
          </DialogHeader>
          {selectedHolding && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {selectedHolding.schemeName}
              </p>
              <div className="space-y-2">
                <Label>New NAV</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={newNav}
                  onChange={(e) => setNewNav(e.target.value)}
                  placeholder="Enter new NAV"
                />
              </div>
              <div className="text-sm text-muted-foreground">
                <p>Units: {selectedHolding.units.toFixed(3)}</p>
                <p>
                  New Value: {formatCurrency(
                    selectedHolding.units * (parseFloat(newNav) || 0)
                  )}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNavDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                selectedHolding &&
                updateNavMutation.mutate({
                  id: selectedHolding.id,
                  nav: parseFloat(newNav) || 0,
                })
              }
            >
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Holding</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this holding? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {holdingToDelete && (
            <p className="text-sm font-medium py-2">{holdingToDelete.schemeName}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => holdingToDelete && deleteMutation.mutate(holdingToDelete.id)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sync Result Dialog */}
      <Dialog open={syncDialogOpen} onOpenChange={setSyncDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>NAV Sync Complete</DialogTitle>
          </DialogHeader>
          {syncResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-4">
                  <p className="text-sm text-muted-foreground">Updated</p>
                  <p className="text-2xl font-bold text-green-600">{syncResult.updated}</p>
                </div>
                <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-4">
                  <p className="text-sm text-muted-foreground">Failed</p>
                  <p className="text-2xl font-bold text-red-600">{syncResult.failed}</p>
                </div>
              </div>
              {syncResult.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Errors:</p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {syncResult.errors.map((err, i) => (
                      <p key={i} className="text-xs text-muted-foreground">{err}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setSyncDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

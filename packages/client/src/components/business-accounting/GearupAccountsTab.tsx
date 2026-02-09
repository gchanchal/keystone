import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CreditCard,
  Check,
  X,
  ArrowRight,
  Loader2,
  FileSpreadsheet,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { businessAccountingApi } from '@/lib/api';

interface AccountInfo {
  id: string;
  name: string;
  bankName: string;
  accountNumber: string | null;
  accountType: string;
  cardName: string | null;
  isGearupBusiness: boolean;
}

interface GearupAccountsResponse {
  personal: AccountInfo[];
  gearup: AccountInfo[];
  all: AccountInfo[];
}

export function GearupAccountsTab() {
  const queryClient = useQueryClient();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Fetch accounts
  const { data, isLoading, error } = useQuery<GearupAccountsResponse>({
    queryKey: ['gearup-accounts'],
    queryFn: () => businessAccountingApi.getGearupAccounts(),
  });

  // Toggle account mutation
  const toggleMutation = useMutation({
    mutationFn: (accountId: string) => businessAccountingApi.toggleGearupAccount(accountId),
    onMutate: (accountId) => {
      setTogglingId(accountId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gearup-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['business-accounting-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['business-accounting-summary'] });
    },
    onSettled: () => {
      setTogglingId(null);
    },
  });

  const handleToggle = (accountId: string) => {
    toggleMutation.mutate(accountId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-red-500">Failed to load accounts. This feature is exclusive to authorized users.</p>
        </CardContent>
      </Card>
    );
  }

  const accounts = data?.all || [];
  const gearupAccounts = accounts.filter(a => a.isGearupBusiness);
  const personalAccounts = accounts.filter(a => !a.isGearupBusiness);

  // Separate by type - exclude Vyapar from bank accounts
  const bankAccounts = accounts.filter(a => a.accountType !== 'credit_card' && a.accountType !== 'vyapar');
  const creditCards = accounts.filter(a => a.accountType === 'credit_card');
  const dataSources = accounts.filter(a => a.accountType === 'vyapar');

  const getAccountIcon = (accountType: string) => {
    if (accountType === 'credit_card') {
      return <CreditCard className="h-5 w-5" />;
    }
    if (accountType === 'vyapar') {
      return <FileSpreadsheet className="h-5 w-5" />;
    }
    return <Building2 className="h-5 w-5" />;
  };

  const formatAccountNumber = (num: string | null) => {
    if (!num) return '';
    return `****${num.slice(-4)}`;
  };

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">GearUp Mods Accounts</CardTitle>
            <CardDescription>Accounts linked to business accounting</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">{gearupAccounts.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {gearupAccounts.filter(a => a.accountType !== 'credit_card').length} bank accounts,{' '}
              {gearupAccounts.filter(a => a.accountType === 'credit_card').length} credit cards
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Personal Only</CardTitle>
            <CardDescription>Accounts not shared with GearUp</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{personalAccounts.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Available to add to GearUp Mods
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Bank Accounts Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Bank Accounts
          </CardTitle>
          <CardDescription>
            Toggle the switch to share an account with GearUp Mods business accounting
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bankAccounts.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No bank accounts found</p>
          ) : (
            <div className="space-y-3">
              {bankAccounts.map((account) => (
                <div
                  key={account.id}
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    account.isGearupBusiness
                      ? 'bg-primary/5 border-primary/20'
                      : 'bg-muted/30'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-full ${
                      account.isGearupBusiness ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                      {getAccountIcon(account.accountType)}
                    </div>
                    <div>
                      <div className="font-medium">{account.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {account.bankName} {formatAccountNumber(account.accountNumber)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {account.isGearupBusiness && (
                      <Badge variant="default" className="bg-primary">
                        GearUp Mods
                      </Badge>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {account.isGearupBusiness ? 'Shared' : 'Personal'}
                      </span>
                      <Switch
                        checked={account.isGearupBusiness}
                        onCheckedChange={() => handleToggle(account.id)}
                        disabled={togglingId === account.id}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Credit Cards Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Credit Cards
          </CardTitle>
          <CardDescription>
            Share credit cards to track business expenses
          </CardDescription>
        </CardHeader>
        <CardContent>
          {creditCards.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No credit cards found</p>
          ) : (
            <div className="space-y-3">
              {creditCards.map((account) => (
                <div
                  key={account.id}
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    account.isGearupBusiness
                      ? 'bg-primary/5 border-primary/20'
                      : 'bg-muted/30'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-full ${
                      account.isGearupBusiness ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                      {getAccountIcon(account.accountType)}
                    </div>
                    <div>
                      <div className="font-medium">
                        {account.cardName || account.name}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {account.bankName} {formatAccountNumber(account.accountNumber)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {account.isGearupBusiness && (
                      <Badge variant="default" className="bg-primary">
                        GearUp Mods
                      </Badge>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {account.isGearupBusiness ? 'Shared' : 'Personal'}
                      </span>
                      <Switch
                        checked={account.isGearupBusiness}
                        onCheckedChange={() => handleToggle(account.id)}
                        disabled={togglingId === account.id}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data Sources Section (Vyapar) */}
      {dataSources.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Data Sources
            </CardTitle>
            <CardDescription>
              External data sources like Vyapar for sales and inventory tracking
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {dataSources.map((source) => (
                <div
                  key={source.id}
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    source.isGearupBusiness
                      ? 'bg-primary/5 border-primary/20'
                      : 'bg-muted/30'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-full ${
                      source.isGearupBusiness ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                      {getAccountIcon(source.accountType)}
                    </div>
                    <div>
                      <div className="font-medium">{source.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {source.bankName}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {source.isGearupBusiness && (
                      <Badge variant="default" className="bg-primary">
                        GearUp Mods
                      </Badge>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {source.isGearupBusiness ? 'Enabled' : 'Disabled'}
                      </span>
                      <Switch
                        checked={source.isGearupBusiness}
                        onCheckedChange={() => handleToggle(source.id)}
                        disabled={togglingId === source.id}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Help Text */}
      <Card className="bg-muted/30">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <ArrowRight className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground">How it works:</p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li><strong>Shared accounts</strong> appear in both Personal and GearUp Mods sections</li>
                <li><strong>Personal only accounts</strong> are hidden from GearUp Mods business accounting</li>
                <li>Transactions from shared accounts can be enriched with business details (vendor, type, invoices)</li>
                <li>GST tracking and invoice management is available for GearUp Mods accounts</li>
                <li><strong>Vyapar</strong> data source provides sales and inventory transactions</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

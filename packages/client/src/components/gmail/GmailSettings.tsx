import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Mail,
  RefreshCw,
  Unlink,
  History,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { gmailApi } from '@/lib/api';
import type { GmailConnection, GmailSyncState, SyncResult, GmailConfig } from '@/types';
import { format, subMonths } from 'date-fns';

export function GmailSettings() {
  const queryClient = useQueryClient();
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<GmailConnection | null>(null);
  const [syncOptions, setSyncOptions] = useState({
    syncType: 'incremental' as 'historical' | 'incremental',
    afterDate: '',
    banks: [] as string[],
    maxEmails: 200,
  });
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Check URL for OAuth callback results
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const gmailStatus = urlParams.get('gmail');
    const email = urlParams.get('email');

    if (gmailStatus === 'success' && email) {
      // Clear URL params
      window.history.replaceState({}, '', window.location.pathname);
      // Refresh connections
      queryClient.invalidateQueries({ queryKey: ['gmail-connections'] });
    } else if (gmailStatus === 'error') {
      const message = urlParams.get('message') || 'Unknown error';
      console.error('Gmail OAuth error:', message);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [queryClient]);

  // Fetch Gmail config
  const { data: config } = useQuery<GmailConfig>({
    queryKey: ['gmail-config'],
    queryFn: gmailApi.getConfig,
  });

  // Fetch connections
  const { data: connections = [], isLoading: connectionsLoading } = useQuery<GmailConnection[]>({
    queryKey: ['gmail-connections'],
    queryFn: gmailApi.getConnections,
    enabled: config?.configured,
  });

  // Fetch sync history for selected connection
  const { data: syncHistory = [] } = useQuery<GmailSyncState[]>({
    queryKey: ['gmail-sync-history', selectedConnection?.id],
    queryFn: () => gmailApi.getSyncHistory(selectedConnection!.id, 10),
    enabled: !!selectedConnection && historyDialogOpen,
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: gmailApi.disconnect,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gmail-connections'] });
    },
  });

  // Handle connect button
  const handleConnect = async () => {
    try {
      const { url } = await gmailApi.getAuthUrl();
      window.location.href = url;
    } catch (error) {
      console.error('Error getting auth URL:', error);
    }
  };

  // Handle sync
  const handleSync = async () => {
    if (!selectedConnection) return;

    setIsSyncing(true);
    setSyncResult(null);

    try {
      const result = await gmailApi.sync({
        connectionId: selectedConnection.id,
        syncType: syncOptions.syncType,
        afterDate: syncOptions.afterDate || undefined,
        banks: syncOptions.banks.length > 0 ? syncOptions.banks : undefined,
        maxEmails: syncOptions.maxEmails,
      });
      setSyncResult(result);
      queryClient.invalidateQueries({ queryKey: ['gmail-connections'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    } catch (error) {
      console.error('Sync error:', error);
      setSyncResult({
        syncId: '',
        status: 'failed',
        processedCount: 0,
        matchedCount: 0,
        newTransactions: 0,
        duplicates: 0,
        errors: 0,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // Open sync dialog
  const openSyncDialog = (connection: GmailConnection) => {
    setSelectedConnection(connection);
    setSyncResult(null);
    setSyncOptions({
      syncType: 'incremental',
      afterDate: '',
      banks: [],
      maxEmails: 200,
    });
    setSyncDialogOpen(true);
  };

  // Open history dialog
  const openHistoryDialog = (connection: GmailConnection) => {
    setSelectedConnection(connection);
    setHistoryDialogOpen(true);
  };

  if (!config?.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Gmail Integration
          </CardTitle>
          <CardDescription>
            Automatically import transaction alerts from your email
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Gmail OAuth is not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET
              environment variables on the server to enable this feature.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Gmail Integration
        </CardTitle>
        <CardDescription>
          Automatically import transaction alerts from your email
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Supported Banks */}
        <div className="flex flex-wrap gap-2">
          <span className="text-sm text-muted-foreground mr-2">Supported banks:</span>
          {config.supportedBanks.map((bank) => (
            <Badge key={bank} variant="secondary">
              {bank}
            </Badge>
          ))}
        </div>

        {/* Connected Accounts */}
        {connectionsLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : connections.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <Mail className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 font-semibold">No Gmail accounts connected</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Connect your Gmail to automatically import bank transaction alerts
            </p>
            <Button className="mt-4" onClick={handleConnect}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Connect Gmail
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {connections.map((connection) => (
              <div
                key={connection.id}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{connection.email}</p>
                    <p className="text-sm text-muted-foreground">
                      {connection.lastSyncAt
                        ? `Last sync: ${format(new Date(connection.lastSyncAt), 'PPp')}`
                        : 'Never synced'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openHistoryDialog(connection)}
                  >
                    <History className="mr-2 h-4 w-4" />
                    History
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => openSyncDialog(connection)}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Sync Now
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => disconnectMutation.mutate(connection.id)}
                  >
                    <Unlink className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}

            <Button variant="outline" onClick={handleConnect} className="w-full">
              <ExternalLink className="mr-2 h-4 w-4" />
              Connect Another Account
            </Button>
          </div>
        )}

        {/* Sync Dialog */}
        <Dialog open={syncDialogOpen} onOpenChange={setSyncDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Sync Emails</DialogTitle>
              <DialogDescription>
                Import transaction alerts from {selectedConnection?.email}
              </DialogDescription>
            </DialogHeader>

            {!syncResult ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Sync Type</Label>
                  <Select
                    value={syncOptions.syncType}
                    onValueChange={(v: 'historical' | 'incremental') =>
                      setSyncOptions({ ...syncOptions, syncType: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="incremental">
                        Incremental (New emails since last sync)
                      </SelectItem>
                      <SelectItem value="historical">
                        Historical (All matching emails)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {syncOptions.syncType === 'historical' && (
                  <div className="space-y-2">
                    <Label>Start Date (Optional)</Label>
                    <Select
                      value={syncOptions.afterDate}
                      onValueChange={(v) =>
                        setSyncOptions({ ...syncOptions, afterDate: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select start date" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">All time</SelectItem>
                        <SelectItem value={format(subMonths(new Date(), 1), 'yyyy-MM-dd')}>
                          Last 1 month
                        </SelectItem>
                        <SelectItem value={format(subMonths(new Date(), 3), 'yyyy-MM-dd')}>
                          Last 3 months
                        </SelectItem>
                        <SelectItem value={format(subMonths(new Date(), 6), 'yyyy-MM-dd')}>
                          Last 6 months
                        </SelectItem>
                        <SelectItem value={format(subMonths(new Date(), 12), 'yyyy-MM-dd')}>
                          Last 12 months
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Banks to Include</Label>
                  <div className="flex flex-wrap gap-2">
                    {config?.supportedBanks.map((bank) => (
                      <Badge
                        key={bank}
                        variant={syncOptions.banks.includes(bank) ? 'default' : 'outline'}
                        className="cursor-pointer"
                        onClick={() => {
                          if (syncOptions.banks.includes(bank)) {
                            setSyncOptions({
                              ...syncOptions,
                              banks: syncOptions.banks.filter((b) => b !== bank),
                            });
                          } else {
                            setSyncOptions({
                              ...syncOptions,
                              banks: [...syncOptions.banks, bank],
                            });
                          }
                        }}
                      >
                        {bank}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Click to select. Leave empty to include all supported banks.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Max Emails to Process</Label>
                  <Select
                    value={String(syncOptions.maxEmails)}
                    onValueChange={(v) =>
                      setSyncOptions({ ...syncOptions, maxEmails: parseInt(v) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="200">200</SelectItem>
                      <SelectItem value="500">500</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {syncResult.status === 'completed' ? (
                  <Alert>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <AlertDescription>Sync completed successfully!</AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>
                      Sync failed: {syncResult.errorMessage}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted p-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Processed</p>
                    <p className="text-2xl font-bold">{syncResult.processedCount}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Matched</p>
                    <p className="text-2xl font-bold">{syncResult.matchedCount}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">New Transactions</p>
                    <p className="text-2xl font-bold text-green-500">
                      {syncResult.newTransactions}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Duplicates</p>
                    <p className="text-2xl font-bold text-yellow-500">
                      {syncResult.duplicates}
                    </p>
                  </div>
                  {syncResult.errors > 0 && (
                    <div className="col-span-2">
                      <p className="text-sm text-muted-foreground">Errors</p>
                      <p className="text-2xl font-bold text-red-500">
                        {syncResult.errors}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            <DialogFooter>
              {!syncResult ? (
                <>
                  <Button variant="outline" onClick={() => setSyncDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSync} disabled={isSyncing}>
                    {isSyncing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Start Sync
                      </>
                    )}
                  </Button>
                </>
              ) : (
                <Button onClick={() => setSyncDialogOpen(false)}>Close</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* History Dialog */}
        <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Sync History</DialogTitle>
              <DialogDescription>{selectedConnection?.email}</DialogDescription>
            </DialogHeader>

            <div className="max-h-[400px] overflow-y-auto space-y-3">
              {syncHistory.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No sync history yet
                </p>
              ) : (
                syncHistory.map((sync) => (
                  <div
                    key={sync.id}
                    className="rounded-lg border p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {sync.status === 'completed' ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : sync.status === 'failed' ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                        <Badge variant={sync.syncType === 'historical' ? 'default' : 'secondary'}>
                          {sync.syncType}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {sync.createdAt && format(new Date(sync.createdAt), 'PPp')}
                      </span>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span>
                        Processed: <strong>{sync.processedCount}</strong>
                      </span>
                      <span>
                        Matched: <strong>{sync.matchedCount}</strong>
                      </span>
                    </div>
                    {sync.errorMessage && (
                      <p className="text-xs text-red-500">{sync.errorMessage}</p>
                    )}
                  </div>
                ))
              )}
            </div>

            <DialogFooter>
              <Button onClick={() => setHistoryDialogOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export default GmailSettings;

import { Router } from 'express';
import { z } from 'zod';
import * as gmailService from '../services/gmail-service.js';
import * as gmailSyncService from '../services/gmail-sync-service.js';
import { getSupportedBanks } from '../parsers/email-parsers/index.js';

const router = Router();

/**
 * GET /api/gmail/config
 * Check if Gmail OAuth is configured
 */
router.get('/config', (_req, res) => {
  res.json({
    configured: gmailService.isGmailConfigured(),
    supportedBanks: getSupportedBanks(),
  });
});

/**
 * GET /api/gmail/auth/url
 * Get OAuth authorization URL
 */
router.get('/auth/url', (_req, res) => {
  try {
    if (!gmailService.isGmailConfigured()) {
      return res.status(503).json({
        error: 'Gmail OAuth not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.',
      });
    }

    const authUrl = gmailService.getAuthUrl();
    res.json({ url: authUrl });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

/**
 * GET /api/gmail/oauth/callback
 * OAuth callback - exchanges code for tokens and saves connection
 */
router.get('/oauth/callback', async (req, res) => {
  try {
    const code = req.query.code as string;

    if (!code) {
      return res.redirect('http://localhost:5173/settings?gmail=error&message=No+authorization+code');
    }

    // Exchange code for tokens
    const tokens = await gmailService.exchangeCodeForTokens(code);

    // Get user email
    const email = await gmailService.getUserEmail(tokens.accessToken);

    // Save connection
    await gmailService.saveConnection(email, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiry: tokens.tokenExpiry,
      scope: tokens.scope,
    });

    // Redirect to frontend with success
    res.redirect(`http://localhost:5173/settings?gmail=success&email=${encodeURIComponent(email)}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.redirect(`http://localhost:5173/settings?gmail=error&message=${encodeURIComponent(message)}`);
  }
});

/**
 * GET /api/gmail/connections
 * List all connected Gmail accounts
 */
router.get('/connections', async (_req, res) => {
  try {
    const connections = await gmailService.getConnections();

    // Don't expose tokens in API response
    const safeConnections = connections.map(conn => ({
      id: conn.id,
      email: conn.email,
      isActive: conn.isActive,
      lastSyncAt: conn.lastSyncAt,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    }));

    res.json(safeConnections);
  } catch (error) {
    console.error('Error fetching connections:', error);
    res.status(500).json({ error: 'Failed to fetch connections' });
  }
});

/**
 * GET /api/gmail/connections/:id
 * Get a single connection
 */
router.get('/connections/:id', async (req, res) => {
  try {
    const connection = await gmailService.getConnection(req.params.id);

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    res.json({
      id: connection.id,
      email: connection.email,
      isActive: connection.isActive,
      lastSyncAt: connection.lastSyncAt,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    });
  } catch (error) {
    console.error('Error fetching connection:', error);
    res.status(500).json({ error: 'Failed to fetch connection' });
  }
});

/**
 * DELETE /api/gmail/connections/:id
 * Disconnect a Gmail account
 */
router.delete('/connections/:id', async (req, res) => {
  try {
    await gmailService.disconnectGmail(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting Gmail:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// Sync request schema
const syncSchema = z.object({
  connectionId: z.string().uuid(),
  syncType: z.enum(['historical', 'incremental']),
  afterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  beforeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  banks: z.array(z.enum(['HDFC', 'ICICI', 'Kotak', 'Axis'])).optional(),
  maxEmails: z.number().int().min(1).max(1000).optional(),
});

/**
 * POST /api/gmail/sync
 * Trigger email sync for a connection
 */
router.post('/sync', async (req, res) => {
  try {
    const data = syncSchema.parse(req.body);

    // Verify connection exists
    const connection = await gmailService.getConnection(data.connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Start sync
    const result = await gmailSyncService.syncGmailTransactions(data.connectionId, {
      syncType: data.syncType,
      afterDate: data.afterDate,
      beforeDate: data.beforeDate,
      banks: data.banks,
      maxEmails: data.maxEmails,
    });

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }
    console.error('Error syncing Gmail:', error);
    res.status(500).json({ error: 'Failed to sync emails' });
  }
});

/**
 * GET /api/gmail/connections/:id/sync-history
 * Get sync history for a connection
 */
router.get('/connections/:id/sync-history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const history = await gmailSyncService.getSyncHistory(req.params.id, limit);
    res.json(history);
  } catch (error) {
    console.error('Error fetching sync history:', error);
    res.status(500).json({ error: 'Failed to fetch sync history' });
  }
});

/**
 * GET /api/gmail/connections/:id/emails
 * Get processed emails for a connection
 */
router.get('/connections/:id/emails', async (req, res) => {
  try {
    const status = req.query.status as 'success' | 'failed' | 'skipped' | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const emails = await gmailSyncService.getProcessedEmails(req.params.id, {
      status,
      limit,
      offset,
    });

    // Don't expose full raw content in list view
    const safeEmails = emails.map(email => ({
      id: email.id,
      gmailMessageId: email.gmailMessageId,
      fromAddress: email.fromAddress,
      subject: email.subject,
      receivedAt: email.receivedAt,
      bankName: email.bankName,
      parseStatus: email.parseStatus,
      transactionId: email.transactionId,
      transactionType: email.transactionType,
      errorMessage: email.errorMessage,
      createdAt: email.createdAt,
    }));

    res.json(safeEmails);
  } catch (error) {
    console.error('Error fetching processed emails:', error);
    res.status(500).json({ error: 'Failed to fetch processed emails' });
  }
});

/**
 * GET /api/gmail/sync/:id
 * Get sync state by ID
 */
router.get('/sync/:id', async (req, res) => {
  try {
    const syncState = await gmailSyncService.getSyncState(req.params.id);

    if (!syncState) {
      return res.status(404).json({ error: 'Sync not found' });
    }

    res.json(syncState);
  } catch (error) {
    console.error('Error fetching sync state:', error);
    res.status(500).json({ error: 'Failed to fetch sync state' });
  }
});

export default router;

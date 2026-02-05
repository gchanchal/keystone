import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import { db, gmailConnections } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import type { GmailConnection, NewGmailConnection } from '../db/index.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * Create OAuth2 client with credentials from environment
 */
export function createOAuth2Client() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost:3001/api/gmail/oauth/callback';

  if (!clientId || !clientSecret) {
    throw new Error('Gmail OAuth credentials not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET environment variables.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Generate OAuth authorization URL
 */
export function getAuthUrl(): string {
  const oauth2Client = createOAuth2Client();

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent to always get refresh token
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string) {
  const oauth2Client = createOAuth2Client();

  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Failed to obtain access and refresh tokens');
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    scope: tokens.scope || SCOPES.join(' '),
  };
}

/**
 * Get user's email address using OAuth tokens
 */
export async function getUserEmail(accessToken: string): Promise<string> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();

  if (!data.email) {
    throw new Error('Could not retrieve user email');
  }

  return data.email;
}

/**
 * Refresh access token for a connection
 */
export async function refreshAccessToken(connectionId: string): Promise<string> {
  const connections = await db
    .select()
    .from(gmailConnections)
    .where(eq(gmailConnections.id, connectionId))
    .limit(1);

  if (connections.length === 0) {
    throw new Error('Connection not found');
  }

  const connection = connections[0];
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: connection.refreshToken });

  const { credentials } = await oauth2Client.refreshAccessToken();

  if (!credentials.access_token) {
    throw new Error('Failed to refresh access token');
  }

  // Update connection with new access token
  const now = new Date().toISOString();
  await db
    .update(gmailConnections)
    .set({
      accessToken: credentials.access_token,
      tokenExpiry: credentials.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : connection.tokenExpiry,
      updatedAt: now,
    })
    .where(eq(gmailConnections.id, connectionId));

  return credentials.access_token;
}

/**
 * Get authenticated Gmail client for a connection
 */
export async function getGmailClient(connectionId: string) {
  const connections = await db
    .select()
    .from(gmailConnections)
    .where(eq(gmailConnections.id, connectionId))
    .limit(1);

  if (connections.length === 0) {
    throw new Error('Connection not found');
  }

  const connection = connections[0];

  // Check if token is expired and refresh if needed
  let accessToken = connection.accessToken;
  if (connection.tokenExpiry) {
    const expiryDate = new Date(connection.tokenExpiry);
    const now = new Date();
    // Refresh if token expires in less than 5 minutes
    if (expiryDate.getTime() - now.getTime() < 5 * 60 * 1000) {
      accessToken = await refreshAccessToken(connectionId);
    }
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Search for transaction emails in Gmail
 */
export async function searchTransactionEmails(
  connectionId: string,
  options: {
    query: string;
    maxResults?: number;
    pageToken?: string;
  }
) {
  const gmail = await getGmailClient(connectionId);

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: options.query,
    maxResults: options.maxResults || 100,
    pageToken: options.pageToken,
  });

  return {
    messages: response.data.messages || [],
    nextPageToken: response.data.nextPageToken,
    resultSizeEstimate: response.data.resultSizeEstimate,
  };
}

/**
 * Fetch full email content by message ID
 */
export async function fetchEmailContent(connectionId: string, messageId: string) {
  const gmail = await getGmailClient(connectionId);

  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const message = response.data;

  // Extract headers
  const headers = message.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

  const from = getHeader('From');
  const subject = getHeader('Subject');
  const date = getHeader('Date');

  // Extract body
  let body = '';
  const payload = message.payload;

  if (payload) {
    body = extractBodyFromPart(payload);
  }

  return {
    id: message.id,
    threadId: message.threadId,
    from,
    subject,
    date,
    body,
    internalDate: message.internalDate,
    snippet: message.snippet,
  };
}

/**
 * Extract body text from email payload (handles multipart)
 */
function extractBodyFromPart(part: any): string {
  if (part.body?.data) {
    return decodeBase64(part.body.data);
  }

  if (part.parts) {
    // Look for text/plain first, then text/html
    for (const subpart of part.parts) {
      if (subpart.mimeType === 'text/plain' && subpart.body?.data) {
        return decodeBase64(subpart.body.data);
      }
    }
    // Fallback to html
    for (const subpart of part.parts) {
      if (subpart.mimeType === 'text/html' && subpart.body?.data) {
        return stripHtml(decodeBase64(subpart.body.data));
      }
    }
    // Recursively check nested parts
    for (const subpart of part.parts) {
      const body = extractBodyFromPart(subpart);
      if (body) return body;
    }
  }

  return '';
}

/**
 * Decode base64 URL-safe string
 */
function decodeBase64(data: string): string {
  // Replace URL-safe characters
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Strip HTML tags from string
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Save a new Gmail connection
 */
export async function saveConnection(
  email: string,
  tokens: {
    accessToken: string;
    refreshToken: string;
    tokenExpiry: string | null;
    scope: string;
  }
): Promise<GmailConnection> {
  // Check if connection already exists for this email
  const existing = await db
    .select()
    .from(gmailConnections)
    .where(eq(gmailConnections.email, email))
    .limit(1);

  const now = new Date().toISOString();

  if (existing.length > 0) {
    // Update existing connection
    await db
      .update(gmailConnections)
      .set({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiry: tokens.tokenExpiry || now,
        scope: tokens.scope,
        isActive: true,
        updatedAt: now,
      })
      .where(eq(gmailConnections.id, existing[0].id));

    const updated = await db
      .select()
      .from(gmailConnections)
      .where(eq(gmailConnections.id, existing[0].id))
      .limit(1);

    return updated[0];
  }

  // Create new connection
  const newConnection: NewGmailConnection = {
    id: uuidv4(),
    email,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenExpiry: tokens.tokenExpiry || now,
    scope: tokens.scope,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(gmailConnections).values(newConnection);

  return newConnection as GmailConnection;
}

/**
 * Get all Gmail connections
 */
export async function getConnections(userId?: string): Promise<GmailConnection[]> {
  if (userId) {
    return db.select().from(gmailConnections).where(
      and(eq(gmailConnections.isActive, true), eq(gmailConnections.userId, userId))
    );
  }
  return db.select().from(gmailConnections).where(eq(gmailConnections.isActive, true));
}

/**
 * Get a single connection by ID
 */
export async function getConnection(connectionId: string): Promise<GmailConnection | null> {
  const connections = await db
    .select()
    .from(gmailConnections)
    .where(eq(gmailConnections.id, connectionId))
    .limit(1);

  return connections[0] || null;
}

/**
 * Disconnect a Gmail account (soft delete)
 */
export async function disconnectGmail(connectionId: string): Promise<void> {
  const now = new Date().toISOString();

  await db
    .update(gmailConnections)
    .set({
      isActive: false,
      updatedAt: now,
    })
    .where(eq(gmailConnections.id, connectionId));
}

/**
 * Update last sync time for a connection
 */
export async function updateLastSyncTime(connectionId: string): Promise<void> {
  const now = new Date().toISOString();

  await db
    .update(gmailConnections)
    .set({
      lastSyncAt: now,
      updatedAt: now,
    })
    .where(eq(gmailConnections.id, connectionId));
}

/**
 * Check if Gmail credentials are configured
 */
export function isGmailConfigured(): boolean {
  return !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
}

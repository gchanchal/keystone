import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { db, users, sqlite } from '../db/index.js';
import { eq, isNull } from 'drizzle-orm';
import type { User, NewUser } from '../db/index.js';

const AUTH_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

// Admin email - existing data will be migrated to this user
const ADMIN_EMAIL = 'g.chanchal@gmail.com';

// JWT configuration
const JWT_EXPIRES_IN = '7d';

export interface GoogleUserInfo {
  googleId: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export interface JWTPayload {
  userId: string;
  email: string;
}

/**
 * Create OAuth2 client for authentication (reuses Gmail OAuth credentials)
 */
export function createAuthOAuth2Client() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.AUTH_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback';

  if (!clientId || !clientSecret) {
    throw new Error('OAuth credentials not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET environment variables.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Generate OAuth authorization URL for login
 */
export function getLoginUrl(state?: string): string {
  const oauth2Client = createAuthOAuth2Client();

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: AUTH_SCOPES,
    prompt: 'select_account', // Allow user to select account
    state: state || uuidv4(), // CSRF protection
  });
}

/**
 * Exchange authorization code for tokens and get user info
 */
export async function handleGoogleCallback(code: string): Promise<{ user: User; token: string }> {
  const oauth2Client = createAuthOAuth2Client();

  // Exchange code for tokens
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token) {
    throw new Error('Failed to obtain access token');
  }

  // Get user info from Google
  oauth2Client.setCredentials({ access_token: tokens.access_token });
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();

  if (!data.email || !data.id) {
    throw new Error('Could not retrieve user information from Google');
  }

  const googleUser: GoogleUserInfo = {
    googleId: data.id,
    email: data.email,
    name: data.name || null,
    picture: data.picture || null,
  };

  // Find or create user
  const user = await findOrCreateUser(googleUser);

  // Generate JWT
  const token = generateJWT(user);

  return { user, token };
}

/**
 * Find existing user or create new one, with data migration for admin
 */
export async function findOrCreateUser(googleUser: GoogleUserInfo): Promise<User> {
  const now = new Date().toISOString();

  // Check if user exists by Google ID
  const existingByGoogleId = await db
    .select()
    .from(users)
    .where(eq(users.googleId, googleUser.googleId))
    .limit(1);

  if (existingByGoogleId.length > 0) {
    // Update last login time
    await db
      .update(users)
      .set({
        lastLoginAt: now,
        updatedAt: now,
        name: googleUser.name,
        picture: googleUser.picture,
      })
      .where(eq(users.id, existingByGoogleId[0].id));

    return { ...existingByGoogleId[0], lastLoginAt: now };
  }

  // Check if user exists by email (edge case: same email, different Google account)
  const existingByEmail = await db
    .select()
    .from(users)
    .where(eq(users.email, googleUser.email))
    .limit(1);

  if (existingByEmail.length > 0) {
    // Update with new Google ID
    await db
      .update(users)
      .set({
        googleId: googleUser.googleId,
        lastLoginAt: now,
        updatedAt: now,
        name: googleUser.name,
        picture: googleUser.picture,
      })
      .where(eq(users.id, existingByEmail[0].id));

    return { ...existingByEmail[0], googleId: googleUser.googleId, lastLoginAt: now };
  }

  // Create new user
  const newUser: NewUser = {
    id: uuidv4(),
    email: googleUser.email,
    name: googleUser.name,
    picture: googleUser.picture,
    googleId: googleUser.googleId,
    isActive: true,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(users).values(newUser);

  // If this is the admin email, migrate all orphaned data
  if (googleUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    await migrateOrphanedData(newUser.id);
  }

  return newUser as User;
}

/**
 * Migrate all orphaned data (records with null user_id) to the specified user
 */
async function migrateOrphanedData(userId: string): Promise<void> {
  console.log(`Migrating orphaned data to user ${userId}...`);

  const tables = [
    'accounts',
    'bank_transactions',
    'vyapar_transactions',
    'vyapar_item_details',
    'credit_card_transactions',
    'credit_card_statements',
    'card_holders',
    'investments',
    'investment_history',
    'loans',
    'loan_payments',
    'loan_disbursements',
    'loan_schedule',
    'loan_given_details',
    'uploads',
    'categories',
    'reconciliation_matches',
    'mutual_fund_folios',
    'mutual_fund_holdings',
    'mutual_fund_transactions',
    'mutual_fund_nav_history',
    'assets',
    'policies',
    'policy_payments',
    'fixed_expenses',
    'fixed_expense_payments',
    'recurring_income',
    'income_receipts',
    'gmail_connections',
    'gmail_sync_state',
    'processed_emails',
  ];

  for (const table of tables) {
    try {
      const result = sqlite.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(userId);
      if (result.changes > 0) {
        console.log(`  Migrated ${result.changes} records in ${table}`);
      }
    } catch (error) {
      // Table might not have user_id column yet, skip
      console.log(`  Skipped ${table}: ${(error as Error).message}`);
    }
  }

  console.log('Data migration completed');
}

/**
 * Generate JWT token for user
 */
export function generateJWT(user: User): string {
  const secret = getJWTSecret();

  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
  };

  return jwt.sign(payload, secret, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify and decode JWT token
 */
export function verifyJWT(token: string): JWTPayload {
  const secret = getJWTSecret();

  try {
    return jwt.verify(token, secret) as JWTPayload;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | null> {
  const result = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return result[0] || null;
}

/**
 * Get JWT secret from environment
 */
function getJWTSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    console.warn('WARNING: JWT_SECRET not set, using default. Set JWT_SECRET in production!');
    return 'keystone-default-jwt-secret-change-in-production';
  }

  return secret;
}

/**
 * Check if authentication is configured
 */
export function isAuthConfigured(): boolean {
  return !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
}

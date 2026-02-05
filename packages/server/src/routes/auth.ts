import { Router } from 'express';
import {
  getLoginUrl,
  handleGoogleCallback,
  isAuthConfigured,
  getUserById,
  verifyJWT,
} from '../services/auth-service.js';
import { requireAuth, setAuthCookie, clearAuthCookie } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/auth/google
 * Redirect to Google OAuth login
 */
router.get('/google', (req, res) => {
  try {
    if (!isAuthConfigured()) {
      return res.status(500).json({ error: 'OAuth not configured' });
    }

    const state = req.query.state as string | undefined;
    const authUrl = getLoginUrl(state);

    res.redirect(authUrl);
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to initiate login' });
  }
});

/**
 * GET /api/auth/google/callback
 * Handle OAuth callback from Google
 */
router.get('/google/callback', async (req, res) => {
  try {
    const { code, error: oauthError } = req.query;

    // Frontend URL for redirects
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    if (oauthError) {
      console.error('OAuth error:', oauthError);
      return res.redirect(`${frontendUrl}/login?error=oauth_error`);
    }

    if (!code || typeof code !== 'string') {
      return res.redirect(`${frontendUrl}/login?error=no_code`);
    }

    // Exchange code for tokens and get/create user
    const { user, token } = await handleGoogleCallback(code);

    // Set auth cookie
    setAuthCookie(res, token);

    // Redirect to dashboard
    res.redirect(`${frontendUrl}/`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/login?error=auth_failed`);
  }
});

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
router.get('/me', requireAuth, (req, res) => {
  // User is attached by requireAuth middleware
  const user = req.user!;

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  });
});

/**
 * POST /api/auth/logout
 * Log out the current user
 */
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * GET /api/auth/status
 * Check if user is authenticated (doesn't require auth)
 */
router.get('/status', async (req, res) => {
  try {
    const token = req.cookies?.keystone_auth;

    if (!token) {
      return res.json({ authenticated: false });
    }

    try {
      const payload = verifyJWT(token);
      const user = await getUserById(payload.userId);

      if (user && user.isActive) {
        return res.json({
          authenticated: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            picture: user.picture,
          },
        });
      }
    } catch (error) {
      // Invalid token
    }

    // Clear invalid cookie
    clearAuthCookie(res);
    return res.json({ authenticated: false });
  } catch (error) {
    console.error('Auth status error:', error);
    return res.json({ authenticated: false });
  }
});

/**
 * GET /api/auth/config
 * Check if OAuth is configured
 */
router.get('/config', (req, res) => {
  res.json({
    configured: isAuthConfigured(),
  });
});

/**
 * GET /api/auth/debug
 * Debug OAuth configuration (shows redirect URI being used)
 */
router.get('/debug', (req, res) => {
  const authRedirectUri = process.env.AUTH_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const gmailRedirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost:3001/api/gmail/oauth/callback';

  res.json({
    configured: isAuthConfigured(),
    authRedirectUri,
    frontendUrl,
    gmailRedirectUri,
    hasClientId: !!process.env.GMAIL_CLIENT_ID,
    hasClientSecret: !!process.env.GMAIL_CLIENT_SECRET,
    hasJwtSecret: !!process.env.JWT_SECRET,
  });
});

export default router;

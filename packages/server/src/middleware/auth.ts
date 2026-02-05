import { Request, Response, NextFunction } from 'express';
import { verifyJWT, getUserById, JWTPayload } from '../services/auth-service.js';
import type { User } from '../db/index.js';

// Extend Express Request type to include user info
declare global {
  namespace Express {
    interface Request {
      user?: User;
      userId?: string;
    }
  }
}

const AUTH_COOKIE_NAME = 'keystone_auth';

/**
 * Authentication middleware - requires valid JWT token
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // Get token from cookie
    const token = req.cookies?.[AUTH_COOKIE_NAME];

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify token
    let payload: JWTPayload;
    try {
      payload = verifyJWT(token);
    } catch (error) {
      // Clear invalid cookie
      clearAuthCookie(res);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Get user from database
    const user = await getUserById(payload.userId);

    if (!user) {
      clearAuthCookie(res);
      return res.status(401).json({ error: 'User not found' });
    }

    if (!user.isActive) {
      clearAuthCookie(res);
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    // Attach user to request
    req.user = user;
    req.userId = user.id;

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Optional authentication middleware - attaches user if token is present but doesn't require it
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME];

    if (token) {
      try {
        const payload = verifyJWT(token);
        const user = await getUserById(payload.userId);

        if (user && user.isActive) {
          req.user = user;
          req.userId = user.id;
        }
      } catch (error) {
        // Token invalid, but we don't require auth
      }
    }

    next();
  } catch (error) {
    next();
  }
}

/**
 * Set authentication cookie with JWT token
 */
export function setAuthCookie(res: Response, token: string): void {
  const isProduction = process.env.NODE_ENV === 'production';

  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction, // Only send over HTTPS in production
    sameSite: 'lax', // CSRF protection
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    path: '/',
  });
}

/**
 * Clear authentication cookie (logout)
 */
export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { initializeDatabase } from './db/index.js';

// Routes
import accountsRouter from './routes/accounts.js';
import transactionsRouter from './routes/transactions.js';
import reconciliationRouter from './routes/reconciliation.js';
import uploadsRouter from './routes/uploads.js';
import investmentsRouter from './routes/investments.js';
import loansRouter from './routes/loans.js';
import dashboardRouter from './routes/dashboard.js';
import reportsRouter from './routes/reports.js';
import categoriesRouter from './routes/categories.js';
import mutualFundsRouter from './routes/mutual-funds.js';
import assetsRouter from './routes/assets.js';
import fixedExpensesRouter from './routes/fixed-expenses.js';
import recurringIncomeRouter from './routes/recurring-income.js';
import creditCardsRouter from './routes/credit-cards.js';
import gmailRouter from './routes/gmail.js';
import adminRouter from './routes/admin.js';
import authRouter from './routes/auth.js';
import portfolioRouter from './routes/portfolio.js';
import templatesRouter from './routes/templates.js';
import learnRouter from './routes/learn.js';
import { requireAuth } from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize database
initializeDatabase();

// Middleware
const isProduction = process.env.NODE_ENV === 'production';

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: isProduction ? undefined : false,
}));
app.use(cors({
  origin: isProduction
    ? [process.env.FRONTEND_URL || 'https://keystone.up.railway.app']
    : ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Auth routes (public)
app.use('/api/auth', authRouter);

// Protected API Routes - require authentication
app.use('/api/accounts', requireAuth, accountsRouter);
app.use('/api/transactions', requireAuth, transactionsRouter);
app.use('/api/reconciliation', requireAuth, reconciliationRouter);
app.use('/api/uploads', requireAuth, uploadsRouter);
app.use('/api/investments', requireAuth, investmentsRouter);
app.use('/api/loans', requireAuth, loansRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/reports', requireAuth, reportsRouter);
app.use('/api/categories', requireAuth, categoriesRouter);
app.use('/api/mutual-funds', requireAuth, mutualFundsRouter);
app.use('/api/assets', requireAuth, assetsRouter);
app.use('/api/fixed-expenses', requireAuth, fixedExpensesRouter);
app.use('/api/recurring-income', requireAuth, recurringIncomeRouter);
app.use('/api/credit-cards', requireAuth, creditCardsRouter);
app.use('/api/gmail', requireAuth, gmailRouter);
app.use('/api/admin', requireAuth, adminRouter);
app.use('/api/portfolio', requireAuth, portfolioRouter);
app.use('/api/templates', requireAuth, templatesRouter);
app.use('/api/learn', requireAuth, learnRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files from uploads
app.use('/uploads', express.static(path.join(__dirname, '../../data/uploads')));

// Serve static files from client build in production
if (isProduction) {
  const clientBuildPath = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientBuildPath));

  // Handle client-side routing - serve index.html for non-API routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

// Error handling middleware
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`KeyStone server running on http://localhost:${PORT}`);
});

export default app;

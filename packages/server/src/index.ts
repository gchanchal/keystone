import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize database
initializeDatabase();

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API Routes
app.use('/api/accounts', accountsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/reconciliation', reconciliationRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/investments', investmentsRouter);
app.use('/api/loans', loansRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/mutual-funds', mutualFundsRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/fixed-expenses', fixedExpensesRouter);
app.use('/api/recurring-income', recurringIncomeRouter);
app.use('/api/credit-cards', creditCardsRouter);
app.use('/api/gmail', gmailRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files from uploads
app.use('/uploads', express.static(path.join(__dirname, '../../data/uploads')));

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

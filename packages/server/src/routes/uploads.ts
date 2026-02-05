import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, uploads, bankTransactions, vyaparTransactions, vyaparItemDetails, creditCardTransactions, creditCardStatements, cardHolders, accounts, investments } from '../db/index.js';
import { eq, desc, and, sql } from 'drizzle-orm';
import {
  parseHDFCStatement,
  convertToDBTransactions as convertHDFC,
} from '../parsers/hdfc-parser.js';
import {
  parseKotakStatement,
  convertToDBTransactions as convertKotak,
} from '../parsers/kotak-parser.js';
import {
  parseICICIStatement,
  convertToDBTransactions as convertICICI,
} from '../parsers/icici-parser.js';
import {
  parseVyaparReport,
  parseVyaparItemDetails,
  convertToDBTransactions as convertVyapar,
  convertToDBItemDetails,
} from '../parsers/vyapar-parser.js';
import {
  parseCreditCardStatement,
  parseHDFCInfiniaCreditCard,
  convertToDBTransactions as convertCreditCard,
  type HDFCInfiniaStatementData,
} from '../parsers/credit-card-parser.js';
import {
  convertToDBStatement as convertInfiniaStatement,
  convertToDBCardHolders as convertInfiniaCardHolders,
} from '../parsers/hdfc-infinia-parser.js';
import {
  parseETradePortfolio,
  convertToDBInvestments,
} from '../parsers/etrade-parser.js';
import { parseAxisHomeLoanStatement } from '../parsers/axis-home-loan-parser.js';
import { parseCAMSStatement } from '../parsers/cams-parser.js';
import { detectFileType, type DetectionResult } from '../parsers/file-detector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '../../../data/uploads');

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/pdf',
      'text/csv',
    ];
    const allowedExts = ['.xls', '.xlsx', '.pdf', '.csv'];

    if (
      allowedTypes.includes(file.mimetype) ||
      allowedExts.includes(path.extname(file.originalname).toLowerCase())
    ) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: XLS, XLSX, PDF, CSV'));
    }
  },
});

const router = Router();

// Helper function to check for duplicate bank transactions
async function findDuplicateBankTransactions(
  accountId: string,
  transactions: Array<{ date: string; amount: number; narration?: string; description?: string; reference: string | null }>
): Promise<Set<string>> {
  const duplicateKeys = new Set<string>();

  // Get existing transactions for this account
  const existingTxns = await db
    .select({
      date: bankTransactions.date,
      amount: bankTransactions.amount,
      narration: bankTransactions.narration,
      reference: bankTransactions.reference,
    })
    .from(bankTransactions)
    .where(eq(bankTransactions.accountId, accountId));

  // Create a set of existing transaction signatures
  const existingSignatures = new Set<string>();
  for (const txn of existingTxns) {
    // Create a unique signature: date + amount + reference (or narration hash)
    const signature = createTransactionSignature(txn.date, txn.amount, txn.reference, txn.narration);
    existingSignatures.add(signature);
  }

  // Check each new transaction for duplicates
  for (const txn of transactions) {
    const narration = txn.narration || txn.description || '';
    const signature = createTransactionSignature(txn.date, txn.amount, txn.reference, narration);
    if (existingSignatures.has(signature)) {
      duplicateKeys.add(signature);
    }
  }

  return duplicateKeys;
}

function createTransactionSignature(
  date: string,
  amount: number,
  reference: string | null,
  narration: string | undefined | null
): string {
  // Use reference if available (most unique), otherwise use date + amount + narration prefix
  if (reference) {
    return `${date}|${amount}|${reference}`;
  }
  // Use first 50 chars of narration as part of signature
  const narrationStr = narration || '';
  const narrationPrefix = narrationStr.substring(0, 50).trim();
  return `${date}|${amount}|${narrationPrefix}`;
}

// Get upload history
router.get('/', async (_req, res) => {
  try {
    const allUploads = await db
      .select()
      .from(uploads)
      .orderBy(desc(uploads.createdAt));

    res.json(allUploads);
  } catch (error) {
    console.error('Error fetching uploads:', error);
    res.status(500).json({ error: 'Failed to fetch uploads' });
  }
});

// Auto-detect file type and bank
router.post('/detect', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const buffer = fs.readFileSync(filePath);

    const detection = await detectFileType(buffer, req.file.originalname, req.file.mimetype);

    // Clean up the temp file
    try {
      fs.unlinkSync(filePath);
    } catch {}

    // Map detection to upload types
    let uploadType: string | null = null;
    switch (detection.fileType) {
      case 'bank_statement':
        uploadType = 'bank_statement';
        break;
      case 'vyapar_report':
        uploadType = 'vyapar_report';
        break;
      case 'credit_card':
        uploadType = 'credit_card';
        break;
      case 'credit_card_infinia':
        uploadType = 'credit_card';
        break;
      case 'etrade_portfolio':
        uploadType = 'etrade_portfolio';
        break;
      case 'cams_statement':
        uploadType = 'cams_statement';
        break;
      case 'home_loan_statement':
        uploadType = 'home_loan_statement';
        break;
      default:
        uploadType = null;
    }

    res.json({
      detection,
      uploadType,
      bankName: detection.bankName,
      needsUserInput: detection.confidence === 'low' || !uploadType,
      needsPassword: detection.needsPassword || false,
    });
  } catch (error: any) {
    console.error('Error detecting file type:', error?.message || error);
    res.status(500).json({
      error: 'Failed to detect file type',
      details: error?.message,
      needsUserInput: true
    });
  }
});

// Upload and preview bank statement
router.post('/bank-statement/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { bankName, accountId } = z
      .object({
        bankName: z.enum(['hdfc', 'kotak', 'icici', 'sbi', 'axis', 'other']),
        accountId: z.string(),
      })
      .parse(req.body);

    const filePath = req.file.path;
    const buffer = fs.readFileSync(filePath);

    let transactions;

    switch (bankName) {
      case 'hdfc':
        transactions = parseHDFCStatement(buffer);
        break;
      case 'kotak':
        transactions = await parseKotakStatement(buffer);
        break;
      case 'icici':
        transactions = await parseICICIStatement(buffer);
        break;
      default:
        // Try HDFC format as default for XLS/XLSX
        transactions = parseHDFCStatement(buffer);
    }

    // Check for duplicates
    const duplicateSignatures = await findDuplicateBankTransactions(accountId, transactions);

    // Mark transactions as duplicate or new
    const transactionsWithStatus = transactions.map(txn => {
      // Handle both narration (HDFC) and description (Kotak) field names
      const narration = (txn as any).narration || (txn as any).description || '';
      const signature = createTransactionSignature(txn.date, txn.amount, txn.reference, narration);
      return {
        ...txn,
        isDuplicate: duplicateSignatures.has(signature),
      };
    });

    const newTransactions = transactionsWithStatus.filter(t => !t.isDuplicate);
    const duplicateCount = transactionsWithStatus.filter(t => t.isDuplicate).length;

    // Store upload record
    const now = new Date().toISOString();
    const uploadRecord = {
      id: uuidv4(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadType: 'bank_statement',
      bankName,
      accountId,
      status: 'pending',
      transactionCount: transactions.length,
      errorMessage: null,
      createdAt: now,
      processedAt: null,
    };

    await db.insert(uploads).values(uploadRecord);

    res.json({
      uploadId: uploadRecord.id,
      filename: req.file.originalname,
      transactionCount: transactions.length,
      newTransactionCount: newTransactions.length,
      duplicateCount,
      preview: transactionsWithStatus.slice(0, 10),
      allTransactions: transactionsWithStatus,
    });
  } catch (error: any) {
    console.error('Error previewing bank statement:', error?.message || error);
    console.error('Stack:', error?.stack);
    res.status(500).json({ error: 'Failed to parse file', details: error?.message });
  }
});

// Confirm bank statement import
router.post('/bank-statement/confirm', async (req, res) => {
  try {
    const { uploadId, accountId, transactions, skipDuplicates = true } = z
      .object({
        uploadId: z.string(),
        accountId: z.string(),
        transactions: z.array(z.any()),
        skipDuplicates: z.boolean().optional(),
      })
      .parse(req.body);

    // Check if upload already processed (prevent double submission)
    const existingUpload = await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId))
      .limit(1);

    if (!existingUpload[0]) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    if (existingUpload[0].status === 'completed') {
      return res.status(400).json({ error: 'Upload already processed', alreadyImported: true });
    }

    const now = new Date().toISOString();

    // Filter out duplicates if skipDuplicates is true
    let transactionsToImport = transactions;
    if (skipDuplicates) {
      transactionsToImport = transactions.filter((t: any) => !t.isDuplicate);
    }

    // Convert and insert transactions
    const dbTransactions = transactionsToImport.map((t: any) => ({
      id: uuidv4(),
      accountId,
      date: t.date,
      valueDate: t.valueDate || null,
      narration: t.narration || t.description,
      reference: t.reference || null,
      transactionType: t.transactionType,
      amount: t.amount,
      balance: t.balance || null,
      categoryId: null,
      notes: null,
      isReconciled: false,
      reconciledWithId: null,
      reconciledWithType: null,
      uploadId,
      createdAt: now,
      updatedAt: now,
    }));

    let importedCount = 0;
    for (const txn of dbTransactions) {
      await db.insert(bankTransactions).values(txn);
      importedCount++;
    }

    // Update account balance with last transaction balance (from original order)
    // Find the latest transaction by date to get correct closing balance
    const sortedTransactions = [...transactionsToImport].sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      if (dateA.getTime() !== dateB.getTime()) {
        return dateB.getTime() - dateA.getTime(); // Latest first
      }
      // If same date, use balance to determine order (higher balance = later in day typically)
      return (b.balance || 0) - (a.balance || 0);
    });

    if (sortedTransactions.length > 0 && sortedTransactions[0].balance) {
      await db
        .update(accounts)
        .set({ currentBalance: sortedTransactions[0].balance, updatedAt: now })
        .where(eq(accounts.id, accountId));
    }

    // Update upload status
    await db
      .update(uploads)
      .set({
        status: 'completed',
        transactionCount: importedCount,
        processedAt: now,
      })
      .where(eq(uploads.id, uploadId));

    const skippedCount = transactions.length - importedCount;

    res.json({
      success: true,
      imported: importedCount,
      skipped: skippedCount,
      total: transactions.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error confirming import:', error);
    res.status(500).json({ error: 'Failed to import transactions' });
  }
});

// Upload and preview Vyapar report
router.post('/vyapar/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const buffer = fs.readFileSync(filePath);
    const transactions = parseVyaparReport(buffer);
    const itemDetails = parseVyaparItemDetails(buffer);

    // Check for duplicates
    const existingTxns = await db
      .select({
        date: vyaparTransactions.date,
        amount: vyaparTransactions.amount,
        invoiceNumber: vyaparTransactions.invoiceNumber,
        partyName: vyaparTransactions.partyName,
      })
      .from(vyaparTransactions);

    const existingSignatures = new Set<string>();
    for (const txn of existingTxns) {
      const signature = `${txn.date}|${txn.amount}|${txn.invoiceNumber || ''}|${txn.partyName || ''}`;
      existingSignatures.add(signature);
    }

    const transactionsWithStatus = transactions.map(txn => {
      const signature = `${txn.date}|${txn.amount}|${txn.invoiceNumber || ''}|${txn.partyName || ''}`;
      return {
        ...txn,
        isDuplicate: existingSignatures.has(signature),
      };
    });

    const newTransactions = transactionsWithStatus.filter(t => !t.isDuplicate);
    const duplicateCount = transactionsWithStatus.filter(t => t.isDuplicate).length;

    // Get unique categories from item details for display
    const categories = [...new Set(itemDetails.map(item => item.category).filter(Boolean))];

    const now = new Date().toISOString();
    const uploadRecord = {
      id: uuidv4(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadType: 'vyapar_report',
      bankName: null,
      accountId: null,
      status: 'pending',
      transactionCount: transactions.length,
      errorMessage: null,
      createdAt: now,
      processedAt: null,
    };

    await db.insert(uploads).values(uploadRecord);

    res.json({
      uploadId: uploadRecord.id,
      filename: req.file.originalname,
      transactionCount: transactions.length,
      newTransactionCount: newTransactions.length,
      duplicateCount,
      preview: transactionsWithStatus.slice(0, 10),
      allTransactions: transactionsWithStatus,
      itemDetails: {
        count: itemDetails.length,
        categories,
        preview: itemDetails.slice(0, 10),
        allItems: itemDetails,
      },
    });
  } catch (error) {
    console.error('Error previewing Vyapar report:', error);
    res.status(500).json({ error: 'Failed to parse file' });
  }
});

// Confirm Vyapar import
router.post('/vyapar/confirm', async (req, res) => {
  try {
    const { uploadId, transactions, itemDetails, skipDuplicates = true } = z
      .object({
        uploadId: z.string(),
        transactions: z.array(z.any()),
        itemDetails: z.array(z.any()).optional(),
        skipDuplicates: z.boolean().optional(),
      })
      .parse(req.body);

    // Check if upload already processed (prevent double submission)
    const existingUpload = await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId))
      .limit(1);

    if (!existingUpload[0]) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    if (existingUpload[0].status === 'completed') {
      return res.status(400).json({ error: 'Upload already processed', alreadyImported: true });
    }

    const now = new Date().toISOString();

    // Filter out duplicates if skipDuplicates is true
    let transactionsToImport = transactions;
    if (skipDuplicates) {
      transactionsToImport = transactions.filter((t: any) => !t.isDuplicate);
    }

    const dbTransactions = transactionsToImport.map((t: any) => ({
      id: uuidv4(),
      date: t.date,
      invoiceNumber: t.invoiceNumber || null,
      transactionType: t.transactionType,
      partyName: t.partyName || null,
      categoryName: t.categoryName || null,
      paymentType: t.paymentType || null,
      amount: t.amount,
      balance: t.balance || null,
      description: t.description || null,
      isReconciled: false,
      reconciledWithId: null,
      uploadId,
      createdAt: now,
      updatedAt: now,
    }));

    let importedCount = 0;
    for (const txn of dbTransactions) {
      await db.insert(vyaparTransactions).values(txn);
      importedCount++;
    }

    // Import item details if provided
    let itemDetailsImported = 0;
    let itemDetailsUpdated = 0;
    if (itemDetails && itemDetails.length > 0) {
      // Get existing items to check for duplicates and preserve categories
      const existingItems = await db
        .select({
          id: vyaparItemDetails.id,
          date: vyaparItemDetails.date,
          invoiceNumber: vyaparItemDetails.invoiceNumber,
          itemName: vyaparItemDetails.itemName,
          amount: vyaparItemDetails.amount,
          category: vyaparItemDetails.category,
        })
        .from(vyaparItemDetails);

      // Create a map of existing items by signature for quick lookup
      const existingItemsMap = new Map<string, { id: string; category: string | null }>();
      for (const item of existingItems) {
        const signature = `${item.date}|${item.invoiceNumber || ''}|${item.itemName}|${item.amount}`;
        existingItemsMap.set(signature, { id: item.id, category: item.category });
      }

      for (const item of itemDetails) {
        const signature = `${item.date}|${item.invoiceNumber || ''}|${item.itemName}|${item.amount}`;
        const existingItem = existingItemsMap.get(signature);

        if (existingItem) {
          // Item already exists - only update category if import has a category value AND existing is empty
          if (item.category && !existingItem.category) {
            await db
              .update(vyaparItemDetails)
              .set({ category: item.category })
              .where(eq(vyaparItemDetails.id, existingItem.id));
            itemDetailsUpdated++;
          }
          // Otherwise, preserve existing category - skip this item
        } else {
          // New item - insert it
          const dbItem = {
            id: uuidv4(),
            date: item.date,
            invoiceNumber: item.invoiceNumber || null,
            partyName: item.partyName || null,
            itemName: item.itemName,
            itemCode: item.itemCode || null,
            category: item.category || null,
            challanOrderNo: item.challanOrderNo || null,
            quantity: item.quantity || 1,
            unit: item.unit || null,
            unitPrice: item.unitPrice || null,
            discountPercent: item.discountPercent || null,
            discount: item.discount || null,
            taxPercent: item.taxPercent || null,
            tax: item.tax || null,
            transactionType: item.transactionType || 'Unknown',
            amount: item.amount,
            uploadId,
            createdAt: now,
          };
          await db.insert(vyaparItemDetails).values(dbItem);
          itemDetailsImported++;
        }
      }
    }

    await db
      .update(uploads)
      .set({
        status: 'completed',
        transactionCount: importedCount,
        processedAt: now,
      })
      .where(eq(uploads.id, uploadId));

    const skippedCount = transactions.length - importedCount;

    res.json({
      success: true,
      imported: importedCount,
      skipped: skippedCount,
      total: transactions.length,
      itemDetailsImported,
      itemDetailsUpdated,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error confirming Vyapar import:', error);
    res.status(500).json({ error: 'Failed to import transactions' });
  }
});

// Upload and preview credit card statement
router.post('/credit-card/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { accountId, bankHint } = z
      .object({
        accountId: z.string(),
        bankHint: z.string().optional(),
      })
      .parse(req.body);

    const filePath = req.file.path;
    const buffer = fs.readFileSync(filePath);
    const isPDF = req.file.mimetype === 'application/pdf';

    // Check if this is an HDFC Infinia statement for enhanced parsing
    let isInfinia = bankHint === 'hdfc_infinia';
    let infiniaData: HDFCInfiniaStatementData | null = null;

    if (isPDF && !isInfinia) {
      // Auto-detect Infinia
      const pdfParse = (await import('pdf-parse')).default;
      const data = await pdfParse(buffer);
      const text = data.text.toLowerCase();
      isInfinia = text.includes('infinia') ||
        (text.includes('diners club') && text.includes('hdfc')) ||
        (text.includes('reward points') && text.includes('hdfc') && text.includes('credit card'));
    }

    if (isInfinia && isPDF) {
      // Use HDFC Infinia parser for full metadata extraction
      infiniaData = await parseHDFCInfiniaCreditCard(buffer);
    }

    const transactions = await parseCreditCardStatement(buffer, req.file.mimetype, bankHint);

    // Check for duplicates
    const existingTxns = await db
      .select({
        date: creditCardTransactions.date,
        amount: creditCardTransactions.amount,
        description: creditCardTransactions.description,
      })
      .from(creditCardTransactions)
      .where(eq(creditCardTransactions.accountId, accountId));

    const existingSignatures = new Set<string>();
    for (const txn of existingTxns) {
      const signature = `${txn.date}|${txn.amount}|${txn.description.substring(0, 50)}`;
      existingSignatures.add(signature);
    }

    const transactionsWithStatus = transactions.map(txn => {
      const signature = `${txn.date}|${txn.amount}|${txn.description.substring(0, 50)}`;
      return {
        ...txn,
        isDuplicate: existingSignatures.has(signature),
      };
    });

    const newTransactions = transactionsWithStatus.filter(t => !t.isDuplicate);
    const duplicateCount = transactionsWithStatus.filter(t => t.isDuplicate).length;

    const now = new Date().toISOString();
    const uploadRecord = {
      id: uuidv4(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadType: isInfinia ? 'credit_card_infinia' : 'credit_card_statement',
      bankName: isInfinia ? 'hdfc_infinia' : (bankHint || null),
      accountId,
      status: 'pending',
      transactionCount: transactions.length,
      errorMessage: null,
      createdAt: now,
      processedAt: null,
    };

    await db.insert(uploads).values(uploadRecord);

    // Build response
    const response: any = {
      uploadId: uploadRecord.id,
      filename: req.file.originalname,
      transactionCount: transactions.length,
      newTransactionCount: newTransactions.length,
      duplicateCount,
      preview: transactionsWithStatus.slice(0, 10),
      allTransactions: transactionsWithStatus,
      isInfinia,
    };

    // Add Infinia-specific metadata
    if (infiniaData) {
      response.statementMetadata = {
        cardNumber: infiniaData.cardNumber,
        statementDate: infiniaData.statementDate,
        billingPeriodStart: infiniaData.billingPeriodStart,
        billingPeriodEnd: infiniaData.billingPeriodEnd,
        dueDate: infiniaData.dueDate,
        totalDue: infiniaData.totalDue,
        minimumDue: infiniaData.minimumDue,
        creditLimit: infiniaData.creditLimit,
        availableLimit: infiniaData.availableLimit,
        rewardPointsBalance: infiniaData.rewardPointsBalance,
        rewardPointsEarned: infiniaData.rewardPointsEarned,
        openingBalance: infiniaData.openingBalance,
        closingBalance: infiniaData.closingBalance,
        totalCredits: infiniaData.totalCredits,
        totalDebits: infiniaData.totalDebits,
      };
      response.cardHolders = infiniaData.cardHolders;
    }

    res.json(response);
  } catch (error) {
    console.error('Error previewing credit card statement:', error);
    res.status(500).json({ error: 'Failed to parse file' });
  }
});

// Confirm credit card import
router.post('/credit-card/confirm', async (req, res) => {
  try {
    const { uploadId, accountId, transactions, skipDuplicates = true, statementMetadata, cardHoldersData } = z
      .object({
        uploadId: z.string(),
        accountId: z.string(),
        transactions: z.array(z.any()),
        skipDuplicates: z.boolean().optional(),
        statementMetadata: z.any().optional(),
        cardHoldersData: z.array(z.any()).optional(),
      })
      .parse(req.body);

    // Check if upload already processed (prevent double submission)
    const existingUpload = await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId))
      .limit(1);

    if (!existingUpload[0]) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    if (existingUpload[0].status === 'completed') {
      return res.status(400).json({ error: 'Upload already processed', alreadyImported: true });
    }

    const now = new Date().toISOString();
    let statementId: string | null = null;

    // Create statement record if metadata provided (HDFC Infinia)
    if (statementMetadata && statementMetadata.statementDate) {
      statementId = uuidv4();

      // Check for existing statement with same billing period
      const existingStmt = await db
        .select()
        .from(creditCardStatements)
        .where(and(
          eq(creditCardStatements.accountId, accountId),
          eq(creditCardStatements.billingPeriodStart, statementMetadata.billingPeriodStart || ''),
          eq(creditCardStatements.billingPeriodEnd, statementMetadata.billingPeriodEnd || '')
        ))
        .limit(1);

      if (existingStmt[0]) {
        // Update existing statement
        statementId = existingStmt[0].id;
        await db
          .update(creditCardStatements)
          .set({
            statementDate: statementMetadata.statementDate,
            dueDate: statementMetadata.dueDate || existingStmt[0].dueDate,
            totalDue: statementMetadata.totalDue || existingStmt[0].totalDue,
            minimumDue: statementMetadata.minimumDue || existingStmt[0].minimumDue,
            creditLimit: statementMetadata.creditLimit || existingStmt[0].creditLimit,
            availableLimit: statementMetadata.availableLimit || existingStmt[0].availableLimit,
            rewardPointsBalance: statementMetadata.rewardPointsBalance || existingStmt[0].rewardPointsBalance,
            rewardPointsEarned: statementMetadata.rewardPointsEarned || existingStmt[0].rewardPointsEarned,
            openingBalance: statementMetadata.openingBalance,
            closingBalance: statementMetadata.closingBalance,
            totalCredits: statementMetadata.totalCredits,
            totalDebits: statementMetadata.totalDebits,
            uploadId,
          })
          .where(eq(creditCardStatements.id, statementId));
      } else {
        // Insert new statement
        await db.insert(creditCardStatements).values({
          id: statementId,
          accountId,
          statementDate: statementMetadata.statementDate,
          billingPeriodStart: statementMetadata.billingPeriodStart || statementMetadata.statementDate,
          billingPeriodEnd: statementMetadata.billingPeriodEnd || statementMetadata.statementDate,
          dueDate: statementMetadata.dueDate || statementMetadata.statementDate,
          totalDue: statementMetadata.totalDue || 0,
          minimumDue: statementMetadata.minimumDue || 0,
          creditLimit: statementMetadata.creditLimit || null,
          availableLimit: statementMetadata.availableLimit || null,
          rewardPointsBalance: statementMetadata.rewardPointsBalance || null,
          rewardPointsEarned: statementMetadata.rewardPointsEarned || null,
          rewardPointsRedeemed: statementMetadata.rewardPointsRedeemed || null,
          cashbackEarned: statementMetadata.cashbackEarned || null,
          openingBalance: statementMetadata.openingBalance || null,
          closingBalance: statementMetadata.closingBalance || null,
          totalCredits: statementMetadata.totalCredits || null,
          totalDebits: statementMetadata.totalDebits || null,
          financeCharges: statementMetadata.financeCharges || null,
          uploadId,
          createdAt: now,
        });
      }
    }

    // Create/update card holders if provided
    if (cardHoldersData && cardHoldersData.length > 0) {
      for (const holder of cardHoldersData) {
        // Check if card holder already exists for this account
        const existingHolder = await db
          .select()
          .from(cardHolders)
          .where(and(
            eq(cardHolders.accountId, accountId),
            eq(cardHolders.name, holder.name)
          ))
          .limit(1);

        if (!existingHolder[0]) {
          await db.insert(cardHolders).values({
            id: uuidv4(),
            accountId,
            name: holder.name,
            isPrimary: holder.isPrimary || false,
            cardLastFour: holder.cardLastFour || null,
            createdAt: now,
          });
        }
      }
    }

    // Filter out duplicates if skipDuplicates is true
    let transactionsToImport = transactions;
    if (skipDuplicates) {
      transactionsToImport = transactions.filter((t: any) => !t.isDuplicate);
    }

    const dbTransactions = transactionsToImport.map((t: any) => ({
      id: uuidv4(),
      accountId,
      date: t.date,
      description: t.description,
      amount: t.amount,
      transactionType: t.transactionType,
      categoryId: null,
      notes: null,
      isReconciled: false,
      reconciledWithId: null,
      uploadId,
      // HDFC Infinia specific fields
      cardHolderName: t.cardHolderName || null,
      isEmi: t.isEmi || false,
      emiTenure: t.emiTenure || null,
      rewardPoints: t.rewardPoints || 0,
      merchantLocation: t.merchantLocation || null,
      transactionTime: t.transactionTime || null,
      piCategory: t.piCategory || null,
      statementId,
      createdAt: now,
      updatedAt: now,
    }));

    let importedCount = 0;
    for (const txn of dbTransactions) {
      await db.insert(creditCardTransactions).values(txn);
      importedCount++;
    }

    // Update account balance (negative for credit card outstanding)
    if (statementMetadata?.totalDue) {
      await db
        .update(accounts)
        .set({ currentBalance: -statementMetadata.totalDue, updatedAt: now })
        .where(eq(accounts.id, accountId));
    }

    await db
      .update(uploads)
      .set({
        status: 'completed',
        transactionCount: importedCount,
        processedAt: now,
      })
      .where(eq(uploads.id, uploadId));

    const skippedCount = transactions.length - importedCount;

    res.json({
      success: true,
      imported: importedCount,
      skipped: skippedCount,
      total: transactions.length,
      statementId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error confirming credit card import:', error);
    res.status(500).json({ error: 'Failed to import transactions' });
  }
});

// Upload and preview ETrade portfolio
router.post('/etrade/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const csvContent = fs.readFileSync(filePath, 'utf-8');
    const portfolio = parseETradePortfolio(csvContent);

    const now = new Date().toISOString();
    const uploadRecord = {
      id: uuidv4(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadType: 'etrade_portfolio',
      bankName: 'etrade',
      accountId: null,
      status: 'pending',
      transactionCount: portfolio.holdings.length,
      errorMessage: null,
      createdAt: now,
      processedAt: null,
    };

    await db.insert(uploads).values(uploadRecord);

    res.json({
      uploadId: uploadRecord.id,
      filename: req.file.originalname,
      accountInfo: {
        accountName: portfolio.accountName,
        netAccountValue: portfolio.netAccountValue,
        totalGain: portfolio.totalGain,
        totalGainPercent: portfolio.totalGainPercent,
      },
      holdingsCount: portfolio.holdings.length,
      preview: portfolio.holdings.slice(0, 10),
      allHoldings: portfolio.holdings,
    });
  } catch (error: any) {
    console.error('Error previewing ETrade portfolio:', error?.message || error);
    res.status(500).json({ error: 'Failed to parse file', details: error?.message });
  }
});

// Confirm ETrade import
router.post('/etrade/confirm', async (req, res) => {
  try {
    const { uploadId, holdings } = z
      .object({
        uploadId: z.string(),
        holdings: z.array(z.any()),
      })
      .parse(req.body);

    // Check if upload already processed (prevent double submission)
    const existingUpload = await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId))
      .limit(1);

    if (!existingUpload[0]) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    if (existingUpload[0].status === 'completed') {
      return res.status(400).json({ error: 'Upload already processed', alreadyImported: true });
    }

    const now = new Date().toISOString();
    const today = now.split('T')[0];

    // Check for existing holdings with same symbol from ETrade
    const existingHoldings = await db
      .select({ symbol: investments.symbol })
      .from(investments)
      .where(eq(investments.platform, 'ETrade'));

    const existingSymbols = new Set(existingHoldings.map(h => h.symbol));

    let importedCount = 0;
    let updatedCount = 0;

    for (const holding of holdings) {
      if (existingSymbols.has(holding.symbol)) {
        // Update existing holding
        await db
          .update(investments)
          .set({
            quantity: holding.quantity,
            currentPrice: holding.currentPrice,
            currentValue: holding.currentValue,
            lastUpdated: now,
            updatedAt: now,
          })
          .where(and(
            eq(investments.symbol, holding.symbol),
            eq(investments.platform, 'ETrade')
          ));
        updatedCount++;
      } else {
        // Insert new holding
        await db.insert(investments).values({
          id: uuidv4(),
          name: holding.name || holding.symbol,
          type: 'stocks',
          symbol: holding.symbol,
          platform: 'ETrade',
          quantity: holding.quantity,
          purchasePrice: holding.purchasePrice,
          purchaseDate: today,
          currentPrice: holding.currentPrice,
          currentValue: holding.currentValue,
          lastUpdated: now,
          notes: `Total Gain: ${holding.totalGainPercent?.toFixed(2) || 0}%`,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        importedCount++;
      }
    }

    await db
      .update(uploads)
      .set({
        status: 'completed',
        transactionCount: importedCount + updatedCount,
        processedAt: now,
      })
      .where(eq(uploads.id, uploadId));

    res.json({
      success: true,
      imported: importedCount,
      updated: updatedCount,
      total: holdings.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error confirming ETrade import:', error);
    res.status(500).json({ error: 'Failed to import holdings' });
  }
});

// Upload and preview home loan statement
router.post('/home-loan/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const buffer = fs.readFileSync(filePath);

    // Parse the home loan statement
    const data = await parseAxisHomeLoanStatement(buffer);

    // Check if loan with same agreement number already exists
    const { loans } = await import('../db/index.js');
    let existingLoan = null;
    if (data.loan.agreementNumber) {
      const existingLoans = await db
        .select()
        .from(loans)
        .where(eq(loans.agreementNumber, data.loan.agreementNumber as string))
        .limit(1);
      existingLoan = existingLoans[0];
    }

    const now = new Date().toISOString();
    const uploadRecord = {
      id: uuidv4(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadType: 'home_loan_statement',
      bankName: 'axis',
      accountId: null,
      status: 'pending',
      transactionCount: data.payments.length,
      errorMessage: null,
      createdAt: now,
      processedAt: null,
    };

    await db.insert(uploads).values(uploadRecord);

    res.json({
      uploadId: uploadRecord.id,
      filename: req.file.originalname,
      loan: data.loan,
      payments: data.payments,
      disbursements: data.disbursements,
      summary: data.summary,
      paymentCount: data.payments.length,
      disbursementCount: data.disbursements.length,
      existingLoanId: existingLoan?.id || null,
      isUpdate: !!existingLoan,
    });
  } catch (error: any) {
    console.error('Error previewing home loan statement:', error?.message || error);
    res.status(500).json({ error: 'Failed to parse file', details: error?.message });
  }
});

// Confirm home loan import - redirects to loans API
router.post('/home-loan/confirm', async (req, res) => {
  try {
    const { uploadId, loan, payments, disbursements } = z
      .object({
        uploadId: z.string(),
        loan: z.any(),
        payments: z.array(z.any()),
        disbursements: z.array(z.any()),
      })
      .parse(req.body);

    // Check if upload already processed
    const existingUpload = await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId))
      .limit(1);

    if (!existingUpload[0]) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    if (existingUpload[0].status === 'completed') {
      return res.status(400).json({ error: 'Upload already processed', alreadyImported: true });
    }

    const now = new Date().toISOString();

    // Import the loan data using the loans table
    const { loans, loanPayments, loanDisbursements } = await import('../db/index.js');

    // Check if loan with same agreement number already exists
    let existingLoan = null;
    if (loan.agreementNumber) {
      const existingLoans = await db
        .select()
        .from(loans)
        .where(eq(loans.agreementNumber, loan.agreementNumber))
        .limit(1);
      existingLoan = existingLoans[0];
    }

    let loanId: string;
    let isUpdate = false;

    if (existingLoan) {
      // Update existing loan with latest data
      loanId = existingLoan.id;
      isUpdate = true;

      await db
        .update(loans)
        .set({
          // Update with latest values from statement
          outstandingAmount: loan.outstandingAmount,
          totalPrincipalPaid: loan.totalPrincipalPaid,
          totalInterestPaid: loan.totalInterestPaid,
          totalChargesPaid: loan.totalChargesPaid,
          paidInstallments: loan.paidInstallments,
          pendingInstallments: loan.pendingInstallments,
          interestRate: loan.interestRate, // Rate might change for floating
          emiAmount: loan.emiAmount,
          status: loan.status || 'active',
          updatedAt: now,
        })
        .where(eq(loans.id, loanId));

      console.log(`Updated existing loan ${loanId} (Agreement: ${loan.agreementNumber})`);
    } else {
      // Insert new loan
      loanId = loan.id || uuidv4();
      const loanRecord = {
        ...loan,
        id: loanId,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(loans).values(loanRecord);
      console.log(`Created new loan ${loanId} (Agreement: ${loan.agreementNumber})`);
    }

    // Get existing payments to avoid duplicates
    const existingPayments = await db
      .select({ date: loanPayments.date, amount: loanPayments.amount, transactionType: loanPayments.transactionType })
      .from(loanPayments)
      .where(eq(loanPayments.loanId, loanId));

    const existingPaymentKeys = new Set(
      existingPayments.map(p => `${p.date}-${p.amount}-${p.transactionType}`)
    );

    // Insert only new payments (dedup by date + amount + type)
    let paymentsImported = 0;
    let paymentsSkipped = 0;
    for (const payment of payments) {
      const key = `${payment.date}-${payment.amount}-${payment.transactionType}`;
      if (existingPaymentKeys.has(key)) {
        paymentsSkipped++;
        continue;
      }

      await db.insert(loanPayments).values({
        ...payment,
        id: uuidv4(),
        loanId,
        createdAt: now,
      });
      paymentsImported++;
    }

    // Get existing disbursements to avoid duplicates
    const existingDisbursements = await db
      .select({ date: loanDisbursements.date, amount: loanDisbursements.amount })
      .from(loanDisbursements)
      .where(eq(loanDisbursements.loanId, loanId));

    const existingDisbursementKeys = new Set(
      existingDisbursements.map(d => `${d.date}-${d.amount}`)
    );

    // Insert only new disbursements
    let disbursementsImported = 0;
    let disbursementsSkipped = 0;
    for (const disbursement of disbursements) {
      const key = `${disbursement.date}-${disbursement.amount}`;
      if (existingDisbursementKeys.has(key)) {
        disbursementsSkipped++;
        continue;
      }

      await db.insert(loanDisbursements).values({
        ...disbursement,
        id: uuidv4(),
        loanId,
        createdAt: now,
      });
      disbursementsImported++;
    }

    // Update upload status
    await db
      .update(uploads)
      .set({
        status: 'completed',
        transactionCount: paymentsImported + disbursementsImported,
        processedAt: now,
      })
      .where(eq(uploads.id, uploadId));

    res.json({
      success: true,
      loanId,
      isUpdate,
      paymentsImported,
      paymentsSkipped,
      disbursementsImported,
      disbursementsSkipped,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error confirming home loan import:', error);
    res.status(500).json({ error: 'Failed to import home loan data' });
  }
});

// Upload and preview CAMS mutual fund statement
router.post('/cams/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { password } = z
      .object({
        password: z.string(),
      })
      .parse(req.body);

    const filePath = req.file.path;

    // Parse the CAMS statement
    const data = await parseCAMSStatement(filePath, password);

    const now = new Date().toISOString();
    const uploadRecord = {
      id: uuidv4(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadType: 'cams_statement',
      bankName: null,
      accountId: null,
      status: 'pending',
      transactionCount: data.holdings.length,
      errorMessage: null,
      createdAt: now,
      processedAt: null,
    };

    await db.insert(uploads).values(uploadRecord);

    res.json({
      uploadId: uploadRecord.id,
      filename: req.file.originalname,
      investorName: data.investorName,
      email: data.email,
      panNumber: data.panNumber,
      statementDate: data.statementDate,
      holdingsCount: data.holdings.length,
      totalCostValue: data.totalCostValue,
      totalCurrentValue: data.totalCurrentValue,
      totalAbsoluteReturn: data.totalAbsoluteReturn,
      totalAbsoluteReturnPercent: data.totalAbsoluteReturnPercent,
      holdings: data.holdings,
    });
  } catch (error: any) {
    console.error('Error previewing CAMS statement:', error?.message || error);

    // Check for password error
    if (error?.message?.includes('password') || error?.message?.includes('Invalid')) {
      return res.status(400).json({ error: 'Invalid password', isPasswordError: true });
    }

    res.status(500).json({ error: 'Failed to parse file', details: error?.message });
  }
});

// Confirm CAMS mutual fund import
router.post('/cams/confirm', async (req, res) => {
  try {
    const { uploadId, investorName, email, panNumber, holdings } = z
      .object({
        uploadId: z.string(),
        investorName: z.string().nullish(),
        email: z.string().nullish(),
        panNumber: z.string().nullish(),
        holdings: z.array(z.any()),
      })
      .parse(req.body);

    // Check if upload already processed
    const existingUpload = await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId))
      .limit(1);

    if (!existingUpload[0]) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    if (existingUpload[0].status === 'completed') {
      return res.status(400).json({ error: 'Upload already processed', alreadyImported: true });
    }

    const now = new Date().toISOString();

    // Import mutual fund holdings
    const { mutualFundFolios, mutualFundHoldings } = await import('../db/index.js');

    // Group holdings by folio
    const holdingsByFolio = new Map<string, typeof holdings>();
    for (const holding of holdings) {
      const key = `${holding.folioNumber}-${holding.amcName}`;
      if (!holdingsByFolio.has(key)) {
        holdingsByFolio.set(key, []);
      }
      holdingsByFolio.get(key)!.push(holding);
    }

    let foliosCreated = 0;
    let foliosUpdated = 0;
    let holdingsCreated = 0;
    let holdingsUpdated = 0;

    for (const [key, folioHoldings] of holdingsByFolio) {
      const firstHolding = folioHoldings[0];

      // Check if folio exists
      const existingFolios = await db
        .select()
        .from(mutualFundFolios)
        .where(eq(mutualFundFolios.folioNumber, firstHolding.folioNumber))
        .limit(1);

      let folioId: string;

      if (existingFolios[0]) {
        // Update existing folio
        folioId = existingFolios[0].id;
        await db
          .update(mutualFundFolios)
          .set({
            amcName: firstHolding.amcName,
            registrar: firstHolding.registrar,
            investorName: investorName || existingFolios[0].investorName,
            email: email || existingFolios[0].email,
            panNumber: panNumber || existingFolios[0].panNumber,
            updatedAt: now,
          })
          .where(eq(mutualFundFolios.id, folioId));
        foliosUpdated++;
      } else {
        // Create new folio
        folioId = uuidv4();
        await db.insert(mutualFundFolios).values({
          id: folioId,
          folioNumber: firstHolding.folioNumber,
          amcName: firstHolding.amcName,
          registrar: firstHolding.registrar,
          investorName: investorName || null,
          email: email || null,
          panNumber: panNumber || null,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        foliosCreated++;
      }

      // Process holdings for this folio
      for (const holding of folioHoldings) {
        // Check if holding exists by ISIN or scheme name
        const existingHoldings = await db
          .select()
          .from(mutualFundHoldings)
          .where(
            and(
              eq(mutualFundHoldings.folioId, folioId),
              holding.isin
                ? eq(mutualFundHoldings.isin, holding.isin)
                : eq(mutualFundHoldings.schemeName, holding.schemeName)
            )
          )
          .limit(1);

        if (existingHoldings[0]) {
          // Update existing holding with latest values
          await db
            .update(mutualFundHoldings)
            .set({
              units: holding.units,
              costValue: holding.costValue,
              currentValue: holding.currentValue,
              nav: holding.nav,
              navDate: holding.navDate,
              absoluteReturn: holding.absoluteReturn,
              absoluteReturnPercent: holding.absoluteReturnPercent,
              lastUpdated: now,
              updatedAt: now,
            })
            .where(eq(mutualFundHoldings.id, existingHoldings[0].id));
          holdingsUpdated++;
        } else {
          // Create new holding
          await db.insert(mutualFundHoldings).values({
            id: uuidv4(),
            folioId,
            schemeName: holding.schemeName,
            isin: holding.isin || null,
            units: holding.units,
            costValue: holding.costValue,
            currentValue: holding.currentValue,
            nav: holding.nav,
            navDate: holding.navDate,
            absoluteReturn: holding.absoluteReturn,
            absoluteReturnPercent: holding.absoluteReturnPercent,
            isActive: true,
            lastUpdated: now,
            createdAt: now,
            updatedAt: now,
          });
          holdingsCreated++;
        }
      }
    }

    // Update upload status
    await db
      .update(uploads)
      .set({
        status: 'completed',
        transactionCount: holdingsCreated + holdingsUpdated,
        processedAt: now,
      })
      .where(eq(uploads.id, uploadId));

    res.json({
      success: true,
      foliosCreated,
      foliosUpdated,
      holdingsCreated,
      holdingsUpdated,
      total: holdings.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error confirming CAMS import:', error);
    res.status(500).json({ error: 'Failed to import mutual fund holdings' });
  }
});

// Delete upload record only (transactions are preserved)
// To delete transactions, use the bulk delete in Settings
router.delete('/:id', async (req, res) => {
  try {
    const uploadId = req.params.id;

    // Get the upload to find the file
    const uploadRecord = await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId))
      .limit(1);

    if (uploadRecord[0]) {
      // Try to delete the physical file
      const filePath = path.join(uploadDir, uploadRecord[0].filename);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (fileError) {
        console.error('Error deleting file:', fileError);
        // Continue even if file delete fails
      }

      // Clear the uploadId reference from transactions (but keep the transactions)
      await db
        .update(bankTransactions)
        .set({ uploadId: null })
        .where(eq(bankTransactions.uploadId, uploadId));

      await db
        .update(vyaparTransactions)
        .set({ uploadId: null })
        .where(eq(vyaparTransactions.uploadId, uploadId));

      await db
        .update(vyaparItemDetails)
        .set({ uploadId: null })
        .where(eq(vyaparItemDetails.uploadId, uploadId));

      await db
        .update(creditCardTransactions)
        .set({ uploadId: null })
        .where(eq(creditCardTransactions.uploadId, uploadId));
    }

    // Delete upload record
    await db.delete(uploads).where(eq(uploads.id, uploadId));

    res.json({ success: true, message: 'Upload record deleted. Transactions preserved.' });
  } catch (error) {
    console.error('Error deleting upload:', error);
    res.status(500).json({ error: 'Failed to delete upload' });
  }
});

export default router;

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, bankTransactions, accounts, businessInvoices, enrichmentRules } from '../db/index.js';
import { eq, and, between, desc, asc, sql, like, isNull } from 'drizzle-orm';
import {
  enrichTransaction,
  extractVendorName,
  getBizTypeLabels,
  type BizType,
} from '../services/business-enrichment.js';
import { extractGSTInfo } from '../services/invoice-parser.js';

/**
 * Extract a normalized key from narration for pattern matching
 * This is used to find similar transactions
 */
function extractNarrationKey(narration: string): string | null {
  if (!narration) return null;

  const upper = narration.toUpperCase();

  // UPI: extract payee name
  const upiMatch = upper.match(/UPI\/([^\/]+)\//);
  if (upiMatch) {
    return `UPI:${upiMatch[1].trim()}`;
  }

  // NEFT: extract beneficiary name
  const neftMatch = upper.match(/NEFT\/\s*([^\/]+)\//);
  if (neftMatch) {
    return `NEFT:${neftMatch[1].trim()}`;
  }

  // MB: Sent NEFT format
  const mbNeftMatch = upper.match(/MB:\s*SENT\s*NEFT\/\s*([^\/]+)/);
  if (mbNeftMatch) {
    return `NEFT:${mbNeftMatch[1].trim()}`;
  }

  // MB: RECEIVED FROM format (for incoming transfers like loans)
  const mbReceivedMatch = upper.match(/MB:\s*RECEIVED\s*FROM\s+([^\/]+)/);
  if (mbReceivedMatch) {
    return `RECEIVED:${mbReceivedMatch[1].trim()}`;
  }

  // RTGS: extract beneficiary name
  const rtgsMatch = upper.match(/RTGS\/\s*([^\/]+)\//);
  if (rtgsMatch) {
    return `RTGS:${rtgsMatch[1].trim()}`;
  }

  // IMPS: extract payee name
  const impsMatch = upper.match(/IMPS\/[^\/]+\/([^\/]+)/);
  if (impsMatch) {
    return `IMPS:${impsMatch[1].trim()}`;
  }

  // Payment gateway patterns
  if (upper.includes('CASHFREE')) return 'GATEWAY:CASHFREE';
  if (upper.includes('RAZORPAY')) return 'GATEWAY:RAZORPAY';
  if (upper.includes('PAYTM GATEWAY')) return 'GATEWAY:PAYTM';

  return null;
}

/**
 * Extract the person/entity name from narration for fuzzy matching
 * Returns an array of searchable keywords
 */
function extractSearchableNames(narration: string): string[] {
  if (!narration) return [];

  const upper = narration.toUpperCase();
  const names: string[] = [];

  // UPI format: UPI/NAME/...
  const upiMatch = upper.match(/UPI\/([^\/]+)\//);
  if (upiMatch) names.push(upiMatch[1].trim());

  // NEFT format: NEFT/ NAME/ or MB: Sent NEFT/ NAME
  const neftMatch = upper.match(/NEFT\/\s*([^\/]+)/);
  if (neftMatch) names.push(neftMatch[1].trim());

  // RECEIVED FROM format
  const receivedMatch = upper.match(/RECEIVED\s*FROM\s+([^\/]+)/);
  if (receivedMatch) names.push(receivedMatch[1].trim());

  // RTGS format
  const rtgsMatch = upper.match(/RTGS\/\s*([^\/]+)/);
  if (rtgsMatch) names.push(rtgsMatch[1].trim());

  // IMPS format
  const impsMatch = upper.match(/IMPS\/[^\/]+\/([^\/]+)/);
  if (impsMatch) names.push(impsMatch[1].trim());

  // Also extract any text after common keywords
  const keywordMatches = upper.match(/(?:SALARY|LOAN|RENT|EMI|PAYMENT)\b/gi);
  if (keywordMatches) {
    names.push(...keywordMatches.map(k => k.trim()));
  }

  return names.filter(n => n.length > 2);
}

/**
 * Calculate similarity between two strings (Jaccard similarity on words)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = new Set(str1.toUpperCase().split(/\s+/).filter(w => w.length > 1));
  const words2 = new Set(str2.toUpperCase().split(/\s+/).filter(w => w.length > 1));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Check if two narrations are similar enough (>= threshold)
 */
function areNarrationsSimilar(narration1: string, narration2: string, threshold = 0.5): boolean {
  // First try exact key matching
  const key1 = extractNarrationKey(narration1);
  const key2 = extractNarrationKey(narration2);

  if (key1 && key2 && key1 === key2) return true;

  // Extract names and check for overlap
  const names1 = extractSearchableNames(narration1);
  const names2 = extractSearchableNames(narration2);

  // Check if any extracted name appears in the other narration
  for (const name of names1) {
    if (narration2.toUpperCase().includes(name)) return true;
    // Check word-level similarity
    for (const name2 of names2) {
      if (calculateSimilarity(name, name2) >= threshold) return true;
    }
  }

  // Fall back to overall similarity check
  return calculateSimilarity(narration1, narration2) >= threshold;
}

/**
 * Propagate updates to similar transactions with empty values
 * Uses fuzzy matching to find similar narrations (80-90% match)
 */
async function propagateToSimilarTransactions(
  userId: string,
  accountIds: string[],
  sourceNarration: string,
  sourceTransactionId: string,
  updates: { vendorName?: string; bizType?: string; bizDescription?: string; gstType?: string | null; needsInvoice?: boolean }
): Promise<number> {
  if (!sourceNarration || accountIds.length === 0) return 0;
  if (!updates.vendorName && !updates.bizType) return 0;

  // Get all transactions that might need updating
  const allTransactions = await db
    .select({
      id: bankTransactions.id,
      narration: bankTransactions.narration,
      vendorName: bankTransactions.vendorName,
      bizType: bankTransactions.bizType,
    })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.userId, userId),
        sql`${bankTransactions.accountId} IN (${sql.join(
          accountIds.map((id) => sql`${id}`),
          sql`, `
        )})`,
        // Only get transactions with empty values
        sql`(
          (${bankTransactions.vendorName} IS NULL OR ${bankTransactions.vendorName} = '')
          OR (${bankTransactions.bizType} IS NULL OR ${bankTransactions.bizType} = '' OR ${bankTransactions.bizType} = 'OTHER')
        )`
      )
    );

  // Filter using fuzzy matching
  const matchingTransactions = allTransactions.filter(tx =>
    tx.id !== sourceTransactionId && areNarrationsSimilar(sourceNarration, tx.narration, 0.4)
  );

  if (matchingTransactions.length === 0) return 0;

  const now = new Date().toISOString();
  let updatedCount = 0;

  for (const tx of matchingTransactions) {
    const updateData: any = { updatedAt: now };

    // Only set fields that are empty in this transaction
    if (updates.vendorName && (!tx.vendorName || tx.vendorName === '')) {
      updateData.vendorName = updates.vendorName;
    }
    if (updates.bizType && (!tx.bizType || tx.bizType === '' || tx.bizType === 'OTHER')) {
      updateData.bizType = updates.bizType;
      if (updates.bizDescription) updateData.bizDescription = updates.bizDescription;
      if (updates.needsInvoice !== undefined) updateData.needsInvoice = updates.needsInvoice;
      if (updates.gstType !== undefined) updateData.gstType = updates.gstType;
    }

    if (Object.keys(updateData).length > 1) { // more than just updatedAt
      await db
        .update(bankTransactions)
        .set(updateData)
        .where(eq(bankTransactions.id, tx.id));
      updatedCount++;
    }
  }

  return updatedCount;
}
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Use /data/invoices on Railway (persistent volume), otherwise use local data folder
const invoiceDir = process.env.NODE_ENV === 'production'
  ? '/data/invoices'
  : path.join(__dirname, '../../../data/invoices');

// Ensure invoice directory exists
if (!fs.existsSync(invoiceDir)) {
  fs.mkdirSync(invoiceDir, { recursive: true });
}

// Multer storage for invoice uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, invoiceDir);
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
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'text/csv', 'application/vnd.ms-excel'];
    // Also allow CSV files by extension (some browsers send different MIME types)
    const isCSV = file.originalname.toLowerCase().endsWith('.csv');
    if (allowedTypes.includes(file.mimetype) || isCSV) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, image, and CSV files are allowed'));
    }
  },
});

const router = Router();

// ASG Technologies account ID - this should be configured properly
// For now, we'll filter by account name containing "ASG" or "Kotak Current"
const ASG_ACCOUNT_FILTER = ['ASG', 'Kotak Current', 'GearUp'];

// Get ASG account IDs for the user
async function getASGAccountIds(userId: string): Promise<string[]> {
  const userAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.userId, userId));

  return userAccounts
    .filter((acc) =>
      ASG_ACCOUNT_FILTER.some((filter) =>
        acc.name.toLowerCase().includes(filter.toLowerCase())
      )
    )
    .map((acc) => acc.id);
}

// Query schema for transactions
const querySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  accountId: z.string().optional(),
  bizType: z.string().optional(),
  needsInvoice: z.enum(['true', 'false']).optional(),
  hasInvoice: z.enum(['true', 'false']).optional(),
  search: z.string().optional(),
  sortBy: z.enum(['date', 'amount']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

// Get transactions with enrichment data
router.get('/transactions', async (req, res) => {
  try {
    const query = querySchema.parse(req.query);
    const asgAccountIds = await getASGAccountIds(req.userId!);

    if (asgAccountIds.length === 0) {
      return res.json([]);
    }

    const conditions = [
      eq(bankTransactions.userId, req.userId!),
      sql`${bankTransactions.accountId} IN (${sql.join(
        asgAccountIds.map((id) => sql`${id}`),
        sql`, `
      )})`,
    ];

    if (query.startDate && query.endDate) {
      conditions.push(between(bankTransactions.date, query.startDate, query.endDate));
    }
    if (query.accountId) {
      conditions.push(eq(bankTransactions.accountId, query.accountId));
    }
    if (query.bizType) {
      conditions.push(eq(bankTransactions.bizType, query.bizType));
    }
    if (query.needsInvoice === 'true') {
      conditions.push(eq(bankTransactions.needsInvoice, true));
    }
    if (query.hasInvoice === 'true') {
      conditions.push(sql`${bankTransactions.invoiceFileId} IS NOT NULL`);
    } else if (query.hasInvoice === 'false') {
      conditions.push(isNull(bankTransactions.invoiceFileId));
    }
    if (query.search) {
      conditions.push(
        sql`(${bankTransactions.narration} LIKE ${'%' + query.search + '%'} OR ${bankTransactions.vendorName} LIKE ${'%' + query.search + '%'} OR ${bankTransactions.bizDescription} LIKE ${'%' + query.search + '%'})`
      );
    }

    const sortColumn = query.sortBy === 'amount' ? bankTransactions.amount : bankTransactions.date;
    const sortFn = query.sortOrder === 'asc' ? asc : desc;

    let dbQuery = db
      .select({
        id: bankTransactions.id,
        accountId: bankTransactions.accountId,
        userId: bankTransactions.userId,
        date: bankTransactions.date,
        valueDate: bankTransactions.valueDate,
        narration: bankTransactions.narration,
        reference: bankTransactions.reference,
        transactionType: bankTransactions.transactionType,
        amount: bankTransactions.amount,
        balance: bankTransactions.balance,
        categoryId: bankTransactions.categoryId,
        notes: bankTransactions.notes,
        isReconciled: bankTransactions.isReconciled,
        reconciledWithId: bankTransactions.reconciledWithId,
        reconciledWithType: bankTransactions.reconciledWithType,
        uploadId: bankTransactions.uploadId,
        bizType: bankTransactions.bizType,
        bizDescription: bankTransactions.bizDescription,
        vendorName: bankTransactions.vendorName,
        needsInvoice: bankTransactions.needsInvoice,
        invoiceFileId: bankTransactions.invoiceFileId,
        gstAmount: bankTransactions.gstAmount,
        cgstAmount: bankTransactions.cgstAmount,
        sgstAmount: bankTransactions.sgstAmount,
        igstAmount: bankTransactions.igstAmount,
        gstType: bankTransactions.gstType,
        createdAt: bankTransactions.createdAt,
        updatedAt: bankTransactions.updatedAt,
        accountName: accounts.name,
      })
      .from(bankTransactions)
      .leftJoin(accounts, eq(bankTransactions.accountId, accounts.id))
      .orderBy(sortFn(sortColumn), desc(bankTransactions.createdAt));

    if (conditions.length > 0) {
      dbQuery = dbQuery.where(and(...conditions)) as typeof dbQuery;
    }

    if (query.limit) {
      dbQuery = dbQuery.limit(parseInt(query.limit)) as typeof dbQuery;
    }
    if (query.offset) {
      dbQuery = dbQuery.offset(parseInt(query.offset)) as typeof dbQuery;
    }

    const transactions = await dbQuery;
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching business transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Run auto-enrichment on transactions
router.post('/enrich', async (req, res) => {
  try {
    const { accountId, overwrite = false } = req.body;
    const asgAccountIds = accountId ? [accountId] : await getASGAccountIds(req.userId!);

    if (asgAccountIds.length === 0) {
      return res.json({ enriched: 0, message: 'No ASG accounts found' });
    }

    // First, load persisted enrichment rules (these survive transaction deletion)
    const savedRules = await db
      .select()
      .from(enrichmentRules)
      .where(
        and(
          eq(enrichmentRules.userId, req.userId!),
          eq(enrichmentRules.isActive, 1)
        )
      )
      .orderBy(desc(enrichmentRules.priority), desc(enrichmentRules.matchCount));

    // Build lookup map from persisted rules: patternValue -> enrichment data
    const learnedMappings: Map<string, {
      vendorName: string | null;
      bizType: string | null;
      bizDescription: string | null;
      gstType: string | null;
      needsInvoice: boolean | null;
      ruleId: string;
    }> = new Map();

    for (const rule of savedRules) {
      if (!learnedMappings.has(rule.patternValue)) {
        learnedMappings.set(rule.patternValue, {
          vendorName: rule.vendorName,
          bizType: rule.bizType,
          bizDescription: rule.bizDescription,
          gstType: rule.gstType,
          needsInvoice: rule.needsInvoice === 1,
          ruleId: rule.id,
        });
      }
    }

    // Also learn from existing enriched transactions (for backward compatibility)
    const existingMappings = await db
      .select({
        narration: bankTransactions.narration,
        vendorName: bankTransactions.vendorName,
        bizType: bankTransactions.bizType,
        bizDescription: bankTransactions.bizDescription,
        gstType: bankTransactions.gstType,
        needsInvoice: bankTransactions.needsInvoice,
      })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.userId, req.userId!),
          sql`${bankTransactions.accountId} IN (${sql.join(
            asgAccountIds.map((id) => sql`${id}`),
            sql`, `
          )})`,
          sql`${bankTransactions.vendorName} IS NOT NULL AND ${bankTransactions.vendorName} != ''`
        )
      );

    for (const mapping of existingMappings) {
      const key = extractNarrationKey(mapping.narration);
      // Only add if not already in persisted rules (persisted rules take priority)
      if (key && !learnedMappings.has(key)) {
        learnedMappings.set(key, {
          vendorName: mapping.vendorName,
          bizType: mapping.bizType,
          bizDescription: mapping.bizDescription,
          gstType: mapping.gstType,
          needsInvoice: mapping.needsInvoice,
          ruleId: '', // No rule ID for transaction-learned mappings
        });
      }
    }

    console.log(`[Enrich] Loaded ${savedRules.length} persisted rules, ${learnedMappings.size} total mappings`);

    // Get transactions that need enrichment
    const conditions = [
      eq(bankTransactions.userId, req.userId!),
      sql`${bankTransactions.accountId} IN (${sql.join(
        asgAccountIds.map((id) => sql`${id}`),
        sql`, `
      )})`,
    ];

    if (!overwrite) {
      // Only enrich transactions with empty vendorName OR empty/OTHER bizType
      conditions.push(
        sql`(${bankTransactions.vendorName} IS NULL OR ${bankTransactions.vendorName} = '' OR ${bankTransactions.bizType} IS NULL OR ${bankTransactions.bizType} = '' OR ${bankTransactions.bizType} = 'OTHER')`
      );
    }

    const transactions = await db
      .select()
      .from(bankTransactions)
      .where(and(...conditions));

    let enrichedCount = 0;
    const now = new Date().toISOString();

    for (const tx of transactions) {
      const narrationKey = extractNarrationKey(tx.narration);
      const learnedMapping = narrationKey ? learnedMappings.get(narrationKey) : null;

      // Start with auto-detected enrichment
      const autoEnrichment = enrichTransaction(
        tx.narration,
        tx.transactionType as 'credit' | 'debit',
        tx.amount
      );

      // Override with learned mappings if available
      const finalEnrichment = {
        bizType: learnedMapping?.bizType || autoEnrichment.bizType,
        bizDescription: learnedMapping?.bizDescription || autoEnrichment.bizDescription,
        vendorName: learnedMapping?.vendorName || autoEnrichment.vendorName,
        needsInvoice: learnedMapping?.needsInvoice ?? autoEnrichment.needsInvoice,
        gstType: learnedMapping?.gstType || autoEnrichment.gstType,
      };

      // Only update fields that are empty in the transaction
      const updateData: any = { updatedAt: now };

      if (!tx.vendorName && finalEnrichment.vendorName) {
        updateData.vendorName = finalEnrichment.vendorName;
      }
      if ((!tx.bizType || tx.bizType === 'OTHER') && finalEnrichment.bizType) {
        updateData.bizType = finalEnrichment.bizType;
      }
      if (!tx.bizDescription && finalEnrichment.bizDescription) {
        updateData.bizDescription = finalEnrichment.bizDescription;
      }
      if (tx.needsInvoice === null && finalEnrichment.needsInvoice !== undefined) {
        updateData.needsInvoice = finalEnrichment.needsInvoice;
      }
      if (!tx.gstType && finalEnrichment.gstType) {
        updateData.gstType = finalEnrichment.gstType;
      }

      if (Object.keys(updateData).length > 1) { // more than just updatedAt
        await db
          .update(bankTransactions)
          .set(updateData)
          .where(eq(bankTransactions.id, tx.id));
        enrichedCount++;

        // Increment match count for the used rule
        if (learnedMapping?.ruleId) {
          await db
            .update(enrichmentRules)
            .set({
              matchCount: sql`${enrichmentRules.matchCount} + 1`,
              updatedAt: now,
            })
            .where(eq(enrichmentRules.id, learnedMapping.ruleId));
        }
      }
    }

    res.json({
      enriched: enrichedCount,
      learnedMappings: learnedMappings.size,
      persistedRules: savedRules.length,
      message: `Successfully enriched ${enrichedCount} transactions (using ${learnedMappings.size} learned patterns, ${savedRules.length} persisted rules)`,
    });
  } catch (error) {
    console.error('Error enriching transactions:', error);
    res.status(500).json({ error: 'Failed to enrich transactions' });
  }
});

// ============================================
// Enrichment Rules Management
// ============================================

// Get all enrichment rules
router.get('/enrichment-rules', async (req, res) => {
  try {
    const rules = await db
      .select()
      .from(enrichmentRules)
      .where(eq(enrichmentRules.userId, req.userId!))
      .orderBy(desc(enrichmentRules.matchCount), desc(enrichmentRules.priority));

    res.json(rules);
  } catch (error) {
    console.error('Error fetching enrichment rules:', error);
    res.status(500).json({ error: 'Failed to fetch enrichment rules' });
  }
});

// Delete an enrichment rule
router.delete('/enrichment-rules/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify rule belongs to user
    const [rule] = await db
      .select()
      .from(enrichmentRules)
      .where(and(eq(enrichmentRules.id, id), eq(enrichmentRules.userId, req.userId!)));

    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    await db.delete(enrichmentRules).where(eq(enrichmentRules.id, id));

    res.json({ success: true, message: 'Rule deleted' });
  } catch (error) {
    console.error('Error deleting enrichment rule:', error);
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

// Toggle enrichment rule active status
router.patch('/enrichment-rules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    // Verify rule belongs to user
    const [rule] = await db
      .select()
      .from(enrichmentRules)
      .where(and(eq(enrichmentRules.id, id), eq(enrichmentRules.userId, req.userId!)));

    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    await db
      .update(enrichmentRules)
      .set({
        isActive: isActive ? 1 : 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(enrichmentRules.id, id));

    const [updated] = await db
      .select()
      .from(enrichmentRules)
      .where(eq(enrichmentRules.id, id));

    res.json(updated);
  } catch (error) {
    console.error('Error updating enrichment rule:', error);
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

// Update transaction business details
const updateSchema = z.object({
  bizType: z.string().optional(),
  bizDescription: z.string().optional(),
  vendorName: z.string().optional(),
  needsInvoice: z.boolean().optional(),
  gstAmount: z.number().optional(),
  cgstAmount: z.number().optional(),
  sgstAmount: z.number().optional(),
  igstAmount: z.number().optional(),
  gstType: z.enum(['input', 'output']).optional().nullable(),
  notes: z.string().optional(),
});

router.patch('/transaction/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = updateSchema.parse(req.body);

    // Verify transaction belongs to user
    const [tx] = await db
      .select()
      .from(bankTransactions)
      .where(and(eq(bankTransactions.id, id), eq(bankTransactions.userId, req.userId!)));

    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const now = new Date().toISOString();
    await db
      .update(bankTransactions)
      .set({
        ...data,
        updatedAt: now,
      })
      .where(eq(bankTransactions.id, id));

    // Save enrichment rule for future auto-enrichment (learn from user's corrections)
    if (data.bizType || data.vendorName) {
      const narrationKey = extractNarrationKey(tx.narration);
      if (narrationKey) {
        // Check if rule already exists
        const [existingRule] = await db
          .select()
          .from(enrichmentRules)
          .where(
            and(
              eq(enrichmentRules.userId, req.userId!),
              eq(enrichmentRules.patternType, 'narration_key'),
              eq(enrichmentRules.patternValue, narrationKey)
            )
          )
          .limit(1);

        if (existingRule) {
          // Update existing rule
          await db
            .update(enrichmentRules)
            .set({
              bizType: data.bizType || existingRule.bizType,
              bizDescription: data.bizDescription || existingRule.bizDescription,
              vendorName: data.vendorName || existingRule.vendorName,
              needsInvoice: data.needsInvoice !== undefined ? (data.needsInvoice ? 1 : 0) : existingRule.needsInvoice,
              gstType: data.gstType || existingRule.gstType,
              matchCount: (existingRule.matchCount || 0) + 1,
              updatedAt: now,
            })
            .where(eq(enrichmentRules.id, existingRule.id));
        } else {
          // Create new rule
          await db.insert(enrichmentRules).values({
            id: uuidv4(),
            userId: req.userId!,
            patternType: 'narration_key',
            patternValue: narrationKey,
            bizType: data.bizType,
            bizDescription: data.bizDescription,
            vendorName: data.vendorName,
            needsInvoice: data.needsInvoice ? 1 : 0,
            gstType: data.gstType,
            matchCount: 1,
            priority: 10, // User-defined rules have higher priority
            isActive: 1,
            createdAt: now,
          });
        }
      }
    }

    // Propagate updates to similar transactions with empty values (fuzzy matching)
    let propagatedCount = 0;

    if (data.vendorName || data.bizType) {
      const asgAccountIds = await getASGAccountIds(req.userId!);
      propagatedCount = await propagateToSimilarTransactions(
        req.userId!,
        asgAccountIds,
        tx.narration,
        tx.id,
        {
          vendorName: data.vendorName,
          bizType: data.bizType,
          bizDescription: data.bizDescription,
          gstType: data.gstType,
          needsInvoice: data.needsInvoice,
        }
      );

      if (propagatedCount > 0) {
        console.log(`[BusinessAccounting] Propagated updates to ${propagatedCount} similar transactions (fuzzy match)`);
      }
    }

    const [updated] = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, id));

    res.json({ ...updated, propagatedCount });
  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

// Upload invoice
router.post('/invoice', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { transactionId, invoiceDate, invoiceNumber, vendorName, totalAmount, gstAmount, notes } =
      req.body;

    if (!transactionId) {
      // Delete uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Transaction ID is required' });
    }

    // Verify transaction belongs to user
    const [tx] = await db
      .select()
      .from(bankTransactions)
      .where(and(eq(bankTransactions.id, transactionId), eq(bankTransactions.userId, req.userId!)));

    if (!tx) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Extract GST information from the invoice
    const extractedInfo = await extractGSTInfo(req.file.path, req.file.mimetype);
    console.log('[Invoice Upload] Extracted info:', extractedInfo);

    // Use extracted values if not provided in request
    const finalCgstAmount = extractedInfo.cgstAmount || null;
    const finalSgstAmount = extractedInfo.sgstAmount || null;
    const finalIgstAmount = extractedInfo.igstAmount || null;
    const finalGstAmount = gstAmount ? parseFloat(gstAmount) : extractedInfo.gstAmount;
    const finalInvoiceDate = invoiceDate || extractedInfo.invoiceDate;
    const finalInvoiceNumber = invoiceNumber || extractedInfo.invoiceNumber;
    const finalTotalAmount = totalAmount ? parseFloat(totalAmount) : extractedInfo.totalAmount;
    const finalVendorName = vendorName || tx.vendorName;
    const finalGstType = extractedInfo.gstType || tx.gstType || 'input';

    const now = new Date().toISOString();
    const invoiceId = uuidv4();

    // Calculate taxable amount (total - GST)
    const calculatedGst = (finalCgstAmount || 0) + (finalSgstAmount || 0) + (finalIgstAmount || 0);
    const finalTaxableAmount = finalTotalAmount ? finalTotalAmount - (finalGstAmount || calculatedGst || 0) : null;

    // Create invoice record with extracted data
    await db.insert(businessInvoices).values({
      id: invoiceId,
      userId: req.userId!,
      transactionId,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      invoiceDate: finalInvoiceDate || tx.date || null,
      invoiceNumber: finalInvoiceNumber || null,
      // GST fields
      partyName: finalVendorName || extractedInfo.gstinVendor || null,
      partyGstin: extractedInfo.gstinVendor || null,
      gstType: finalGstType,
      taxableAmount: finalTaxableAmount,
      cgstAmount: finalCgstAmount,
      sgstAmount: finalSgstAmount,
      igstAmount: finalIgstAmount,
      gstAmount: finalGstAmount || calculatedGst || null,
      totalAmount: finalTotalAmount || tx.amount || null,
      // Legacy
      vendorName: finalVendorName || null,
      notes: notes || null,
      createdAt: now,
      updatedAt: now,
    });

    // Update transaction with invoice reference and extracted GST info
    await db
      .update(bankTransactions)
      .set({
        invoiceFileId: invoiceId,
        gstAmount: finalGstAmount || tx.gstAmount,
        cgstAmount: finalCgstAmount,
        sgstAmount: finalSgstAmount,
        igstAmount: finalIgstAmount,
        gstType: finalGstType,
        updatedAt: now,
      })
      .where(eq(bankTransactions.id, transactionId));

    const [invoice] = await db
      .select()
      .from(businessInvoices)
      .where(eq(businessInvoices.id, invoiceId));

    // Return invoice with extracted info for frontend display
    res.json({
      ...invoice,
      extracted: {
        gstAmount: extractedInfo.gstAmount,
        cgstAmount: extractedInfo.cgstAmount,
        sgstAmount: extractedInfo.sgstAmount,
        igstAmount: extractedInfo.igstAmount,
        invoiceNumber: extractedInfo.invoiceNumber,
        invoiceDate: extractedInfo.invoiceDate,
        totalAmount: extractedInfo.totalAmount,
        gstinVendor: extractedInfo.gstinVendor,
      },
    });
  } catch (error) {
    console.error('Error uploading invoice:', error);
    res.status(500).json({ error: 'Failed to upload invoice' });
  }
});

// Get invoice by ID
router.get('/invoice/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [invoice] = await db
      .select()
      .from(businessInvoices)
      .where(and(eq(businessInvoices.id, id), eq(businessInvoices.userId, req.userId!)));

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (!invoice.filename) {
      return res.status(404).json({ error: 'Invoice has no file attached' });
    }

    const filePath = path.join(invoiceDir, invoice.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Invoice file not found' });
    }

    res.setHeader('Content-Type', invoice.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.originalName || 'invoice'}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error getting invoice:', error);
    res.status(500).json({ error: 'Failed to get invoice' });
  }
});

// Delete invoice
router.delete('/invoice/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [invoice] = await db
      .select()
      .from(businessInvoices)
      .where(and(eq(businessInvoices.id, id), eq(businessInvoices.userId, req.userId!)));

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Remove invoice reference from transaction
    await db
      .update(bankTransactions)
      .set({
        invoiceFileId: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(bankTransactions.invoiceFileId, id));

    // Delete file if exists
    if (invoice.filename) {
      const filePath = path.join(invoiceDir, invoice.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Delete record
    await db.delete(businessInvoices).where(eq(businessInvoices.id, id));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

// Get all matching transactions for a given transaction (for history view)
router.get('/transaction/:id/matches', async (req, res) => {
  try {
    const { id } = req.params;

    // Get the transaction
    const [tx] = await db
      .select()
      .from(bankTransactions)
      .where(and(eq(bankTransactions.id, id), eq(bankTransactions.userId, req.userId!)));

    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const asgAccountIds = await getASGAccountIds(req.userId!);
    if (asgAccountIds.length === 0) {
      return res.json({ matches: [], totalAmount: 0 });
    }

    // Get all transactions for these accounts
    const allTransactions = await db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.userId, req.userId!),
          sql`${bankTransactions.accountId} IN (${sql.join(
            asgAccountIds.map((aid) => sql`${aid}`),
            sql`, `
          )})`
        )
      )
      .orderBy(desc(bankTransactions.date));

    // Find matching transactions using fuzzy matching
    const matches = allTransactions.filter(t =>
      t.id !== tx.id && areNarrationsSimilar(tx.narration, t.narration, 0.4)
    );

    // Group by month
    const monthlyGroups: Record<string, {
      month: string;
      transactions: typeof matches;
      totalAmount: number;
      creditAmount: number;
      debitAmount: number;
    }> = {};

    for (const match of matches) {
      const month = match.date.substring(0, 7); // YYYY-MM
      if (!monthlyGroups[month]) {
        monthlyGroups[month] = {
          month,
          transactions: [],
          totalAmount: 0,
          creditAmount: 0,
          debitAmount: 0,
        };
      }
      monthlyGroups[month].transactions.push(match);
      if (match.transactionType === 'credit') {
        monthlyGroups[month].creditAmount += match.amount;
      } else {
        monthlyGroups[month].debitAmount += match.amount;
      }
      monthlyGroups[month].totalAmount += match.transactionType === 'credit' ? match.amount : -match.amount;
    }

    const groupedMatches = Object.values(monthlyGroups).sort((a, b) => b.month.localeCompare(a.month));

    const summary = {
      totalMatches: matches.length,
      totalCredit: matches.filter(m => m.transactionType === 'credit').reduce((sum, m) => sum + m.amount, 0),
      totalDebit: matches.filter(m => m.transactionType === 'debit').reduce((sum, m) => sum + m.amount, 0),
      firstDate: matches.length > 0 ? matches[matches.length - 1].date : null,
      lastDate: matches.length > 0 ? matches[0].date : null,
    };

    res.json({
      transaction: tx,
      matches: groupedMatches,
      summary,
      extractedKey: extractNarrationKey(tx.narration),
      extractedNames: extractSearchableNames(tx.narration),
    });
  } catch (error) {
    console.error('Error getting matching transactions:', error);
    res.status(500).json({ error: 'Failed to get matching transactions' });
  }
});

// Get vendors with payment summaries
router.get('/vendors', async (req, res) => {
  try {
    const asgAccountIds = await getASGAccountIds(req.userId!);

    if (asgAccountIds.length === 0) {
      return res.json([]);
    }

    const result = await db
      .select({
        vendorName: bankTransactions.vendorName,
        totalAmount: sql<number>`SUM(${bankTransactions.amount})`,
        transactionCount: sql<number>`COUNT(*)`,
        lastPaymentDate: sql<string>`MAX(${bankTransactions.date})`,
        invoiceCount: sql<number>`SUM(CASE WHEN ${bankTransactions.invoiceFileId} IS NOT NULL THEN 1 ELSE 0 END)`,
      })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.userId, req.userId!),
          sql`${bankTransactions.accountId} IN (${sql.join(
            asgAccountIds.map((id) => sql`${id}`),
            sql`, `
          )})`,
          sql`${bankTransactions.vendorName} IS NOT NULL`,
          eq(bankTransactions.transactionType, 'debit')
        )
      )
      .groupBy(bankTransactions.vendorName)
      .orderBy(desc(sql`SUM(${bankTransactions.amount})`));

    res.json(result);
  } catch (error) {
    console.error('Error fetching vendors:', error);
    res.status(500).json({ error: 'Failed to fetch vendors' });
  }
});

// Get payment history for a vendor (grouped by month)
router.get('/vendors/:name/payments', async (req, res) => {
  try {
    const { name } = req.params;
    const decodedName = decodeURIComponent(name);
    const asgAccountIds = await getASGAccountIds(req.userId!);

    if (asgAccountIds.length === 0) {
      return res.json([]);
    }

    const result = await db
      .select({
        month: sql<string>`strftime('%Y-%m', ${bankTransactions.date})`,
        totalAmount: sql<number>`SUM(${bankTransactions.amount})`,
        transactionCount: sql<number>`COUNT(*)`,
      })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.userId, req.userId!),
          sql`${bankTransactions.accountId} IN (${sql.join(
            asgAccountIds.map((id) => sql`${id}`),
            sql`, `
          )})`,
          eq(bankTransactions.vendorName, decodedName)
        )
      )
      .groupBy(sql`strftime('%Y-%m', ${bankTransactions.date})`)
      .orderBy(desc(sql`strftime('%Y-%m', ${bankTransactions.date})`));

    res.json(result);
  } catch (error) {
    console.error('Error fetching vendor payments:', error);
    res.status(500).json({ error: 'Failed to fetch vendor payments' });
  }
});

// Get actual transactions for a vendor
router.get('/vendors/:name/transactions', async (req, res) => {
  try {
    const { name } = req.params;
    const { month } = req.query; // Optional: filter by month (YYYY-MM)
    const decodedName = decodeURIComponent(name);
    const asgAccountIds = await getASGAccountIds(req.userId!);

    if (asgAccountIds.length === 0) {
      return res.json([]);
    }

    const conditions = [
      eq(bankTransactions.userId, req.userId!),
      sql`${bankTransactions.accountId} IN (${sql.join(
        asgAccountIds.map((id) => sql`${id}`),
        sql`, `
      )})`,
      eq(bankTransactions.vendorName, decodedName),
    ];

    // Filter by month if provided
    if (month) {
      conditions.push(sql`strftime('%Y-%m', ${bankTransactions.date}) = ${month}`);
    }

    const transactions = await db
      .select()
      .from(bankTransactions)
      .where(and(...conditions))
      .orderBy(desc(bankTransactions.date));

    res.json(transactions);
  } catch (error) {
    console.error('Error fetching vendor transactions:', error);
    res.status(500).json({ error: 'Failed to fetch vendor transactions' });
  }
});

// Rename a vendor (updates all transactions and invoices with that vendor name)
router.patch('/vendors/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { newName } = req.body;
    const decodedName = decodeURIComponent(name);

    if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
      return res.status(400).json({ error: 'New vendor name is required' });
    }

    const trimmedNewName = newName.trim();
    const asgAccountIds = await getASGAccountIds(req.userId!);

    if (asgAccountIds.length === 0) {
      return res.status(404).json({ error: 'No ASG accounts found' });
    }

    const now = new Date().toISOString();

    // Update all transactions with this vendor name
    const txResult = await db
      .update(bankTransactions)
      .set({
        vendorName: trimmedNewName,
        updatedAt: now,
      })
      .where(
        and(
          eq(bankTransactions.userId, req.userId!),
          sql`${bankTransactions.accountId} IN (${sql.join(
            asgAccountIds.map((id) => sql`${id}`),
            sql`, `
          )})`,
          eq(bankTransactions.vendorName, decodedName)
        )
      );

    // Also update invoices with this vendor/party name
    await db
      .update(businessInvoices)
      .set({
        vendorName: trimmedNewName,
        partyName: trimmedNewName,
        updatedAt: now,
      })
      .where(
        and(
          eq(businessInvoices.userId, req.userId!),
          sql`(${businessInvoices.vendorName} = ${decodedName} OR ${businessInvoices.partyName} = ${decodedName})`
        )
      );

    res.json({
      success: true,
      oldName: decodedName,
      newName: trimmedNewName,
      message: `Vendor renamed from "${decodedName}" to "${trimmedNewName}"`,
    });
  } catch (error) {
    console.error('Error renaming vendor:', error);
    res.status(500).json({ error: 'Failed to rename vendor' });
  }
});

// Get GST summary
router.get('/gst-summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const asgAccountIds = await getASGAccountIds(req.userId!);

    if (asgAccountIds.length === 0) {
      return res.json({ months: [], totals: { input: 0, output: 0, net: 0 } });
    }

    const conditions = [
      eq(bankTransactions.userId, req.userId!),
      sql`${bankTransactions.accountId} IN (${sql.join(
        asgAccountIds.map((id) => sql`${id}`),
        sql`, `
      )})`,
      sql`${bankTransactions.gstType} IS NOT NULL`,
    ];

    if (startDate && endDate) {
      conditions.push(
        between(bankTransactions.date, startDate as string, endDate as string)
      );
    }

    const result = await db
      .select({
        month: sql<string>`strftime('%Y-%m', ${bankTransactions.date})`,
        gstType: bankTransactions.gstType,
        totalGst: sql<number>`SUM(COALESCE(${bankTransactions.gstAmount}, 0))`,
        transactionCount: sql<number>`COUNT(*)`,
      })
      .from(bankTransactions)
      .where(and(...conditions))
      .groupBy(sql`strftime('%Y-%m', ${bankTransactions.date})`, bankTransactions.gstType)
      .orderBy(desc(sql`strftime('%Y-%m', ${bankTransactions.date})`));

    // Group by month
    const monthlyData: Record<
      string,
      { month: string; input: number; output: number; inputCount: number; outputCount: number }
    > = {};

    for (const row of result) {
      if (!monthlyData[row.month]) {
        monthlyData[row.month] = { month: row.month, input: 0, output: 0, inputCount: 0, outputCount: 0 };
      }
      if (row.gstType === 'input') {
        monthlyData[row.month].input = row.totalGst;
        monthlyData[row.month].inputCount = row.transactionCount;
      } else if (row.gstType === 'output') {
        monthlyData[row.month].output = row.totalGst;
        monthlyData[row.month].outputCount = row.transactionCount;
      }
    }

    const months = Object.values(monthlyData)
      .map((m) => ({
        ...m,
        net: m.output - m.input,
      }))
      .sort((a, b) => b.month.localeCompare(a.month));

    const totals = months.reduce(
      (acc, m) => ({
        input: acc.input + m.input,
        output: acc.output + m.output,
        net: acc.net + m.net,
      }),
      { input: 0, output: 0, net: 0 }
    );

    res.json({ months, totals });
  } catch (error) {
    console.error('Error fetching GST summary:', error);
    res.status(500).json({ error: 'Failed to fetch GST summary' });
  }
});

// Get summary stats
router.get('/summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const asgAccountIds = await getASGAccountIds(req.userId!);

    if (asgAccountIds.length === 0) {
      return res.json({
        totalExpenses: 0,
        totalIncome: 0,
        pendingInvoices: 0,
        gstPayable: 0,
        vendorCount: 0,
      });
    }

    const conditions = [
      eq(bankTransactions.userId, req.userId!),
      sql`${bankTransactions.accountId} IN (${sql.join(
        asgAccountIds.map((id) => sql`${id}`),
        sql`, `
      )})`,
    ];

    // Add date filter if provided
    if (startDate && endDate) {
      conditions.push(between(bankTransactions.date, startDate as string, endDate as string));
    }

    const baseCondition = and(...conditions);

    // Get totals
    const [totals] = await db
      .select({
        totalExpenses: sql<number>`SUM(CASE WHEN ${bankTransactions.transactionType} = 'debit' THEN ${bankTransactions.amount} ELSE 0 END)`,
        totalIncome: sql<number>`SUM(CASE WHEN ${bankTransactions.transactionType} = 'credit' THEN ${bankTransactions.amount} ELSE 0 END)`,
        pendingInvoices: sql<number>`SUM(CASE WHEN ${bankTransactions.needsInvoice} = 1 AND ${bankTransactions.invoiceFileId} IS NULL THEN 1 ELSE 0 END)`,
        gstInput: sql<number>`SUM(CASE WHEN ${bankTransactions.gstType} = 'input' THEN COALESCE(${bankTransactions.gstAmount}, 0) ELSE 0 END)`,
        gstOutput: sql<number>`SUM(CASE WHEN ${bankTransactions.gstType} = 'output' THEN COALESCE(${bankTransactions.gstAmount}, 0) ELSE 0 END)`,
      })
      .from(bankTransactions)
      .where(baseCondition);

    // Get vendor count
    const [vendorResult] = await db
      .select({
        vendorCount: sql<number>`COUNT(DISTINCT ${bankTransactions.vendorName})`,
      })
      .from(bankTransactions)
      .where(
        and(baseCondition, sql`${bankTransactions.vendorName} IS NOT NULL`)
      );

    res.json({
      totalExpenses: totals.totalExpenses || 0,
      totalIncome: totals.totalIncome || 0,
      pendingInvoices: totals.pendingInvoices || 0,
      gstPayable: (totals.gstOutput || 0) - (totals.gstInput || 0),
      vendorCount: vendorResult.vendorCount || 0,
    });
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// Export for CA (XLSX)
router.get('/ca-export', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const asgAccountIds = await getASGAccountIds(req.userId!);

    if (asgAccountIds.length === 0) {
      return res.status(400).json({ error: 'No ASG accounts found' });
    }

    const conditions = [
      eq(bankTransactions.userId, req.userId!),
      sql`${bankTransactions.accountId} IN (${sql.join(
        asgAccountIds.map((id) => sql`${id}`),
        sql`, `
      )})`,
    ];

    if (startDate && endDate) {
      conditions.push(
        between(bankTransactions.date, startDate as string, endDate as string)
      );
    }

    const transactions = await db
      .select()
      .from(bankTransactions)
      .where(and(...conditions))
      .orderBy(desc(bankTransactions.date));

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Transactions');

    // Headers
    sheet.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Type', key: 'bizType', width: 15 },
      { header: 'Description', key: 'bizDescription', width: 40 },
      { header: 'Vendor', key: 'vendorName', width: 25 },
      { header: 'Original Narration', key: 'narration', width: 50 },
      { header: 'Debit', key: 'debit', width: 12 },
      { header: 'Credit', key: 'credit', width: 12 },
      { header: 'GST Type', key: 'gstType', width: 10 },
      { header: 'GST Amount', key: 'gstAmount', width: 12 },
      { header: 'Has Invoice', key: 'hasInvoice', width: 12 },
      { header: 'Reference', key: 'reference', width: 20 },
    ];

    // Style header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add data rows
    for (const tx of transactions) {
      sheet.addRow({
        date: tx.date,
        bizType: tx.bizType || 'OTHER',
        bizDescription: tx.bizDescription || tx.narration,
        vendorName: tx.vendorName || '',
        narration: tx.narration,
        debit: tx.transactionType === 'debit' ? tx.amount : '',
        credit: tx.transactionType === 'credit' ? tx.amount : '',
        gstType: tx.gstType || '',
        gstAmount: tx.gstAmount || '',
        hasInvoice: tx.invoiceFileId ? 'Yes' : 'No',
        reference: tx.reference || '',
      });
    }

    // Format number columns
    sheet.getColumn('debit').numFmt = '#,##0.00';
    sheet.getColumn('credit').numFmt = '#,##0.00';
    sheet.getColumn('gstAmount').numFmt = '#,##0.00';

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    const filename = `ASG_Transactions_${startDate || 'all'}_${endDate || 'all'}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error('Error exporting CA data:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Get business type labels
router.get('/biz-types', (_req, res) => {
  res.json(getBizTypeLabels());
});

// Fix/migrate old invoices that don't have GST fields set properly
router.post('/fix-invoices', async (req, res) => {
  try {
    // Get all invoices that need fixing:
    // 1. gstType is NULL, OR
    // 2. gstAmount is NULL (missing GST extraction)
    const invoicesToFix = await db
      .select()
      .from(businessInvoices)
      .where(
        and(
          eq(businessInvoices.userId, req.userId!),
          sql`(${businessInvoices.gstType} IS NULL OR ${businessInvoices.gstAmount} IS NULL OR ${businessInvoices.gstAmount} = 0)`
        )
      );

    const now = new Date().toISOString();
    let fixedCount = 0;

    for (const invoice of invoicesToFix) {
      const updates: any = {
        gstType: invoice.gstType || 'input', // Default to input for purchases
        updatedAt: now,
      };

      // If linked to a transaction, get details from it
      if (invoice.transactionId) {
        const [tx] = await db
          .select()
          .from(bankTransactions)
          .where(eq(bankTransactions.id, invoice.transactionId));

        if (tx) {
          updates.partyName = invoice.partyName || invoice.vendorName || tx.vendorName;
          updates.gstType = invoice.gstType || tx.gstType || (tx.transactionType === 'credit' ? 'output' : 'input');
          updates.invoiceDate = invoice.invoiceDate || tx.date;
          updates.totalAmount = invoice.totalAmount || tx.amount;
        }
      }

      // Try to extract GST from PDF if file exists and GST is missing
      if (invoice.filename && (!invoice.gstAmount || invoice.gstAmount === 0)) {
        const filePath = path.join(invoiceDir, invoice.filename);

        if (fs.existsSync(filePath)) {
          try {
            console.log(`Re-parsing PDF for invoice ${invoice.id}: ${invoice.filename}`);
            const mimeType = invoice.mimeType || 'application/pdf';
            const gstInfo = await extractGSTInfo(filePath, mimeType);
            console.log(`Extracted GST info:`, gstInfo);

            if (gstInfo.gstAmount && gstInfo.gstAmount > 0) {
              updates.gstAmount = gstInfo.gstAmount;
              updates.cgstAmount = gstInfo.cgstAmount || 0;
              updates.sgstAmount = gstInfo.sgstAmount || 0;
              updates.igstAmount = gstInfo.igstAmount || 0;
              updates.taxableAmount = gstInfo.taxableAmount || (updates.totalAmount ? updates.totalAmount - gstInfo.gstAmount : 0);
              updates.partyGstin = gstInfo.gstinVendor || invoice.partyGstin;
              updates.invoiceNumber = gstInfo.invoiceNumber || invoice.invoiceNumber;
            } else if (updates.totalAmount) {
              // No GST found in PDF - try to calculate assuming 18% GST
              // taxable = total / 1.18, gst = total - taxable
              const taxable = updates.totalAmount / 1.18;
              const gst = updates.totalAmount - taxable;
              updates.taxableAmount = Math.round(taxable * 100) / 100;
              updates.gstAmount = Math.round(gst * 100) / 100;
              updates.cgstAmount = Math.round((gst / 2) * 100) / 100;
              updates.sgstAmount = Math.round((gst / 2) * 100) / 100;
            }
          } catch (parseError) {
            console.error(`Error parsing PDF for invoice ${invoice.id}:`, parseError);
            // If parsing fails but we have totalAmount, estimate GST at 18%
            if (updates.totalAmount && !invoice.gstAmount) {
              const taxable = updates.totalAmount / 1.18;
              const gst = updates.totalAmount - taxable;
              updates.taxableAmount = Math.round(taxable * 100) / 100;
              updates.gstAmount = Math.round(gst * 100) / 100;
              updates.cgstAmount = Math.round((gst / 2) * 100) / 100;
              updates.sgstAmount = Math.round((gst / 2) * 100) / 100;
            }
          }
        }
      }

      // If we still have GST amount but not breakdown, assume 50-50 CGST/SGST
      if (invoice.gstAmount && !invoice.cgstAmount && !invoice.sgstAmount && !invoice.igstAmount) {
        updates.cgstAmount = invoice.gstAmount / 2;
        updates.sgstAmount = invoice.gstAmount / 2;
      }

      // Calculate taxable if missing
      if (!invoice.taxableAmount && updates.totalAmount && (updates.gstAmount || invoice.gstAmount)) {
        updates.taxableAmount = updates.totalAmount - (updates.gstAmount || invoice.gstAmount);
      }

      await db
        .update(businessInvoices)
        .set(updates)
        .where(eq(businessInvoices.id, invoice.id));

      fixedCount++;
    }

    res.json({
      fixed: fixedCount,
      message: `Fixed ${fixedCount} invoices`,
    });
  } catch (error) {
    console.error('Error fixing invoices:', error);
    res.status(500).json({ error: 'Failed to fix invoices' });
  }
});

// ============================================
// GST Invoice Management (Input/Output)
// ============================================

// Schema for GST invoice - all fields optional for quick upload mode
const gstInvoiceSchema = z.object({
  invoiceDate: z.string().optional(),
  invoiceNumber: z.string().optional(),
  partyName: z.string().optional(),
  partyGstin: z.string().optional(),
  gstType: z.enum(['input', 'output']),
  taxableAmount: z.number().optional(),
  cgstAmount: z.number().optional(),
  sgstAmount: z.number().optional(),
  igstAmount: z.number().optional(),
  gstAmount: z.number().optional(),
  totalAmount: z.number().optional(),
  transactionId: z.string().optional(), // Optional - can be external
  notes: z.string().optional(),
});

// Upload GST invoice (can be external or linked to transaction)
// Supports quick upload with just file + gstType, and full form submission
router.post('/gst-invoice', upload.single('file'), async (req, res) => {
  try {
    const data = gstInvoiceSchema.parse({
      ...req.body,
      taxableAmount: req.body.taxableAmount ? parseFloat(req.body.taxableAmount) : undefined,
      cgstAmount: req.body.cgstAmount ? parseFloat(req.body.cgstAmount) : undefined,
      sgstAmount: req.body.sgstAmount ? parseFloat(req.body.sgstAmount) : undefined,
      igstAmount: req.body.igstAmount ? parseFloat(req.body.igstAmount) : undefined,
      gstAmount: req.body.gstAmount ? parseFloat(req.body.gstAmount) : undefined,
      totalAmount: req.body.totalAmount ? parseFloat(req.body.totalAmount) : undefined,
    });

    const now = new Date().toISOString();
    const invoiceId = uuidv4();

    // If file is uploaded, extract GST info
    let extractedInfo: any = {};
    if (req.file) {
      try {
        extractedInfo = await extractGSTInfo(req.file.path, req.file.mimetype);
        console.log('Extracted GST info from uploaded file:', extractedInfo);
      } catch (parseError) {
        console.error('Error extracting GST from file:', parseError);
      }
    }

    // Check for duplicate invoice by invoice number
    const invoiceNumber = data.invoiceNumber || extractedInfo.invoiceNumber;
    if (invoiceNumber) {
      const existingInvoice = await db
        .select()
        .from(businessInvoices)
        .where(
          and(
            eq(businessInvoices.userId, req.userId!),
            eq(businessInvoices.invoiceNumber, invoiceNumber)
          )
        )
        .limit(1);

      if (existingInvoice.length > 0) {
        // Clean up uploaded file since we're rejecting the upload
        if (req.file) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        return res.status(409).json({
          error: `Duplicate invoice: Invoice #${invoiceNumber} already exists`,
          existingInvoiceId: existingInvoice[0].id,
          existingPartyName: existingInvoice[0].partyName,
        });
      }
    }

    // If linked to a transaction, get transaction details
    let txDetails: any = null;
    if (data.transactionId) {
      const [tx] = await db
        .select()
        .from(bankTransactions)
        .where(eq(bankTransactions.id, data.transactionId));
      if (tx) {
        txDetails = tx;
      }
    }

    // Build invoice data with fallbacks: provided data > extracted data > transaction data > defaults
    const invoiceDate = data.invoiceDate || (txDetails?.date?.split('T')[0]) || now.split('T')[0];
    const partyName = data.partyName || extractedInfo.partyName || txDetails?.vendorName || 'Unknown';
    const totalAmount = data.totalAmount || extractedInfo.totalAmount || txDetails?.amount || 0;

    // GST amounts with fallbacks
    let gstAmount = data.gstAmount || extractedInfo.gstAmount || 0;
    let cgstAmount = data.cgstAmount || extractedInfo.cgstAmount || 0;
    let sgstAmount = data.sgstAmount || extractedInfo.sgstAmount || 0;
    let igstAmount = data.igstAmount || extractedInfo.igstAmount || 0;
    let taxableAmount = data.taxableAmount || extractedInfo.taxableAmount || 0;

    // If we have total but no GST breakdown, estimate at 18%
    if (totalAmount > 0 && gstAmount === 0 && cgstAmount === 0 && sgstAmount === 0 && igstAmount === 0) {
      taxableAmount = Math.round((totalAmount / 1.18) * 100) / 100;
      gstAmount = Math.round((totalAmount - taxableAmount) * 100) / 100;
      cgstAmount = Math.round((gstAmount / 2) * 100) / 100;
      sgstAmount = Math.round((gstAmount / 2) * 100) / 100;
    }

    // If we have GST but no taxable, calculate it
    if (gstAmount > 0 && taxableAmount === 0 && totalAmount > 0) {
      taxableAmount = totalAmount - gstAmount;
    }

    // Auto-match invoice to transaction if not already linked
    let matchedTransactionId: string | null = data.transactionId || null;

    if (!matchedTransactionId && partyName && partyName !== 'Unknown' && totalAmount > 0) {
      // Try to find a matching transaction by vendor name, amount, and date
      const invoiceDateObj = new Date(invoiceDate);
      const dateStart = new Date(invoiceDateObj);
      dateStart.setDate(dateStart.getDate() - 14); // 14 days before
      const dateEnd = new Date(invoiceDateObj);
      dateEnd.setDate(dateEnd.getDate() + 14); // 14 days after

      // Get potential matching transactions
      const potentialMatches = await db
        .select()
        .from(bankTransactions)
        .where(
          and(
            eq(bankTransactions.userId, req.userId!),
            between(bankTransactions.date, dateStart.toISOString().split('T')[0], dateEnd.toISOString().split('T')[0]),
            isNull(bankTransactions.invoiceFileId) // Not already linked to an invoice
          )
        );

      // Find best match by vendor name and amount
      const partyNameLower = partyName.toLowerCase().trim();
      const partyNameWords = partyNameLower.split(/\s+/).filter((w: string) => w.length >= 2);

      for (const tx of potentialMatches) {
        const txVendorName = (tx.vendorName || '').toLowerCase().trim();
        const txNarration = (tx.narration || '').toLowerCase();
        const txAmount = tx.amount || 0;

        // Check if amount matches (within 1% tolerance for rounding differences)
        const amountDiff = Math.abs(txAmount - totalAmount);
        const amountMatches = amountDiff < 1 || (totalAmount > 0 && (amountDiff / totalAmount) < 0.01);

        if (!amountMatches) continue;

        // Multiple vendor matching strategies
        const exactMatch = txVendorName === partyNameLower;
        const vendorContainsParty = txVendorName.includes(partyNameLower);
        const partyContainsVendor = txVendorName.length > 2 && partyNameLower.includes(txVendorName);
        const wordMatch = partyNameWords.some((word: string) =>
          txVendorName.includes(word) || txNarration.includes(word)
        );
        const prefixMatch = partyNameLower.length >= 3 &&
          (txVendorName.includes(partyNameLower.substring(0, Math.min(10, partyNameLower.length))) ||
           txNarration.includes(partyNameLower.substring(0, Math.min(10, partyNameLower.length))));

        const vendorMatches = exactMatch || vendorContainsParty || partyContainsVendor || wordMatch || prefixMatch;

        if (vendorMatches) {
          matchedTransactionId = tx.id;
          console.log(`Auto-matched invoice to transaction: ${tx.id} (${tx.vendorName || tx.narration?.substring(0, 30)})`);
          break;
        }
      }
    }

    // Create invoice record
    await db.insert(businessInvoices).values({
      id: invoiceId,
      userId: req.userId!,
      transactionId: matchedTransactionId,
      filename: req.file?.filename || null,
      originalName: req.file?.originalname || null,
      mimeType: req.file?.mimetype || null,
      size: req.file?.size || null,
      invoiceDate,
      invoiceNumber: data.invoiceNumber || extractedInfo.invoiceNumber || null,
      partyName,
      partyGstin: data.partyGstin || extractedInfo.gstinVendor || null,
      vendorName: partyName, // Legacy field
      gstType: data.gstType,
      taxableAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      gstAmount,
      totalAmount,
      notes: data.notes || null,
      documentType: extractedInfo.documentType || null,
      isEstimate: extractedInfo.isEstimate ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });

    // If linked to a transaction (manual or auto-matched), update the transaction
    if (matchedTransactionId) {
      await db
        .update(bankTransactions)
        .set({
          invoiceFileId: invoiceId,
          gstAmount,
          cgstAmount,
          sgstAmount,
          igstAmount,
          gstType: data.gstType,
          vendorName: partyName, // Update vendor name from invoice
          updatedAt: now,
        })
        .where(eq(bankTransactions.id, matchedTransactionId));
    }

    const [invoice] = await db
      .select()
      .from(businessInvoices)
      .where(eq(businessInvoices.id, invoiceId));

    // Include auto-match info in response
    const autoMatched = matchedTransactionId && !data.transactionId;
    res.json({
      ...invoice,
      autoMatched,
      matchedTransactionId: autoMatched ? matchedTransactionId : undefined,
    });
  } catch (error) {
    console.error('Error creating GST invoice:', error);
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    res.status(500).json({ error: 'Failed to create GST invoice' });
  }
});

// Get all GST invoices with filters
router.get('/gst-invoices', async (req, res) => {
  try {
    const { startDate, endDate, gstType, hasFile, isExternal } = req.query;

    const conditions = [eq(businessInvoices.userId, req.userId!)];

    if (startDate && endDate) {
      conditions.push(between(businessInvoices.invoiceDate, startDate as string, endDate as string));
    }
    if (gstType && gstType !== 'all') {
      conditions.push(eq(businessInvoices.gstType, gstType as string));
    }
    if (hasFile === 'true') {
      conditions.push(sql`${businessInvoices.filename} IS NOT NULL`);
    }
    if (isExternal === 'true') {
      conditions.push(isNull(businessInvoices.transactionId));
    } else if (isExternal === 'false') {
      conditions.push(sql`${businessInvoices.transactionId} IS NOT NULL`);
    }

    const invoices = await db
      .select()
      .from(businessInvoices)
      .where(and(...conditions))
      .orderBy(desc(businessInvoices.invoiceDate));

    res.json(invoices);
  } catch (error) {
    console.error('Error fetching GST invoices:', error);
    res.status(500).json({ error: 'Failed to fetch GST invoices' });
  }
});

// Update a single GST invoice
router.patch('/gst-invoice/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Verify invoice belongs to user
    const [existing] = await db
      .select()
      .from(businessInvoices)
      .where(and(eq(businessInvoices.id, id), eq(businessInvoices.userId, req.userId!)));

    if (!existing) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const now = new Date().toISOString();
    await db
      .update(businessInvoices)
      .set({
        ...updateData,
        updatedAt: now,
      })
      .where(eq(businessInvoices.id, id));

    // If linked to transaction, update transaction GST info
    if (existing.transactionId) {
      const gstUpdates: any = { updatedAt: now };
      if (updateData.gstAmount !== undefined) gstUpdates.gstAmount = updateData.gstAmount;
      if (updateData.cgstAmount !== undefined) gstUpdates.cgstAmount = updateData.cgstAmount;
      if (updateData.sgstAmount !== undefined) gstUpdates.sgstAmount = updateData.sgstAmount;
      if (updateData.igstAmount !== undefined) gstUpdates.igstAmount = updateData.igstAmount;
      if (updateData.gstType !== undefined) gstUpdates.gstType = updateData.gstType;

      if (Object.keys(gstUpdates).length > 1) {
        await db
          .update(bankTransactions)
          .set(gstUpdates)
          .where(eq(bankTransactions.id, existing.transactionId));
      }
    }

    const [updated] = await db
      .select()
      .from(businessInvoices)
      .where(eq(businessInvoices.id, id));

    res.json(updated);
  } catch (error) {
    console.error('Error updating GST invoice:', error);
    res.status(500).json({ error: 'Failed to update GST invoice' });
  }
});

// Bulk update GST invoices
router.patch('/gst-invoices/bulk', async (req, res) => {
  try {
    const { invoiceIds, updates } = req.body as {
      invoiceIds: string[];
      updates: {
        gstType?: 'input' | 'output';
        partyName?: string;
        partyGstin?: string;
        notes?: string;
      };
    };

    if (!invoiceIds || invoiceIds.length === 0) {
      return res.status(400).json({ error: 'No invoice IDs provided' });
    }

    const now = new Date().toISOString();
    let updatedCount = 0;

    for (const invoiceId of invoiceIds) {
      // Verify ownership
      const [existing] = await db
        .select()
        .from(businessInvoices)
        .where(and(eq(businessInvoices.id, invoiceId), eq(businessInvoices.userId, req.userId!)));

      if (existing) {
        await db
          .update(businessInvoices)
          .set({
            ...updates,
            updatedAt: now,
          })
          .where(eq(businessInvoices.id, invoiceId));

        // Update linked transaction if GST type changed
        if (existing.transactionId && updates.gstType) {
          await db
            .update(bankTransactions)
            .set({ gstType: updates.gstType, updatedAt: now })
            .where(eq(bankTransactions.id, existing.transactionId));
        }

        updatedCount++;
      }
    }

    res.json({ updated: updatedCount, message: `Updated ${updatedCount} invoices` });
  } catch (error) {
    console.error('Error bulk updating GST invoices:', error);
    res.status(500).json({ error: 'Failed to bulk update invoices' });
  }
});

// Delete GST invoice
router.delete('/gst-invoice/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(businessInvoices)
      .where(and(eq(businessInvoices.id, id), eq(businessInvoices.userId, req.userId!)));

    if (!existing) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Remove link from transaction if any
    if (existing.transactionId) {
      await db
        .update(bankTransactions)
        .set({
          invoiceFileId: null,
          gstAmount: null,
          cgstAmount: null,
          sgstAmount: null,
          igstAmount: null,
          gstType: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(bankTransactions.id, existing.transactionId));
    }

    // Delete file if exists
    if (existing.filename) {
      const filePath = path.join(invoiceDir, existing.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await db.delete(businessInvoices).where(eq(businessInvoices.id, id));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting GST invoice:', error);
    res.status(500).json({ error: 'Failed to delete GST invoice' });
  }
});

// Get GST Ledger - comprehensive summary with invoice details
router.get('/gst-ledger', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const conditions = [eq(businessInvoices.userId, req.userId!)];

    if (startDate && endDate) {
      // Use invoiceDate if available, otherwise use createdAt
      conditions.push(
        sql`COALESCE(${businessInvoices.invoiceDate}, substr(${businessInvoices.createdAt}, 1, 10)) BETWEEN ${startDate} AND ${endDate}`
      );
    }

    // Get all invoices for the period
    const invoices = await db
      .select()
      .from(businessInvoices)
      .where(and(...conditions))
      .orderBy(desc(sql`COALESCE(${businessInvoices.invoiceDate}, substr(${businessInvoices.createdAt}, 1, 10))`));

    // Separate input and output (treat null/unknown as input by default for purchases)
    const inputInvoices = invoices.filter(i => i.gstType === 'input' || !i.gstType);
    const outputInvoices = invoices.filter(i => i.gstType === 'output');

    // Calculate totals
    const inputTotals = {
      count: inputInvoices.length,
      taxableAmount: inputInvoices.reduce((sum, i) => sum + (i.taxableAmount || 0), 0),
      cgst: inputInvoices.reduce((sum, i) => sum + (i.cgstAmount || 0), 0),
      sgst: inputInvoices.reduce((sum, i) => sum + (i.sgstAmount || 0), 0),
      igst: inputInvoices.reduce((sum, i) => sum + (i.igstAmount || 0), 0),
      totalGst: inputInvoices.reduce((sum, i) => sum + (i.gstAmount || 0), 0),
      totalAmount: inputInvoices.reduce((sum, i) => sum + (i.totalAmount || 0), 0),
    };

    const outputTotals = {
      count: outputInvoices.length,
      taxableAmount: outputInvoices.reduce((sum, i) => sum + (i.taxableAmount || 0), 0),
      cgst: outputInvoices.reduce((sum, i) => sum + (i.cgstAmount || 0), 0),
      sgst: outputInvoices.reduce((sum, i) => sum + (i.sgstAmount || 0), 0),
      igst: outputInvoices.reduce((sum, i) => sum + (i.igstAmount || 0), 0),
      totalGst: outputInvoices.reduce((sum, i) => sum + (i.gstAmount || 0), 0),
      totalAmount: outputInvoices.reduce((sum, i) => sum + (i.totalAmount || 0), 0),
    };

    // Net liability
    const netLiability = {
      cgst: outputTotals.cgst - inputTotals.cgst,
      sgst: outputTotals.sgst - inputTotals.sgst,
      igst: outputTotals.igst - inputTotals.igst,
      total: outputTotals.totalGst - inputTotals.totalGst,
      status: outputTotals.totalGst > inputTotals.totalGst ? 'payable' : 'credit',
    };

    // Group by month
    const monthlyData: Record<string, {
      month: string;
      input: typeof inputTotals;
      output: typeof outputTotals;
      net: number;
    }> = {};

    for (const invoice of invoices) {
      const month = invoice.invoiceDate?.substring(0, 7) || 'unknown';
      if (!monthlyData[month]) {
        monthlyData[month] = {
          month,
          input: { count: 0, taxableAmount: 0, cgst: 0, sgst: 0, igst: 0, totalGst: 0, totalAmount: 0 },
          output: { count: 0, taxableAmount: 0, cgst: 0, sgst: 0, igst: 0, totalGst: 0, totalAmount: 0 },
          net: 0,
        };
      }
      const target = invoice.gstType === 'input' ? monthlyData[month].input : monthlyData[month].output;
      target.count++;
      target.taxableAmount += invoice.taxableAmount || 0;
      target.cgst += invoice.cgstAmount || 0;
      target.sgst += invoice.sgstAmount || 0;
      target.igst += invoice.igstAmount || 0;
      target.totalGst += invoice.gstAmount || 0;
      target.totalAmount += invoice.totalAmount || 0;
    }

    // Calculate net for each month
    for (const month of Object.keys(monthlyData)) {
      monthlyData[month].net = monthlyData[month].output.totalGst - monthlyData[month].input.totalGst;
    }

    const months = Object.values(monthlyData).sort((a, b) => b.month.localeCompare(a.month));

    res.json({
      inputTotals,
      outputTotals,
      netLiability,
      months,
      inputInvoices,
      outputInvoices,
    });
  } catch (error) {
    console.error('Error fetching GST ledger:', error);
    res.status(500).json({ error: 'Failed to fetch GST ledger' });
  }
});

// ============================================
// Get Invoices by Vendor for Manual Matching
// ============================================

// Get unlinked invoices for a vendor/party name
router.get('/invoices-by-vendor', async (req, res) => {
  try {
    const { vendorName } = req.query;

    if (!vendorName || typeof vendorName !== 'string') {
      return res.json([]);
    }

    const vendorLower = vendorName.toLowerCase().trim();

    // Get all unlinked invoices
    const allInvoices = await db
      .select()
      .from(businessInvoices)
      .where(
        and(
          eq(businessInvoices.userId, req.userId!),
          sql`(${businessInvoices.transactionId} IS NULL OR ${businessInvoices.transactionId} = '')`
        )
      )
      .orderBy(desc(businessInvoices.invoiceDate));

    // Filter by vendor name match (flexible matching)
    const matchingInvoices = allInvoices.filter(inv => {
      const partyName = (inv.partyName || '').toLowerCase().trim();
      if (!partyName) return false;

      // Check various matching strategies
      const exactMatch = partyName === vendorLower;
      const vendorContainsParty = vendorLower.includes(partyName);
      const partyContainsVendor = partyName.includes(vendorLower);
      const wordMatch = vendorLower.split(/\s+/).some(word =>
        word.length >= 2 && partyName.includes(word)
      );

      return exactMatch || vendorContainsParty || partyContainsVendor || wordMatch;
    });

    res.json(matchingInvoices);
  } catch (error) {
    console.error('Error fetching invoices by vendor:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// Manually link an invoice to a transaction
router.post('/link-invoice', async (req, res) => {
  try {
    const { invoiceId, transactionId } = req.body;

    if (!invoiceId || !transactionId) {
      return res.status(400).json({ error: 'invoiceId and transactionId are required' });
    }

    // Verify invoice belongs to user
    const [invoice] = await db
      .select()
      .from(businessInvoices)
      .where(and(eq(businessInvoices.id, invoiceId), eq(businessInvoices.userId, req.userId!)));

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Verify transaction belongs to user
    const [transaction] = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, transactionId));

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const now = new Date().toISOString();

    // Link invoice to transaction
    await db
      .update(businessInvoices)
      .set({ transactionId, updatedAt: now })
      .where(eq(businessInvoices.id, invoiceId));

    // Update transaction with invoice file id and GST info
    await db
      .update(bankTransactions)
      .set({
        invoiceFileId: invoiceId,
        gstAmount: invoice.gstAmount || ((invoice.cgstAmount || 0) + (invoice.sgstAmount || 0) + (invoice.igstAmount || 0)),
        cgstAmount: invoice.cgstAmount,
        sgstAmount: invoice.sgstAmount,
        igstAmount: invoice.igstAmount,
        gstType: invoice.gstType || 'input',
        updatedAt: now,
      })
      .where(eq(bankTransactions.id, transactionId));

    res.json({ success: true, message: 'Invoice linked to transaction' });
  } catch (error) {
    console.error('Error linking invoice:', error);
    res.status(500).json({ error: 'Failed to link invoice' });
  }
});

// ============================================
// Auto-Match Invoices to Transactions
// ============================================

// Auto-match unlinked invoices to transactions
router.post('/auto-match-invoices', async (req, res) => {
  try {
    const asgAccountIds = await getASGAccountIds(req.userId!);

    if (asgAccountIds.length === 0) {
      return res.json({ matched: 0, message: 'No ASG accounts found' });
    }

    const now = new Date().toISOString();

    // First, clean up any invoices with stale transaction_id (pointing to non-existent transactions)
    const invoicesWithLinks = await db
      .select({ id: businessInvoices.id, transactionId: businessInvoices.transactionId })
      .from(businessInvoices)
      .where(
        and(
          eq(businessInvoices.userId, req.userId!),
          sql`${businessInvoices.transactionId} IS NOT NULL AND ${businessInvoices.transactionId} != ''`
        )
      );

    let staleCount = 0;
    for (const inv of invoicesWithLinks) {
      const [tx] = await db
        .select({ id: bankTransactions.id })
        .from(bankTransactions)
        .where(eq(bankTransactions.id, inv.transactionId!))
        .limit(1);

      if (!tx) {
        // Transaction doesn't exist - clear the stale link
        await db
          .update(businessInvoices)
          .set({ transactionId: null, updatedAt: now })
          .where(eq(businessInvoices.id, inv.id));
        staleCount++;
      }
    }

    if (staleCount > 0) {
      console.log(`[AutoMatch] Cleaned up ${staleCount} invoices with stale transaction links`);
    }

    // Get all unlinked invoices (no transactionId)
    const unlinkedInvoices = await db
      .select()
      .from(businessInvoices)
      .where(
        and(
          eq(businessInvoices.userId, req.userId!),
          isNull(businessInvoices.transactionId),
          sql`${businessInvoices.totalAmount} > 0`
        )
      );

    if (unlinkedInvoices.length === 0) {
      return res.json({ matched: 0, staleCleared: staleCount, message: 'No unlinked invoices to match' });
    }

    let matchedCount = 0;
    const matchDetails: Array<{
      invoiceId: string;
      invoiceNumber: string | null;
      partyName: string | null;
      transactionId: string;
      transactionDate: string;
      amount: number;
    }> = [];

    for (const invoice of unlinkedInvoices) {
      const partyName = invoice.partyName || invoice.vendorName;
      const totalAmount = invoice.totalAmount || 0;

      if (!partyName || partyName === 'Unknown' || totalAmount <= 0) continue;

      // Calculate date range: 14 days before and after invoice date (wider range for better matching)
      const invoiceDate = invoice.invoiceDate || invoice.createdAt?.split('T')[0];
      if (!invoiceDate) continue;

      const invoiceDateObj = new Date(invoiceDate);
      const dateStart = new Date(invoiceDateObj);
      dateStart.setDate(dateStart.getDate() - 14);
      const dateEnd = new Date(invoiceDateObj);
      dateEnd.setDate(dateEnd.getDate() + 14);

      // Get potential matching transactions (not already linked to an invoice)
      const potentialMatches = await db
        .select()
        .from(bankTransactions)
        .where(
          and(
            eq(bankTransactions.userId, req.userId!),
            sql`${bankTransactions.accountId} IN (${sql.join(
              asgAccountIds.map((id) => sql`${id}`),
              sql`, `
            )})`,
            between(bankTransactions.date, dateStart.toISOString().split('T')[0], dateEnd.toISOString().split('T')[0]),
            sql`(${bankTransactions.invoiceFileId} IS NULL OR ${bankTransactions.invoiceFileId} = '')` // Not already linked
          )
        );

      // Find best match by vendor name and amount
      const partyNameLower = partyName.toLowerCase().trim();
      // Include all words, even short ones like "HTRZ"
      const partyNameWords = partyNameLower.split(/\s+/).filter((w: string) => w.length >= 2);

      for (const tx of potentialMatches) {
        const txVendorName = (tx.vendorName || '').toLowerCase().trim();
        const txNarration = (tx.narration || '').toLowerCase();
        const txAmount = tx.amount || 0;

        // Check if amount matches (within 1% tolerance for rounding differences)
        const amountDiff = Math.abs(txAmount - totalAmount);
        const amountMatches = amountDiff < 1 || (totalAmount > 0 && (amountDiff / totalAmount) < 0.01);

        if (!amountMatches) continue;

        // Multiple vendor matching strategies:
        // 1. Exact match of vendor name
        const exactMatch = txVendorName === partyNameLower;
        // 2. Transaction vendor contains party name
        const vendorContainsParty = txVendorName.includes(partyNameLower);
        // 3. Party name contains transaction vendor (if vendor name exists)
        const partyContainsVendor = txVendorName.length > 2 && partyNameLower.includes(txVendorName);
        // 4. Any word from party name appears in transaction vendor or narration
        const wordMatch = partyNameWords.some((word: string) =>
          txVendorName.includes(word) || txNarration.includes(word)
        );
        // 5. First part of party name (for short names like HTRZ)
        const prefixMatch = partyNameLower.length >= 3 &&
          (txVendorName.includes(partyNameLower.substring(0, Math.min(10, partyNameLower.length))) ||
           txNarration.includes(partyNameLower.substring(0, Math.min(10, partyNameLower.length))));

        const vendorMatches = exactMatch || vendorContainsParty || partyContainsVendor || wordMatch || prefixMatch;

        if (vendorMatches) {
          // Found a match! Link the invoice to the transaction
          await db
            .update(businessInvoices)
            .set({
              transactionId: tx.id,
              updatedAt: now,
            })
            .where(eq(businessInvoices.id, invoice.id));

          await db
            .update(bankTransactions)
            .set({
              invoiceFileId: invoice.id,
              gstAmount: invoice.gstAmount || tx.gstAmount,
              cgstAmount: invoice.cgstAmount,
              sgstAmount: invoice.sgstAmount,
              igstAmount: invoice.igstAmount,
              gstType: invoice.gstType || tx.gstType,
              vendorName: partyName, // Update vendor name from invoice
              updatedAt: now,
            })
            .where(eq(bankTransactions.id, tx.id));

          matchedCount++;
          matchDetails.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            partyName,
            transactionId: tx.id,
            transactionDate: tx.date,
            amount: txAmount,
          });

          console.log(`Auto-matched invoice ${invoice.invoiceNumber || invoice.id} to transaction ${tx.id}`);
          break;
        }
      }
    }

    res.json({
      matched: matchedCount,
      total: unlinkedInvoices.length,
      staleCleared: staleCount,
      details: matchDetails,
      message: `Matched ${matchedCount} of ${unlinkedInvoices.length} unlinked invoices${staleCount > 0 ? ` (cleared ${staleCount} stale links)` : ''}`,
    });
  } catch (error) {
    console.error('Error auto-matching invoices:', error);
    res.status(500).json({ error: 'Failed to auto-match invoices' });
  }
});

// ============================================
// Import External Data (Amazon, etc.)
// ============================================

/**
 * Parse CSV content handling quoted fields properly
 */
function parseCSVLine(line: string): string[] {
  const row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field.trim());
  return row;
}

/**
 * Parse Amazon Business CSV and extract GST data
 */
function parseAmazonCSV(content: string): {
  totalGST: number;
  totalSubtotal: number;
  totalNet: number;
  itemCount: number;
  sellers: Record<string, number>;
  startDate: string | null;
  endDate: string | null;
  items: Array<{
    date: string;
    orderId: string;
    title: string;
    seller: string;
    subtotal: number;
    gst: number;
    total: number;
  }>;
} {
  const lines = content.split('\n');
  const header = parseCSVLine(lines[0]);

  // Find column indices
  const orderDateIdx = header.findIndex(h => h.includes('Order Date'));
  const orderIdIdx = header.findIndex(h => h.includes('Order ID'));
  const orderStatusIdx = header.findIndex(h => h.includes('Order Status'));
  const titleIdx = header.findIndex(h => h.includes('Title'));
  const sellerIdx = header.findIndex(h => h.includes('Seller Name'));
  const itemSubtotalIdx = header.findIndex(h => h.includes('Item Subtotal'));
  const itemTaxIdx = header.findIndex(h => h.includes('Item & Shipping Tax'));
  const itemNetTotalIdx = header.findIndex(h => h.includes('Item Net Total'));

  let totalGST = 0;
  let totalSubtotal = 0;
  let totalNet = 0;
  let itemCount = 0;
  const sellers: Record<string, number> = {};
  const items: Array<any> = [];
  let startDate: string | null = null;
  let endDate: string | null = null;

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    const row = parseCSVLine(lines[i]);
    const status = row[orderStatusIdx];
    if (status === 'Cancelled') continue;

    const itemTax = parseFloat(row[itemTaxIdx]?.replace(/[^0-9.-]/g, '')) || 0;
    const subtotal = parseFloat(row[itemSubtotalIdx]?.replace(/[^0-9.-]/g, '')) || 0;
    const netTotal = parseFloat(row[itemNetTotalIdx]?.replace(/[^0-9.-]/g, '')) || 0;
    const seller = row[sellerIdx] || 'Unknown';
    const orderDate = row[orderDateIdx];
    const orderId = row[orderIdIdx];
    const title = row[titleIdx];

    if (itemTax > 0) {
      totalGST += itemTax;
      totalSubtotal += subtotal;
      totalNet += netTotal;
      itemCount++;
      sellers[seller] = (sellers[seller] || 0) + itemTax;

      // Track date range
      if (orderDate) {
        if (!startDate || orderDate < startDate) startDate = orderDate;
        if (!endDate || orderDate > endDate) endDate = orderDate;
      }

      items.push({
        date: orderDate,
        orderId,
        title: title?.substring(0, 100),
        seller,
        subtotal,
        gst: itemTax,
        total: netTotal,
      });
    }
  }

  return { totalGST, totalSubtotal, totalNet, itemCount, sellers, startDate, endDate, items };
}

// Import Amazon Business CSV
router.post('/import-amazon-csv', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Read the uploaded CSV file
    const content = fs.readFileSync(req.file.path, 'utf8');
    const parsed = parseAmazonCSV(content);

    if (parsed.itemCount === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'No valid GST items found in CSV' });
    }

    const now = new Date().toISOString();
    const invoiceId = uuidv4();

    // Determine the month/period for the invoice
    const periodStart = parsed.startDate || now.split('T')[0];
    const periodEnd = parsed.endDate || periodStart;
    const periodMonth = periodStart.substring(0, 7); // YYYY-MM
    const invoiceNumber = `AMAZON-${periodMonth}`;

    // Check for duplicate Amazon import for the same period
    const existingInvoice = await db
      .select()
      .from(businessInvoices)
      .where(
        and(
          eq(businessInvoices.userId, req.userId!),
          eq(businessInvoices.invoiceNumber, invoiceNumber)
        )
      )
      .limit(1);

    if (existingInvoice.length > 0) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(409).json({
        error: `Duplicate: Amazon CSV for ${periodMonth} already imported`,
        existingInvoiceId: existingInvoice[0].id,
        existingPartyName: 'Amazon Business',
      });
    }

    // Format period for display (e.g., "Jan 2026")
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const [year, month] = periodMonth.split('-');
    const periodDisplay = `${monthNames[parseInt(month) - 1]} ${year}`;

    // Calculate GST breakdown (assume 50-50 CGST/SGST for intra-state)
    const cgstAmount = Math.round((parsed.totalGST / 2) * 100) / 100;
    const sgstAmount = Math.round((parsed.totalGST / 2) * 100) / 100;
    const taxableAmount = Math.round(parsed.totalSubtotal * 100) / 100;

    // Create a consolidated GST invoice entry
    await db.insert(businessInvoices).values({
      id: invoiceId,
      userId: req.userId!,
      transactionId: null, // External - no linked transaction
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: 'text/csv',
      size: req.file.size,
      invoiceDate: periodEnd, // Use end date of the period
      invoiceNumber,
      partyName: 'Amazon Business',
      partyGstin: null, // Amazon has multiple sellers
      vendorName: 'Amazon Business',
      gstType: 'input', // Purchases = Input GST
      taxableAmount,
      cgstAmount,
      sgstAmount,
      igstAmount: 0,
      gstAmount: parsed.totalGST,
      totalAmount: parsed.totalNet,
      notes: `Amazon Business Orders - ${periodDisplay}\n${parsed.itemCount} items from ${Object.keys(parsed.sellers).length} sellers\n\nTop sellers:\n${
        Object.entries(parsed.sellers)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([s, g]) => `• ${s}: ₹${g.toFixed(2)}`)
          .join('\n')
      }`,
      createdAt: now,
      updatedAt: now,
    });

    const [invoice] = await db
      .select()
      .from(businessInvoices)
      .where(eq(businessInvoices.id, invoiceId));

    res.json({
      success: true,
      invoice,
      summary: {
        period: periodDisplay,
        itemCount: parsed.itemCount,
        sellerCount: Object.keys(parsed.sellers).length,
        totalGST: parsed.totalGST,
        totalSubtotal: parsed.totalSubtotal,
        totalNet: parsed.totalNet,
        sellers: parsed.sellers,
      },
    });
  } catch (error) {
    console.error('Error importing Amazon CSV:', error);
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    res.status(500).json({ error: 'Failed to import Amazon CSV' });
  }
});

// ============================================================
// GearUp Mods Account Management (exclusive to g.chanchal@gmail.com)
// ============================================================

const GEARUP_USER_EMAIL = 'g.chanchal@gmail.com';

// Check if user is authorized for GearUp features
function isGearupAuthorized(req: any): boolean {
  return req.user?.email === GEARUP_USER_EMAIL;
}

// Get all accounts with GearUp business status
router.get('/gearup-accounts', async (req: any, res) => {
  try {
    if (!isGearupAuthorized(req)) {
      return res.status(403).json({ error: 'GearUp features are exclusive to authorized users' });
    }

    const userId = req.user.id;

    // Get all user accounts (both bank and credit cards)
    const allAccounts = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.isActive, true)));

    // Separate into personal and gearup accounts
    const result = {
      personal: allAccounts.filter(a => !a.isGearupBusiness),
      gearup: allAccounts.filter(a => a.isGearupBusiness),
      all: allAccounts.map(a => ({
        id: a.id,
        name: a.name,
        bankName: a.bankName,
        accountNumber: a.accountNumber,
        accountType: a.accountType,
        cardName: a.cardName,
        isGearupBusiness: a.isGearupBusiness || false,
      })),
    };

    res.json(result);
  } catch (error) {
    console.error('Error fetching GearUp accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// Update account GearUp business status (share/unshare with GearUp)
router.post('/gearup-accounts/:accountId/toggle', async (req: any, res) => {
  try {
    if (!isGearupAuthorized(req)) {
      return res.status(403).json({ error: 'GearUp features are exclusive to authorized users' });
    }

    const { accountId } = req.params;
    const userId = req.user.id;

    // Get current status
    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Toggle the status
    const newStatus = !account.isGearupBusiness;

    await db
      .update(accounts)
      .set({ isGearupBusiness: newStatus, updatedAt: new Date().toISOString() })
      .where(eq(accounts.id, accountId));

    res.json({
      accountId,
      isGearupBusiness: newStatus,
      message: newStatus ? 'Account added to GearUp Mods' : 'Account removed from GearUp Mods',
    });
  } catch (error) {
    console.error('Error toggling GearUp account:', error);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

// Bulk update GearUp account status
router.post('/gearup-accounts/bulk-update', async (req: any, res) => {
  try {
    if (!isGearupAuthorized(req)) {
      return res.status(403).json({ error: 'GearUp features are exclusive to authorized users' });
    }

    const { accountIds, isGearupBusiness } = z
      .object({
        accountIds: z.array(z.string()),
        isGearupBusiness: z.boolean(),
      })
      .parse(req.body);

    const userId = req.user.id;

    // Update all specified accounts
    for (const accountId of accountIds) {
      await db
        .update(accounts)
        .set({ isGearupBusiness, updatedAt: new Date().toISOString() })
        .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
    }

    res.json({
      updated: accountIds.length,
      isGearupBusiness,
      message: isGearupBusiness
        ? `${accountIds.length} account(s) added to GearUp Mods`
        : `${accountIds.length} account(s) removed from GearUp Mods`,
    });
  } catch (error) {
    console.error('Error bulk updating GearUp accounts:', error);
    res.status(500).json({ error: 'Failed to update accounts' });
  }
});

// Get transactions from all GearUp business accounts
router.get('/gearup-transactions', async (req: any, res) => {
  try {
    if (!isGearupAuthorized(req)) {
      return res.status(403).json({ error: 'GearUp features are exclusive to authorized users' });
    }

    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    // Get all GearUp business accounts
    const gearupAccounts = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          eq(accounts.isActive, true),
          eq(accounts.isGearupBusiness, true)
        )
      );

    if (gearupAccounts.length === 0) {
      return res.json({ transactions: [], accounts: [] });
    }

    const accountIds = gearupAccounts.map(a => a.id);

    // Build date conditions
    const conditions = [sql`${bankTransactions.accountId} IN (${sql.join(accountIds.map(id => sql`${id}`), sql`, `)})`];

    if (startDate) {
      conditions.push(sql`${bankTransactions.date} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${bankTransactions.date} <= ${endDate}`);
    }

    // Get transactions from all GearUp accounts
    const transactions = await db
      .select()
      .from(bankTransactions)
      .where(and(...conditions))
      .orderBy(desc(bankTransactions.date));

    res.json({
      transactions,
      accounts: gearupAccounts,
    });
  } catch (error) {
    console.error('Error fetching GearUp transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

export default router;

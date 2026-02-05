import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, bankTransactions, vyaparTransactions, vyaparItemDetails, creditCardTransactions, categories } from '../db/index.js';
import { eq, and, between, like, desc, asc, or, sql } from 'drizzle-orm';

const router = Router();

// Bank transaction schema
const bankTransactionSchema = z.object({
  accountId: z.string(),
  date: z.string(),
  valueDate: z.string().optional(),
  narration: z.string(),
  reference: z.string().optional(),
  transactionType: z.enum(['credit', 'debit']),
  amount: z.number().positive(),
  balance: z.number().optional(),
  categoryId: z.string().optional(),
  notes: z.string().optional(),
});

// Query params schema
const querySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
  type: z.enum(['credit', 'debit']).optional(),
  reconciled: z.enum(['true', 'false']).optional(),
  search: z.string().optional(),
  minAmount: z.string().optional(),
  maxAmount: z.string().optional(),
  sortBy: z.enum(['date', 'amount']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
  // Vyapar-specific filters
  transactionType: z.string().optional(), // Sale, Payment-In, Purchase, etc.
  paymentType: z.string().optional(), // Cash, Bank, UPI, etc.
});

// Get bank transactions
router.get('/bank', async (req, res) => {
  try {
    const query = querySchema.parse(req.query);
    const conditions = [];

    if (query.startDate && query.endDate) {
      conditions.push(between(bankTransactions.date, query.startDate, query.endDate));
    }
    if (query.accountId) {
      conditions.push(eq(bankTransactions.accountId, query.accountId));
    }
    if (query.categoryId) {
      conditions.push(eq(bankTransactions.categoryId, query.categoryId));
    }
    if (query.type) {
      conditions.push(eq(bankTransactions.transactionType, query.type));
    }
    if (query.reconciled !== undefined) {
      conditions.push(eq(bankTransactions.isReconciled, query.reconciled === 'true'));
    }
    if (query.search) {
      conditions.push(like(bankTransactions.narration, `%${query.search}%`));
    }
    if (query.minAmount) {
      conditions.push(sql`${bankTransactions.amount} >= ${parseFloat(query.minAmount)}`);
    }
    if (query.maxAmount) {
      conditions.push(sql`${bankTransactions.amount} <= ${parseFloat(query.maxAmount)}`);
    }

    const sortColumn = query.sortBy === 'amount' ? bankTransactions.amount : bankTransactions.date;
    const sortFn = query.sortOrder === 'asc' ? asc : desc;

    let dbQuery = db
      .select()
      .from(bankTransactions)
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
    console.error('Error fetching bank transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Get vyapar transactions
router.get('/vyapar', async (req, res) => {
  try {
    const query = querySchema.parse(req.query);
    const conditions = [];

    if (query.startDate && query.endDate) {
      conditions.push(between(vyaparTransactions.date, query.startDate, query.endDate));
    }
    if (query.reconciled !== undefined) {
      conditions.push(eq(vyaparTransactions.isReconciled, query.reconciled === 'true'));
    }
    if (query.transactionType) {
      conditions.push(eq(vyaparTransactions.transactionType, query.transactionType));
    }
    if (query.paymentType) {
      conditions.push(eq(vyaparTransactions.paymentType, query.paymentType));
    }
    if (query.search) {
      conditions.push(
        or(
          like(vyaparTransactions.partyName, `%${query.search}%`),
          like(vyaparTransactions.invoiceNumber, `%${query.search}%`),
          like(vyaparTransactions.description, `%${query.search}%`)
        )
      );
    }

    let dbQuery = db
      .select()
      .from(vyaparTransactions)
      .orderBy(desc(vyaparTransactions.date), desc(vyaparTransactions.createdAt));

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
    console.error('Error fetching vyapar transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Get credit card transactions
router.get('/credit-card', async (req, res) => {
  try {
    const query = querySchema.parse(req.query);
    const conditions = [];

    if (query.startDate && query.endDate) {
      conditions.push(between(creditCardTransactions.date, query.startDate, query.endDate));
    }
    if (query.accountId) {
      conditions.push(eq(creditCardTransactions.accountId, query.accountId));
    }
    if (query.categoryId) {
      conditions.push(eq(creditCardTransactions.categoryId, query.categoryId));
    }
    if (query.reconciled !== undefined) {
      conditions.push(eq(creditCardTransactions.isReconciled, query.reconciled === 'true'));
    }
    if (query.search) {
      conditions.push(like(creditCardTransactions.description, `%${query.search}%`));
    }

    let dbQuery = db
      .select()
      .from(creditCardTransactions)
      .orderBy(desc(creditCardTransactions.date), desc(creditCardTransactions.createdAt));

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
    console.error('Error fetching credit card transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Create bank transaction
router.post('/bank', async (req, res) => {
  try {
    const data = bankTransactionSchema.parse(req.body);
    const now = new Date().toISOString();

    const newTransaction = {
      id: uuidv4(),
      ...data,
      isReconciled: false,
      reconciledWithId: null,
      reconciledWithType: null,
      uploadId: null,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(bankTransactions).values(newTransaction);
    res.status(201).json(newTransaction);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

// Update bank transaction
router.put('/bank/:id', async (req, res) => {
  try {
    const data = bankTransactionSchema.partial().parse(req.body);
    const now = new Date().toISOString();

    await db
      .update(bankTransactions)
      .set({ ...data, updatedAt: now })
      .where(eq(bankTransactions.id, req.params.id));

    const updated = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, req.params.id))
      .limit(1);

    res.json(updated[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating transaction:', error);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

// Delete bank transaction
router.delete('/bank/:id', async (req, res) => {
  try {
    await db.delete(bankTransactions).where(eq(bankTransactions.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

// Get all categories
router.get('/categories', async (_req, res) => {
  try {
    const allCategories = await db.select().from(categories);
    res.json(allCategories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Update single transaction category
router.patch('/bank/:id/category', async (req, res) => {
  try {
    const { categoryId } = z
      .object({
        categoryId: z.string().nullable(),
      })
      .parse(req.body);

    const now = new Date().toISOString();

    await db
      .update(bankTransactions)
      .set({ categoryId, updatedAt: now })
      .where(eq(bankTransactions.id, req.params.id));

    const updated = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, req.params.id))
      .limit(1);

    res.json(updated[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating transaction category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Bulk update category
router.patch('/bank/bulk-category', async (req, res) => {
  try {
    const { ids, categoryId } = z
      .object({
        ids: z.array(z.string()),
        categoryId: z.string().nullable(),
      })
      .parse(req.body);

    const now = new Date().toISOString();

    for (const id of ids) {
      await db
        .update(bankTransactions)
        .set({ categoryId, updatedAt: now })
        .where(eq(bankTransactions.id, id));
    }

    res.json({ success: true, updated: ids.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error bulk updating categories:', error);
    res.status(500).json({ error: 'Failed to update categories' });
  }
});

// Get vyapar item details (expense/sales line items)
router.get('/vyapar-items', async (req, res) => {
  try {
    const query = z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      category: z.string().optional(),
      transactionType: z.string().optional(),
      search: z.string().optional(),
      limit: z.string().optional(),
      offset: z.string().optional(),
    }).parse(req.query);

    const conditions = [];

    if (query.startDate && query.endDate) {
      conditions.push(between(vyaparItemDetails.date, query.startDate, query.endDate));
    }
    if (query.category) {
      conditions.push(eq(vyaparItemDetails.category, query.category));
    }
    if (query.transactionType) {
      conditions.push(eq(vyaparItemDetails.transactionType, query.transactionType));
    }
    if (query.search) {
      conditions.push(
        or(
          like(vyaparItemDetails.itemName, `%${query.search}%`),
          like(vyaparItemDetails.partyName, `%${query.search}%`)
        )
      );
    }

    let dbQuery = db
      .select()
      .from(vyaparItemDetails)
      .orderBy(desc(vyaparItemDetails.date), desc(vyaparItemDetails.createdAt));

    if (conditions.length > 0) {
      dbQuery = dbQuery.where(and(...conditions)) as typeof dbQuery;
    }

    if (query.limit) {
      dbQuery = dbQuery.limit(parseInt(query.limit)) as typeof dbQuery;
    }
    if (query.offset) {
      dbQuery = dbQuery.offset(parseInt(query.offset)) as typeof dbQuery;
    }

    const items = await dbQuery;
    res.json(items);
  } catch (error) {
    console.error('Error fetching vyapar item details:', error);
    res.status(500).json({ error: 'Failed to fetch item details' });
  }
});

// Auto-categorize vyapar items based on pattern rules
router.post('/vyapar-items/auto-categorize', async (req, res) => {
  try {
    const { rules, onlyUncategorized = true } = z
      .object({
        rules: z.array(z.object({
          pattern: z.string(),
          category: z.string(),
          caseSensitive: z.boolean().optional(),
        })),
        onlyUncategorized: z.boolean().optional(),
      })
      .parse(req.body);

    // Get items to categorize
    const conditions = [];
    if (onlyUncategorized) {
      conditions.push(
        or(
          eq(vyaparItemDetails.category, null),
          eq(vyaparItemDetails.category, '')
        )
      );
    }

    let dbQuery = db.select().from(vyaparItemDetails);
    if (conditions.length > 0) {
      dbQuery = dbQuery.where(and(...conditions)) as typeof dbQuery;
    }

    const items = await dbQuery;

    let updatedCount = 0;
    const updates: { id: string; category: string; itemName: string }[] = [];

    for (const item of items) {
      for (const rule of rules) {
        const itemName = rule.caseSensitive ? item.itemName : item.itemName.toLowerCase();
        const pattern = rule.caseSensitive ? rule.pattern : rule.pattern.toLowerCase();

        if (itemName.includes(pattern)) {
          await db
            .update(vyaparItemDetails)
            .set({ category: rule.category })
            .where(eq(vyaparItemDetails.id, item.id));

          updates.push({
            id: item.id,
            category: rule.category,
            itemName: item.itemName,
          });
          updatedCount++;
          break; // Stop at first matching rule
        }
      }
    }

    res.json({
      success: true,
      updatedCount,
      totalChecked: items.length,
      updates: updates.slice(0, 50), // Return first 50 for preview
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error auto-categorizing items:', error);
    res.status(500).json({ error: 'Failed to auto-categorize items' });
  }
});

// Update vyapar item category (with auto-propagation to similar uncategorized items)
router.patch('/vyapar-items/:id/category', async (req, res) => {
  try {
    const { category, autoPropagate = true } = z
      .object({
        category: z.string().nullable(),
        autoPropagate: z.boolean().optional(), // Auto-update similar uncategorized items
      })
      .parse(req.body);

    // Get the item being updated to extract its name for pattern matching
    const [currentItem] = await db
      .select()
      .from(vyaparItemDetails)
      .where(eq(vyaparItemDetails.id, req.params.id))
      .limit(1);

    if (!currentItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Update the target item
    await db
      .update(vyaparItemDetails)
      .set({ category })
      .where(eq(vyaparItemDetails.id, req.params.id));

    let autoUpdatedCount = 0;
    const autoUpdatedItems: string[] = [];

    // Auto-propagate to similar uncategorized items if category is set
    if (autoPropagate && category) {
      // Extract patterns from item name and category
      // Use category name as primary pattern, plus significant words from item name
      const patterns: string[] = [category.toLowerCase()];

      // Also extract words from item name that might be meaningful (3+ chars, not common words)
      const commonWords = new Set(['the', 'and', 'for', 'with', 'from', 'item', 'purchase', 'sale', 'payment']);
      const itemWords = currentItem.itemName
        .toLowerCase()
        .split(/[\s\-_\/\\,\.]+/)
        .filter(word => word.length >= 3 && !commonWords.has(word) && !/^\d+$/.test(word));

      // Add item words as potential patterns
      patterns.push(...itemWords);

      // Get all uncategorized items (excluding the one we just updated)
      const uncategorizedItems = await db
        .select()
        .from(vyaparItemDetails)
        .where(
          and(
            or(
              eq(vyaparItemDetails.category, null),
              eq(vyaparItemDetails.category, '')
            ),
            sql`${vyaparItemDetails.id} != ${req.params.id}`
          )
        );

      // Check each uncategorized item for pattern matches
      for (const item of uncategorizedItems) {
        const itemNameLower = item.itemName.toLowerCase();

        // Check if any pattern matches
        const matches = patterns.some(pattern => itemNameLower.includes(pattern));

        if (matches) {
          await db
            .update(vyaparItemDetails)
            .set({ category })
            .where(eq(vyaparItemDetails.id, item.id));

          autoUpdatedCount++;
          if (autoUpdatedItems.length < 10) {
            autoUpdatedItems.push(item.itemName);
          }
        }
      }
    }

    const updated = await db
      .select()
      .from(vyaparItemDetails)
      .where(eq(vyaparItemDetails.id, req.params.id))
      .limit(1);

    res.json({
      ...updated[0],
      autoUpdated: {
        count: autoUpdatedCount,
        items: autoUpdatedItems,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating vyapar item category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Get vyapar item categories summary (for filtering and reports)
router.get('/vyapar-items/categories', async (req, res) => {
  try {
    const query = z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      transactionType: z.string().optional(),
    }).parse(req.query);

    const conditions = [];

    if (query.startDate && query.endDate) {
      conditions.push(between(vyaparItemDetails.date, query.startDate, query.endDate));
    }
    if (query.transactionType) {
      conditions.push(eq(vyaparItemDetails.transactionType, query.transactionType));
    }

    // Get categories with totals
    let dbQuery = db
      .select({
        category: vyaparItemDetails.category,
        transactionType: vyaparItemDetails.transactionType,
        count: sql<number>`COUNT(*)`,
        totalAmount: sql<number>`SUM(${vyaparItemDetails.amount})`,
      })
      .from(vyaparItemDetails)
      .groupBy(vyaparItemDetails.category, vyaparItemDetails.transactionType);

    if (conditions.length > 0) {
      dbQuery = dbQuery.where(and(...conditions)) as typeof dbQuery;
    }

    const categories = await dbQuery;
    res.json(categories);
  } catch (error) {
    console.error('Error fetching vyapar item categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Bulk delete bank transactions
router.post('/bank/bulk-delete', async (req, res) => {
  try {
    const { accountId, startDate, endDate, deleteAll } = z
      .object({
        accountId: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        deleteAll: z.boolean().optional(),
      })
      .parse(req.body);

    const conditions = [];

    if (accountId) {
      conditions.push(eq(bankTransactions.accountId, accountId));
    }
    if (startDate && endDate) {
      conditions.push(between(bankTransactions.date, startDate, endDate));
    }

    // Safety check: require at least one filter unless deleteAll is explicitly true
    if (conditions.length === 0 && !deleteAll) {
      return res.status(400).json({ error: 'Please specify accountId or date range, or set deleteAll: true' });
    }

    // First count how many will be deleted
    let countQuery = db.select({ count: sql<number>`COUNT(*)` }).from(bankTransactions);
    if (conditions.length > 0) {
      countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
    }
    const countResult = await countQuery;
    const count = countResult[0]?.count || 0;

    // Delete the transactions
    if (conditions.length > 0) {
      await db.delete(bankTransactions).where(and(...conditions));
    } else if (deleteAll) {
      await db.delete(bankTransactions);
    }

    res.json({ success: true, deleted: count });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error bulk deleting bank transactions:', error);
    res.status(500).json({ error: 'Failed to delete transactions' });
  }
});

// Bulk delete vyapar transactions
router.post('/vyapar/bulk-delete', async (req, res) => {
  try {
    const { startDate, endDate, transactionType, deleteAll } = z
      .object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        transactionType: z.string().optional(),
        deleteAll: z.boolean().optional(),
      })
      .parse(req.body);

    const conditions = [];

    if (startDate && endDate) {
      conditions.push(between(vyaparTransactions.date, startDate, endDate));
    }
    if (transactionType) {
      conditions.push(eq(vyaparTransactions.transactionType, transactionType));
    }

    // Safety check
    if (conditions.length === 0 && !deleteAll) {
      return res.status(400).json({ error: 'Please specify date range or transactionType, or set deleteAll: true' });
    }

    // Count
    let countQuery = db.select({ count: sql<number>`COUNT(*)` }).from(vyaparTransactions);
    if (conditions.length > 0) {
      countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
    }
    const countResult = await countQuery;
    const count = countResult[0]?.count || 0;

    // Delete
    if (conditions.length > 0) {
      await db.delete(vyaparTransactions).where(and(...conditions));
    } else if (deleteAll) {
      await db.delete(vyaparTransactions);
    }

    res.json({ success: true, deleted: count });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error bulk deleting vyapar transactions:', error);
    res.status(500).json({ error: 'Failed to delete transactions' });
  }
});

// Bulk delete credit card transactions
router.post('/credit-card/bulk-delete', async (req, res) => {
  try {
    const { accountId, startDate, endDate, deleteAll } = z
      .object({
        accountId: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        deleteAll: z.boolean().optional(),
      })
      .parse(req.body);

    const conditions = [];

    if (accountId) {
      conditions.push(eq(creditCardTransactions.accountId, accountId));
    }
    if (startDate && endDate) {
      conditions.push(between(creditCardTransactions.date, startDate, endDate));
    }

    // Safety check
    if (conditions.length === 0 && !deleteAll) {
      return res.status(400).json({ error: 'Please specify accountId or date range, or set deleteAll: true' });
    }

    // Count
    let countQuery = db.select({ count: sql<number>`COUNT(*)` }).from(creditCardTransactions);
    if (conditions.length > 0) {
      countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
    }
    const countResult = await countQuery;
    const count = countResult[0]?.count || 0;

    // Delete
    if (conditions.length > 0) {
      await db.delete(creditCardTransactions).where(and(...conditions));
    } else if (deleteAll) {
      await db.delete(creditCardTransactions);
    }

    res.json({ success: true, deleted: count });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error bulk deleting credit card transactions:', error);
    res.status(500).json({ error: 'Failed to delete transactions' });
  }
});

// Get transaction counts for bulk delete preview
router.get('/counts', async (req, res) => {
  try {
    const { type, accountId, startDate, endDate } = z
      .object({
        type: z.enum(['bank', 'vyapar', 'credit-card']),
        accountId: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
      .parse(req.query);

    const conditions = [];
    let table: any;

    if (type === 'bank') {
      table = bankTransactions;
      if (accountId) conditions.push(eq(bankTransactions.accountId, accountId));
      if (startDate && endDate) conditions.push(between(bankTransactions.date, startDate, endDate));
    } else if (type === 'vyapar') {
      table = vyaparTransactions;
      if (startDate && endDate) conditions.push(between(vyaparTransactions.date, startDate, endDate));
    } else {
      table = creditCardTransactions;
      if (accountId) conditions.push(eq(creditCardTransactions.accountId, accountId));
      if (startDate && endDate) conditions.push(between(creditCardTransactions.date, startDate, endDate));
    }

    let countQuery = db.select({ count: sql<number>`COUNT(*)` }).from(table);
    if (conditions.length > 0) {
      countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
    }

    const result = await countQuery;
    res.json({ count: result[0]?.count || 0 });
  } catch (error) {
    console.error('Error getting transaction counts:', error);
    res.status(500).json({ error: 'Failed to get counts' });
  }
});

// Update single credit card transaction category
router.patch('/credit-card/:id/category', async (req, res) => {
  try {
    const { categoryId } = z
      .object({
        categoryId: z.string().nullable(),
      })
      .parse(req.body);

    const now = new Date().toISOString();

    await db
      .update(creditCardTransactions)
      .set({ categoryId, updatedAt: now })
      .where(eq(creditCardTransactions.id, req.params.id));

    const updated = await db
      .select()
      .from(creditCardTransactions)
      .where(eq(creditCardTransactions.id, req.params.id))
      .limit(1);

    res.json(updated[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating credit card transaction category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

export default router;

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, bankTransactions, vyaparTransactions, vyaparItemDetails, creditCardTransactions, categories } from '../db/index.js';
import { eq, and, between, like, desc, asc, or, sql, isNull, inArray } from 'drizzle-orm';
import { getGearupDataUserId } from '../utils/gearup-auth.js';

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
    const conditions = [eq(bankTransactions.userId, req.userId!)];

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
    const conditions = [eq(vyaparTransactions.userId, req.userId!)];

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
      const searchCondition = or(
        like(vyaparTransactions.partyName, `%${query.search}%`),
        like(vyaparTransactions.invoiceNumber, `%${query.search}%`),
        like(vyaparTransactions.description, `%${query.search}%`)
      );
      if (searchCondition) conditions.push(searchCondition);
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
    const conditions = [eq(creditCardTransactions.userId, req.userId!)];

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
      userId: req.userId!,
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
      .where(and(eq(bankTransactions.id, req.params.id), eq(bankTransactions.userId, req.userId!)));

    const updated = await db
      .select()
      .from(bankTransactions)
      .where(and(eq(bankTransactions.id, req.params.id), eq(bankTransactions.userId, req.userId!)))
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
    const bankTxnId = req.params.id;

    // First, unlink any Vyapar transactions that reference this bank transaction
    await db.update(vyaparTransactions)
      .set({
        isReconciled: false,
        reconciledWithId: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(vyaparTransactions.reconciledWithId, bankTxnId));

    // Then delete the bank transaction
    await db.delete(bankTransactions).where(and(eq(bankTransactions.id, bankTxnId), eq(bankTransactions.userId, req.userId!)));
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

// Verify and fix transaction types using balance continuity
router.post('/bank/verify-fix-types', async (req, res) => {
  try {
    const { accountId } = z
      .object({
        accountId: z.string().optional(),
      })
      .parse(req.body);

    // Get all transactions for the user (or specific account)
    const conditions = [eq(bankTransactions.userId, req.userId!)];
    if (accountId) {
      conditions.push(eq(bankTransactions.accountId, accountId));
    }

    const allTxns = await db
      .select()
      .from(bankTransactions)
      .where(and(...conditions))
      .orderBy(asc(bankTransactions.accountId), asc(bankTransactions.date), asc(bankTransactions.createdAt));

    if (allTxns.length === 0) {
      return res.json({ fixed: 0, total: 0, message: 'No transactions found' });
    }

    // Group transactions by account - balance continuity only makes sense within same account
    const txnsByAccount = new Map<string, typeof allTxns>();
    for (const txn of allTxns) {
      if (!txnsByAccount.has(txn.accountId)) {
        txnsByAccount.set(txn.accountId, []);
      }
      txnsByAccount.get(txn.accountId)!.push(txn);
    }

    const now = new Date().toISOString();
    let fixedCount = 0;
    const fixes: Array<{ id: string; narration: string; oldType: string; newType: string; amount: number; account: string }> = [];

    // Process each account separately
    for (const [accId, accountTxns] of txnsByAccount) {
      // Sort by date and created_at within this account
      accountTxns.sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.createdAt.localeCompare(b.createdAt);
      });

      // Use balance continuity to verify and fix transaction types
      for (let i = 1; i < accountTxns.length; i++) {
        const prev = accountTxns[i - 1];
        const curr = accountTxns[i];

        // Skip if either balance is null
        if (prev.balance === null || curr.balance === null) {
          continue;
        }

        // Calculate expected type based on balance change
        const balanceDiff = curr.balance - prev.balance;
        let expectedType: 'credit' | 'debit';

        // Balance increased by transaction amount -> credit
        // Balance decreased by transaction amount -> debit
        if (Math.abs(balanceDiff + curr.amount) < 0.01) {
          // prev.balance - curr.amount = curr.balance (debit)
          expectedType = 'debit';
        } else if (Math.abs(balanceDiff - curr.amount) < 0.01) {
          // prev.balance + curr.amount = curr.balance (credit)
          expectedType = 'credit';
        } else {
          // Balance change doesn't match amount - might be missing transactions
          // Fall back to simple check
          if (balanceDiff > 0) {
            expectedType = 'credit';
          } else if (balanceDiff < 0) {
            expectedType = 'debit';
          } else {
            continue;
          }
        }

        // Check if current type matches expected
        if (curr.transactionType !== expectedType) {
          // Fix it
          await db
            .update(bankTransactions)
            .set({
              transactionType: expectedType,
              updatedAt: now,
            })
            .where(eq(bankTransactions.id, curr.id));

          fixes.push({
            id: curr.id,
            narration: curr.narration?.substring(0, 50) || '',
            oldType: curr.transactionType,
            newType: expectedType,
            amount: curr.amount,
            account: accId,
          });
          fixedCount++;
        }
      }
    }

    res.json({
      total: allTxns.length,
      accountsProcessed: txnsByAccount.size,
      fixed: fixedCount,
      fixes: fixes.slice(0, 30), // Return first 30 fixes for reference
      message: fixedCount > 0
        ? `Fixed ${fixedCount} transaction(s) with incorrect credit/debit type across ${txnsByAccount.size} account(s)`
        : `All transactions have correct credit/debit types (checked ${txnsByAccount.size} account(s))`,
    });
  } catch (error) {
    console.error('Error verifying/fixing transaction types:', error);
    res.status(500).json({ error: 'Failed to verify/fix transaction types' });
  }
});

// Get all categories
router.get('/categories', async (req, res) => {
  try {
    const allCategories = await db.select().from(categories).where(
      or(eq(categories.userId, req.userId!), isNull(categories.userId))
    );
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
      .where(and(eq(bankTransactions.id, req.params.id), eq(bankTransactions.userId, req.userId!)));

    const updated = await db
      .select()
      .from(bankTransactions)
      .where(and(eq(bankTransactions.id, req.params.id), eq(bankTransactions.userId, req.userId!)))
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

// Update transaction purpose (business/personal)
router.patch('/bank/:id/purpose', async (req, res) => {
  try {
    const { purpose } = z
      .object({
        purpose: z.enum(['business', 'personal']).nullable(),
      })
      .parse(req.body);

    const now = new Date().toISOString();

    await db
      .update(bankTransactions)
      .set({ purpose, updatedAt: now })
      .where(and(eq(bankTransactions.id, req.params.id), eq(bankTransactions.userId, req.userId!)));

    const updated = await db
      .select()
      .from(bankTransactions)
      .where(and(eq(bankTransactions.id, req.params.id), eq(bankTransactions.userId, req.userId!)))
      .limit(1);

    res.json(updated[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating transaction purpose:', error);
    res.status(500).json({ error: 'Failed to update purpose' });
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
        .where(and(eq(bankTransactions.id, id), eq(bankTransactions.userId, req.userId!)));
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
    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
    const query = z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      category: z.string().optional(),
      transactionType: z.string().optional(),
      invoiceNumber: z.string().optional(),
      partyName: z.string().optional(),
      date: z.string().optional(),
      search: z.string().optional(),
      limit: z.string().optional(),
      offset: z.string().optional(),
    }).parse(req.query);

    const conditions = [eq(vyaparItemDetails.userId, dataUserId)];

    if (query.startDate && query.endDate) {
      conditions.push(between(vyaparItemDetails.date, query.startDate, query.endDate));
    }
    if (query.date) {
      conditions.push(eq(vyaparItemDetails.date, query.date));
    }
    if (query.category) {
      conditions.push(eq(vyaparItemDetails.category, query.category));
    }
    if (query.transactionType) {
      conditions.push(eq(vyaparItemDetails.transactionType, query.transactionType));
    }
    if (query.invoiceNumber) {
      conditions.push(eq(vyaparItemDetails.invoiceNumber, query.invoiceNumber));
    }
    if (query.partyName) {
      conditions.push(eq(vyaparItemDetails.partyName, query.partyName));
    }
    if (query.search) {
      const searchCondition = or(
        like(vyaparItemDetails.itemName, `%${query.search}%`),
        like(vyaparItemDetails.partyName, `%${query.search}%`)
      );
      if (searchCondition) conditions.push(searchCondition);
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

    // Deduplicate items based on date + itemName + amount
    // Invoice number is excluded because Vyapar Expense exports assign different
    // invoice numbers (e.g. EXP-16) across exports for the same item
    const seen = new Set<string>();
    const uniqueItems = items.filter(item => {
      const signature = `${item.date}|${item.itemName}|${item.amount}`;
      if (seen.has(signature)) {
        return false;
      }
      seen.add(signature);
      return true;
    });

    res.json(uniqueItems);
  } catch (error) {
    console.error('Error fetching vyapar item details:', error);
    res.status(500).json({ error: 'Failed to fetch item details' });
  }
});

// Auto-categorize vyapar items based on pattern rules
router.post('/vyapar-items/auto-categorize', async (req, res) => {
  try {
    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
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
    const conditions = [eq(vyaparItemDetails.userId, dataUserId)];
    if (onlyUncategorized) {
      const uncatCondition = or(
        isNull(vyaparItemDetails.category),
        eq(vyaparItemDetails.category, '')
      );
      if (uncatCondition) conditions.push(uncatCondition);
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
    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
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
      .where(and(eq(vyaparItemDetails.id, req.params.id), eq(vyaparItemDetails.userId, dataUserId)))
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
            eq(vyaparItemDetails.userId, dataUserId),
            or(
              isNull(vyaparItemDetails.category),
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
    const dataUserId = (await getGearupDataUserId(req)) || req.userId!;
    const query = z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      transactionType: z.string().optional(),
    }).parse(req.query);

    const conditions = [eq(vyaparItemDetails.userId, dataUserId)];

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

    const conditions = [eq(bankTransactions.userId, req.userId!)];

    if (accountId) {
      conditions.push(eq(bankTransactions.accountId, accountId));
    }
    if (startDate && endDate) {
      conditions.push(between(bankTransactions.date, startDate, endDate));
    }

    // Safety check: require at least one additional filter unless deleteAll is explicitly true
    if (conditions.length === 1 && !deleteAll) {
      return res.status(400).json({ error: 'Please specify accountId or date range, or set deleteAll: true' });
    }

    // Get IDs of bank transactions to be deleted (for unlinking Vyapar transactions)
    const toDelete = await db.select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(and(...conditions));
    const idsToDelete = toDelete.map(t => t.id);
    const count = idsToDelete.length;

    if (idsToDelete.length > 0) {
      // Unlink any Vyapar transactions that reference these bank transactions
      await db.update(vyaparTransactions)
        .set({
          isReconciled: false,
          reconciledWithId: null,
          updatedAt: new Date().toISOString(),
        })
        .where(inArray(vyaparTransactions.reconciledWithId, idsToDelete));

      // Delete the bank transactions
      await db.delete(bankTransactions).where(and(...conditions));
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

    const conditions = [eq(vyaparTransactions.userId, req.userId!)];

    if (startDate && endDate) {
      conditions.push(between(vyaparTransactions.date, startDate, endDate));
    }
    if (transactionType) {
      conditions.push(eq(vyaparTransactions.transactionType, transactionType));
    }

    // Safety check
    if (conditions.length === 1 && !deleteAll) {
      return res.status(400).json({ error: 'Please specify date range or transactionType, or set deleteAll: true' });
    }

    // Get IDs of vyapar transactions to be deleted (for clearing reconciliation links)
    const toDelete = await db
      .select({ id: vyaparTransactions.id })
      .from(vyaparTransactions)
      .where(and(...conditions));

    const vyaparIds = toDelete.map(t => t.id);
    const count = vyaparIds.length;

    if (count > 0) {
      // Clear reconciliation links on bank transactions that point to these vyapar transactions
      await db
        .update(bankTransactions)
        .set({
          reconciledWithId: null,
          reconciledWithType: null,
          isReconciled: false,
          purpose: null,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(bankTransactions.reconciledWithType, 'vyapar'),
            sql`${bankTransactions.reconciledWithId} IN (${sql.join(vyaparIds.map(id => sql`${id}`), sql`, `)})`
          )
        );

      // Delete vyapar transactions
      await db.delete(vyaparTransactions).where(and(...conditions));
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
    const { accountId, startDate, endDate, source, deleteAll } = z
      .object({
        accountId: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        source: z.enum(['gmail', 'statement']).optional(),
        deleteAll: z.boolean().optional(),
      })
      .parse(req.body);

    const conditions = [eq(creditCardTransactions.userId, req.userId!)];

    if (accountId) {
      conditions.push(eq(creditCardTransactions.accountId, accountId));
    }
    if (startDate && endDate) {
      conditions.push(between(creditCardTransactions.date, startDate, endDate));
    }
    if (source) {
      conditions.push(eq(creditCardTransactions.source, source));
    }

    // Safety check
    if (conditions.length === 1 && !deleteAll) {
      return res.status(400).json({ error: 'Please specify accountId, date range, or source, or set deleteAll: true' });
    }

    // Count
    let countQuery = db.select({ count: sql<number>`COUNT(*)` }).from(creditCardTransactions);
    countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
    const countResult = await countQuery;
    const count = countResult[0]?.count || 0;

    // Delete
    await db.delete(creditCardTransactions).where(and(...conditions));

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
    const { type, accountId, startDate, endDate, source } = z
      .object({
        type: z.enum(['bank', 'vyapar', 'credit-card']),
        accountId: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        source: z.enum(['gmail', 'statement']).optional(),
      })
      .parse(req.query);

    const conditions: any[] = [];
    let table: any;

    if (type === 'bank') {
      table = bankTransactions;
      conditions.push(eq(bankTransactions.userId, req.userId!));
      if (accountId) conditions.push(eq(bankTransactions.accountId, accountId));
      if (startDate && endDate) conditions.push(between(bankTransactions.date, startDate, endDate));
    } else if (type === 'vyapar') {
      table = vyaparTransactions;
      conditions.push(eq(vyaparTransactions.userId, req.userId!));
      if (startDate && endDate) conditions.push(between(vyaparTransactions.date, startDate, endDate));
    } else {
      table = creditCardTransactions;
      conditions.push(eq(creditCardTransactions.userId, req.userId!));
      if (accountId) conditions.push(eq(creditCardTransactions.accountId, accountId));
      if (startDate && endDate) conditions.push(between(creditCardTransactions.date, startDate, endDate));
      if (source) conditions.push(eq(creditCardTransactions.source, source));
    }

    let countQuery = db.select({ count: sql<number>`COUNT(*)` }).from(table);
    countQuery = countQuery.where(and(...conditions)) as typeof countQuery;

    const result = await countQuery;
    res.json({ count: result[0]?.count || 0 });
  } catch (error) {
    console.error('Error getting transaction counts:', error);
    res.status(500).json({ error: 'Failed to get counts' });
  }
});

// Find duplicate bank transactions
router.get('/bank/duplicates', async (req, res) => {
  try {
    const { accountId } = z
      .object({
        accountId: z.string().optional(),
      })
      .parse(req.query);

    // Find duplicates based on date + narration + amount + transactionType
    const conditions = [eq(bankTransactions.userId, req.userId!)];
    if (accountId) {
      conditions.push(eq(bankTransactions.accountId, accountId));
    }

    const allTxns = await db
      .select()
      .from(bankTransactions)
      .where(and(...conditions))
      .orderBy(asc(bankTransactions.date), asc(bankTransactions.createdAt));

    // Group by signature (date + narration + amount + type)
    const groups = new Map<string, typeof allTxns>();
    for (const txn of allTxns) {
      const signature = `${txn.date}|${txn.narration}|${txn.amount}|${txn.transactionType}`;
      if (!groups.has(signature)) {
        groups.set(signature, []);
      }
      groups.get(signature)!.push(txn);
    }

    // Filter to only groups with more than one transaction (duplicates)
    const duplicateGroups: { signature: string; count: number; transactions: typeof allTxns }[] = [];
    for (const [signature, txns] of groups) {
      if (txns.length > 1) {
        duplicateGroups.push({
          signature,
          count: txns.length,
          transactions: txns,
        });
      }
    }

    const totalDuplicates = duplicateGroups.reduce((sum, g) => sum + g.count - 1, 0);

    res.json({
      duplicateGroups: duplicateGroups.length,
      totalDuplicates,
      groups: duplicateGroups.map(g => ({
        signature: g.signature,
        count: g.count,
        // Include first and last transaction details
        sample: {
          date: g.transactions[0].date,
          narration: g.transactions[0].narration,
          amount: g.transactions[0].amount,
          transactionType: g.transactions[0].transactionType,
        },
        ids: g.transactions.map(t => t.id),
      })),
    });
  } catch (error) {
    console.error('Error finding duplicates:', error);
    res.status(500).json({ error: 'Failed to find duplicates' });
  }
});

// Remove duplicate bank transactions (keeps the first one)
router.delete('/bank/duplicates', async (req, res) => {
  try {
    const { accountId, dryRun } = z
      .object({
        accountId: z.string().optional(),
        dryRun: z.boolean().default(true),
      })
      .parse(req.body);

    // Find duplicates based on date + narration + amount + transactionType
    const conditions = [eq(bankTransactions.userId, req.userId!)];
    if (accountId) {
      conditions.push(eq(bankTransactions.accountId, accountId));
    }

    const allTxns = await db
      .select()
      .from(bankTransactions)
      .where(and(...conditions))
      .orderBy(asc(bankTransactions.date), asc(bankTransactions.createdAt));

    // Group by signature (date + narration + amount + type)
    const groups = new Map<string, typeof allTxns>();
    for (const txn of allTxns) {
      const signature = `${txn.date}|${txn.narration}|${txn.amount}|${txn.transactionType}`;
      if (!groups.has(signature)) {
        groups.set(signature, []);
      }
      groups.get(signature)!.push(txn);
    }

    // Collect IDs to delete (all but the first in each group)
    const idsToDelete: string[] = [];
    for (const [, txns] of groups) {
      if (txns.length > 1) {
        // Keep first (oldest by createdAt), delete rest
        for (let i = 1; i < txns.length; i++) {
          idsToDelete.push(txns[i].id);
        }
      }
    }

    if (dryRun) {
      res.json({
        dryRun: true,
        wouldDelete: idsToDelete.length,
        message: `Would delete ${idsToDelete.length} duplicate transactions. Set dryRun=false to actually delete.`,
      });
    } else {
      // Actually delete the duplicates
      if (idsToDelete.length > 0) {
        // First, unlink any Vyapar transactions that reference these bank transactions
        await db.update(vyaparTransactions)
          .set({
            isReconciled: false,
            reconciledWithId: null,
            updatedAt: new Date().toISOString(),
          })
          .where(inArray(vyaparTransactions.reconciledWithId, idsToDelete));

        // Then delete the bank transactions
        for (const id of idsToDelete) {
          await db.delete(bankTransactions).where(eq(bankTransactions.id, id));
        }
      }

      res.json({
        dryRun: false,
        deleted: idsToDelete.length,
        message: `Deleted ${idsToDelete.length} duplicate transactions.`,
      });
    }
  } catch (error) {
    console.error('Error removing duplicates:', error);
    res.status(500).json({ error: 'Failed to remove duplicates' });
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
      .where(and(eq(creditCardTransactions.id, req.params.id), eq(creditCardTransactions.userId, req.userId!)));

    const updated = await db
      .select()
      .from(creditCardTransactions)
      .where(and(eq(creditCardTransactions.id, req.params.id), eq(creditCardTransactions.userId, req.userId!)))
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

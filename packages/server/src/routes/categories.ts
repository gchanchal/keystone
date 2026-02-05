import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, categories } from '../db/index.js';
import { eq } from 'drizzle-orm';

const router = Router();

const categorySchema = z.object({
  name: z.string().min(1),
  type: z.enum(['income', 'expense']),
  icon: z.string().optional(),
  color: z.string().optional(),
  parentId: z.string().optional(),
});

// Get all categories
router.get('/', async (_req, res) => {
  try {
    const allCategories = await db.select().from(categories);
    res.json(allCategories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Get category by ID
router.get('/:id', async (req, res) => {
  try {
    const category = await db
      .select()
      .from(categories)
      .where(eq(categories.id, req.params.id))
      .limit(1);

    if (!category[0]) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json(category[0]);
  } catch (error) {
    console.error('Error fetching category:', error);
    res.status(500).json({ error: 'Failed to fetch category' });
  }
});

// Create category
router.post('/', async (req, res) => {
  try {
    const data = categorySchema.parse(req.body);
    const now = new Date().toISOString();

    const newCategory = {
      id: uuidv4(),
      ...data,
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(categories).values(newCategory);
    res.status(201).json(newCategory);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Update category
router.put('/:id', async (req, res) => {
  try {
    // Check if it's a system category
    const existing = await db
      .select()
      .from(categories)
      .where(eq(categories.id, req.params.id))
      .limit(1);

    if (!existing[0]) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (existing[0].isSystem) {
      return res.status(403).json({ error: 'Cannot modify system categories' });
    }

    const data = categorySchema.partial().parse(req.body);
    const now = new Date().toISOString();

    await db
      .update(categories)
      .set({ ...data, updatedAt: now })
      .where(eq(categories.id, req.params.id));

    const updated = await db
      .select()
      .from(categories)
      .where(eq(categories.id, req.params.id))
      .limit(1);

    res.json(updated[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Delete category
router.delete('/:id', async (req, res) => {
  try {
    // Check if it's a system category
    const existing = await db
      .select()
      .from(categories)
      .where(eq(categories.id, req.params.id))
      .limit(1);

    if (!existing[0]) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (existing[0].isSystem) {
      return res.status(403).json({ error: 'Cannot delete system categories' });
    }

    await db.delete(categories).where(eq(categories.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

export default router;

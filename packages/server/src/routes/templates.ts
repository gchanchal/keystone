import { Router } from 'express';
import { db, learnedTemplates, templateLearningSessions } from '../db/index.js';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const router = Router();

// Schema for template updates
const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  institution: z.string().optional(),
  statementType: z.string().optional(),
  fieldMappings: z.record(z.any()).optional(),
  detectionPatterns: z.object({
    textPatterns: z.array(z.string()).optional(),
    filenamePatterns: z.array(z.string()).optional(),
  }).optional(),
  isActive: z.boolean().optional(),
});

// GET /api/templates - List all learned templates
router.get('/', async (req, res) => {
  try {
    const templates = await db
      .select()
      .from(learnedTemplates)
      .where(eq(learnedTemplates.userId, req.userId!))
      .orderBy(desc(learnedTemplates.updatedAt));

    // Parse JSON fields
    const parsed = templates.map(t => ({
      ...t,
      detectionPatterns: JSON.parse(t.detectionPatterns || '{}'),
      fieldMappings: JSON.parse(t.fieldMappings || '{}'),
      sampleHeaders: t.sampleHeaders ? JSON.parse(t.sampleHeaders) : null,
      sampleRows: t.sampleRows ? JSON.parse(t.sampleRows) : null,
    }));

    res.json(parsed);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// GET /api/templates/:id - Get template details
router.get('/:id', async (req, res) => {
  try {
    const [template] = await db
      .select()
      .from(learnedTemplates)
      .where(and(
        eq(learnedTemplates.id, req.params.id),
        eq(learnedTemplates.userId, req.userId!)
      ));

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({
      ...template,
      detectionPatterns: JSON.parse(template.detectionPatterns || '{}'),
      fieldMappings: JSON.parse(template.fieldMappings || '{}'),
      sampleHeaders: template.sampleHeaders ? JSON.parse(template.sampleHeaders) : null,
      sampleRows: template.sampleRows ? JSON.parse(template.sampleRows) : null,
    });
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// PUT /api/templates/:id - Update template
router.put('/:id', async (req, res) => {
  try {
    const data = updateTemplateSchema.parse(req.body);
    const now = new Date().toISOString();

    // Check if template exists and belongs to user
    const [existing] = await db
      .select()
      .from(learnedTemplates)
      .where(and(
        eq(learnedTemplates.id, req.params.id),
        eq(learnedTemplates.userId, req.userId!)
      ));

    if (!existing) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Build update object
    const updateData: Record<string, any> = { updatedAt: now };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.institution !== undefined) updateData.institution = data.institution;
    if (data.statementType !== undefined) updateData.statementType = data.statementType;
    if (data.isActive !== undefined) updateData.isActive = data.isActive ? 1 : 0;

    if (data.fieldMappings !== undefined) {
      updateData.fieldMappings = JSON.stringify(data.fieldMappings);
    }

    if (data.detectionPatterns !== undefined) {
      const existingPatterns = JSON.parse(existing.detectionPatterns || '{}');
      updateData.detectionPatterns = JSON.stringify({
        ...existingPatterns,
        ...data.detectionPatterns,
      });
    }

    await db
      .update(learnedTemplates)
      .set(updateData)
      .where(eq(learnedTemplates.id, req.params.id));

    const [updated] = await db
      .select()
      .from(learnedTemplates)
      .where(eq(learnedTemplates.id, req.params.id));

    res.json({
      ...updated,
      detectionPatterns: JSON.parse(updated.detectionPatterns || '{}'),
      fieldMappings: JSON.parse(updated.fieldMappings || '{}'),
      sampleHeaders: updated.sampleHeaders ? JSON.parse(updated.sampleHeaders) : null,
      sampleRows: updated.sampleRows ? JSON.parse(updated.sampleRows) : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// DELETE /api/templates/:id - Delete template
router.delete('/:id', async (req, res) => {
  try {
    const [template] = await db
      .select()
      .from(learnedTemplates)
      .where(and(
        eq(learnedTemplates.id, req.params.id),
        eq(learnedTemplates.userId, req.userId!)
      ));

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Delete associated learning sessions
    await db
      .delete(templateLearningSessions)
      .where(eq(templateLearningSessions.templateId, req.params.id));

    // Delete template
    await db
      .delete(learnedTemplates)
      .where(eq(learnedTemplates.id, req.params.id));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// POST /api/templates/check - Check if uploaded file matches known template
router.post('/check', async (req, res) => {
  try {
    const { content, filename } = req.body;

    if (!content && !filename) {
      return res.status(400).json({ error: 'Content or filename required' });
    }

    // Get all active templates for user
    const templates = await db
      .select()
      .from(learnedTemplates)
      .where(and(
        eq(learnedTemplates.userId, req.userId!),
        eq(learnedTemplates.isActive, 1)
      ));

    let bestMatch: { template: any; score: number } | null = null;

    for (const template of templates) {
      const patterns = JSON.parse(template.detectionPatterns || '{}');
      let score = 0;

      // Check text patterns
      if (content && patterns.textPatterns) {
        const contentLower = content.toLowerCase();
        for (const pattern of patterns.textPatterns) {
          if (contentLower.includes(pattern.toLowerCase())) {
            score += 10;
          }
        }
      }

      // Check filename patterns
      if (filename && patterns.filenamePatterns) {
        const filenameLower = filename.toLowerCase();
        for (const pattern of patterns.filenamePatterns) {
          if (filenameLower.includes(pattern.toLowerCase())) {
            score += 5;
          }
          // Check regex patterns
          try {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(filename)) {
              score += 8;
            }
          } catch {
            // Invalid regex, skip
          }
        }
      }

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = {
          template: {
            ...template,
            detectionPatterns: patterns,
            fieldMappings: JSON.parse(template.fieldMappings || '{}'),
          },
          score,
        };
      }
    }

    if (bestMatch && bestMatch.score >= 10) {
      res.json({
        matched: true,
        template: bestMatch.template,
        confidence: bestMatch.score >= 20 ? 'high' : bestMatch.score >= 10 ? 'medium' : 'low',
      });
    } else {
      res.json({ matched: false });
    }
  } catch (error) {
    console.error('Error checking templates:', error);
    res.status(500).json({ error: 'Failed to check templates' });
  }
});

// POST /api/templates/:id/increment-usage - Increment usage counter
router.post('/:id/increment-usage', async (req, res) => {
  try {
    const [template] = await db
      .select()
      .from(learnedTemplates)
      .where(and(
        eq(learnedTemplates.id, req.params.id),
        eq(learnedTemplates.userId, req.userId!)
      ));

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const now = new Date().toISOString();

    await db
      .update(learnedTemplates)
      .set({
        timesUsed: (template.timesUsed || 0) + 1,
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(eq(learnedTemplates.id, req.params.id));

    res.json({ success: true });
  } catch (error) {
    console.error('Error incrementing usage:', error);
    res.status(500).json({ error: 'Failed to increment usage' });
  }
});

export default router;

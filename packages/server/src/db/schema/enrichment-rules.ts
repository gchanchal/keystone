import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// Enrichment rules table - stores learned patterns for auto-enrichment
export const enrichmentRules = sqliteTable('enrichment_rules', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),

  // Pattern matching
  patternType: text('pattern_type').notNull(), // 'narration_contains', 'upi_id', 'neft_name', 'exact_match'
  patternValue: text('pattern_value').notNull(), // The text/pattern to match

  // Enrichment values to apply
  bizType: text('biz_type'),
  bizDescription: text('biz_description'),
  vendorName: text('vendor_name'),
  needsInvoice: integer('needs_invoice'),
  gstType: text('gst_type'), // 'input' or 'output'

  // Metadata
  matchCount: integer('match_count').default(0), // How many times this rule has been applied
  priority: integer('priority').default(0), // Higher priority rules are checked first
  isActive: integer('is_active').default(1),

  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});

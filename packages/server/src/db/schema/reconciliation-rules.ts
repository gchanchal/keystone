import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Reconciliation rules table - stores learned bank-to-vyapar party mappings
export const reconciliationRules = sqliteTable('reconciliation_rules', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),

  // Bank transaction pattern
  bankPatternType: text('bank_pattern_type').notNull(), // 'upi_name', 'neft_name', 'narration_contains'
  bankPatternValue: text('bank_pattern_value').notNull(), // The extracted name/pattern

  // Vyapar party to match with
  vyaparPartyName: text('vyapar_party_name').notNull(),

  // Metadata
  matchCount: integer('match_count').default(0), // How many times this rule has been used
  priority: integer('priority').default(0), // Higher priority rules are preferred
  isActive: integer('is_active').default(1),

  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});

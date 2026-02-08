import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// Learned statement templates
export const learnedTemplates = sqliteTable('learned_templates', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),                    // "HDFC Credit Card Statement"
  institution: text('institution').notNull(),     // "hdfc", "icici", etc.
  statementType: text('statement_type').notNull(), // "credit_card", "bank_statement", "loan"
  fileType: text('file_type').notNull(),          // "pdf", "xlsx", "csv"

  // Detection signatures (how to recognize this template)
  detectionPatterns: text('detection_patterns').notNull(), // JSON: {"text_patterns": ["hdfc bank", "credit card"], "filename_patterns": [...]}

  // Field mappings (how to parse)
  fieldMappings: text('field_mappings').notNull(), // JSON: {"date": {"source": "col_0", "format": "DD/MM/YYYY"}, ...}

  // Sample data for reference
  sampleHeaders: text('sample_headers'),           // JSON: Extracted headers from sample
  sampleRows: text('sample_rows'),                 // JSON: First 3 rows as example

  // Status
  isActive: integer('is_active').default(1),
  confidenceScore: real('confidence_score').default(0), // How well it matches (0-1)
  timesUsed: integer('times_used').default(0),
  lastUsedAt: text('last_used_at'),

  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Template learning sessions
export const templateLearningSessions = sqliteTable('template_learning_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  templateId: text('template_id'),                 // NULL until learning complete
  status: text('status').default('extracting'),   // extracting, mapping, completed, failed

  // Uploaded file info
  filename: text('filename').notNull(),
  filePath: text('file_path').notNull(),
  fileType: text('file_type'),                    // "pdf", "xlsx", "csv"

  // Extracted data
  extractedFields: text('extracted_fields'),      // JSON: AI-extracted fields
  suggestedMappings: text('suggested_mappings'),  // JSON: AI-suggested mappings
  finalMappings: text('final_mappings'),          // JSON: User-confirmed mappings

  // Detection info
  detectedPatterns: text('detected_patterns'),    // JSON: Patterns found in file

  // Error info
  errorMessage: text('error_message'),

  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Type exports
export type LearnedTemplate = typeof learnedTemplates.$inferSelect;
export type NewLearnedTemplate = typeof learnedTemplates.$inferInsert;

export type TemplateLearningSession = typeof templateLearningSessions.$inferSelect;
export type NewTemplateLearningSession = typeof templateLearningSessions.$inferInsert;

// System field definitions for mapping
export const SYSTEM_FIELDS = {
  date: { label: 'Date', type: 'date', required: true },
  valueDate: { label: 'Value Date', type: 'date', required: false },
  narration: { label: 'Narration/Description', type: 'text', required: true },
  reference: { label: 'Reference/Cheque No', type: 'text', required: false },
  withdrawal: { label: 'Withdrawal/Debit', type: 'amount', required: false },
  deposit: { label: 'Deposit/Credit', type: 'amount', required: false },
  amount: { label: 'Amount', type: 'amount', required: false }, // Combined amount (positive/negative)
  balance: { label: 'Balance', type: 'amount', required: false },
  transactionType: { label: 'Transaction Type', type: 'text', required: false },
  category: { label: 'Category', type: 'text', required: false },
  merchant: { label: 'Merchant', type: 'text', required: false },
  cardNumber: { label: 'Card Number', type: 'text', required: false },
  ignore: { label: '(Ignore this field)', type: 'ignore', required: false },
} as const;

export type SystemFieldKey = keyof typeof SYSTEM_FIELDS;

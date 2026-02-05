import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // income, expense
  icon: text('icon'),
  color: text('color'),
  parentId: text('parent_id'),
  isSystem: integer('is_system', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

// Default categories seed data
export const defaultCategories = [
  // Income categories
  { name: 'Salary', type: 'income', icon: 'briefcase', color: '#22c55e' },
  { name: 'Business Income', type: 'income', icon: 'building', color: '#16a34a' },
  { name: 'Investment Returns', type: 'income', icon: 'trending-up', color: '#15803d' },
  { name: 'Rental Income', type: 'income', icon: 'home', color: '#166534' },
  { name: 'Other Income', type: 'income', icon: 'plus-circle', color: '#14532d' },

  // Expense categories
  { name: 'Food & Dining', type: 'expense', icon: 'utensils', color: '#ef4444' },
  { name: 'Transportation', type: 'expense', icon: 'car', color: '#f97316' },
  { name: 'Shopping', type: 'expense', icon: 'shopping-bag', color: '#eab308' },
  { name: 'Entertainment', type: 'expense', icon: 'film', color: '#a855f7' },
  { name: 'Bills & Utilities', type: 'expense', icon: 'receipt', color: '#3b82f6' },
  { name: 'Healthcare', type: 'expense', icon: 'heart-pulse', color: '#ec4899' },
  { name: 'Education', type: 'expense', icon: 'graduation-cap', color: '#6366f1' },
  { name: 'Travel', type: 'expense', icon: 'plane', color: '#0ea5e9' },
  { name: 'Personal Care', type: 'expense', icon: 'scissors', color: '#f43f5e' },
  { name: 'Insurance', type: 'expense', icon: 'shield', color: '#64748b' },
  { name: 'Taxes', type: 'expense', icon: 'landmark', color: '#71717a' },
  { name: 'Bank Charges', type: 'expense', icon: 'credit-card', color: '#78716c' },
  { name: 'Other Expenses', type: 'expense', icon: 'more-horizontal', color: '#a1a1aa' },
];

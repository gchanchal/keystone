import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const personalTeamMembers = sqliteTable('personal_team_members', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull(),
  memberEmail: text('member_email').notNull(),
  memberUserId: text('member_user_id'),
  role: text('role').default('viewer'),              // 'viewer', 'editor', 'admin'
  invitedAt: text('invited_at').notNull(),
  acceptedAt: text('accepted_at'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
});

export type PersonalTeamMember = typeof personalTeamMembers.$inferSelect;
export type NewPersonalTeamMember = typeof personalTeamMembers.$inferInsert;

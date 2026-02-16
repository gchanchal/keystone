import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const gearupTeamMembers = sqliteTable('gearup_team_members', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull(),      // g.chanchal's user ID
  memberEmail: text('member_email').notNull(),       // Invited email (unique)
  memberUserId: text('member_user_id'),              // Filled when member logs in
  role: text('role').default('viewer'),              // 'viewer', 'editor', 'admin'
  invitedAt: text('invited_at').notNull(),
  acceptedAt: text('accepted_at'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
});

export type GearupTeamMember = typeof gearupTeamMembers.$inferSelect;
export type NewGearupTeamMember = typeof gearupTeamMembers.$inferInsert;

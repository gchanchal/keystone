import { db, gearupTeamMembers, users, accounts } from '../db/index.js';
import { eq, and } from 'drizzle-orm';

// GearUp Mods owner email
export const GEARUP_OWNER_EMAIL = 'g.chanchal@gmail.com';

/**
 * Check if current user has GearUp access (owner or active team member)
 * Returns { hasAccess, isOwner, ownerUserId, memberRole }
 */
export async function checkGearupAccess(userEmail: string | undefined, userId: string | undefined): Promise<{
  hasAccess: boolean;
  isOwner: boolean;
  ownerUserId: string | null;
  memberRole: string | null;
}> {
  if (!userEmail) {
    return { hasAccess: false, isOwner: false, ownerUserId: null, memberRole: null };
  }

  // Owner always has access
  if (userEmail === GEARUP_OWNER_EMAIL) {
    return { hasAccess: true, isOwner: true, ownerUserId: userId || null, memberRole: null };
  }

  // Check if user is an invited team member
  const [member] = await db.select()
    .from(gearupTeamMembers)
    .where(and(
      eq(gearupTeamMembers.memberEmail, userEmail),
      eq(gearupTeamMembers.isActive, true)
    ))
    .limit(1);

  if (member) {
    // Update member_user_id if not set (first login after invite)
    if (!member.memberUserId && userId) {
      await db.update(gearupTeamMembers)
        .set({
          memberUserId: userId,
          acceptedAt: new Date().toISOString(),
        })
        .where(eq(gearupTeamMembers.id, member.id));
    }
    return {
      hasAccess: true,
      isOwner: false,
      ownerUserId: member.ownerUserId,
      memberRole: member.role,
    };
  }

  return { hasAccess: false, isOwner: false, ownerUserId: null, memberRole: null };
}

/**
 * Get the owner's user ID for GearUp (g.chanchal's user ID)
 */
export async function getGearupOwnerId(): Promise<string | null> {
  const [owner] = await db.select({ id: users.id })
    .from(users)
    .where(eq(users.email, GEARUP_OWNER_EMAIL))
    .limit(1);
  return owner?.id || null;
}

/**
 * Get GearUp business account IDs
 * For owner: returns their own GearUp accounts
 * For team members: returns owner's GearUp accounts (NOT the team member's accounts)
 */
export async function getASGAccountIds(userId: string, userEmail?: string): Promise<string[]> {
  // Check if this is a team member (not the owner)
  if (userEmail && userEmail !== GEARUP_OWNER_EMAIL) {
    // Team member - get OWNER's GearUp accounts
    const ownerUserId = await getGearupOwnerId();
    if (!ownerUserId) {
      return [];
    }

    const gearupAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, ownerUserId),
          eq(accounts.isActive, true),
          eq(accounts.isGearupBusiness, true)
        )
      );
    return gearupAccounts.map((acc) => acc.id);
  }

  // Owner - get their own GearUp accounts
  const gearupAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.isActive, true),
        eq(accounts.isGearupBusiness, true)
      )
    );
  return gearupAccounts.map((acc) => acc.id);
}

// Check if user is authorized for GearUp features (synchronous check for owner only)
export function isGearupOwner(req: any): boolean {
  return req.user?.email === GEARUP_OWNER_EMAIL;
}

// Check if user is authorized for GearUp features (async check including team members)
export async function isGearupAuthorized(req: any): Promise<boolean> {
  const access = await checkGearupAccess(req.user?.email, req.user?.id);
  return access.hasAccess;
}

// Get effective user ID for GearUp data access
// For owner: returns their own user ID
// For team members: returns owner's user ID (to access owner's data)
export async function getGearupDataUserId(req: any): Promise<string | null> {
  const access = await checkGearupAccess(req.user?.email, req.user?.id);
  if (!access.hasAccess) return null;
  if (access.isOwner) return req.user?.id;
  return access.ownerUserId;
}

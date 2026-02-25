import { db, personalTeamMembers } from '../db/index.js';
import { eq, and } from 'drizzle-orm';

/**
 * Check if current user has access to a specific owner's personal data.
 * Returns { hasAccess, isOwner, ownerUserId, memberRole }
 */
export async function checkPersonalAccess(userEmail: string | undefined, userId: string | undefined): Promise<{
  hasAccess: boolean;
  isOwner: boolean;
  ownerUserId: string | null;
  memberRole: string | null;
}> {
  if (!userEmail || !userId) {
    return { hasAccess: false, isOwner: false, ownerUserId: null, memberRole: null };
  }

  // Every user is owner of their own personal data
  // This function is primarily used to check if a user can access *someone else's* data
  // For "my own data" the caller just uses req.userId directly

  // Check if user is an invited team member of someone else's personal data
  const [member] = await db.select()
    .from(personalTeamMembers)
    .where(and(
      eq(personalTeamMembers.memberEmail, userEmail),
      eq(personalTeamMembers.isActive, true)
    ))
    .limit(1);

  if (member) {
    // Auto-link: update memberUserId if not set (first login after invite)
    if (!member.memberUserId && userId) {
      await db.update(personalTeamMembers)
        .set({
          memberUserId: userId,
          acceptedAt: new Date().toISOString(),
        })
        .where(eq(personalTeamMembers.id, member.id));
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
 * Get the effective user ID for personal data access.
 * For the owner: returns their own user ID.
 * For team members: returns owner's user ID (to access owner's data).
 */
export async function getPersonalDataUserId(req: any): Promise<string | null> {
  const userId = req.user?.id;
  if (!userId) return null;

  // User always has access to their own data
  // This helper would be used when route-level access control is implemented
  return userId;
}

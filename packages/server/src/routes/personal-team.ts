import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { db, personalTeamMembers, users } from '../db/index.js';
import { eq, and, desc } from 'drizzle-orm';
import { checkPersonalAccess } from '../utils/personal-auth.js';

const router = Router();

// Check my access (am I invited to someone's personal data?)
router.get('/my-access', async (req: any, res) => {
  try {
    const access = await checkPersonalAccess(req.user?.email, req.user?.id);
    res.json({
      hasAccess: access.hasAccess,
      isOwner: access.isOwner,
      role: access.memberRole,
      ownerUserId: access.ownerUserId,
    });
  } catch (error) {
    console.error('Error checking personal access:', error);
    res.status(500).json({ error: 'Failed to check access' });
  }
});

// Get team members (lists people you've invited to your personal data)
router.get('/members', async (req: any, res) => {
  try {
    const members = await db.select()
      .from(personalTeamMembers)
      .where(eq(personalTeamMembers.ownerUserId, req.user.id))
      .orderBy(desc(personalTeamMembers.invitedAt));

    res.json(members);
  } catch (error) {
    console.error('Error fetching personal team members:', error);
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
});

// Invite a member to access your personal data
router.post('/invite', async (req: any, res) => {
  try {
    const { email, role = 'viewer' } = z.object({
      email: z.string().email(),
      role: z.enum(['viewer', 'editor', 'admin']).optional().default('viewer'),
    }).parse(req.body);

    // Don't allow inviting yourself
    if (email === req.user.email) {
      return res.status(400).json({ error: 'Cannot invite yourself' });
    }

    // Check if already invited by this owner
    const [existing] = await db.select()
      .from(personalTeamMembers)
      .where(and(
        eq(personalTeamMembers.ownerUserId, req.user.id),
        eq(personalTeamMembers.memberEmail, email)
      ))
      .limit(1);

    if (existing) {
      if (existing.isActive) {
        return res.status(400).json({ error: 'This email has already been invited' });
      } else {
        // Re-activate the existing member
        await db.update(personalTeamMembers)
          .set({
            isActive: true,
            role,
            invitedAt: new Date().toISOString(),
            acceptedAt: null,
          })
          .where(eq(personalTeamMembers.id, existing.id));

        const [updated] = await db.select()
          .from(personalTeamMembers)
          .where(eq(personalTeamMembers.id, existing.id));

        return res.json(updated);
      }
    }

    const now = new Date().toISOString();
    const memberId = uuidv4();

    await db.insert(personalTeamMembers).values({
      id: memberId,
      ownerUserId: req.user.id,
      memberEmail: email,
      role,
      invitedAt: now,
      isActive: true,
    });

    const [member] = await db.select()
      .from(personalTeamMembers)
      .where(eq(personalTeamMembers.id, memberId));

    res.json(member);
  } catch (error) {
    console.error('Error inviting personal team member:', error);
    res.status(500).json({ error: 'Failed to invite team member' });
  }
});

// Update team member role
router.patch('/members/:id', async (req: any, res) => {
  try {
    const { id } = req.params;
    const { role } = z.object({
      role: z.enum(['viewer', 'editor', 'admin']),
    }).parse(req.body);

    // Verify member belongs to this owner
    const [member] = await db.select()
      .from(personalTeamMembers)
      .where(and(
        eq(personalTeamMembers.id, id),
        eq(personalTeamMembers.ownerUserId, req.user.id)
      ));

    if (!member) {
      return res.status(404).json({ error: 'Team member not found' });
    }

    await db.update(personalTeamMembers)
      .set({ role })
      .where(eq(personalTeamMembers.id, id));

    const [updated] = await db.select()
      .from(personalTeamMembers)
      .where(eq(personalTeamMembers.id, id));

    res.json(updated);
  } catch (error) {
    console.error('Error updating personal team member:', error);
    res.status(500).json({ error: 'Failed to update team member' });
  }
});

// Remove team member (soft delete)
router.delete('/members/:id', async (req: any, res) => {
  try {
    const { id } = req.params;

    // Verify member belongs to this owner
    const [member] = await db.select()
      .from(personalTeamMembers)
      .where(and(
        eq(personalTeamMembers.id, id),
        eq(personalTeamMembers.ownerUserId, req.user.id)
      ));

    if (!member) {
      return res.status(404).json({ error: 'Team member not found' });
    }

    await db.update(personalTeamMembers)
      .set({ isActive: false })
      .where(eq(personalTeamMembers.id, id));

    res.json({ success: true, message: 'Team member removed' });
  } catch (error) {
    console.error('Error removing personal team member:', error);
    res.status(500).json({ error: 'Failed to remove team member' });
  }
});

export default router;

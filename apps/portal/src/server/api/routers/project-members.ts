import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { schema, DBType } from "@/server/db";
import { eq, and } from "drizzle-orm";
import { count } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { TRPCError } from "@trpc/server";

const { user, projectUser, invitation } = schema;

// Helper function to get member counts by role
async function getProjectMemberCounts(db: DBType, projectId: string) {
  const [totalResult, ownerResult, adminResult] = await Promise.all([
    db
      .select({ count: count() })
      .from(projectUser)
      .where(eq(projectUser.projectId, projectId)),
    db
      .select({ count: count() })
      .from(projectUser)
      .where(
        and(
          eq(projectUser.projectId, projectId),
          eq(projectUser.role, "owner"),
        ),
      ),
    db
      .select({ count: count() })
      .from(projectUser)
      .where(
        and(
          eq(projectUser.projectId, projectId),
          eq(projectUser.role, "admin"),
        ),
      ),
  ]);

  return {
    total: totalResult[0]?.count ?? 0,
    owners: ownerResult[0]?.count ?? 0,
    admins: adminResult[0]?.count ?? 0,
  };
}

// Helper to validate role changes
async function validateRoleChange(
  db: DBType,
  projectId: string,
  userId: string,
  newRole: string,
  currentUserId: string,
) {
  // Get current user's role (the one making the change)
  const [currentUserMembership] = await db
    .select()
    .from(projectUser)
    .where(
      and(
        eq(projectUser.projectId, projectId),
        eq(projectUser.userId, currentUserId),
      ),
    );

  if (!currentUserMembership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this project",
    });
  }

  // Only owners and admins can change roles
  if (currentUserMembership.role === "member") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't have permission to change roles",
    });
  }

  // Get target user's current role
  const [targetUserMembership] = await db
    .select()
    .from(projectUser)
    .where(
      and(eq(projectUser.projectId, projectId), eq(projectUser.userId, userId)),
    );

  if (!targetUserMembership) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "User is not a member of this project",
    });
  }

  const counts = await getProjectMemberCounts(db, projectId);

  // Prevent demoting the last owner
  if (
    targetUserMembership.role === "owner" &&
    counts.owners === 1 &&
    newRole !== "owner"
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Cannot demote the last owner. Promote another member to owner first.",
    });
  }

  // Prevent demoting the last admin if there are no owners
  if (
    targetUserMembership.role === "admin" &&
    counts.admins === 1 &&
    counts.owners === 0 &&
    newRole === "member"
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot demote the last admin when there are no owners.",
    });
  }

  // Only owners can promote to owner
  if (newRole === "owner" && currentUserMembership.role !== "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only owners can promote members to owner role",
    });
  }
}

// Helper to validate member removal
async function validateMemberRemoval(
  db: DBType,
  projectId: string,
  userIdToRemove: string,
  currentUserId: string,
) {
  // Get current user's role
  const [currentUserMembership] = await db
    .select()
    .from(projectUser)
    .where(
      and(
        eq(projectUser.projectId, projectId),
        eq(projectUser.userId, currentUserId),
      ),
    );

  if (!currentUserMembership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this project",
    });
  }

  // Only owners and admins can remove members
  if (currentUserMembership.role === "member") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't have permission to remove members",
    });
  }

  // Get target user's role
  const [targetUserMembership] = await db
    .select()
    .from(projectUser)
    .where(
      and(
        eq(projectUser.projectId, projectId),
        eq(projectUser.userId, userIdToRemove),
      ),
    );

  if (!targetUserMembership) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "User is not a member of this project",
    });
  }

  const counts = await getProjectMemberCounts(db, projectId);

  // Prevent removing the last member
  if (counts.total === 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot remove the last member of the project",
    });
  }

  // Prevent removing the last owner
  if (targetUserMembership.role === "owner" && counts.owners === 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Cannot remove the last owner. Promote another member to owner first.",
    });
  }

  // Prevent removing the last admin if there are no owners
  if (
    targetUserMembership.role === "admin" &&
    counts.admins === 1 &&
    counts.owners === 0
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot remove the last admin when there are no owners.",
    });
  }
}

export const projectMembersRouter = createTRPCRouter({
  /**
   * Get all members for the active project.
   */
  listMembers: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeProjectId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No active project",
      });
    }

    const rows = await ctx.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.image,
        role: projectUser.role,
        joinedAt: projectUser.createdAt,
      })
      .from(projectUser)
      .innerJoin(user, eq(projectUser.userId, user.id))
      .where(eq(projectUser.projectId, ctx.activeProjectId));

    // Include member counts for UI to use
    const counts = await getProjectMemberCounts(ctx.db, ctx.activeProjectId);

    // Format joinedAt to readable string
    return {
      members: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        avatar: row.avatar ?? undefined,
        role: row.role as "admin" | "member" | "owner",
        joinedAt: row.joinedAt.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        isCurrentUser: row.id === ctx.userId, // Add flag to identify current user
      })),
      counts, // Include counts for UI validations
      currentUserId: ctx.userId, // Explicitly provide current user ID
      currentUserRole: ctx.projectUserRole, // Provide current user's role for UI permissions
    };
  }),

  /**
   * Get pending/expired invitations for the active project.
   */
  listInvitations: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeProjectId) {
      throw new Error("No active project");
    }

    const data = await ctx.db
      .select()
      .from(invitation)
      .innerJoin(user, eq(user.id, invitation.inviterId))
      .where(
        and(
          eq(invitation.projectId, ctx.activeProjectId),
          eq(invitation.status, "pending"),
        ),
      );

    if (!data) return [];

    return data.map(({ invitation, user }) => ({
      id: invitation.id,
      email: invitation.email,
      role: (invitation.role as "admin" | "member" | "owner") ?? "member",
      invitedBy: user.name ?? user.email ?? "System",
      invitedAt: new Date(invitation.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      expiresAt: new Date(invitation.expiresAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      status: invitation.status as "pending" | "accepted" | "expired",
    }));
  }),

  /**
   * Invite a member (creates invitation).
   */
  invite: protectedProcedure
    .input(
      z.object({
        email: z.string().email(),
        role: z.enum(["admin", "member", "owner"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeProjectId || !ctx.userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active project or user",
        });
      }

      // Check if user has permission to invite
      if (ctx.projectUserRole === "member") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "You don't have permission to invite members. Only owners and admins can invite.",
        });
      }

      // Only owners can invite other owners
      if (ctx.projectUserRole === "admin" && input.role === "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only owners can invite other owners",
        });
      }

      // Create invitation entry
      const invitation = await auth.api.createInvitation({
        body: {
          organizationId: ctx.activeProjectId,
          email: input.email,
          role: input.role,
        },
        headers: ctx.headers,
      });

      return { id: invitation };
    }),

  /**
   * Change role of a member with validation.
   */
  changeRole: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        role: z.enum(["admin", "member", "owner"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeProjectId || !ctx.userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active project or user",
        });
      }

      // Validate the role change
      await validateRoleChange(
        ctx.db,
        ctx.activeProjectId,
        input.userId,
        input.role,
        ctx.userId,
      );

      // Use Better Auth's API to update the role
      await auth.api.updateMemberRole({
        body: {
          organizationId: ctx.activeProjectId,
          memberId: input.userId,
          role: input.role,
        },
        headers: ctx.headers,
      });

      return { success: true };
    }),

  /**
   * Remove member from project with validation.
   */
  remove: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeProjectId || !ctx.userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active project or user",
        });
      }

      // Validate the member removal
      await validateMemberRemoval(
        ctx.db,
        ctx.activeProjectId,
        input.userId,
        ctx.userId,
      );

      // Use Better Auth's API to remove the member
      await auth.api.removeMember({
        body: {
          organizationId: ctx.activeProjectId,
          memberIdOrEmail: input.userId,
        },
        headers: ctx.headers,
      });

      return { success: true };
    }),

  /**
   * Cancel invitation.
   */
  cancelInvitation: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Check if user has permission to cancel invitations
      if (ctx.projectUserRole === "member") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "You don't have permission to cancel invitations. Only owners and admins can cancel invitations.",
        });
      }

      await auth.api.cancelInvitation({
        body: {
          invitationId: input.id,
        },
        headers: ctx.headers,
      });
      await ctx.db.delete(invitation).where(eq(invitation.id, input.id));

      return { success: true };
    }),

  resendInvitation: protectedProcedure
    .input(
      z.object({
        email: z.string(),
        role: z.enum(["admin", "member", "owner"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Check if user has permission to resend invitations
      if (ctx.projectUserRole === "member") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "You don't have permission to resend invitations. Only owners and admins can resend invitations.",
        });
      }

      // Only owners can invite other owners
      if (ctx.projectUserRole === "admin" && input.role === "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only owners can invite other owners",
        });
      }

      const invitation = await auth.api.createInvitation({
        body: {
          email: input.email,
          role: input.role,
          organizationId: ctx.activeProjectId,
          resend: true,
        },
        headers: ctx.headers,
      });

      return { id: invitation };
    }),
  acceptInvitation: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await auth.api.acceptInvitation({
        body: { invitationId: input.id },
        headers: ctx.headers,
      });

      return { success: true };
    }),
});

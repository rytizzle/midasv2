import type { Request } from 'express';
import { userInfo, userWorkspaceClient } from './user-client';

/**
 * Returns true if the caller is a member of the workspace `admins` group.
 *
 * Resolves identity from the OBO X-Forwarded-Access-Token via `currentUser.me()`
 * — that returns the user with their group memberships. Workspace admins are
 * members of the `admins` group by convention.
 *
 * Results are cached for 5 minutes keyed on the user email so we don't make a
 * SCIM call per request.
 */

interface CacheEntry {
  groups: string[];
  isAdmin: boolean;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

/**
 * Resolve the caller's group display names (lowercased) plus admin status via
 * one OBO `currentUser.me()` SCIM call, cached 5 minutes per user email.
 */
async function resolveMembership(
  req: Request,
): Promise<{ groups: string[]; isAdmin: boolean }> {
  const email = userInfo(req).email;
  if (!email) return { groups: [], isAdmin: false };

  const cached = cache.get(email);
  if (cached && cached.expiresAt > Date.now()) {
    return { groups: cached.groups, isAdmin: cached.isAdmin };
  }

  let groups: string[] = [];
  let isAdmin = false;
  try {
    const ws = userWorkspaceClient(req);
    const me = await ws.currentUser.me();
    groups = (me.groups ?? [])
      .map((g) => (g.display ?? '').toLowerCase())
      .filter(Boolean);
    isAdmin = groups.includes('admins');
  } catch (err) {
    // If the OBO lookup fails (e.g. no token locally), default to no groups.
    console.warn('[admin] membership lookup failed:', (err as Error).message);
  }

  cache.set(email, { groups, isAdmin, expiresAt: Date.now() + TTL_MS });
  return { groups, isAdmin };
}

export async function isWorkspaceAdmin(req: Request): Promise<boolean> {
  return (await resolveMembership(req)).isAdmin;
}

/** Group display names (lowercased) the caller belongs to. */
export async function callerGroups(req: Request): Promise<string[]> {
  return (await resolveMembership(req)).groups;
}

/**
 * Optional admin-override group that may approve any change regardless of the
 * owning group (e.g. a central data-governance team). Configured via
 * MIDAS_ADMIN_OVERRIDE. Workspace `admins` always qualify.
 */
export function adminOverrideGroup(): string | null {
  const g = (process.env.MIDAS_ADMIN_OVERRIDE || '').trim().toLowerCase();
  return g || null;
}

/**
 * True when the caller may approve a change owned by `ownerGroup`.
 *
 * Rules:
 *  - workspace admins can always approve;
 *  - a configured admin-override group can always approve;
 *  - otherwise the caller must be a member of the change's owner group;
 *  - when a change has no owner group (untagged table), only admins /
 *    the override group qualify (safe fallback so nothing is stuck).
 */
export async function canApprove(
  req: Request,
  ownerGroup: string | null,
): Promise<boolean> {
  const { groups, isAdmin } = await resolveMembership(req);
  if (isAdmin) return true;
  const override = adminOverrideGroup();
  if (override && groups.includes(override)) return true;
  if (!ownerGroup) return false;
  return groups.includes(ownerGroup.toLowerCase());
}

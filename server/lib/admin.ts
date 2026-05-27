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
  value: boolean;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

export async function isWorkspaceAdmin(req: Request): Promise<boolean> {
  const email = userInfo(req).email;
  if (!email) return false;

  const cached = cache.get(email);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let isAdmin = false;
  try {
    const ws = userWorkspaceClient(req);
    const me = await ws.currentUser.me();
    const groups = me.groups ?? [];
    isAdmin = groups.some(
      (g) => (g.display ?? '').toLowerCase() === 'admins',
    );
  } catch (err) {
    // If the OBO lookup fails (e.g. no token locally), default to non-admin.
    console.warn('[admin] isWorkspaceAdmin lookup failed:', (err as Error).message);
    isAdmin = false;
  }

  cache.set(email, { value: isAdmin, expiresAt: Date.now() + TTL_MS });
  return isAdmin;
}

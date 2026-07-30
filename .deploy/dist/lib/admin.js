import { userInfo, userWorkspaceClient } from "./user-client.js";

//#region server/lib/admin.ts
const cache = /* @__PURE__ */ new Map();
const TTL_MS = 300 * 1e3;
/**
* Resolve the caller's group display names (lowercased) plus admin status via
* one OBO `currentUser.me()` SCIM call, cached 5 minutes per user email.
*/
async function resolveMembership(req) {
	const email = userInfo(req).email;
	if (!email) return {
		groups: [],
		isAdmin: false
	};
	const cached = cache.get(email);
	if (cached && cached.expiresAt > Date.now()) return {
		groups: cached.groups,
		isAdmin: cached.isAdmin
	};
	let groups = [];
	let isAdmin = false;
	try {
		groups = ((await userWorkspaceClient(req).currentUser.me()).groups ?? []).map((g) => (g.display ?? "").toLowerCase()).filter(Boolean);
		isAdmin = groups.includes("admins");
	} catch (err) {
		console.warn("[admin] membership lookup failed:", err.message);
	}
	cache.set(email, {
		groups,
		isAdmin,
		expiresAt: Date.now() + TTL_MS
	});
	return {
		groups,
		isAdmin
	};
}
async function isWorkspaceAdmin(req) {
	return (await resolveMembership(req)).isAdmin;
}
/** Group display names (lowercased) the caller belongs to. */
async function callerGroups(req) {
	return (await resolveMembership(req)).groups;
}
/**
* Optional admin-override group that may approve any change regardless of the
* owning group (e.g. a central data-governance team). Configured via
* MIDAS_ADMIN_OVERRIDE. Workspace `admins` always qualify.
*/
function adminOverrideGroup() {
	return (process.env.MIDAS_ADMIN_OVERRIDE || "").trim().toLowerCase() || null;
}

//#endregion
export { adminOverrideGroup, callerGroups, isWorkspaceAdmin };
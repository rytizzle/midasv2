import { executeSql } from "./sql.js";
import { DEFAULT_TIER, normalizeTier } from "../shared/tiers.js";

//#region server/lib/tags.ts
/**
* Governed-tag lookups used for approval routing (owner group) and tier-based
* metadata templates (data tier). Both read
* <catalog>.INFORMATION_SCHEMA.TABLE_TAGS.
*
* Tag keys are configurable so this can point at whatever convention a
* workspace uses:
*   MIDAS_OWNER_TAG_KEY  (default "owner")     → value is the owning group
*   MIDAS_TIER_TAG_KEY   (default "data_tier") → value is the DAWG 0002 tier
*/
const OWNER_TAG_KEY = process.env.MIDAS_OWNER_TAG_KEY || "owner";
const TIER_TAG_KEY = process.env.MIDAS_TIER_TAG_KEY || "data_tier";
function escLit(s) {
	return "'" + s.replace(/'/g, "''") + "'";
}
/**
* Resolve owner group + tier for a set of fully-qualified table names within a
* single catalog. Batched into one INFORMATION_SCHEMA query. Tables not found
* in the tag table come back with { ownerGroup: null, tier: DEFAULT_TIER }.
*/
async function resolveTableTags(ws, warehouseId, catalog, fqns) {
	const out = {};
	const wanted = /* @__PURE__ */ new Map();
	for (const fqn of fqns) {
		const parts = fqn.split(".");
		if (parts.length !== 3) continue;
		const [cat, schema, table] = parts;
		if (cat !== catalog) continue;
		wanted.set(fqn, {
			schema,
			table
		});
		out[fqn] = {
			ownerGroup: null,
			tier: DEFAULT_TIER,
			tierTagged: false
		};
	}
	if (wanted.size === 0) return out;
	const rows = await executeSql(ws, warehouseId, `SELECT schema_name, table_name, tag_name, tag_value
       FROM ${catalog}.INFORMATION_SCHEMA.TABLE_TAGS
      WHERE (${Array.from(wanted.values()).map((p) => `(schema_name = ${escLit(p.schema)} AND table_name = ${escLit(p.table)})`).join(" OR ")})
        AND lower(tag_name) IN (${escLit(OWNER_TAG_KEY.toLowerCase())}, ${escLit(TIER_TAG_KEY.toLowerCase())})`);
	for (const row of rows) {
		const entry = out[`${catalog}.${row.schema_name ?? ""}.${row.table_name ?? ""}`];
		if (!entry) continue;
		const key = (row.tag_name ?? "").toLowerCase();
		const value = row.tag_value ?? "";
		if (key === OWNER_TAG_KEY.toLowerCase()) entry.ownerGroup = value || null;
		else if (key === TIER_TAG_KEY.toLowerCase()) {
			const t = normalizeTier(value);
			if (t) {
				entry.tier = t;
				entry.tierTagged = true;
			}
		}
	}
	return out;
}
/** Catalog portion of a fully-qualified name, or '' if malformed. */
function catalogOf(fqn) {
	const i = fqn.indexOf(".");
	return i > 0 ? fqn.slice(0, i) : "";
}

//#endregion
export { OWNER_TAG_KEY, TIER_TAG_KEY, catalogOf, resolveTableTags };
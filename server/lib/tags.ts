import type { WorkspaceClient } from '@databricks/sdk-experimental';
import { executeSql } from './sql';
import { normalizeTier, DEFAULT_TIER, type Tier } from '../../shared/tiers';

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

export const OWNER_TAG_KEY = process.env.MIDAS_OWNER_TAG_KEY || 'owner';
export const TIER_TAG_KEY = process.env.MIDAS_TIER_TAG_KEY || 'data_tier';

export interface TableTagInfo {
  /** Owning group from the owner tag, or null when the tag is absent. */
  ownerGroup: string | null;
  /** DAWG 0002 tier (normalized), or DEFAULT_TIER when the tag is absent. */
  tier: Tier;
  /** True when a recognizable data_tier tag was actually present. */
  tierTagged: boolean;
}

function escLit(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

/**
 * Resolve owner group + tier for a set of fully-qualified table names within a
 * single catalog. Batched into one INFORMATION_SCHEMA query. Tables not found
 * in the tag table come back with { ownerGroup: null, tier: DEFAULT_TIER }.
 */
export async function resolveTableTags(
  ws: WorkspaceClient,
  warehouseId: string,
  catalog: string,
  fqns: string[],
): Promise<Record<string, TableTagInfo>> {
  const out: Record<string, TableTagInfo> = {};
  // Seed defaults so every requested table has an entry.
  const wanted = new Map<string, { schema: string; table: string }>();
  for (const fqn of fqns) {
    const parts = fqn.split('.');
    if (parts.length !== 3) continue;
    const [cat, schema, table] = parts;
    if (cat !== catalog) continue;
    wanted.set(fqn, { schema, table });
    out[fqn] = { ownerGroup: null, tier: DEFAULT_TIER, tierTagged: false };
  }
  if (wanted.size === 0) return out;

  // Build a schema/table IN-list to keep the scan bounded.
  const pairFilter = Array.from(wanted.values())
    .map((p) => `(schema_name = ${escLit(p.schema)} AND table_name = ${escLit(p.table)})`)
    .join(' OR ');

  const rows = await executeSql(
    ws,
    warehouseId,
    `SELECT schema_name, table_name, tag_name, tag_value
       FROM ${catalog}.INFORMATION_SCHEMA.TABLE_TAGS
      WHERE (${pairFilter})
        AND lower(tag_name) IN (${escLit(OWNER_TAG_KEY.toLowerCase())}, ${escLit(
          TIER_TAG_KEY.toLowerCase(),
        )})`,
  );

  for (const row of rows) {
    const schema = row.schema_name ?? '';
    const table = row.table_name ?? '';
    const fqn = `${catalog}.${schema}.${table}`;
    const entry = out[fqn];
    if (!entry) continue;
    const key = (row.tag_name ?? '').toLowerCase();
    const value = row.tag_value ?? '';
    if (key === OWNER_TAG_KEY.toLowerCase()) {
      entry.ownerGroup = value || null;
    } else if (key === TIER_TAG_KEY.toLowerCase()) {
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
export function catalogOf(fqn: string): string {
  const i = fqn.indexOf('.');
  return i > 0 ? fqn.slice(0, i) : '';
}

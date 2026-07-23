import type { Application, Request, Response } from 'express';
import { userInfo, userWorkspaceClient } from '../lib/user-client';
import { executeSql } from '../lib/sql';
import { OWNER_TAG_KEY, TIER_TAG_KEY } from '../lib/tags';
import { normalizeTier, DEFAULT_TIER, TIER_ORDER } from '../../shared/tiers';

interface AppKit {
  server: { extend(fn: (app: Application) => void): void };
}

// Hard cap so a runaway "show all" query can't try to hydrate an entire
// 39k-table catalog into one response.
const MAX_TABLE_PAGE = 500;

export function registerCatalogRoutes(appkit: AppKit) {
  appkit.server.extend((app) => {
    app.get('/api/catalog/me', (req: Request, res: Response) => {
      const u = userInfo(req);
      res.json({ email: u.email, name: u.name });
    });

    app.get('/api/catalog/warehouses', async (req: Request, res: Response) => {
      try {
        const ws = userWorkspaceClient(req);
        const out: Array<{ id: string; name: string; state: string; size: string }> = [];
        for await (const wh of ws.warehouses.list({})) {
          if (!wh.id) continue;
          out.push({
            id: wh.id,
            name: wh.name ?? '',
            state: wh.state ?? 'UNKNOWN',
            size: wh.cluster_size ?? '',
          });
        }
        res.json(out);
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    app.get('/api/catalog/catalogs', async (req: Request, res: Response) => {
      try {
        const ws = userWorkspaceClient(req);
        const out: Array<{ name: string; comment: string }> = [];
        for await (const c of ws.catalogs.list({})) {
          if (c.name && !c.name.startsWith('__')) {
            out.push({ name: c.name, comment: c.comment ?? '' });
          }
        }
        res.json(out);
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    app.get('/api/catalog/schemas', async (req: Request, res: Response) => {
      try {
        const catalog = String(req.query.catalog ?? '');
        if (!catalog) {
          res.status(400).json({ error: 'catalog is required' });
          return;
        }
        const ws = userWorkspaceClient(req);
        const out: Array<{ name: string; comment: string }> = [];
        for await (const s of ws.schemas.list({ catalog_name: catalog })) {
          if (s.name && s.name !== 'information_schema') {
            out.push({ name: s.name, comment: s.comment ?? '' });
          }
        }
        res.json(out);
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    app.get('/api/catalog/tables', async (req: Request, res: Response) => {
      try {
        const catalog = String(req.query.catalog ?? '');
        const schema = String(req.query.schema ?? '');
        if (!catalog || !schema) {
          res.status(400).json({ error: 'catalog and schema are required' });
          return;
        }
        const ws = userWorkspaceClient(req);
        const out: Array<{
          name: string;
          full_name: string;
          table_type: string;
          comment: string;
          columns: Array<{ name: string; type: string; comment: string }>;
          column_count: number;
        }> = [];
        for await (const t of ws.tables.list({ catalog_name: catalog, schema_name: schema })) {
          const columns = (t.columns ?? []).map((col) => ({
            name: col.name ?? '',
            type: col.type_text ?? String(col.type_name ?? ''),
            comment: col.comment ?? '',
          }));
          out.push({
            name: t.name ?? '',
            full_name: t.full_name ?? '',
            table_type: t.table_type ?? 'TABLE',
            comment: t.comment ?? '',
            columns,
            column_count: columns.length,
          });
        }
        res.json(out);
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    /**
     * "Show all tables" — the default browse view.
     *
     * Lists tables across a whole catalog (all schemas) in one bounded
     * INFORMATION_SCHEMA query, with server-side search + keyset-friendly
     * pagination so a 39k-table catalog never streams in full. Joins the
     * owner + data_tier governed tags so the UI can show tier/owner without
     * an extra round trip.
     *
     * Query params:
     *   catalog       (required)  catalog to browse
     *   warehouse_id  (required)  warehouse for the metadata query
     *   schema        (optional)  restrict to one schema
     *   q             (optional)  case-insensitive substring on schema/table
     *   limit         (optional)  page size, default 200, max 500
     *   offset        (optional)  page offset, default 0
     *
     * Returns { tables: [...], total, limit, offset, has_more }. Lightweight:
     * columns are NOT hydrated here (that happens on selection/profiling).
     */
    app.get('/api/catalog/all-tables', async (req: Request, res: Response) => {
      try {
        const catalog = String(req.query.catalog ?? '');
        const warehouseId = String(req.query.warehouse_id ?? '');
        const schema = String(req.query.schema ?? '');
        const q = String(req.query.q ?? '').trim();
        // Optional tier filter: comma-separated list of tiers ('0'..'4'). A
        // table's effective tier is its normalized data_tier tag, or DEFAULT_TIER
        // (4) when untagged/unrecognized — so selecting 4 also matches
        // "non-tiered" tables. Empty = no filter.
        const tiers = [
          ...new Set(
            String(req.query.tiers ?? '')
              .split(',')
              .map((s) => s.trim())
              .filter((s) => /^[0-4]$/.test(s)),
          ),
        ];
        const limit = Math.min(
          Math.max(Number(req.query.limit ?? 200) || 200, 1),
          MAX_TABLE_PAGE,
        );
        const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
        if (!catalog || !warehouseId) {
          res.status(400).json({ error: 'catalog and warehouse_id are required' });
          return;
        }

        const escLit = (s: string) => "'" + s.replace(/'/g, "''") + "'";
        const conds: string[] = [`t.table_schema <> 'information_schema'`];
        if (schema) conds.push(`t.table_schema = ${escLit(schema)}`);
        if (q) {
          const like = `%${q.replace(/([%_\\])/g, '\\$1').toLowerCase()}%`;
          conds.push(
            `(lower(t.table_name) LIKE ${escLit(like)} ESCAPE '\\\\' ` +
              `OR lower(t.table_schema) LIKE ${escLit(like)} ESCAPE '\\\\')`,
          );
        }
        // Filter on the table's effective DAWG-0002 tier. The effective tier is
        // the normalized data_tier tag value, or '4' when the tag is absent or
        // unrecognized — mirroring normalizeTier()/DEFAULT_TIER on the read
        // path, so Tier 4 also captures "non-tiered" tables. Computed via a
        // correlated subquery so it's independent of the owner/tier LEFT JOIN.
        if (tiers.length > 0 && tiers.length < TIER_ORDER.length) {
          const rawTier =
            `(SELECT MAX(tt.tag_value) FROM ${catalog}.INFORMATION_SCHEMA.TABLE_TAGS tt ` +
            `WHERE tt.schema_name = t.table_schema AND tt.table_name = t.table_name ` +
            `AND lower(tt.tag_name) = ${escLit(TIER_TAG_KEY.toLowerCase())})`;
          const effTier =
            `CASE WHEN lower(${rawTier}) = 'critical' THEN '0' ` +
            `WHEN regexp_extract(lower(${rawTier}), '([0-4])', 1) <> '' ` +
            `THEN regexp_extract(lower(${rawTier}), '([0-4])', 1) ELSE '4' END`;
          conds.push(`${effTier} IN (${tiers.map(escLit).join(', ')})`);
        }
        const where = conds.join(' AND ');
        const ws = userWorkspaceClient(req);

        // Total count for pagination UI.
        const countRows = await executeSql(
          ws,
          warehouseId,
          `SELECT COUNT(*) AS n
             FROM ${catalog}.INFORMATION_SCHEMA.TABLES t
            WHERE ${where}`,
        );
        const total = Number(countRows[0]?.n ?? 0);

        // Page of tables, left-joined to owner + tier tags in one shot.
        const rows = await executeSql(
          ws,
          warehouseId,
          `SELECT t.table_schema AS schema_name,
                  t.table_name   AS table_name,
                  t.table_type   AS table_type,
                  t.comment      AS comment,
                  MAX(CASE WHEN lower(tg.tag_name) = ${escLit(
                    OWNER_TAG_KEY.toLowerCase(),
                  )} THEN tg.tag_value END) AS owner_group,
                  MAX(CASE WHEN lower(tg.tag_name) = ${escLit(
                    TIER_TAG_KEY.toLowerCase(),
                  )} THEN tg.tag_value END) AS tier_raw
             FROM ${catalog}.INFORMATION_SCHEMA.TABLES t
             LEFT JOIN ${catalog}.INFORMATION_SCHEMA.TABLE_TAGS tg
                    ON tg.schema_name = t.table_schema
                   AND tg.table_name  = t.table_name
                   AND lower(tg.tag_name) IN (${escLit(
                     OWNER_TAG_KEY.toLowerCase(),
                   )}, ${escLit(TIER_TAG_KEY.toLowerCase())})
            WHERE ${where}
            GROUP BY t.table_schema, t.table_name, t.table_type, t.comment
            ORDER BY t.table_schema, t.table_name
            LIMIT ${limit} OFFSET ${offset}`,
        );

        const tables = rows.map((r) => {
          const schemaName = r.schema_name ?? '';
          const name = r.table_name ?? '';
          const tier = normalizeTier(r.tier_raw) ?? DEFAULT_TIER;
          return {
            name,
            full_name: `${catalog}.${schemaName}.${name}`,
            schema_name: schemaName,
            table_type: r.table_type ?? 'TABLE',
            comment: r.comment ?? '',
            owner_group: r.owner_group ?? null,
            tier,
            tier_tagged: normalizeTier(r.tier_raw) != null,
            columns: [],
            column_count: 0,
          };
        });

        res.json({
          tables,
          total,
          limit,
          offset,
          has_more: offset + tables.length < total,
        });
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    /**
     * Hydrate full table info (columns, type, comment) for a set of selected
     * fully-qualified names. Used after the lightweight "show all" list so we
     * only pay the per-table `tables.get` cost for tables the user actually
     * selected.
     */
    app.post('/api/catalog/tables/hydrate', async (req: Request, res: Response) => {
      try {
        const body = req.body as { tables?: string[] };
        const fqns = body.tables ?? [];
        const ws = userWorkspaceClient(req);
        const out: Array<Record<string, unknown>> = [];
        for (const fqn of fqns) {
          const parts = fqn.split('.');
          const schemaName = parts.length === 3 ? parts[1] : '';
          try {
            const t = await ws.tables.get({ full_name: fqn });
            const columns = (t.columns ?? []).map((col) => ({
              name: col.name ?? '',
              type: col.type_text ?? String(col.type_name ?? ''),
              comment: col.comment ?? '',
            }));
            out.push({
              name: t.name ?? parts[2] ?? fqn,
              full_name: t.full_name ?? fqn,
              schema_name: schemaName,
              table_type: t.table_type ?? 'TABLE',
              comment: t.comment ?? '',
              columns,
              column_count: columns.length,
            });
          } catch (e) {
            out.push({
              name: parts[2] ?? fqn,
              full_name: fqn,
              schema_name: schemaName,
              table_type: 'TABLE',
              comment: '',
              columns: [],
              column_count: 0,
              error: String((e as Error).message ?? e),
            });
          }
        }
        res.json(out);
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    app.post('/api/catalog/check-permissions', async (req: Request, res: Response) => {
      try {
        const body = req.body as { tables?: string[]; warehouse_id?: string };
        const tables = body.tables ?? [];
        const warehouseId = body.warehouse_id ?? '';
        if (!warehouseId) {
          res.status(400).json({ error: 'warehouse_id is required' });
          return;
        }
        const results: Record<string, { can_modify: boolean; error?: string }> = {};
        const ws = userWorkspaceClient(req);
        for (const fqn of tables) {
          try {
            const rows = await executeSql(ws, warehouseId, `SHOW GRANTS ON TABLE ${fqn}`);
            const canModify = rows.some((r) => {
              const v = JSON.stringify(r).toUpperCase();
              return v.includes('MODIFY') || v.includes('ALL_PRIVILEGES') || v.includes('ALL PRIVILEGES');
            });
            results[fqn] = { can_modify: canModify };
          } catch (e) {
            results[fqn] = { can_modify: false, error: String((e as Error).message ?? e) };
          }
        }
        res.json(results);
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    /**
     * List the governed-tag keys + their observed values across the catalog.
     * Reads <catalog>.INFORMATION_SCHEMA.TABLE_TAGS.
     */
    app.get('/api/catalog/tags', async (req: Request, res: Response) => {
      try {
        const catalog = String(req.query.catalog ?? '');
        const warehouseId = String(req.query.warehouse_id ?? '');
        if (!catalog || !warehouseId) {
          res.status(400).json({ error: 'catalog and warehouse_id are required' });
          return;
        }
        const ws = userWorkspaceClient(req);
        const rows = await executeSql(
          ws,
          warehouseId,
          `SELECT tag_name, tag_value, COUNT(*) AS n
           FROM ${catalog}.INFORMATION_SCHEMA.TABLE_TAGS
           GROUP BY tag_name, tag_value
           ORDER BY tag_name, tag_value`,
        );
        const tags: Record<string, Array<{ value: string; count: number }>> = {};
        for (const row of rows) {
          const key = row.tag_name ?? '';
          const value = row.tag_value ?? '';
          const count = Number(row.n ?? 0);
          if (!key) continue;
          if (!tags[key]) tags[key] = [];
          tags[key].push({ value, count });
        }
        res.json(tags);
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    /**
     * Return tables matching a set of tag filters. Within a key the match is
     * OR (any value); across keys the match is AND (all keys must match).
     * Body: { catalog, warehouse_id, filters: { key: ["v1","v2"], ... } }
     */
    app.post('/api/catalog/tables-by-tags', async (req: Request, res: Response) => {
      try {
        const body = req.body as {
          catalog?: string;
          warehouse_id?: string;
          filters?: Record<string, string[]>;
        };
        const catalog = body.catalog ?? '';
        const warehouseId = body.warehouse_id ?? '';
        const filters = body.filters ?? {};
        if (!catalog || !warehouseId) {
          res.status(400).json({ error: 'catalog and warehouse_id are required' });
          return;
        }
        const filterEntries = Object.entries(filters).filter(([, vs]) => vs.length > 0);
        if (filterEntries.length === 0) {
          res.json([]);
          return;
        }

        const escapeLit = (s: string) => "'" + s.replace(/'/g, "''") + "'";
        const orClauses = filterEntries
          .map(
            ([key, vals]) =>
              `(tag_name = ${escapeLit(key)} AND tag_value IN (${vals
                .map(escapeLit)
                .join(', ')}))`,
          )
          .join(' OR ');

        const ws = userWorkspaceClient(req);
        const matches = await executeSql(
          ws,
          warehouseId,
          `SELECT schema_name, table_name
           FROM ${catalog}.INFORMATION_SCHEMA.TABLE_TAGS
           WHERE ${orClauses}
           GROUP BY schema_name, table_name
           HAVING COUNT(DISTINCT tag_name) = ${filterEntries.length}
           ORDER BY schema_name, table_name`,
        );

        // Enrich each match with full table info (columns, type, etc.)
        const out: Array<Record<string, unknown>> = [];
        for (const row of matches) {
          const schema = row.schema_name;
          const tableName = row.table_name;
          if (!schema || !tableName) continue;
          const fqn = `${catalog}.${schema}.${tableName}`;
          try {
            const t = await ws.tables.get({ full_name: fqn });
            const columns = (t.columns ?? []).map((col) => ({
              name: col.name ?? '',
              type: col.type_text ?? String(col.type_name ?? ''),
              comment: col.comment ?? '',
            }));
            out.push({
              name: t.name ?? tableName,
              full_name: t.full_name ?? fqn,
              schema_name: schema,
              table_type: t.table_type ?? 'TABLE',
              comment: t.comment ?? '',
              columns,
              column_count: columns.length,
            });
          } catch {
            out.push({
              name: tableName,
              full_name: fqn,
              schema_name: schema,
              table_type: 'TABLE',
              comment: '',
              columns: [],
              column_count: 0,
              error: 'unreadable',
            });
          }
        }
        res.json(out);
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });
  });
}

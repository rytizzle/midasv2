import type { Application, Request, Response } from 'express';
import { userInfo, userWorkspaceClient } from '../lib/user-client';
import { executeSql } from '../lib/sql';

interface AppKit {
  server: { extend(fn: (app: Application) => void): void };
}

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

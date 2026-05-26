import type { Application, Request, Response } from 'express';
import { userWorkspaceClient } from '../lib/user-client';
import { escapeIdent, executeSql, type SQLRow } from '../lib/sql';

interface AppKit {
  server: { extend(fn: (app: Application) => void): void };
}

interface ColumnProfile {
  name: string;
  type: string;
  distinct_count: number;
  null_pct: number;
  sample_values: string[];
}

interface TableProfile {
  table: string;
  row_count: number;
  columns: ColumnProfile[];
  sample_rows: Array<Record<string, string | null>>;
  error?: string;
}

async function profileTable(
  ws: ReturnType<typeof userWorkspaceClient>,
  warehouseId: string,
  fqn: string,
): Promise<TableProfile> {
  const ident = escapeIdent(fqn);

  // Query 1: DESCRIBE TABLE EXTENDED — capture columns until we hit the metadata divider
  const describeRows = await executeSql(ws, warehouseId, `DESCRIBE TABLE EXTENDED ${ident}`);
  const columns: Array<{ name: string; type: string }> = [];
  for (const row of describeRows) {
    const vals = Object.values(row);
    const name = (vals[0] as string | null)?.trim() ?? '';
    const type = (vals[1] as string | null)?.trim() ?? '';
    if (!name || name.startsWith('#')) break;
    columns.push({ name, type });
  }

  if (columns.length === 0) {
    return { table: fqn, row_count: 0, columns: [], sample_rows: [] };
  }

  // Query 2: row_count + per-column distinct + null% + sample values (single scan)
  const parts: string[] = ['COUNT(*) AS `_row_count`'];
  for (const col of columns) {
    const cn = '`' + col.name.replace(/`/g, '``') + '`';
    const safe = col.name;
    parts.push(`COUNT(DISTINCT ${cn}) AS \`distinct_${safe}\``);
    parts.push(
      `ROUND(100.0 * SUM(CASE WHEN ${cn} IS NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS \`null_pct_${safe}\``,
    );
    parts.push(`SLICE(COLLECT_SET(CAST(${cn} AS STRING)), 1, 5) AS \`sample_${safe}\``);
  }
  const statsRows = await executeSql(
    ws,
    warehouseId,
    `SELECT ${parts.join(', ')} FROM ${ident}`,
  );
  const stats: SQLRow = statsRows[0] ?? {};

  const rowCount = Number(stats['_row_count'] ?? 0);
  const columnProfiles: ColumnProfile[] = columns.map((col) => {
    const safe = col.name;
    const rawSamples = stats[`sample_${safe}`];
    let samples: string[] = [];
    if (rawSamples) {
      try {
        const parsed = JSON.parse(rawSamples);
        if (Array.isArray(parsed)) {
          samples = parsed.map((v) => String(v));
        }
      } catch {
        // Some SDK paths may already pass arrays through; ignore parse errors.
        samples = [];
      }
    }
    return {
      name: col.name,
      type: col.type,
      distinct_count: Number(stats[`distinct_${safe}`] ?? 0),
      null_pct: Number(stats[`null_pct_${safe}`] ?? 0),
      sample_values: samples,
    };
  });

  // Query 3: sample rows
  const sampleRows = await executeSql(ws, warehouseId, `SELECT * FROM ${ident} LIMIT 10`);

  return {
    table: fqn,
    row_count: rowCount,
    columns: columnProfiles,
    sample_rows: sampleRows,
  };
}

export function registerProfilingRoutes(appkit: AppKit) {
  appkit.server.extend((app) => {
    app.post('/api/profiling/profile', async (req: Request, res: Response) => {
      try {
        const body = req.body as { tables?: string[]; warehouse_id?: string };
        const tables = body.tables ?? [];
        const warehouseId = body.warehouse_id;
        if (!warehouseId) {
          res.status(400).json({ error: 'warehouse_id is required' });
          return;
        }

        const ws = userWorkspaceClient(req);
        const results: Record<string, TableProfile> = {};
        for (const fqn of tables) {
          try {
            results[fqn] = await profileTable(ws, warehouseId, fqn);
          } catch (e) {
            results[fqn] = {
              table: fqn,
              row_count: 0,
              columns: [],
              sample_rows: [],
              error: String((e as Error).message ?? e),
            };
          }
        }
        res.json(results);
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });
  });
}

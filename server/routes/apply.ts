import type { Application, Request, Response } from 'express';
import { userWorkspaceClient } from '../lib/user-client';
import { escapeIdent, executeSql } from '../lib/sql';

interface AppKit {
  server: { extend(fn: (app: Application) => void): void };
}

interface TableChange {
  table_type?: string;
  table_comment?: string;
  columns?: Record<string, { description?: string }>;
}

interface ApplyRequest {
  changes?: Record<string, TableChange>;
  warehouse_id?: string;
}

interface UndoTableState {
  table_type?: string;
  comment?: string;
  columns?: Record<string, { comment?: string }>;
}

interface UndoRequest {
  previous_state?: Record<string, UndoTableState>;
  warehouse_id?: string;
}

function escapeComment(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeCol(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
}

function isView(tableType: string | undefined): boolean {
  return (tableType ?? 'TABLE').toUpperCase().includes('VIEW');
}

export function registerApplyRoutes(appkit: AppKit) {
  appkit.server.extend((app) => {
    app.post('/api/apply/execute', async (req: Request, res: Response) => {
      const body = req.body as ApplyRequest;
      const changes = body.changes ?? {};
      const warehouseId = body.warehouse_id;
      if (!warehouseId) {
        res.status(400).json({ error: 'warehouse_id is required' });
        return;
      }

      const ws = userWorkspaceClient(req);
      const results: Array<Record<string, unknown>> = [];

      for (const [tableFqn, change] of Object.entries(changes)) {
        const ident = escapeIdent(tableFqn);
        const kind = isView(change.table_type) ? 'VIEW' : 'TABLE';

        if (change.table_comment) {
          const comment = escapeComment(change.table_comment);
          try {
            await executeSql(
              ws,
              warehouseId,
              `COMMENT ON ${kind} ${ident} IS '${comment}'`,
            );
            results.push({ table: tableFqn, type: 'table_comment', status: 'success' });
          } catch (e) {
            results.push({
              table: tableFqn,
              type: 'table_comment',
              status: 'error',
              error: String((e as Error).message ?? e),
            });
          }
        }

        for (const [colName, colData] of Object.entries(change.columns ?? {})) {
          const desc = colData.description ?? '';
          if (!desc) continue;
          const escDesc = escapeComment(desc);
          const stmt =
            kind === 'VIEW'
              ? `COMMENT ON COLUMN ${ident}.${escapeCol(colName)} IS '${escDesc}'`
              : `ALTER TABLE ${ident} ALTER COLUMN ${escapeCol(colName)} COMMENT '${escDesc}'`;
          try {
            await executeSql(ws, warehouseId, stmt);
            results.push({
              table: tableFqn,
              type: 'column_comment',
              column: colName,
              status: 'success',
            });
          } catch (e) {
            results.push({
              table: tableFqn,
              type: 'column_comment',
              column: colName,
              status: 'error',
              error: String((e as Error).message ?? e),
            });
          }
        }
      }

      res.json(results);
    });

    app.post('/api/apply/undo', async (req: Request, res: Response) => {
      const body = req.body as UndoRequest;
      const previous = body.previous_state ?? {};
      const warehouseId = body.warehouse_id;
      if (!warehouseId) {
        res.status(400).json({ error: 'warehouse_id is required' });
        return;
      }
      if (Object.keys(previous).length === 0) {
        res.json({ error: 'No previous state to restore' });
        return;
      }

      const ws = userWorkspaceClient(req);
      const results: Array<Record<string, unknown>> = [];

      for (const [tableFqn, prev] of Object.entries(previous)) {
        const ident = escapeIdent(tableFqn);
        const kind = isView(prev.table_type) ? 'VIEW' : 'TABLE';

        const prevComment = escapeComment(prev.comment ?? '');
        try {
          await executeSql(
            ws,
            warehouseId,
            `COMMENT ON ${kind} ${ident} IS '${prevComment}'`,
          );
          results.push({ table: tableFqn, type: 'table_comment', status: 'restored' });
        } catch (e) {
          results.push({
            table: tableFqn,
            type: 'table_comment',
            status: 'error',
            error: String((e as Error).message ?? e),
          });
        }

        for (const [colName, colMeta] of Object.entries(prev.columns ?? {})) {
          const escDesc = escapeComment(colMeta.comment ?? '');
          const stmt =
            kind === 'VIEW'
              ? `COMMENT ON COLUMN ${ident}.${escapeCol(colName)} IS '${escDesc}'`
              : `ALTER TABLE ${ident} ALTER COLUMN ${escapeCol(colName)} COMMENT '${escDesc}'`;
          try {
            await executeSql(ws, warehouseId, stmt);
            results.push({
              table: tableFqn,
              type: 'column_comment',
              column: colName,
              status: 'restored',
            });
          } catch (e) {
            results.push({
              table: tableFqn,
              type: 'column_comment',
              column: colName,
              status: 'error',
              error: String((e as Error).message ?? e),
            });
          }
        }
      }

      res.json(results);
    });
  });
}

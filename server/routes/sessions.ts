import type { Application, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { query, ensureReady } from '../lib/lakebase';
import { userInfo, userWorkspaceClient } from '../lib/user-client';
import { escapeIdent, executeSql } from '../lib/sql';
import { isWorkspaceAdmin } from '../lib/admin';

interface AppKit {
  server: { extend(fn: (app: Application) => void): void };
}

interface SessionRow {
  session_id: string;
  submitted_by: string;
  submit_comment: string | null;
  status: string;
  reviewed_by: string | null;
  review_comment: string | null;
  warehouse_id: string | null;
  created_at: Date;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  applied_at: Date | null;
}

interface ChangeRow {
  change_id: string;
  session_id: string;
  table_fqn: string;
  table_type: string;
  kind: 'table_comment' | 'column_comment';
  column_name: string | null;
  current_value: string | null;
  proposed_value: string;
  apply_status: string | null;
  apply_error: string | null;
  applied_at: Date | null;
}

interface SubmitChange {
  table_fqn: string;
  table_type?: string;
  kind: 'table_comment' | 'column_comment';
  column_name?: string;
  current_value?: string | null;
  proposed_value: string;
}

interface SubmitRequest {
  warehouse_id?: string;
  submit_comment?: string;
  changes: SubmitChange[];
}

function escComment(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
function escCol(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
}
function isView(tableType: string | undefined): boolean {
  return (tableType ?? 'TABLE').toUpperCase().includes('VIEW');
}

async function getSessionWithChanges(sessionId: string) {
  const s = await query<SessionRow>(
    'SELECT * FROM midas.sessions WHERE session_id = $1',
    [sessionId],
  );
  if (s.rows.length === 0) return null;
  const c = await query<ChangeRow>(
    'SELECT * FROM midas.change_proposals WHERE session_id = $1 ORDER BY table_fqn, kind DESC, column_name',
    [sessionId],
  );
  return { ...s.rows[0], changes: c.rows };
}

export function registerSessionRoutes(appkit: AppKit) {
  // Warm up the schema at startup so the first request isn't slow
  ensureReady().catch((e) => console.error('[sessions] ensureReady failed', e));

  appkit.server.extend((app) => {
    /** Create a pending session with a batch of proposed changes. */
    app.post('/api/sessions', async (req: Request, res: Response) => {
      try {
        const body = req.body as SubmitRequest;
        const changes = body.changes ?? [];
        if (changes.length === 0) {
          res.status(400).json({ error: 'changes is required' });
          return;
        }
        const user = userInfo(req);
        const submittedBy = user.email || 'unknown';
        const sessionId = randomUUID();
        const now = new Date();

        await query(
          `INSERT INTO midas.sessions
            (session_id, submitted_by, submit_comment, status, warehouse_id,
             created_at, submitted_at)
           VALUES ($1, $2, $3, 'pending', $4, $5, $5)`,
          [sessionId, submittedBy, body.submit_comment ?? null, body.warehouse_id ?? null, now],
        );

        for (const c of changes) {
          await query(
            `INSERT INTO midas.change_proposals
              (change_id, session_id, table_fqn, table_type, kind,
               column_name, current_value, proposed_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              randomUUID(),
              sessionId,
              c.table_fqn,
              c.table_type ?? 'TABLE',
              c.kind,
              c.column_name ?? null,
              c.current_value ?? null,
              c.proposed_value,
            ],
          );
        }

        res.json({ session_id: sessionId, status: 'pending' });
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    /**
     * List sessions. Non-admins ALWAYS see only their own (ignoring any
     * `mine` param). Admins can pass `mine=1` to filter to their own
     * submissions, or omit to see everything.
     * `?status=pending` filters by status.
     */
    app.get('/api/sessions', async (req: Request, res: Response) => {
      try {
        const status = typeof req.query.status === 'string' ? req.query.status : null;
        const me = userInfo(req).email;
        const admin = await isWorkspaceAdmin(req);
        const restrictToOwn = !admin || req.query.mine === '1';

        const filters: string[] = [];
        const params: unknown[] = [];
        if (status) {
          params.push(status);
          filters.push(`status = $${params.length}`);
        }
        if (restrictToOwn) {
          params.push(me);
          filters.push(`submitted_by = $${params.length}`);
        }
        const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
        const list = await query<SessionRow & { change_count: string }>(
          `SELECT s.*,
                  (SELECT COUNT(*) FROM midas.change_proposals
                   WHERE session_id = s.session_id) AS change_count
           FROM midas.sessions s
           ${where}
           ORDER BY s.created_at DESC
           LIMIT 200`,
          params,
        );
        res.json(
          list.rows.map((r) => ({
            ...r,
            change_count: Number(r.change_count ?? 0),
          })),
        );
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    /** Caller's identity + admin status. */
    app.get('/api/me/role', async (req: Request, res: Response) => {
      try {
        const u = userInfo(req);
        const admin = await isWorkspaceAdmin(req);
        res.json({ email: u.email, name: u.name, is_admin: admin });
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    /** Get one session with all its proposed changes. */
    app.get('/api/sessions/:id', async (req: Request, res: Response) => {
      try {
        const id = String(req.params.id);
        const session = await getSessionWithChanges(id);
        if (!session) {
          res.status(404).json({ error: 'not found' });
          return;
        }
        const me = userInfo(req).email;
        const admin = await isWorkspaceAdmin(req);
        if (!admin && session.submitted_by !== me) {
          // Don't leak the existence of other people's sessions.
          res.status(404).json({ error: 'not found' });
          return;
        }
        res.json(session);
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    /** Approve a pending session: apply changes to UC, record results. ADMIN ONLY. */
    app.post('/api/sessions/:id/approve', async (req: Request, res: Response) => {
      const id = String(req.params.id);
      try {
        if (!(await isWorkspaceAdmin(req))) {
          res.status(403).json({ error: 'workspace admin required to approve' });
          return;
        }
        const body = req.body as { review_comment?: string; warehouse_id?: string };
        const session = await getSessionWithChanges(id);
        if (!session) {
          res.status(404).json({ error: 'not found' });
          return;
        }
        if (session.status !== 'pending') {
          res.status(400).json({ error: `cannot approve from status ${session.status}` });
          return;
        }
        const warehouseId = body.warehouse_id || session.warehouse_id;
        if (!warehouseId) {
          res.status(400).json({ error: 'warehouse_id is required' });
          return;
        }

        const ws = userWorkspaceClient(req);
        const reviewer = userInfo(req).email;
        const now = new Date();

        for (const change of session.changes) {
          const ident = escapeIdent(change.table_fqn);
          const kind = isView(change.table_type) ? 'VIEW' : 'TABLE';
          const value = escComment(change.proposed_value);
          let stmt: string;
          if (change.kind === 'table_comment') {
            stmt = `COMMENT ON ${kind} ${ident} IS '${value}'`;
          } else if (change.kind === 'column_comment' && change.column_name) {
            const col = escCol(change.column_name);
            stmt =
              kind === 'VIEW'
                ? `COMMENT ON COLUMN ${ident}.${col} IS '${value}'`
                : `ALTER TABLE ${ident} ALTER COLUMN ${col} COMMENT '${value}'`;
          } else {
            await query(
              `UPDATE midas.change_proposals
                 SET apply_status = 'error', apply_error = $1, applied_at = $2
               WHERE change_id = $3`,
              ['skipped — invalid change shape', now, change.change_id],
            );
            continue;
          }
          try {
            await executeSql(ws, warehouseId, stmt);
            await query(
              `UPDATE midas.change_proposals
                 SET apply_status = 'success', apply_error = NULL, applied_at = $1
               WHERE change_id = $2`,
              [now, change.change_id],
            );
          } catch (e) {
            await query(
              `UPDATE midas.change_proposals
                 SET apply_status = 'error', apply_error = $1, applied_at = $2
               WHERE change_id = $3`,
              [String((e as Error).message ?? e).slice(0, 1000), now, change.change_id],
            );
          }
        }

        // Determine overall outcome: if any change failed, mark session
        // status='applied_partial', else 'approved'. Either way we record
        // reviewer + applied_at.
        const after = await query<{ failed: string }>(
          `SELECT COUNT(*)::text AS failed
             FROM midas.change_proposals
            WHERE session_id = $1 AND apply_status = 'error'`,
          [id],
        );
        const failedCount = Number(after.rows[0]?.failed ?? 0);
        const finalStatus = failedCount > 0 ? 'applied_partial' : 'approved';

        await query(
          `UPDATE midas.sessions
              SET status = $1,
                  reviewed_by = $2,
                  review_comment = $3,
                  reviewed_at = $4,
                  applied_at = $4
            WHERE session_id = $5`,
          [finalStatus, reviewer, body.review_comment ?? null, now, id],
        );

        const updated = await getSessionWithChanges(id);
        res.json(updated);
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    /** Reject a pending session. ADMIN ONLY. */
    app.post('/api/sessions/:id/reject', async (req: Request, res: Response) => {
      try {
        if (!(await isWorkspaceAdmin(req))) {
          res.status(403).json({ error: 'workspace admin required to reject' });
          return;
        }
        const id = String(req.params.id);
        const body = req.body as { review_comment?: string };
        const reviewer = userInfo(req).email;
        const now = new Date();
        const r = await query(
          `UPDATE midas.sessions
              SET status = 'rejected', reviewed_by = $1,
                  review_comment = $2, reviewed_at = $3
            WHERE session_id = $4 AND status = 'pending'
           RETURNING session_id`,
          [reviewer, body.review_comment ?? null, now, id],
        );
        if (r.rowCount === 0) {
          res.status(400).json({ error: 'session not pending or not found' });
          return;
        }
        const updated = await getSessionWithChanges(id);
        res.json(updated);
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    /** Resubmit a previously rejected session (owner only). */
    app.post('/api/sessions/:id/resubmit', async (req: Request, res: Response) => {
      try {
        const id = String(req.params.id);
        const me = userInfo(req).email;
        const now = new Date();
        const r = await query(
          `UPDATE midas.sessions
              SET status = 'pending', reviewed_by = NULL,
                  review_comment = NULL, reviewed_at = NULL,
                  submitted_at = $1
            WHERE session_id = $2 AND status = 'rejected'
              AND submitted_by = $3
           RETURNING session_id`,
          [now, id, me],
        );
        if (r.rowCount === 0) {
          res.status(403).json({ error: 'cannot resubmit (not the submitter or not rejected)' });
          return;
        }
        const updated = await getSessionWithChanges(id);
        res.json(updated);
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    /** Update a proposed value on a rejected session before resubmit (owner only). */
    app.patch('/api/sessions/:id/changes/:changeId', async (req: Request, res: Response) => {
      try {
        const id = String(req.params.id);
        const changeId = String(req.params.changeId);
        const me = userInfo(req).email;
        const body = req.body as { proposed_value?: string };
        if (typeof body.proposed_value !== 'string') {
          res.status(400).json({ error: 'proposed_value is required' });
          return;
        }
        const r = await query(
          `UPDATE midas.change_proposals
              SET proposed_value = $1, apply_status = NULL, apply_error = NULL,
                  applied_at = NULL
            WHERE change_id = $2 AND session_id = $3
              AND EXISTS (
                SELECT 1 FROM midas.sessions
                 WHERE session_id = $3
                   AND status = 'rejected'
                   AND submitted_by = $4
              )
           RETURNING change_id`,
          [body.proposed_value, changeId, id, me],
        );
        if (r.rowCount === 0) {
          res.status(403).json({ error: 'change not editable (must own a rejected session)' });
          return;
        }
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    /** Discard a session (only own pending or rejected). */
    app.delete('/api/sessions/:id', async (req: Request, res: Response) => {
      try {
        const id = String(req.params.id);
        const me = userInfo(req).email;
        const r = await query(
          `DELETE FROM midas.sessions
            WHERE session_id = $1 AND submitted_by = $2
              AND status IN ('pending','rejected')
           RETURNING session_id`,
          [id, me],
        );
        if (r.rowCount === 0) {
          res.status(400).json({ error: 'session not deletable' });
          return;
        }
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });
  });
}

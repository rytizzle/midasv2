/**
 * Lakebase Postgres connection layer with OAuth token refresh.
 *
 * Strategy:
 *  - Read PGHOST/PGPORT/PGDATABASE from env (injected by Databricks Apps
 *    runtime when the lakebase-db resource is attached). Locally, fall back
 *    to env or SDK lookup.
 *  - Generate a fresh OAuth token per pg pool connection (1-hour expiry,
 *    recycled before then via pool maxLifetimeSeconds).
 *  - On first use, ensure database app_db + schema midas + required tables
 *    exist. Connect to default "postgres" db first to CREATE DATABASE if
 *    needed.
 */

import pg from 'pg';
import { WorkspaceClient } from '@databricks/sdk-experimental';
import { randomUUID } from 'node:crypto';

const INSTANCE_NAME = process.env.LAKEBASE_INSTANCE_NAME || 'midasv2-lakebase';
const TARGET_DB = process.env.PGDATABASE || 'app_db';

let cachedConnInfo: { host: string; port: number; user: string } | null = null;
let appDbPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

async function resolveConnectionInfo(): Promise<{ host: string; port: number; user: string }> {
  if (cachedConnInfo) return cachedConnInfo;
  const port = Number(process.env.PGPORT || 5432);
  let host = process.env.PGHOST || '';
  let user = process.env.PGUSER || '';

  if (!host || !user) {
    const ws = new WorkspaceClient({});
    if (!host) {
      const inst = await ws.database.getDatabaseInstance({ name: INSTANCE_NAME });
      host = inst.read_write_dns || '';
      if (!host) throw new Error(`Lakebase ${INSTANCE_NAME} has no read_write_dns`);
    }
    if (!user) {
      user = (await ws.currentUser.me()).userName || '';
      if (!user) throw new Error('Could not resolve PG user');
    }
  }

  cachedConnInfo = { host, port, user };
  return cachedConnInfo;
}

async function generateToken(): Promise<string> {
  const ws = new WorkspaceClient({});
  const cred = await ws.database.generateDatabaseCredential({
    request_id: randomUUID(),
    instance_names: [INSTANCE_NAME],
  });
  if (!cred.token) throw new Error('No token returned from generateDatabaseCredential');
  return cred.token;
}

function buildPool(database: string): pg.Pool {
  const pool = new pg.Pool({
    database,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    // Recycle connections well before the 1-hour OAuth token expires
    maxLifetimeSeconds: 2700,
  } as pg.PoolConfig);

  // Inject host/port/user/password right before each connect
  pool.on('connect', () => {});
  (pool as unknown as { options: pg.PoolConfig }).options = {
    ...(pool as unknown as { options: pg.PoolConfig }).options,
  };

  // Override the password fetcher by intercepting pool.connect via Proxy
  // (pg supports a password function in PoolConfig that returns a Promise<string>).
  // Reassign with proper signature below.
  return pool;
}

async function createPool(database: string): Promise<pg.Pool> {
  const { host, port, user } = await resolveConnectionInfo();
  const pool = new pg.Pool({
    host,
    port,
    user,
    database,
    // pg accepts password as () => Promise<string>; called per new connection.
    password: () => generateToken(),
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    maxLifetimeSeconds: 2700,
  } as pg.PoolConfig);
  return pool;
}

async function ensureDatabaseExists(): Promise<void> {
  // Connect to default `postgres` db to check/create the target DB.
  const adminPool = await createPool('postgres');
  try {
    const { rows } = await adminPool.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [TARGET_DB],
    );
    if (!rows[0]?.exists) {
      // CREATE DATABASE cannot run in a transaction, and identifiers cannot be
      // parameterized; quote it carefully.
      const safe = TARGET_DB.replace(/"/g, '""');
      await adminPool.query(`CREATE DATABASE "${safe}"`);
      console.log(`[lakebase] created database ${TARGET_DB}`);
    }
  } finally {
    await adminPool.end();
  }
}

async function ensureSchema(): Promise<void> {
  const pool = await getPool();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS midas`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS midas.sessions (
      session_id      uuid PRIMARY KEY,
      submitted_by    text NOT NULL,
      submit_comment  text,
      status          text NOT NULL DEFAULT 'pending',
      reviewed_by     text,
      review_comment  text,
      warehouse_id    text,
      created_at      timestamptz NOT NULL DEFAULT now(),
      submitted_at    timestamptz,
      reviewed_at     timestamptz,
      applied_at      timestamptz
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS sessions_status_idx ON midas.sessions(status);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS sessions_submitted_by_idx ON midas.sessions(submitted_by);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS midas.change_proposals (
      change_id       uuid PRIMARY KEY,
      session_id      uuid NOT NULL REFERENCES midas.sessions(session_id) ON DELETE CASCADE,
      table_fqn       text NOT NULL,
      table_type      text NOT NULL DEFAULT 'TABLE',
      kind            text NOT NULL,                 -- 'table_comment' | 'column_comment'
      column_name     text,                          -- null when kind = table_comment
      current_value   text,
      proposed_value  text NOT NULL,
      apply_status    text,                          -- null | 'success' | 'error'
      apply_error     text,
      applied_at      timestamptz
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS change_proposals_session_idx
      ON midas.change_proposals(session_id);
  `);
  // v2: per-change decision (approved | rejected | null)
  await pool.query(`
    ALTER TABLE midas.change_proposals
      ADD COLUMN IF NOT EXISTS decision text;
  `);
  // Backfill so existing sessions surface meaningfully in the new UI.
  await pool.query(`
    UPDATE midas.change_proposals c
       SET decision = 'approved'
      FROM midas.sessions s
     WHERE c.session_id = s.session_id
       AND c.decision IS NULL
       AND s.status IN ('approved', 'applied_partial');
  `);
  await pool.query(`
    UPDATE midas.change_proposals c
       SET decision = 'rejected'
      FROM midas.sessions s
     WHERE c.session_id = s.session_id
       AND c.decision IS NULL
       AND s.status = 'rejected';
  `);
}

export async function getPool(): Promise<pg.Pool> {
  if (!appDbPool) {
    await ensureDatabaseExists();
    appDbPool = await createPool(TARGET_DB);
    appDbPool.on('error', (err) => {
      console.error('[lakebase] pool error', err);
    });
  }
  return appDbPool;
}

export async function ensureReady(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      // Touch the pool (creates the DB if needed)
      await getPool();
      await ensureSchema();
      console.log('[lakebase] schema ready');
    })();
  }
  return schemaReady;
}

export async function query<T = unknown>(
  sql: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number }> {
  await ensureReady();
  const pool = await getPool();
  const res = await pool.query(sql, params as unknown[]);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}

export { buildPool };

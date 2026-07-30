import { WorkspaceClient } from "@databricks/sdk-experimental";
import { randomUUID } from "node:crypto";
import pg from "pg";

//#region server/lib/lakebase.ts
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
const INSTANCE_NAME = process.env.LAKEBASE_INSTANCE_NAME || "midasv2-lakebase";
const TARGET_DB = process.env.PGDATABASE || "app_db";
let cachedConnInfo = null;
let appDbPool = null;
let schemaReady = null;
async function resolveConnectionInfo() {
	if (cachedConnInfo) return cachedConnInfo;
	const port = Number(process.env.PGPORT || 5432);
	let host = process.env.PGHOST || "";
	let user = process.env.PGUSER || "";
	if (!host || !user) {
		const ws = new WorkspaceClient({});
		if (!host) {
			host = (await ws.database.getDatabaseInstance({ name: INSTANCE_NAME })).read_write_dns || "";
			if (!host) throw new Error(`Lakebase ${INSTANCE_NAME} has no read_write_dns`);
		}
		if (!user) {
			user = (await ws.currentUser.me()).userName || "";
			if (!user) throw new Error("Could not resolve PG user");
		}
	}
	cachedConnInfo = {
		host,
		port,
		user
	};
	return cachedConnInfo;
}
async function generateToken() {
	const cred = await new WorkspaceClient({}).database.generateDatabaseCredential({
		request_id: randomUUID(),
		instance_names: [INSTANCE_NAME]
	});
	if (!cred.token) throw new Error("No token returned from generateDatabaseCredential");
	return cred.token;
}
async function createPool(database) {
	const { host, port, user } = await resolveConnectionInfo();
	return new pg.Pool({
		host,
		port,
		user,
		database,
		password: () => generateToken(),
		ssl: { rejectUnauthorized: false },
		max: 5,
		idleTimeoutMillis: 3e4,
		maxLifetimeSeconds: 2700
	});
}
async function ensureDatabaseExists() {
	const adminPool = await createPool("postgres");
	try {
		const { rows } = await adminPool.query("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists", [TARGET_DB]);
		if (!rows[0]?.exists) {
			const safe = TARGET_DB.replace(/"/g, "\"\"");
			await adminPool.query(`CREATE DATABASE "${safe}"`);
			console.log(`[lakebase] created database ${TARGET_DB}`);
		}
	} finally {
		await adminPool.end();
	}
}
async function ensureSchema() {
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
	await pool.query(`
    ALTER TABLE midas.change_proposals
      ADD COLUMN IF NOT EXISTS decision text;
  `);
	await pool.query(`
    ALTER TABLE midas.change_proposals
      ADD COLUMN IF NOT EXISTS owner_group text;
  `);
	await pool.query(`
    CREATE INDEX IF NOT EXISTS change_proposals_owner_group_idx
      ON midas.change_proposals(owner_group);
  `);
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
async function getPool() {
	if (!appDbPool) {
		await ensureDatabaseExists();
		appDbPool = await createPool(TARGET_DB);
		appDbPool.on("error", (err) => {
			console.error("[lakebase] pool error", err);
		});
	}
	return appDbPool;
}
async function ensureReady() {
	if (!schemaReady) schemaReady = (async () => {
		await getPool();
		await ensureSchema();
		console.log("[lakebase] schema ready");
	})();
	return schemaReady;
}
async function query(sql, params) {
	await ensureReady();
	const res = await (await getPool()).query(sql, params);
	return {
		rows: res.rows,
		rowCount: res.rowCount ?? 0
	};
}

//#endregion
export { ensureReady, query };
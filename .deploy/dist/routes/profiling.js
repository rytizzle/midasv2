import { userWorkspaceClient } from "../lib/user-client.js";
import { escapeIdent, executeSql } from "../lib/sql.js";

//#region server/routes/profiling.ts
async function profileTable(ws, warehouseId, fqn) {
	const ident = escapeIdent(fqn);
	const describeRows = await executeSql(ws, warehouseId, `DESCRIBE TABLE EXTENDED ${ident}`);
	const columns = [];
	for (const row of describeRows) {
		const vals = Object.values(row);
		const name = vals[0]?.trim() ?? "";
		const type = vals[1]?.trim() ?? "";
		if (!name || name.startsWith("#")) break;
		columns.push({
			name,
			type
		});
	}
	if (columns.length === 0) return {
		table: fqn,
		row_count: 0,
		columns: [],
		sample_rows: []
	};
	const parts = ["COUNT(*) AS `_row_count`"];
	for (const col of columns) {
		const cn = "`" + col.name.replace(/`/g, "``") + "`";
		const safe = col.name;
		parts.push(`COUNT(DISTINCT ${cn}) AS \`distinct_${safe}\``);
		parts.push(`ROUND(100.0 * SUM(CASE WHEN ${cn} IS NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS \`null_pct_${safe}\``);
		parts.push(`SLICE(COLLECT_SET(CAST(${cn} AS STRING)), 1, 5) AS \`sample_${safe}\``);
	}
	const stats = (await executeSql(ws, warehouseId, `SELECT ${parts.join(", ")} FROM ${ident}`))[0] ?? {};
	return {
		table: fqn,
		row_count: Number(stats["_row_count"] ?? 0),
		columns: columns.map((col) => {
			const safe = col.name;
			const rawSamples = stats[`sample_${safe}`];
			let samples = [];
			if (rawSamples) try {
				const parsed = JSON.parse(rawSamples);
				if (Array.isArray(parsed)) samples = parsed.map((v) => String(v));
			} catch {
				samples = [];
			}
			return {
				name: col.name,
				type: col.type,
				distinct_count: Number(stats[`distinct_${safe}`] ?? 0),
				null_pct: Number(stats[`null_pct_${safe}`] ?? 0),
				sample_values: samples
			};
		}),
		sample_rows: await executeSql(ws, warehouseId, `SELECT * FROM ${ident} LIMIT 10`)
	};
}
function registerProfilingRoutes(appkit) {
	appkit.server.extend((app) => {
		app.post("/api/profiling/profile", async (req, res) => {
			try {
				const body = req.body;
				const tables = body.tables ?? [];
				const warehouseId = body.warehouse_id;
				if (!warehouseId) {
					res.status(400).json({ error: "warehouse_id is required" });
					return;
				}
				const ws = userWorkspaceClient(req);
				const results = {};
				for (const fqn of tables) try {
					results[fqn] = await profileTable(ws, warehouseId, fqn);
				} catch (e) {
					results[fqn] = {
						table: fqn,
						row_count: 0,
						columns: [],
						sample_rows: [],
						error: String(e.message ?? e)
					};
				}
				res.json(results);
			} catch (err) {
				res.status(500).json({ error: String(err.message ?? err) });
			}
		});
	});
}

//#endregion
export { registerProfilingRoutes };
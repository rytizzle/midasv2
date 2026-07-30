import { userWorkspaceClient } from "../lib/user-client.js";
import { escapeIdent, executeSql } from "../lib/sql.js";

//#region server/routes/apply.ts
function escapeComment(text) {
	return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
function escapeCol(name) {
	return "`" + name.replace(/`/g, "``") + "`";
}
function isView(tableType) {
	return (tableType ?? "TABLE").toUpperCase().includes("VIEW");
}
function registerApplyRoutes(appkit) {
	appkit.server.extend((app) => {
		app.post("/api/apply/execute", async (req, res) => {
			const body = req.body;
			const changes = body.changes ?? {};
			const warehouseId = body.warehouse_id;
			if (!warehouseId) {
				res.status(400).json({ error: "warehouse_id is required" });
				return;
			}
			const ws = userWorkspaceClient(req);
			const results = [];
			for (const [tableFqn, change] of Object.entries(changes)) {
				const ident = escapeIdent(tableFqn);
				const kind = isView(change.table_type) ? "VIEW" : "TABLE";
				if (change.table_comment) {
					const comment = escapeComment(change.table_comment);
					try {
						await executeSql(ws, warehouseId, `COMMENT ON ${kind} ${ident} IS '${comment}'`);
						results.push({
							table: tableFqn,
							type: "table_comment",
							status: "success"
						});
					} catch (e) {
						results.push({
							table: tableFqn,
							type: "table_comment",
							status: "error",
							error: String(e.message ?? e)
						});
					}
				}
				for (const [colName, colData] of Object.entries(change.columns ?? {})) {
					const desc = colData.description ?? "";
					if (!desc) continue;
					const escDesc = escapeComment(desc);
					const stmt = kind === "VIEW" ? `COMMENT ON COLUMN ${ident}.${escapeCol(colName)} IS '${escDesc}'` : `ALTER TABLE ${ident} ALTER COLUMN ${escapeCol(colName)} COMMENT '${escDesc}'`;
					try {
						await executeSql(ws, warehouseId, stmt);
						results.push({
							table: tableFqn,
							type: "column_comment",
							column: colName,
							status: "success"
						});
					} catch (e) {
						results.push({
							table: tableFqn,
							type: "column_comment",
							column: colName,
							status: "error",
							error: String(e.message ?? e)
						});
					}
				}
			}
			res.json(results);
		});
		app.post("/api/apply/undo", async (req, res) => {
			const body = req.body;
			const previous = body.previous_state ?? {};
			const warehouseId = body.warehouse_id;
			if (!warehouseId) {
				res.status(400).json({ error: "warehouse_id is required" });
				return;
			}
			if (Object.keys(previous).length === 0) {
				res.json({ error: "No previous state to restore" });
				return;
			}
			const ws = userWorkspaceClient(req);
			const results = [];
			for (const [tableFqn, prev] of Object.entries(previous)) {
				const ident = escapeIdent(tableFqn);
				const kind = isView(prev.table_type) ? "VIEW" : "TABLE";
				const prevComment = escapeComment(prev.comment ?? "");
				try {
					await executeSql(ws, warehouseId, `COMMENT ON ${kind} ${ident} IS '${prevComment}'`);
					results.push({
						table: tableFqn,
						type: "table_comment",
						status: "restored"
					});
				} catch (e) {
					results.push({
						table: tableFqn,
						type: "table_comment",
						status: "error",
						error: String(e.message ?? e)
					});
				}
				for (const [colName, colMeta] of Object.entries(prev.columns ?? {})) {
					const escDesc = escapeComment(colMeta.comment ?? "");
					const stmt = kind === "VIEW" ? `COMMENT ON COLUMN ${ident}.${escapeCol(colName)} IS '${escDesc}'` : `ALTER TABLE ${ident} ALTER COLUMN ${escapeCol(colName)} COMMENT '${escDesc}'`;
					try {
						await executeSql(ws, warehouseId, stmt);
						results.push({
							table: tableFqn,
							type: "column_comment",
							column: colName,
							status: "restored"
						});
					} catch (e) {
						results.push({
							table: tableFqn,
							type: "column_comment",
							column: colName,
							status: "error",
							error: String(e.message ?? e)
						});
					}
				}
			}
			res.json(results);
		});
	});
}

//#endregion
export { registerApplyRoutes };
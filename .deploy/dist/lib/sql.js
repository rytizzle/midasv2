//#region server/lib/sql.ts
/**
* Execute a SQL statement against a warehouse and return rows as
* `{ columnName: stringValue | null }` objects. Polls until completion.
*/
async function executeSql(ws, warehouseId, statement) {
	let resp = await ws.statementExecution.executeStatement({
		statement,
		warehouse_id: warehouseId,
		wait_timeout: "50s",
		disposition: "INLINE",
		format: "JSON_ARRAY",
		on_wait_timeout: "CONTINUE"
	});
	while (resp.statement_id && resp.status?.state && ![
		"SUCCEEDED",
		"FAILED",
		"CANCELED",
		"CLOSED"
	].includes(resp.status.state)) {
		await new Promise((r) => setTimeout(r, 1e3));
		resp = await ws.statementExecution.getStatement({ statement_id: resp.statement_id });
	}
	if (resp.status?.state !== "SUCCEEDED") {
		const msg = resp.status?.error?.message ?? `Statement ended in ${resp.status?.state}`;
		throw new Error(msg);
	}
	const columns = (resp.manifest?.schema?.columns ?? []).map((c) => c.name ?? "");
	return (resp.result?.data_array ?? []).map((row) => {
		const obj = {};
		columns.forEach((col, i) => {
			obj[col] = row[i] ?? null;
		});
		return obj;
	});
}
function escapeIdent(name) {
	return name.split(".").map((part) => "`" + part.replace(/`/g, "``") + "`").join(".");
}

//#endregion
export { escapeIdent, executeSql };
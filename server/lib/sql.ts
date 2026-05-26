import type { WorkspaceClient } from '@databricks/sdk-experimental';

export interface SQLRow {
  [column: string]: string | null;
}

/**
 * Execute a SQL statement against a warehouse and return rows as
 * `{ columnName: stringValue | null }` objects. Polls until completion.
 */
export async function executeSql(
  ws: WorkspaceClient,
  warehouseId: string,
  statement: string,
): Promise<SQLRow[]> {
  let resp = await ws.statementExecution.executeStatement({
    statement,
    warehouse_id: warehouseId,
    wait_timeout: '50s',
    disposition: 'INLINE',
    format: 'JSON_ARRAY',
    on_wait_timeout: 'CONTINUE',
  });

  while (
    resp.statement_id &&
    resp.status?.state &&
    !['SUCCEEDED', 'FAILED', 'CANCELED', 'CLOSED'].includes(resp.status.state)
  ) {
    await new Promise((r) => setTimeout(r, 1000));
    resp = await ws.statementExecution.getStatement({ statement_id: resp.statement_id });
  }

  if (resp.status?.state !== 'SUCCEEDED') {
    const msg = resp.status?.error?.message ?? `Statement ended in ${resp.status?.state}`;
    throw new Error(msg);
  }

  const columns = (resp.manifest?.schema?.columns ?? []).map((c) => c.name ?? '');
  const rows = resp.result?.data_array ?? [];
  return rows.map((row) => {
    const obj: SQLRow = {};
    columns.forEach((col, i) => {
      obj[col] = row[i] ?? null;
    });
    return obj;
  });
}

export function escapeIdent(name: string): string {
  return name
    .split('.')
    .map((part) => '`' + part.replace(/`/g, '``') + '`')
    .join('.');
}

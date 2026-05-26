export interface UserInfo {
  email: string;
  name: string;
}

export interface Warehouse {
  id: string;
  name: string;
  state: string;
  size: string;
}

export interface Catalog {
  name: string;
  comment: string;
}

export interface Schema {
  name: string;
  comment: string;
}

export interface Column {
  name: string;
  type: string;
  comment: string;
}

export interface Table {
  name: string;
  full_name: string;
  table_type: string;
  comment: string;
  columns: Column[];
  column_count: number;
}

export interface ColumnProfile {
  name: string;
  type: string;
  distinct_count: number;
  null_pct: number;
  sample_values: string[];
}

export interface TableProfile {
  table: string;
  row_count: number;
  columns: ColumnProfile[];
  sample_rows: Array<Record<string, string | null>>;
  error?: string;
}

export interface GeneratedMetadata {
  table_comment?: string;
  columns?: Record<string, { description: string }>;
  error?: string;
}

export interface GenerationContext {
  blurb: string;
  docs: string;
  tableTemplate: string;
  columnTemplate: string;
}

async function getJSON<T>(path: string): Promise<T> {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return (await resp.json()) as T;
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status} ${resp.statusText}: ${text}`);
  }
  return (await resp.json()) as T;
}

export const api = {
  getMe: () => getJSON<UserInfo>('/api/catalog/me'),
  getWarehouses: () => getJSON<Warehouse[]>('/api/catalog/warehouses'),
  getCatalogs: () => getJSON<Catalog[]>('/api/catalog/catalogs'),
  getSchemas: (catalog: string) =>
    getJSON<Schema[]>(`/api/catalog/schemas?catalog=${encodeURIComponent(catalog)}`),
  getTables: (catalog: string, schema: string) =>
    getJSON<Table[]>(
      `/api/catalog/tables?catalog=${encodeURIComponent(catalog)}&schema=${encodeURIComponent(schema)}`,
    ),
  profile: (tables: string[], warehouseId: string) =>
    postJSON<Record<string, TableProfile>>('/api/profiling/profile', {
      tables,
      warehouse_id: warehouseId,
    }),
  generate: (tables: Record<string, TableProfile>, context: GenerationContext) =>
    postJSON<Record<string, GeneratedMetadata>>('/api/metadata/generate', {
      tables,
      context,
    }),
  apply: (
    changes: Record<string, { table_type?: string; table_comment?: string; columns?: Record<string, { description: string }> }>,
    warehouseId: string,
  ) => postJSON<Array<Record<string, unknown>>>('/api/apply/execute', { changes, warehouse_id: warehouseId }),
};

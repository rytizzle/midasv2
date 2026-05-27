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

export type TagMap = Record<string, Array<{ value: string; count: number }>>;

export type SessionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'partial'
  | 'applied_partial';

export interface SubmitChange {
  table_fqn: string;
  table_type?: string;
  kind: 'table_comment' | 'column_comment';
  column_name?: string;
  current_value?: string | null;
  proposed_value: string;
}

export interface SessionSummary {
  session_id: string;
  submitted_by: string;
  submit_comment: string | null;
  status: SessionStatus;
  reviewed_by: string | null;
  review_comment: string | null;
  warehouse_id: string | null;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  applied_at: string | null;
  change_count: number;
}

export interface ProposalChange {
  change_id: string;
  session_id: string;
  table_fqn: string;
  table_type: string;
  kind: 'table_comment' | 'column_comment';
  column_name: string | null;
  current_value: string | null;
  proposed_value: string;
  decision: 'approved' | 'rejected' | null;
  apply_status: 'success' | 'error' | null;
  apply_error: string | null;
  applied_at: string | null;
}

export interface SessionDetail extends Omit<SessionSummary, 'change_count'> {
  changes: ProposalChange[];
}

export interface MeRole {
  email: string;
  name: string;
  is_admin: boolean;
}

export const api = {
  getMe: () => getJSON<UserInfo>('/api/catalog/me'),
  getMyRole: () => getJSON<MeRole>('/api/me/role'),
  getWarehouses: () => getJSON<Warehouse[]>('/api/catalog/warehouses'),
  getCatalogs: () => getJSON<Catalog[]>('/api/catalog/catalogs'),
  getSchemas: (catalog: string) =>
    getJSON<Schema[]>(`/api/catalog/schemas?catalog=${encodeURIComponent(catalog)}`),
  getTables: (catalog: string, schema: string) =>
    getJSON<Table[]>(
      `/api/catalog/tables?catalog=${encodeURIComponent(catalog)}&schema=${encodeURIComponent(schema)}`,
    ),
  getTags: (catalog: string, warehouseId: string) =>
    getJSON<TagMap>(
      `/api/catalog/tags?catalog=${encodeURIComponent(catalog)}&warehouse_id=${encodeURIComponent(warehouseId)}`,
    ),
  getTablesByTags: (catalog: string, warehouseId: string, filters: Record<string, string[]>) =>
    postJSON<Table[]>('/api/catalog/tables-by-tags', {
      catalog,
      warehouse_id: warehouseId,
      filters,
    }),
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

  // Sessions / approvals
  submitSession: (warehouseId: string, submitComment: string, changes: SubmitChange[]) =>
    postJSON<{ session_id: string; status: SessionStatus }>('/api/sessions', {
      warehouse_id: warehouseId,
      submit_comment: submitComment,
      changes,
    }),
  listSessions: (opts: { mine?: boolean; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.mine) q.set('mine', '1');
    if (opts.status) q.set('status', opts.status);
    const qs = q.toString();
    return getJSON<SessionSummary[]>(`/api/sessions${qs ? `?${qs}` : ''}`);
  },
  getSession: (id: string) => getJSON<SessionDetail>(`/api/sessions/${id}`),
  decideSession: (
    id: string,
    args: {
      approve_ids: string[];
      reject_ids: string[];
      warehouse_id: string;
      review_comment?: string;
    },
  ) => postJSON<SessionDetail>(`/api/sessions/${id}/decide`, args),
  resubmitSession: (id: string) => postJSON<SessionDetail>(`/api/sessions/${id}/resubmit`, {}),
  updateChange: (sessionId: string, changeId: string, proposedValue: string) =>
    fetch(`/api/sessions/${sessionId}/changes/${changeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposed_value: proposedValue }),
    }).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    }),
  discardSession: (id: string) =>
    fetch(`/api/sessions/${id}`, { method: 'DELETE' }).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    }),
};

import { useEffect, useState } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@databricks/appkit-ui/react';
import {
  api,
  type GeneratedMetadata,
  type ProposalChange,
  type SessionDetail,
  type SessionSummary,
  type Table,
  type TableProfile,
  type TagMap,
  type Warehouse,
} from './lib/api';

const STEPS = ['Tables', 'Context', 'Profile & Generate', 'Review & Apply'] as const;

const DEFAULT_TABLE_TEMPLATE = [
  'General Description: what this table contains and its primary purpose.',
  'Business Value: who uses this data and what decisions or workflows it supports.',
  'Key Relationships: tables it joins to and the join keys.',
  'Filters & Segments: common ways users filter or group this data.',
].join('\n');

const DEFAULT_COLUMN_TEMPLATE =
  "1-2 sentences: business definition, then typical values or categories. Example: 'Total hours logged. Common values: 1, 2, 4, 8 hours.'";

type AppView = 'wizard' | 'sessions';

export default function App() {
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [view, setView] = useState<AppView>('wizard');
  const [step, setStep] = useState(0);
  const [selectedTables, setSelectedTables] = useState<Table[]>([]);
  const [context, setContext] = useState({
    blurb: '',
    docs: '',
    tableTemplate: DEFAULT_TABLE_TEMPLATE,
    columnTemplate: DEFAULT_COLUMN_TEMPLATE,
  });
  const [profiles, setProfiles] = useState<Record<string, TableProfile> | null>(null);
  const [metadata, setMetadata] = useState<Record<string, GeneratedMetadata> | null>(null);

  useEffect(() => {
    api.getMe().then(setUser).catch(() => setUser({ email: '', name: '' }));
  }, []);

  useEffect(() => {
    const fetchWh = () =>
      api
        .getWarehouses()
        .then((whs) => {
          setWarehouses(whs);
          setWarehouseId((prev) => {
            if (prev && whs.some((w) => w.id === prev)) return prev;
            const running = whs.find((w) => w.state === 'RUNNING');
            return running?.id ?? whs[0]?.id ?? '';
          });
        })
        .catch(() => undefined);
    fetchWh();
    const t = setInterval(fetchWh, 30_000);
    return () => clearInterval(t);
  }, []);

  const resetWizard = () => {
    setStep(0);
    setSelectedTables([]);
    setProfiles(null);
    setMetadata(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Midas v2</h1>
            <p className="text-xs text-muted-foreground">AI Metadata Generator · AppKit</p>
          </div>
          <nav className="flex gap-1">
            <button
              type="button"
              onClick={() => setView('wizard')}
              className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
                view === 'wizard'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              New submission
            </button>
            <button
              type="button"
              onClick={() => setView('sessions')}
              className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
                view === 'sessions'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Sessions
            </button>
          </nav>
          <div className="flex items-center gap-3">
            <WarehousePicker
              warehouses={warehouses}
              value={warehouseId}
              onChange={setWarehouseId}
            />
            {user && (
              <Badge variant="secondary" className="text-xs">
                {user.email || 'anonymous'}
              </Badge>
            )}
          </div>
        </div>
      </header>

      {view === 'wizard' && <Stepper step={step} setStep={setStep} />}

      <main className="max-w-6xl mx-auto px-6 py-6">
        {view === 'wizard' && step === 0 && (
          <TablesStep
            warehouseId={warehouseId}
            selected={selectedTables}
            onChange={setSelectedTables}
            onNext={() => setStep(1)}
          />
        )}
        {view === 'wizard' && step === 1 && (
          <ContextStep
            context={context}
            onChange={setContext}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}
        {view === 'wizard' && step === 2 && (
          <ProfileStep
            tables={selectedTables}
            warehouseId={warehouseId}
            context={context}
            profiles={profiles}
            metadata={metadata}
            setProfiles={setProfiles}
            setMetadata={setMetadata}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {view === 'wizard' && step === 3 && (
          <ReviewStep
            tables={selectedTables}
            warehouseId={warehouseId}
            metadata={metadata}
            setMetadata={setMetadata}
            onBack={() => setStep(2)}
            onRestart={resetWizard}
            onSubmitted={() => {
              resetWizard();
              setView('sessions');
            }}
          />
        )}
        {view === 'sessions' && (
          <SessionsView userEmail={user?.email ?? ''} warehouseId={warehouseId} />
        )}
      </main>
    </div>
  );
}

function Stepper({ step, setStep }: { step: number; setStep: (s: number) => void }) {
  return (
    <div className="border-b bg-muted/30">
      <div className="max-w-6xl mx-auto px-6 py-3 flex gap-2">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => i < step && setStep(i)}
            disabled={i > step}
            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
              i === step
                ? 'bg-primary text-primary-foreground'
                : i < step
                  ? 'bg-muted text-foreground hover:bg-muted/70'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {i + 1}. {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WarehousePicker({
  warehouses,
  value,
  onChange,
}: {
  warehouses: Warehouse[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (warehouses.length === 0) {
    return <Skeleton className="h-9 w-48" />;
  }
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-64">
        <SelectValue placeholder="Pick a warehouse" />
      </SelectTrigger>
      <SelectContent>
        {warehouses.map((w) => (
          <SelectItem key={w.id} value={w.id}>
            <span className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  w.state === 'RUNNING' ? 'bg-green-500' : 'bg-muted-foreground/40'
                }`}
              />
              {w.name}
              <span className="text-xs text-muted-foreground">({w.state})</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TableList({
  tables,
  selected,
  onToggle,
  showSchema = false,
}: {
  tables: Table[];
  selected: Table[];
  onToggle: (t: Table) => void;
  showSchema?: boolean;
}) {
  return (
    <div className="space-y-1 max-h-96 overflow-y-auto border rounded-md">
      {tables.map((t) => {
        const checked = selected.some((s) => s.full_name === t.full_name);
        return (
          <div
            key={t.full_name}
            role="button"
            tabIndex={0}
            onClick={() => onToggle(t)}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                onToggle(t);
              }
            }}
            className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer text-sm"
          >
            <Checkbox
              checked={checked}
              onCheckedChange={() => onToggle(t)}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="font-mono">
              {showSchema && (t as Table & { schema_name?: string }).schema_name
                ? `${(t as Table & { schema_name?: string }).schema_name}.${t.name}`
                : t.name}
            </span>
            <span className="text-xs text-muted-foreground ml-auto">
              {t.table_type} · {t.column_count} cols
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BrowseMode({
  selected,
  onToggle,
}: {
  selected: Table[];
  onToggle: (t: Table) => void;
}) {
  const [catalogs, setCatalogs] = useState<string[] | null>(null);
  const [catalog, setCatalog] = useState<string | undefined>(undefined);
  const [schemas, setSchemas] = useState<string[] | null>(null);
  const [schema, setSchema] = useState<string | undefined>(undefined);
  const [tables, setTables] = useState<Table[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getCatalogs().then((cs) => setCatalogs(cs.map((c) => c.name))).catch(() => setCatalogs([]));
  }, []);

  useEffect(() => {
    if (!catalog) return;
    setSchemas(null);
    setSchema(undefined);
    setTables(null);
    api.getSchemas(catalog).then((ss) => setSchemas(ss.map((s) => s.name))).catch(() => setSchemas([]));
  }, [catalog]);

  useEffect(() => {
    if (!catalog || !schema) return;
    setLoading(true);
    setTables(null);
    api
      .getTables(catalog, schema)
      .then(setTables)
      .catch(() => setTables([]))
      .finally(() => setLoading(false));
  }, [catalog, schema]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Catalog</Label>
          {catalogs == null ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <Select value={catalog} onValueChange={setCatalog}>
              <SelectTrigger>
                <SelectValue placeholder="Choose catalog" />
              </SelectTrigger>
              <SelectContent>
                {catalogs.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-2">
          <Label>Schema</Label>
          {!catalog ? (
            <Input disabled placeholder="Pick a catalog first" />
          ) : schemas == null ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <Select value={schema} onValueChange={setSchema}>
              <SelectTrigger>
                <SelectValue placeholder="Choose schema" />
              </SelectTrigger>
              <SelectContent>
                {schemas.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <Separator />

      {loading && <Spinner />}
      {tables && tables.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No tables found in {catalog}.{schema}
        </p>
      )}
      {tables && tables.length > 0 && (
        <TableList tables={tables} selected={selected} onToggle={onToggle} />
      )}
    </div>
  );
}

function TagFilterMode({
  warehouseId,
  selected,
  onToggle,
}: {
  warehouseId: string;
  selected: Table[];
  onToggle: (t: Table) => void;
}) {
  const [catalogs, setCatalogs] = useState<string[] | null>(null);
  const [catalog, setCatalog] = useState<string | undefined>(undefined);
  const [tags, setTags] = useState<TagMap | null>(null);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [results, setResults] = useState<Table[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    api.getCatalogs().then((cs) => setCatalogs(cs.map((c) => c.name))).catch(() => setCatalogs([]));
  }, []);

  useEffect(() => {
    if (!catalog || !warehouseId) return;
    setTags(null);
    setFilters({});
    setResults(null);
    setError('');
    setTagsLoading(true);
    api
      .getTags(catalog, warehouseId)
      .then(setTags)
      .catch((e) => {
        setTags({});
        setError(String((e as Error).message ?? e));
      })
      .finally(() => setTagsLoading(false));
  }, [catalog, warehouseId]);

  const activeFilterCount = Object.values(filters).reduce((n, vs) => n + vs.length, 0);
  const activeKeyCount = Object.values(filters).filter((vs) => vs.length > 0).length;

  const toggleValue = (key: string, value: string) => {
    setFilters((prev) => {
      const existing = prev[key] ?? [];
      const next = existing.includes(value)
        ? existing.filter((v) => v !== value)
        : [...existing, value];
      const out = { ...prev, [key]: next };
      if (next.length === 0) delete out[key];
      return out;
    });
  };

  const runSearch = async () => {
    if (!catalog || !warehouseId) return;
    setSearchLoading(true);
    setError('');
    try {
      const r = await api.getTablesByTags(catalog, warehouseId, filters);
      setResults(r);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const clearFilters = () => {
    setFilters({});
    setResults(null);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Catalog</Label>
        {catalogs == null ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <Select value={catalog} onValueChange={setCatalog}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose catalog" />
            </SelectTrigger>
            <SelectContent>
              {catalogs.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {catalog && (
        <>
          <Separator />

          <div className="flex items-center justify-between">
            <Label className="text-sm">Governed tags</Label>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>

          {tagsLoading && <Spinner />}
          {tags && Object.keys(tags).length === 0 && !tagsLoading && (
            <p className="text-sm text-muted-foreground">
              No governed tags found on tables in {catalog}.
            </p>
          )}
          {tags && Object.keys(tags).length > 0 && (
            <div className="space-y-3">
              {Object.entries(tags).map(([key, values]) => (
                <div key={key} className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">{key}</div>
                  <div className="flex flex-wrap gap-2">
                    {values.map(({ value, count }) => {
                      const isActive = (filters[key] ?? []).includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => toggleValue(key, value)}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            isActive
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-muted text-foreground border-transparent hover:bg-muted/70'
                          }`}
                        >
                          {value}
                          <span className="ml-1.5 opacity-60">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted-foreground">
              {activeFilterCount > 0
                ? `${activeFilterCount} value${activeFilterCount === 1 ? '' : 's'} across ${activeKeyCount} key${activeKeyCount === 1 ? '' : 's'} (AND across keys, OR within a key)`
                : 'Pick one or more tag values, then search.'}
            </p>
            <Button onClick={runSearch} disabled={activeFilterCount === 0 || searchLoading}>
              {searchLoading ? 'Searching…' : 'Search'}
            </Button>
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
          )}

          {results && (
            <>
              <Separator />
              {results.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tables match these tags.</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {results.length} matching table{results.length === 1 ? '' : 's'}
                  </p>
                  <TableList
                    tables={results}
                    selected={selected}
                    onToggle={onToggle}
                    showSchema
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function TablesStep({
  warehouseId,
  selected,
  onChange,
  onNext,
}: {
  warehouseId: string;
  selected: Table[];
  onChange: (t: Table[]) => void;
  onNext: () => void;
}) {
  const toggle = (t: Table) => {
    if (selected.some((s) => s.full_name === t.full_name)) {
      onChange(selected.filter((s) => s.full_name !== t.full_name));
    } else {
      onChange([...selected, t]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pick tables to enrich</CardTitle>
        <CardDescription>
          Browse by catalog/schema or filter by governed tags. Selection persists across modes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue="browse">
          <TabsList>
            <TabsTrigger value="browse">Browse</TabsTrigger>
            <TabsTrigger value="tags">Tag filter</TabsTrigger>
          </TabsList>
          <TabsContent value="browse" className="pt-4">
            <BrowseMode selected={selected} onToggle={toggle} />
          </TabsContent>
          <TabsContent value="tags" className="pt-4">
            <TagFilterMode warehouseId={warehouseId} selected={selected} onToggle={toggle} />
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between pt-2 border-t">
          <p className="text-sm text-muted-foreground">
            {selected.length} table{selected.length === 1 ? '' : 's'} selected
          </p>
          <Button onClick={onNext} disabled={selected.length === 0 || !warehouseId}>
            Next: Context →
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ContextStep({
  context,
  onChange,
  onBack,
  onNext,
}: {
  context: { blurb: string; docs: string; tableTemplate: string; columnTemplate: string };
  onChange: (c: typeof context) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add context</CardTitle>
        <CardDescription>
          Tell the model what this data is about. Templates control output structure.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Business blurb (optional)</Label>
          <Textarea
            placeholder="e.g., This dataset captures Jira issue activity for our platform team..."
            value={context.blurb}
            onChange={(e) => onChange({ ...context, blurb: e.target.value })}
            rows={4}
          />
        </div>
        <Tabs defaultValue="table">
          <TabsList>
            <TabsTrigger value="table">Table template</TabsTrigger>
            <TabsTrigger value="column">Column template</TabsTrigger>
          </TabsList>
          <TabsContent value="table" className="space-y-2">
            <Textarea
              value={context.tableTemplate}
              onChange={(e) => onChange({ ...context, tableTemplate: e.target.value })}
              rows={8}
              className="font-mono text-xs"
            />
          </TabsContent>
          <TabsContent value="column" className="space-y-2">
            <Textarea
              value={context.columnTemplate}
              onChange={(e) => onChange({ ...context, columnTemplate: e.target.value })}
              rows={4}
              className="font-mono text-xs"
            />
          </TabsContent>
        </Tabs>

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}>
            ← Back
          </Button>
          <Button onClick={onNext}>Next: Profile & Generate →</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileStep({
  tables,
  warehouseId,
  context,
  profiles,
  metadata,
  setProfiles,
  setMetadata,
  onBack,
  onNext,
}: {
  tables: Table[];
  warehouseId: string;
  context: { blurb: string; docs: string; tableTemplate: string; columnTemplate: string };
  profiles: Record<string, TableProfile> | null;
  metadata: Record<string, GeneratedMetadata> | null;
  setProfiles: (p: Record<string, TableProfile> | null) => void;
  setMetadata: (m: Record<string, GeneratedMetadata> | null) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'profiling' | 'generating' | 'done' | 'error'>(
    'idle',
  );
  const [error, setError] = useState<string>('');

  const run = async () => {
    setError('');
    setStatus('profiling');
    setProfiles(null);
    setMetadata(null);
    try {
      const fqns = tables.map((t) => t.full_name);
      const p = await api.profile(fqns, warehouseId);
      setProfiles(p);
      setStatus('generating');
      const m = await api.generate(p, context);
      setMetadata(m);
      setStatus('done');
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setStatus('error');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile & Generate</CardTitle>
        <CardDescription>
          Profiling runs 3 SQL queries per table on your selected warehouse, then the model writes descriptions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          {tables.length} table{tables.length === 1 ? '' : 's'} queued.
        </div>

        {status === 'idle' && (
          <Button onClick={run} disabled={!warehouseId}>
            Start
          </Button>
        )}
        {(status === 'profiling' || status === 'generating') && (
          <div className="flex items-center gap-3 text-sm">
            <Spinner /> {status === 'profiling' ? 'Profiling tables…' : 'Generating metadata…'}
          </div>
        )}
        {status === 'error' && (
          <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
            {error}
          </div>
        )}
        {status === 'done' && (
          <div className="space-y-2">
            <p className="text-sm text-green-600">Done. {Object.keys(metadata ?? {}).length} tables generated.</p>
            {profiles && (
              <div className="text-xs text-muted-foreground">
                {Object.entries(profiles).map(([fqn, p]) => (
                  <div key={fqn}>
                    <span className="font-mono">{fqn}</span> — {p.row_count.toLocaleString()} rows · {p.columns.length} cols
                    {p.error ? <span className="text-destructive"> · {p.error}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}>
            ← Back
          </Button>
          <Button onClick={onNext} disabled={status !== 'done'}>
            Next: Review & Apply →
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewStep({
  tables,
  warehouseId,
  metadata,
  setMetadata,
  onBack,
  onRestart,
  onSubmitted,
}: {
  tables: Table[];
  warehouseId: string;
  metadata: Record<string, GeneratedMetadata> | null;
  setMetadata: (m: Record<string, GeneratedMetadata>) => void;
  onBack: () => void;
  onRestart: () => void;
  onSubmitted: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [submitComment, setSubmitComment] = useState('');
  const [submitError, setSubmitError] = useState<string>('');
  const [submittedSessionId, setSubmittedSessionId] = useState<string | null>(null);

  if (!metadata) {
    return (
      <Card>
        <CardContent className="pt-6 text-muted-foreground text-sm">
          No metadata yet. Go back and run profiling first.
        </CardContent>
      </Card>
    );
  }

  const updateTableComment = (fqn: string, value: string) => {
    setMetadata({ ...metadata, [fqn]: { ...metadata[fqn], table_comment: value } });
  };

  const updateColumnDescription = (fqn: string, col: string, value: string) => {
    const current = metadata[fqn] ?? {};
    setMetadata({
      ...metadata,
      [fqn]: {
        ...current,
        columns: { ...(current.columns ?? {}), [col]: { description: value } },
      },
    });
  };

  const doSubmit = async () => {
    setSubmitting(true);
    setSubmitError('');
    setSubmittedSessionId(null);
    try {
      const changes: Array<{
        table_fqn: string;
        table_type?: string;
        kind: 'table_comment' | 'column_comment';
        column_name?: string;
        current_value?: string | null;
        proposed_value: string;
      }> = [];
      for (const t of tables) {
        const m = metadata[t.full_name];
        if (!m || m.error) continue;
        if (m.table_comment) {
          changes.push({
            table_fqn: t.full_name,
            table_type: t.table_type,
            kind: 'table_comment',
            current_value: t.comment ?? null,
            proposed_value: m.table_comment,
          });
        }
        for (const [colName, val] of Object.entries(m.columns ?? {})) {
          if (!val?.description) continue;
          const existingCol = t.columns.find((c) => c.name === colName);
          changes.push({
            table_fqn: t.full_name,
            table_type: t.table_type,
            kind: 'column_comment',
            column_name: colName,
            current_value: existingCol?.comment ?? null,
            proposed_value: val.description,
          });
        }
      }
      if (changes.length === 0) {
        setSubmitError('Nothing to submit — every table errored or had empty descriptions.');
        return;
      }
      const r = await api.submitSession(warehouseId, submitComment, changes);
      setSubmittedSessionId(r.session_id);
      setTimeout(() => onSubmitted(), 1500);
    } catch (e) {
      setSubmitError(String((e as Error).message ?? e));
    } finally {
      setSubmitting(false);
    }
  };

  const allKeys = tables.map((t) => t.full_name);
  const [openItems, setOpenItems] = useState<string[]>(allKeys);
  const allOpen = openItems.length === allKeys.length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Review generated metadata</CardTitle>
              <CardDescription>Edit any descriptions before applying.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpenItems(allOpen ? [] : allKeys)}
              >
                {allOpen ? 'Collapse all' : 'Expand all'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" value={openItems} onValueChange={setOpenItems} className="space-y-2">
            {tables.map((t) => {
              const m = metadata[t.full_name];
              if (!m) return null;
              const columnEntries = Object.entries(m.columns ?? {});
              const summary = m.error
                ? `error: ${m.error.slice(0, 60)}`
                : `${columnEntries.length} column${columnEntries.length === 1 ? '' : 's'}`;
              return (
                <AccordionItem
                  key={t.full_name}
                  value={t.full_name}
                  className="border rounded-md px-4"
                >
                  <AccordionTrigger className="hover:no-underline py-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0 text-left">
                      <span className="font-mono text-sm font-semibold truncate">{t.full_name}</span>
                      <Badge variant={m.error ? 'destructive' : 'secondary'} className="text-xs shrink-0">
                        {summary}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-4">
                    {m.error ? (
                      <div className="text-sm text-destructive">{m.error}</div>
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Table comment</Label>
                          <Textarea
                            value={m.table_comment ?? ''}
                            onChange={(e) => updateTableComment(t.full_name, e.target.value)}
                            rows={3}
                            className="text-sm"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Column descriptions</Label>
                          <div className="space-y-2">
                            {columnEntries.map(([col, val]) => (
                              <div key={col} className="grid grid-cols-[200px_1fr] gap-2 items-start">
                                <code className="text-xs pt-2 truncate">{col}</code>
                                <Textarea
                                  value={val.description}
                                  onChange={(e) =>
                                    updateColumnDescription(t.full_name, col, e.target.value)
                                  }
                                  rows={2}
                                  className="text-xs"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Submit for approval</CardTitle>
          <CardDescription>
            Proposed changes are written to Lakebase and queued for review.
            On approval, an admin runs <code>COMMENT ON TABLE</code> /{' '}
            <code>ALTER COLUMN COMMENT</code> via your warehouse to apply them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Submission note (optional)</Label>
            <Textarea
              value={submitComment}
              onChange={(e) => setSubmitComment(e.target.value)}
              rows={2}
              placeholder="Anything reviewers should know about this batch."
              className="text-sm"
            />
          </div>
          {submitting && (
            <div className="flex items-center gap-2 text-sm">
              <Spinner /> Submitting…
            </div>
          )}
          {submitError && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {submitError}
            </div>
          )}
          {submittedSessionId && (
            <div className="text-sm text-green-700 bg-green-500/10 p-3 rounded-md">
              ✓ Submitted as session <code>{submittedSessionId.slice(0, 8)}</code> — opening
              Sessions view…
            </div>
          )}
          <div className="flex justify-between">
            <Button variant="outline" onClick={onBack} disabled={submitting}>
              ← Back
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onRestart} disabled={submitting}>
                Start over
              </Button>
              <Button
                onClick={doSubmit}
                disabled={submitting || !warehouseId || !!submittedSessionId}
              >
                Submit for approval
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' {
  if (status === 'approved') return 'default';
  if (status === 'rejected') return 'destructive';
  if (status === 'applied_partial') return 'destructive';
  return 'secondary';
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function SessionsView({
  userEmail,
  warehouseId,
}: {
  userEmail: string;
  warehouseId: string;
}) {
  type Scope = 'mine' | 'pending' | 'all';
  const [scope, setScope] = useState<Scope>('pending');
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string>('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = async () => {
    setError('');
    try {
      const opts =
        scope === 'mine'
          ? { mine: true }
          : scope === 'pending'
            ? { status: 'pending' }
            : {};
      const list = await api.listSessions(opts);
      setSessions(list);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setSessions([]);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
      <Card className="lg:max-h-[calc(100vh-180px)] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Sessions</CardTitle>
            <Button variant="outline" size="sm" onClick={refresh}>
              Refresh
            </Button>
          </div>
          <div className="flex gap-1 pt-2">
            {(['pending', 'mine', 'all'] as Scope[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                  scope === s
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {s === 'pending' ? 'Pending review' : s === 'mine' ? 'My submissions' : 'All'}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">{error}</div>
          )}
          {sessions == null && <Spinner />}
          {sessions && sessions.length === 0 && (
            <p className="text-sm text-muted-foreground">No sessions in this view.</p>
          )}
          {sessions?.map((s) => (
            <button
              key={s.session_id}
              type="button"
              onClick={() => setActiveId(s.session_id)}
              className={`w-full text-left p-3 rounded-md border transition-colors ${
                activeId === s.session_id
                  ? 'bg-muted border-primary'
                  : 'hover:bg-muted/50 border-transparent'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Badge variant={statusBadgeVariant(s.status)} className="text-[10px]">
                  {s.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {s.change_count} change{s.change_count === 1 ? '' : 's'}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {timeAgo(s.created_at)}
                </span>
              </div>
              <div className="text-xs text-foreground truncate">
                {s.submit_comment || <span className="italic text-muted-foreground">(no note)</span>}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                {s.submitted_by}
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      <div>
        {activeId ? (
          <SessionDetailCard
            key={activeId}
            sessionId={activeId}
            userEmail={userEmail}
            warehouseId={warehouseId}
            onChanged={refresh}
          />
        ) : (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Select a session on the left to review changes.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function SessionDetailCard({
  sessionId,
  userEmail,
  warehouseId,
  onChanged,
}: {
  sessionId: string;
  userEmail: string;
  warehouseId: string;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');

  const load = async () => {
    setError('');
    try {
      const d = await api.getSession(sessionId);
      setDetail(d);
      setReviewComment(d.review_comment ?? '');
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (!detail) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm">
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : (
            <Spinner />
          )}
        </CardContent>
      </Card>
    );
  }

  const isOwn = detail.submitted_by === userEmail;
  const canApprove = detail.status === 'pending';
  const canResubmit = detail.status === 'rejected' && isOwn;

  const groupedByTable = new Map<string, ProposalChange[]>();
  for (const c of detail.changes) {
    const arr = groupedByTable.get(c.table_fqn) ?? [];
    arr.push(c);
    groupedByTable.set(c.table_fqn, arr);
  }

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-mono text-sm">{detail.session_id.slice(0, 8)}</CardTitle>
            <CardDescription>
              Submitted by {detail.submitted_by} · {timeAgo(detail.created_at)}
            </CardDescription>
          </div>
          <Badge variant={statusBadgeVariant(detail.status)}>{detail.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {detail.submit_comment && (
          <div className="text-sm bg-muted/50 p-3 rounded-md italic">
            “{detail.submit_comment}”
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
        )}

        <Accordion type="multiple" defaultValue={Array.from(groupedByTable.keys())} className="space-y-2">
          {Array.from(groupedByTable.entries()).map(([fqn, changes]) => {
            const tableComment = changes.find((c) => c.kind === 'table_comment');
            const columnChanges = changes.filter((c) => c.kind === 'column_comment');
            const errors = changes.filter((c) => c.apply_status === 'error').length;
            return (
              <AccordionItem key={fqn} value={fqn} className="border rounded-md px-4">
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    <span className="font-mono text-sm font-semibold truncate">{fqn}</span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {changes.length} change{changes.length === 1 ? '' : 's'}
                    </Badge>
                    {errors > 0 && (
                      <Badge variant="destructive" className="text-[10px] shrink-0">
                        {errors} error{errors === 1 ? '' : 's'}
                      </Badge>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4 space-y-3">
                  {tableComment && (
                    <ChangeDiff
                      label="Table comment"
                      change={tableComment}
                      editable={canResubmit}
                      sessionId={detail.session_id}
                      onUpdated={load}
                    />
                  )}
                  {columnChanges.map((c) => (
                    <ChangeDiff
                      key={c.change_id}
                      label={`Column · ${c.column_name}`}
                      change={c}
                      editable={canResubmit}
                      sessionId={detail.session_id}
                      onUpdated={load}
                    />
                  ))}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        {(canApprove || canResubmit) && (
          <div className="space-y-2">
            <Label className="text-xs">Review note (optional)</Label>
            <Textarea
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              rows={2}
              className="text-sm"
              disabled={busy}
            />
          </div>
        )}

        {detail.review_comment && !canApprove && !canResubmit && (
          <div className="text-sm">
            <Label className="text-xs">Reviewer note</Label>
            <div className="bg-muted/50 p-3 rounded-md mt-1">
              “{detail.review_comment}”
              <div className="text-[10px] text-muted-foreground mt-1">
                — {detail.reviewed_by} · {timeAgo(detail.reviewed_at)}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {canApprove && (
            <>
              <Button
                variant="outline"
                onClick={() => act(() => api.rejectSession(detail.session_id, reviewComment))}
                disabled={busy}
              >
                Reject
              </Button>
              <Button
                onClick={() =>
                  act(() => api.approveSession(detail.session_id, warehouseId, reviewComment))
                }
                disabled={busy || !warehouseId}
              >
                Approve & apply
              </Button>
            </>
          )}
          {canResubmit && (
            <Button
              onClick={() => act(() => api.resubmitSession(detail.session_id))}
              disabled={busy}
            >
              Resubmit
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ChangeDiff({
  label,
  change,
  editable,
  sessionId,
  onUpdated,
}: {
  label: string;
  change: ProposalChange;
  editable: boolean;
  sessionId: string;
  onUpdated: () => void;
}) {
  const [val, setVal] = useState(change.proposed_value);
  const [saving, setSaving] = useState(false);
  const isDirty = val !== change.proposed_value;

  const save = async () => {
    setSaving(true);
    try {
      await api.updateChange(sessionId, change.change_id, val);
      onUpdated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Label className="text-xs">{label}</Label>
        {change.apply_status === 'success' && (
          <Badge variant="secondary" className="text-[10px] text-green-700">
            applied
          </Badge>
        )}
        {change.apply_status === 'error' && (
          <Badge variant="destructive" className="text-[10px]">
            apply error
          </Badge>
        )}
      </div>
      {change.current_value && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Current value
          </summary>
          <pre className="whitespace-pre-wrap bg-muted/40 p-2 rounded mt-1 text-[11px]">
            {change.current_value}
          </pre>
        </details>
      )}
      {editable ? (
        <>
          <Textarea
            value={val}
            onChange={(e) => setVal(e.target.value)}
            rows={3}
            className="text-sm"
            disabled={saving}
          />
          {isDirty && (
            <Button size="sm" variant="outline" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save change'}
            </Button>
          )}
        </>
      ) : (
        <div className="text-sm whitespace-pre-wrap bg-background border rounded-md p-2">
          {change.proposed_value}
        </div>
      )}
      {change.apply_error && (
        <div className="text-xs text-destructive">{change.apply_error}</div>
      )}
    </div>
  );
}

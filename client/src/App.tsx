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
import { api, type GeneratedMetadata, type Table, type TableProfile, type Warehouse } from './lib/api';

const STEPS = ['Tables', 'Context', 'Profile & Generate', 'Review & Apply'] as const;

const DEFAULT_TABLE_TEMPLATE = [
  'General Description: what this table contains and its primary purpose.',
  'Business Value: who uses this data and what decisions or workflows it supports.',
  'Key Relationships: tables it joins to and the join keys.',
  'Filters & Segments: common ways users filter or group this data.',
].join('\n');

const DEFAULT_COLUMN_TEMPLATE =
  "1-2 sentences: business definition, then typical values or categories. Example: 'Total hours logged. Common values: 1, 2, 4, 8 hours.'";

export default function App() {
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>('');
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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Midas v2</h1>
            <p className="text-xs text-muted-foreground">AI Metadata Generator · AppKit</p>
          </div>
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

      <Stepper step={step} setStep={setStep} />

      <main className="max-w-6xl mx-auto px-6 py-6">
        {step === 0 && (
          <TablesStep
            warehouseId={warehouseId}
            selected={selectedTables}
            onChange={setSelectedTables}
            onNext={() => setStep(1)}
          />
        )}
        {step === 1 && (
          <ContextStep
            context={context}
            onChange={setContext}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
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
        {step === 3 && (
          <ReviewStep
            tables={selectedTables}
            warehouseId={warehouseId}
            metadata={metadata}
            setMetadata={setMetadata}
            onBack={() => setStep(2)}
            onRestart={() => {
              setStep(0);
              setSelectedTables([]);
              setProfiles(null);
              setMetadata(null);
            }}
          />
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
        <CardDescription>Browse Unity Catalog and select tables. Selection persists across steps.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
          <p className="text-sm text-muted-foreground">No tables found in {catalog}.{schema}</p>
        )}
        {tables && tables.length > 0 && (
          <div className="space-y-1 max-h-96 overflow-y-auto border rounded-md">
            {tables.map((t) => {
              const checked = selected.some((s) => s.full_name === t.full_name);
              return (
                <div
                  key={t.full_name}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(t)}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      toggle(t);
                    }
                  }}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer text-sm"
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(t)} onClick={(e) => e.stopPropagation()} />
                  <span className="font-mono">{t.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {t.table_type} · {t.column_count} cols
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
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
}: {
  tables: Table[];
  warehouseId: string;
  metadata: Record<string, GeneratedMetadata> | null;
  setMetadata: (m: Record<string, GeneratedMetadata>) => void;
  onBack: () => void;
  onRestart: () => void;
}) {
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<Array<Record<string, unknown>> | null>(null);
  const [applyError, setApplyError] = useState<string>('');

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

  const doApply = async () => {
    setApplying(true);
    setApplyError('');
    setApplyResult(null);
    try {
      const changes: Record<string, { table_type?: string; table_comment?: string; columns?: Record<string, { description: string }> }> = {};
      for (const t of tables) {
        const m = metadata[t.full_name];
        if (!m || m.error) continue;
        changes[t.full_name] = {
          table_type: t.table_type,
          table_comment: m.table_comment,
          columns: m.columns,
        };
      }
      const r = await api.apply(changes, warehouseId);
      setApplyResult(r);
    } catch (e) {
      setApplyError(String((e as Error).message ?? e));
    } finally {
      setApplying(false);
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
          <CardTitle>Apply to Unity Catalog</CardTitle>
          <CardDescription>
            Writes <code>COMMENT ON TABLE</code> / <code>ALTER COLUMN COMMENT</code> via your warehouse, as your user.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {applying && <Spinner />}
          {applyError && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{applyError}</div>
          )}
          {applyResult && (
            <div className="text-sm space-y-1 max-h-64 overflow-y-auto border rounded-md p-3">
              {applyResult.map((row, i) => {
                const r = row as { table?: string; type?: string; status?: string; column?: string; error?: string };
                const ok = r.status === 'success' || r.status === 'restored';
                return (
                  <div key={i} className={ok ? 'text-green-600' : 'text-destructive'}>
                    {r.status === 'success' ? '✓' : r.status === 'restored' ? '↩' : '✗'} {r.table} {r.column ? `· ${r.column}` : ''} {r.error ? `· ${r.error}` : ''}
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex justify-between">
            <Button variant="outline" onClick={onBack}>
              ← Back
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onRestart}>
                Start over
              </Button>
              <Button onClick={doApply} disabled={applying || !warehouseId}>
                Apply
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

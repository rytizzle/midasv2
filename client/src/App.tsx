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
  type MeRole,
  type ProposalChange,
  type SessionDetail,
  type SessionSummary,
  type Table,
  type TableProfile,
  type TagMap,
  type Tier,
  type TierContext,
  type Warehouse,
} from './lib/api';
import { diffWords, hasChange } from './lib/diff';
import { DEFAULT_TIER, TIER_ORDER, TIER_SPECS, tierSpec } from '@shared/tiers';

const STEPS = ['Tables', 'Context', 'Profile & Generate', 'Review & Apply'] as const;

/** Per-tier structure templates, editable in the Context step. */
type TierTemplates = Record<Tier, { tableTemplate: string; columnTemplate: string }>;

/** Seed the editable per-tier templates from the DAWG 0003 specs. */
function defaultTierTemplates(): TierTemplates {
  const out = {} as TierTemplates;
  for (const t of TIER_ORDER) {
    out[t] = {
      tableTemplate: TIER_SPECS[t].tableTemplate,
      columnTemplate: TIER_SPECS[t].columnTemplate,
    };
  }
  return out;
}

interface WizardContext {
  blurb: string;
  docs: string;
  /** Per-tier table/column structure templates (DAWG 0003, editable). */
  tierTemplates: TierTemplates;
}

type AppView = 'wizard' | 'sessions';

export default function App() {
  const [user, setUser] = useState<MeRole | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [view, setView] = useState<AppView>('wizard');
  const [step, setStep] = useState(0);
  const [selectedTables, setSelectedTables] = useState<Table[]>([]);
  // Per-tier templates seed from the DAWG 0003 specs and are editable in the
  // Context step; each table uses the template for its tier.
  const [context, setContext] = useState<WizardContext>({
    blurb: '',
    docs: '',
    tierTemplates: defaultTierTemplates(),
  });
  const [profiles, setProfiles] = useState<Record<string, TableProfile> | null>(null);
  const [metadata, setMetadata] = useState<Record<string, GeneratedMetadata> | null>(null);

  useEffect(() => {
    api
      .getMyRole()
      .then(setUser)
      .catch(() => setUser({ email: '', name: '', is_admin: false }));
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

  // Tiers present in the current selection, so the Context step can surface the
  // relevant per-tier templates first.
  const tiersInUse = new Set<Tier>(
    selectedTables.map((t) => t.tier ?? DEFAULT_TIER),
  );

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
              Submissions
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
                {user.is_admin ? ' · admin' : ''}
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
            tiersInUse={tiersInUse}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}
        {view === 'wizard' && step === 2 && (
          <ProfileStep
            tables={selectedTables}
            setTables={setSelectedTables}
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
          <SessionsView
            userEmail={user?.email ?? ''}
            isAdmin={user?.is_admin ?? false}
            canApprove={user?.can_approve ?? false}
            userGroups={user?.groups ?? []}
            warehouseId={warehouseId}
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

function TierBadge({ tier, tagged }: { tier?: Tier; tagged?: boolean }) {
  if (!tier) return null;
  const spec = tierSpec(tier);
  // Tier 0 (critical) gets the strongest visual weight.
  const cls =
    tier === '0'
      ? 'bg-red-500/15 text-red-700 border-red-500/30'
      : tier === '1'
        ? 'bg-orange-500/15 text-orange-700 border-orange-500/30'
        : tier === '2'
          ? 'bg-amber-500/15 text-amber-700 border-amber-500/30'
          : 'bg-muted text-muted-foreground border-transparent';
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`}
      title={
        tagged
          ? `${spec.label} (from governed tag)`
          : `${spec.label} (default — no tier tag found)`
      }
    >
      {spec.label}
      {!tagged && tier === DEFAULT_TIER ? '?' : ''}
    </span>
  );
}

/**
 * Pre-vs-post inline diff (feedback #2). Renders the current value and the
 * proposed value with word-level add/remove highlighting so a reviewer (or the
 * submitter) can verify exactly what will change before it's committed.
 */
function DiffView({
  before,
  after,
  className = '',
}: {
  before: string | null | undefined;
  after: string;
  className?: string;
}) {
  const beforeText = before ?? '';
  const changed = hasChange(beforeText, after);
  const segments = diffWords(beforeText, after);

  if (!beforeText) {
    // No prior value — this is a brand-new comment.
    return (
      <div className={`rounded-md border overflow-hidden ${className}`}>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/50 px-2 py-1">
          New · no current value
        </div>
        <div className="text-sm whitespace-pre-wrap p-2 bg-green-500/5">{after}</div>
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 rounded-md border overflow-hidden ${className}`}>
      <div className="border-b md:border-b-0 md:border-r">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/50 px-2 py-1">
          Current
        </div>
        <div className="text-sm whitespace-pre-wrap p-2 text-muted-foreground">{beforeText}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/50 px-2 py-1">
          Proposed {changed ? '' : '· (unchanged)'}
        </div>
        <div className="text-sm whitespace-pre-wrap p-2 leading-relaxed">
          {segments.map((seg, i) =>
            seg.op === 'equal' ? (
              <span key={i}>{seg.text}</span>
            ) : seg.op === 'added' ? (
              <span key={i} className="bg-green-500/20 text-green-800 rounded-sm">
                {seg.text}
              </span>
            ) : (
              <span key={i} className="bg-red-500/20 text-red-800 line-through rounded-sm">
                {seg.text}
              </span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * DAWG 0003 requirements checklist for a table's tier (feedback #4). Shows the
 * required/optional metadata fields for the tier and a soft indicator of which
 * ones the generated metadata appears to cover. This is guidance — governed
 * tags like Sensitivity_Type / Grain are set outside comment application, so
 * unchecked items are informational, not blocking.
 */
function TierChecklist({ tier, meta }: { tier?: Tier; meta: GeneratedMetadata }) {
  if (!tier) return null;
  const spec = tierSpec(tier);
  const hasTableComment = !!(meta.table_comment && meta.table_comment.trim());
  const colCount = Object.values(meta.columns ?? {}).filter((c) => c?.description?.trim()).length;

  // Which requirements can we infer from what this tool produces (comments)?
  const inferred: Record<string, boolean> = {
    description: hasTableComment,
  };

  const required = spec.fields.filter((f) => f.required);
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <TierBadge tier={tier} tagged />
        <span className="text-xs font-medium">DAWG 0003 requirements</span>
        {spec.columnDescriptionsRequired && (
          <span className="text-[10px] text-muted-foreground">
            · column descriptions required ({colCount} provided)
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {required.map((f) => {
          const known = f.key in inferred;
          const ok = inferred[f.key];
          return (
            <span
              key={f.key}
              title={f.hint}
              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                known
                  ? ok
                    ? 'bg-green-500/15 text-green-700 border-green-500/30'
                    : 'bg-red-500/10 text-red-700 border-red-500/30'
                  : 'bg-background text-muted-foreground border-border'
              }`}
            >
              {known ? (ok ? '✓ ' : '· ') : '· '}
              {f.label}
            </span>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Owner, Sensitivity_Type, Data_Tier, Grain and Lifecycle_Status are governed tags managed
        outside comment application — listed here so you know what this tier requires.
      </p>
    </div>
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
    <div className="space-y-1 max-h-[28rem] overflow-y-auto border rounded-md">
      {tables.map((t) => {
        const checked = selected.some((s) => s.full_name === t.full_name);
        const schemaName = t.schema_name;
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
              {showSchema && schemaName ? `${schemaName}.${t.name}` : t.name}
            </span>
            <TierBadge tier={t.tier} tagged={t.tier_tagged} />
            {t.owner_group && (
              <span
                className="text-[10px] text-muted-foreground truncate max-w-[140px]"
                title={`Owner: ${t.owner_group}`}
              >
                {t.owner_group}
              </span>
            )}
            <span className="text-xs text-muted-foreground ml-auto shrink-0">
              {t.table_type}
              {t.column_count ? ` · ${t.column_count} cols` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Default browse experience (feedback #1): "show all tables".
 *
 * Instead of forcing a catalog→schema drill-down before anything appears, this
 * picks a catalog and immediately lists ALL tables across every schema, with a
 * debounced server-side search box and paging. The heavy lifting (and the
 * 39k-table performance guard) lives in /api/catalog/all-tables, which is
 * bounded by LIMIT/OFFSET and never hydrates columns for the list. An optional
 * schema filter narrows the view without changing the model.
 */
function BrowseMode({
  warehouseId,
  selected,
  onToggle,
}: {
  warehouseId: string;
  selected: Table[];
  onToggle: (t: Table) => void;
}) {
  const PAGE = 200;
  const [catalogs, setCatalogs] = useState<string[] | null>(null);
  const [catalog, setCatalog] = useState<string | undefined>(undefined);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState<string>(''); // '' = all schemas
  const [tagged, setTagged] = useState<'' | 'tagged' | 'untagged'>(''); // '' = any
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [tables, setTables] = useState<Table[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getCatalogs()
      .then((cs) => {
        const names = cs.map((c) => c.name);
        setCatalogs(names);
        // Auto-select the first catalog so tables show up with no extra click.
        setCatalog((prev) => prev ?? names[0]);
      })
      .catch(() => setCatalogs([]));
  }, []);

  // Load the schema list for the optional narrowing dropdown.
  useEffect(() => {
    if (!catalog) return;
    setSchema('');
    api
      .getSchemas(catalog)
      .then((ss) => setSchemas(ss.map((s) => s.name)))
      .catch(() => setSchemas([]));
  }, [catalog]);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset paging whenever the query shape changes.
  useEffect(() => {
    setOffset(0);
  }, [catalog, schema, tagged, debouncedSearch]);

  useEffect(() => {
    if (!catalog || !warehouseId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .getAllTables(catalog, warehouseId, {
        schema: schema || undefined,
        q: debouncedSearch || undefined,
        tagged: tagged || undefined,
        limit: PAGE,
        offset,
      })
      .then((page) => {
        if (cancelled) return;
        setTables(page.tables);
        setTotal(page.total);
      })
      .catch((e) => {
        if (cancelled) return;
        setTables([]);
        setTotal(0);
        setError(String((e as Error).message ?? e));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [catalog, schema, tagged, debouncedSearch, offset, warehouseId]);

  const from = total === 0 ? 0 : offset + 1;
  const to = offset + (tables?.length ?? 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_2fr] gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Catalog</Label>
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
        <div className="space-y-1">
          <Label className="text-xs">Schema (optional)</Label>
          <Select value={schema || '__all__'} onValueChange={(v) => setSchema(v === '__all__' ? '' : v)}>
            <SelectTrigger>
              <SelectValue placeholder="All schemas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All schemas</SelectItem>
              {schemas.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Governed tags</Label>
          <Select
            value={tagged || '__any__'}
            onValueChange={(v) => setTagged(v === '__any__' ? '' : (v as 'tagged' | 'untagged'))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">Any (tagged or not)</SelectItem>
              <SelectItem value="tagged">Has a tag</SelectItem>
              <SelectItem value="untagged">No tag</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Search tables</Label>
          <Input
            placeholder="Filter by table or schema name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Separator />

      {!warehouseId && (
        <p className="text-sm text-muted-foreground">Pick a warehouse to browse tables.</p>
      )}
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
      )}

      {catalog && warehouseId && (
        <>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {loading ? (
                'Loading…'
              ) : total > 0 ? (
                <>
                  Showing <span className="font-medium text-foreground">{from}</span>–
                  <span className="font-medium text-foreground">{to}</span> of{' '}
                  <span className="font-medium text-foreground">{total.toLocaleString()}</span>{' '}
                  table{total === 1 ? '' : 's'}
                  {debouncedSearch ? ` matching “${debouncedSearch}”` : ''}
                </>
              ) : (
                'No tables found.'
              )}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}
              >
                ← Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={to >= total || loading}
                onClick={() => setOffset(offset + PAGE)}
              >
                Next →
              </Button>
            </div>
          </div>

          {loading && !tables ? (
            <Skeleton className="h-64 w-full" />
          ) : tables && tables.length > 0 ? (
            <TableList tables={tables} selected={selected} onToggle={onToggle} showSchema />
          ) : null}
        </>
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
            <BrowseMode warehouseId={warehouseId} selected={selected} onToggle={toggle} />
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
  tiersInUse,
  onBack,
  onNext,
}: {
  context: WizardContext;
  onChange: (c: WizardContext) => void;
  /** Tiers present in the current selection — surfaced first for convenience. */
  tiersInUse: Set<Tier>;
  onBack: () => void;
  onNext: () => void;
}) {
  // Default the active tier tab to one that's actually in the selection.
  const firstInUse = TIER_ORDER.find((t) => tiersInUse.has(t)) ?? DEFAULT_TIER;
  const [activeTier, setActiveTier] = useState<Tier>(firstInUse);

  const spec = tierSpec(activeTier);
  const tpl = context.tierTemplates[activeTier];
  const setTpl = (patch: Partial<{ tableTemplate: string; columnTemplate: string }>) =>
    onChange({
      ...context,
      tierTemplates: {
        ...context.tierTemplates,
        [activeTier]: { ...context.tierTemplates[activeTier], ...patch },
      },
    });
  const resetTier = () =>
    onChange({
      ...context,
      tierTemplates: {
        ...context.tierTemplates,
        [activeTier]: {
          tableTemplate: TIER_SPECS[activeTier].tableTemplate,
          columnTemplate: TIER_SPECS[activeTier].columnTemplate,
        },
      },
    });
  const isCustomized =
    tpl.tableTemplate !== TIER_SPECS[activeTier].tableTemplate ||
    tpl.columnTemplate !== TIER_SPECS[activeTier].columnTemplate;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add context</CardTitle>
        <CardDescription>
          Tell the model what this data is about. Each table is structured with the template for its
          DAWG 0003 tier — pick a tier below to view or edit how its metadata is structured.
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

        <div className="space-y-2">
          <Label className="text-xs">Metadata structure by tier</Label>
          <div className="flex flex-wrap gap-1.5">
            {TIER_ORDER.map((t) => {
              const inUse = tiersInUse.has(t);
              const customized =
                context.tierTemplates[t].tableTemplate !== TIER_SPECS[t].tableTemplate ||
                context.tierTemplates[t].columnTemplate !== TIER_SPECS[t].columnTemplate;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setActiveTier(t)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    activeTier === t
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-foreground border-transparent hover:bg-muted/70'
                  }`}
                  title={inUse ? 'Present in your selection' : 'Not in your current selection'}
                >
                  {TIER_SPECS[t].label}
                  {inUse && <span className="ml-1.5 opacity-70">•</span>}
                  {customized && <span className="ml-1 opacity-70">✎</span>}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            • = present in your selection · ✎ = edited from the DAWG 0003 default.
            {spec.critical && ' Tier 0 is critical — the richest structure.'}
          </p>
        </div>

        <Tabs defaultValue="table">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="table">Table template</TabsTrigger>
              <TabsTrigger value="column">Column template</TabsTrigger>
            </TabsList>
            {isCustomized && (
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={resetTier}>
                Reset {spec.label} to DAWG default
              </Button>
            )}
          </div>
          <TabsContent value="table" className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              How {spec.label} table comments are structured.
            </p>
            <Textarea
              value={tpl.tableTemplate}
              onChange={(e) => setTpl({ tableTemplate: e.target.value })}
              rows={8}
              className="font-mono text-xs"
            />
          </TabsContent>
          <TabsContent value="column" className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              How {spec.label} column descriptions are structured.
              {spec.columnDescriptionsRequired
                ? ' Column descriptions are required at this tier.'
                : ''}
            </p>
            <Textarea
              value={tpl.columnTemplate}
              onChange={(e) => setTpl({ columnTemplate: e.target.value })}
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
  setTables,
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
  setTables: (t: Table[]) => void;
  warehouseId: string;
  context: WizardContext;
  profiles: Record<string, TableProfile> | null;
  metadata: Record<string, GeneratedMetadata> | null;
  setProfiles: (p: Record<string, TableProfile> | null) => void;
  setMetadata: (m: Record<string, GeneratedMetadata> | null) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'hydrating' | 'profiling' | 'generating' | 'done' | 'error'>(
    'idle',
  );
  const [error, setError] = useState<string>('');

  const run = async () => {
    setError('');
    setProfiles(null);
    setMetadata(null);
    try {
      // Tables picked from the lightweight "show all" list have no columns
      // hydrated yet — fetch them now so profiling + the pre/post diff have the
      // current comments to compare against.
      let working = tables;
      const needHydrate = tables.filter((t) => t.column_count === 0 || t.columns.length === 0);
      if (needHydrate.length > 0) {
        setStatus('hydrating');
        const hydrated = await api.hydrateTables(needHydrate.map((t) => t.full_name));
        const byFqn = new Map(hydrated.map((h) => [h.full_name, h]));
        working = tables.map((t) => {
          const h = byFqn.get(t.full_name);
          return h ? { ...t, ...h, tier: t.tier, owner_group: t.owner_group } : t;
        });
        setTables(working);
      }

      setStatus('profiling');
      const fqns = working.map((t) => t.full_name);
      const p = await api.profile(fqns, warehouseId);
      setProfiles(p);

      setStatus('generating');
      // Per-table tier context (DAWG 0003): send each table's tier plus the
      // (possibly user-edited) structure template for that tier, so critical
      // Tier 0 tables get the richer structure and edits in the Context step
      // flow through per tier.
      const tiers: Record<string, TierContext> = {};
      for (const t of working) {
        const tier = t.tier ?? DEFAULT_TIER;
        const tpl = context.tierTemplates[tier];
        tiers[t.full_name] = {
          tier,
          tableTemplate: tpl.tableTemplate,
          columnTemplate: tpl.columnTemplate,
        };
      }
      // Shared context now only carries the free-text blurb/docs; per-tier
      // templates travel in `tiers`.
      const m = await api.generate(p, { blurb: context.blurb, docs: context.docs }, tiers);
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
        {(status === 'hydrating' || status === 'profiling' || status === 'generating') && (
          <div className="flex items-center gap-3 text-sm">
            <Spinner />{' '}
            {status === 'hydrating'
              ? 'Loading table details…'
              : status === 'profiling'
                ? 'Profiling tables…'
                : 'Generating metadata…'}
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
  // Per-table view mode: 'edit' (textareas) or 'diff' (pre-vs-post preview).
  const [viewMode, setViewMode] = useState<'edit' | 'diff'>('diff');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Review generated metadata</CardTitle>
              <CardDescription>
                Verify the pre-vs-post diff, then edit if needed before submitting.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="flex rounded-md border overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode('diff')}
                  className={`px-3 py-1.5 transition-colors ${
                    viewMode === 'diff'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  Diff
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('edit')}
                  className={`px-3 py-1.5 transition-colors ${
                    viewMode === 'edit'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  Edit
                </button>
              </div>
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
              const colByName = new Map(t.columns.map((c) => [c.name, c]));
              return (
                <AccordionItem
                  key={t.full_name}
                  value={t.full_name}
                  className="border rounded-md px-4"
                >
                  <AccordionTrigger className="hover:no-underline py-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0 text-left">
                      <span className="font-mono text-sm font-semibold truncate">{t.full_name}</span>
                      <TierBadge tier={t.tier} tagged={t.tier_tagged} />
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
                        <TierChecklist tier={t.tier} meta={m} />
                        <div className="space-y-1">
                          <Label className="text-xs">Table comment</Label>
                          {viewMode === 'edit' ? (
                            <Textarea
                              value={m.table_comment ?? ''}
                              onChange={(e) => updateTableComment(t.full_name, e.target.value)}
                              rows={3}
                              className="text-sm"
                            />
                          ) : (
                            <DiffView before={t.comment} after={m.table_comment ?? ''} />
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Column descriptions</Label>
                          <div className="space-y-2">
                            {columnEntries.map(([col, val]) =>
                              viewMode === 'edit' ? (
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
                              ) : (
                                <div key={col} className="space-y-1">
                                  <code className="text-xs truncate">{col}</code>
                                  <DiffView
                                    before={colByName.get(col)?.comment ?? ''}
                                    after={val.description}
                                  />
                                </div>
                              ),
                            )}
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
            Proposed changes are written to Lakebase and queued for review by the owning group.
            On approval, an approver from each table's owner group runs{' '}
            <code>COMMENT ON TABLE</code> / <code>ALTER COLUMN COMMENT</code> via your warehouse to
            apply them.
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
  isAdmin,
  canApprove,
  userGroups,
  warehouseId,
}: {
  userEmail: string;
  isAdmin: boolean;
  canApprove: boolean;
  userGroups: string[];
  warehouseId: string;
}) {
  type Scope = 'mine' | 'pending';
  // Approvers (workspace admins, override-group members, or members of any
  // owner group) default to the 'pending' review queue. Everyone else is
  // locked to their own submissions.
  const [scope, setScope] = useState<Scope>(canApprove ? 'pending' : 'mine');
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string>('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = async () => {
    setError('');
    try {
      const opts = scope === 'mine' ? { mine: true } : { status: 'pending' };
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
  }, [scope, canApprove]);

  const scopeOptions: Scope[] = canApprove ? ['pending', 'mine'] : ['mine'];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
      <Card className="lg:max-h-[calc(100vh-180px)] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Submissions</CardTitle>
            <Button variant="outline" size="sm" onClick={refresh}>
              Refresh
            </Button>
          </div>
          {scopeOptions.length > 1 && (
            <div className="flex gap-1 pt-2">
              {scopeOptions.map((s) => (
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
                  {s === 'pending' ? 'Pending review' : 'My submissions'}
                </button>
              ))}
            </div>
          )}
          {canApprove ? (
            <p className="text-[11px] text-muted-foreground pt-1">
              {isAdmin
                ? 'As a workspace admin you can review every submission.'
                : `You can approve changes owned by your groups: ${
                    userGroups.length ? userGroups.join(', ') : '(none)'
                  }.`}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground pt-1">
              You see only submissions you created. Owner-group members review pending submissions.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-1">
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">{error}</div>
          )}
          {sessions == null && <Spinner />}
          {sessions && sessions.length === 0 && (
            <p className="text-sm text-muted-foreground">No submissions in this view.</p>
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
            isAdmin={isAdmin}
            userGroups={userGroups}
            warehouseId={warehouseId}
            onChanged={refresh}
          />
        ) : (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Select a submission on the left to review changes.
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
  isAdmin,
  userGroups,
  warehouseId,
  onChanged,
}: {
  sessionId: string;
  userEmail: string;
  isAdmin: boolean;
  userGroups: string[];
  warehouseId: string;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');
  // Selection state for per-change approve/reject. Defaults to all undecided
  // changes the caller is allowed to decide, so a one-click "Approve selected"
  // never includes changes they lack authority over.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const groupSet = new Set(userGroups.map((g) => g.toLowerCase()));
  // Can the current user decide a given change? Admins can decide anything;
  // others only changes owned by a group they belong to. (The server enforces
  // this too — this just keeps the UI honest.)
  const mayDecide = (ownerGroup: string | null): boolean => {
    if (isAdmin) return true;
    if (!ownerGroup) return false;
    return groupSet.has(ownerGroup.toLowerCase());
  };

  const load = async () => {
    setError('');
    try {
      const d = await api.getSession(sessionId);
      setDetail(d);
      setReviewComment(d.review_comment ?? '');
      setSelected(
        new Set(
          d.changes
            .filter((c) => !c.decision && mayDecide(c.owner_group))
            .map((c) => c.change_id),
        ),
      );
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
  const undecidedChanges = detail.changes.filter((c) => !c.decision);
  // Changes this user is actually allowed to decide (owner-group gated).
  const decidableChanges = undecidedChanges.filter((c) => mayDecide(c.owner_group));
  // Show the decision controls whenever the session is pending and the user can
  // act on at least one change in it.
  const canDecide = detail.status === 'pending' && decidableChanges.length > 0;
  const canResubmit = detail.status === 'rejected' && isOwn;
  const selectedUndecided = decidableChanges.filter((c) => selected.has(c.change_id));
  const approvedCount = detail.changes.filter((c) => c.decision === 'approved').length;
  const rejectedCount = detail.changes.filter((c) => c.decision === 'rejected').length;
  const errorCount = detail.changes.filter((c) => c.apply_status === 'error').length;
  // Undecided changes the user cannot act on (owned by other groups).
  const lockedChanges = undecidedChanges.filter((c) => !mayDecide(c.owner_group));

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAll = () => setSelected(new Set(decidableChanges.map((c) => c.change_id)));
  const selectNone = () => setSelected(new Set());

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

        {canDecide && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">
                {selectedUndecided.length}
              </span>{' '}
              of {decidableChanges.length} decidable selected
              {lockedChanges.length > 0 && (
                <>
                  {' · '}
                  <span title="Owned by groups you're not a member of">
                    {lockedChanges.length} locked to other groups
                  </span>
                </>
              )}
              {(approvedCount > 0 || rejectedCount > 0) && (
                <>
                  {' · '}
                  <span className="text-green-700">{approvedCount} approved</span>
                  {rejectedCount > 0 && (
                    <>
                      {' · '}
                      <span className="text-destructive">{rejectedCount} rejected</span>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="text-primary hover:underline"
                disabled={busy}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={selectNone}
                className="text-primary hover:underline"
                disabled={busy}
              >
                None
              </button>
            </div>
          </div>
        )}

        <Accordion type="multiple" defaultValue={Array.from(groupedByTable.keys())} className="space-y-2">
          {Array.from(groupedByTable.entries()).map(([fqn, changes]) => {
            const tableComment = changes.find((c) => c.kind === 'table_comment');
            const columnChanges = changes.filter((c) => c.kind === 'column_comment');
            const tableApproved = changes.filter((c) => c.decision === 'approved').length;
            const tableRejected = changes.filter((c) => c.decision === 'rejected').length;
            const tableErrors = changes.filter((c) => c.apply_status === 'error').length;
            const ownerGroup = changes.find((c) => c.owner_group)?.owner_group ?? null;
            const locked = changes.some((c) => !c.decision && !mayDecide(c.owner_group));
            return (
              <AccordionItem key={fqn} value={fqn} className="border rounded-md px-4">
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    <span className="font-mono text-sm font-semibold truncate">{fqn}</span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {changes.length} change{changes.length === 1 ? '' : 's'}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="text-[10px] shrink-0"
                      title={ownerGroup ? `Owner group: ${ownerGroup}` : 'No owner tag — admin-approved'}
                    >
                      {ownerGroup ? `owner: ${ownerGroup}` : 'no owner tag'}
                    </Badge>
                    {locked && (
                      <Badge variant="secondary" className="text-[10px] shrink-0" title="You are not a member of this owner group">
                        🔒 other group
                      </Badge>
                    )}
                    {tableApproved > 0 && (
                      <Badge variant="secondary" className="text-[10px] shrink-0 text-green-700">
                        {tableApproved} approved
                      </Badge>
                    )}
                    {tableRejected > 0 && (
                      <Badge variant="destructive" className="text-[10px] shrink-0">
                        {tableRejected} rejected
                      </Badge>
                    )}
                    {tableErrors > 0 && (
                      <Badge variant="destructive" className="text-[10px] shrink-0">
                        {tableErrors} error{tableErrors === 1 ? '' : 's'}
                      </Badge>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4 space-y-3">
                  {tableComment && (
                    <ChangeDiff
                      label="Table comment"
                      change={tableComment}
                      editable={canResubmit && !tableComment.decision}
                      selectable={
                        detail.status === 'pending' &&
                        mayDecide(tableComment.owner_group) &&
                        !tableComment.decision
                      }
                      selected={selected.has(tableComment.change_id)}
                      onToggleSelect={() => toggleSelected(tableComment.change_id)}
                      sessionId={detail.session_id}
                      onUpdated={load}
                    />
                  )}
                  {columnChanges.map((c) => (
                    <ChangeDiff
                      key={c.change_id}
                      label={`Column · ${c.column_name}`}
                      change={c}
                      editable={canResubmit && !c.decision}
                      selectable={
                        detail.status === 'pending' && mayDecide(c.owner_group) && !c.decision
                      }
                      selected={selected.has(c.change_id)}
                      onToggleSelect={() => toggleSelected(c.change_id)}
                      sessionId={detail.session_id}
                      onUpdated={load}
                    />
                  ))}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        {(canDecide || canResubmit) && (
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

        {detail.review_comment && !canDecide && !canResubmit && (
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
          {canDecide && (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  act(() =>
                    api.decideSession(detail.session_id, {
                      approve_ids: [],
                      reject_ids: selectedUndecided.map((c) => c.change_id),
                      warehouse_id: warehouseId,
                      review_comment: reviewComment,
                    }),
                  )
                }
                disabled={busy || selectedUndecided.length === 0}
              >
                Reject selected
              </Button>
              <Button
                onClick={() =>
                  act(() =>
                    api.decideSession(detail.session_id, {
                      approve_ids: selectedUndecided.map((c) => c.change_id),
                      reject_ids: [],
                      warehouse_id: warehouseId,
                      review_comment: reviewComment,
                    }),
                  )
                }
                disabled={busy || selectedUndecided.length === 0 || !warehouseId}
              >
                Approve selected ({selectedUndecided.length})
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
        {errorCount > 0 && detail.status !== 'pending' && (
          <p className="text-xs text-destructive">
            {errorCount} change{errorCount === 1 ? '' : 's'} failed to apply — see badges above.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ChangeDiff({
  label,
  change,
  editable,
  selectable = false,
  selected = false,
  onToggleSelect,
  sessionId,
  onUpdated,
}: {
  label: string;
  change: ProposalChange;
  editable: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
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
        {selectable && onToggleSelect && (
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            aria-label={`Select ${label}`}
          />
        )}
        <Label className="text-xs">{label}</Label>
        {change.decision === 'approved' && (
          <Badge variant="secondary" className="text-[10px] text-green-700">
            approved
          </Badge>
        )}
        {change.decision === 'rejected' && (
          <Badge variant="destructive" className="text-[10px]">
            rejected
          </Badge>
        )}
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
      {editable ? (
        <>
          {/* Show the pre/post diff for reference while editing the proposal. */}
          <DiffView before={change.current_value} after={change.proposed_value} className="mb-2" />
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
        <DiffView before={change.current_value} after={change.proposed_value} />
      )}
      {change.apply_error && (
        <div className="text-xs text-destructive">{change.apply_error}</div>
      )}
    </div>
  );
}

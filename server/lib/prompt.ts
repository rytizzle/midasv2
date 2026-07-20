export interface ColumnProfile {
  name: string;
  type: string;
  distinct_count?: number;
  null_pct?: number;
  sample_values?: string[];
}

export interface TableProfile {
  columns?: ColumnProfile[];
  sample_rows?: Array<Record<string, unknown>>;
  row_count?: number;
}

import { tierSpec, type Tier } from '../../shared/tiers';

export interface GenerationContext {
  blurb?: string;
  docs?: string;
  tableTemplate?: string;
  columnTemplate?: string;
}

/** Per-table generation overrides derived from the table's DAWG 0002 tier. */
export interface TierContext {
  tier?: Tier;
  tableTemplate?: string;
  columnTemplate?: string;
}

export function buildPrompt(
  tableName: string,
  profile: TableProfile,
  ctx: GenerationContext,
  tierCtx?: TierContext,
): string {
  const userContextParts: string[] = [];
  if (ctx.blurb) userContextParts.push(ctx.blurb);
  if (ctx.docs) userContextParts.push(`Additional docs: ${ctx.docs}`);
  const userContext = userContextParts.join('\n\n') || 'None provided';

  // Tier-specific templates (DAWG 0003) drive the structure. Precedence, most
  // specific first: an explicit per-table override → the shared-context
  // override → the table's tier template. Treat blank/whitespace strings as
  // "unset" so an empty shared-context field doesn't block the tier template
  // (`??` alone would stop at an empty string).
  const firstNonBlank = (...vals: Array<string | undefined>): string | undefined =>
    vals.find((v) => v != null && v.trim() !== '');
  const spec = tierCtx?.tier ? tierSpec(tierCtx.tier) : null;
  const effectiveTableTemplate = firstNonBlank(
    tierCtx?.tableTemplate,
    ctx.tableTemplate,
    spec?.tableTemplate,
  );
  const effectiveColumnTemplate = firstNonBlank(
    tierCtx?.columnTemplate,
    ctx.columnTemplate,
    spec?.columnTemplate,
  );
  const tierHeader = spec
    ? `\nDATA TIER: ${spec.label} (DAWG 0003). ${
        spec.critical
          ? 'This is CRITICAL data — be thorough and precise.'
          : 'Apply the metadata depth appropriate to this tier.'
      }`
    : '';

  const columns = profile.columns ?? [];
  const sampleRows = profile.sample_rows ?? [];

  const columnsInfo = columns
    .map(
      (c) =>
        `- ${c.name} (${c.type}): ${c.distinct_count ?? '?'} distinct, ${c.null_pct ?? '?'}% null, samples: ${JSON.stringify(c.sample_values ?? [])}`,
    )
    .join('\n');

  const sampleStr = sampleRows.length
    ? JSON.stringify(sampleRows.slice(0, 5), null, 2)
    : 'No samples';

  const tableInstruction = effectiveTableTemplate
    ? `1. "table_comment": A flowing prose description (no section headings or labels). Use the following template ONLY as a guide for what topics to cover, but write it as clean continuous text:
${effectiveTableTemplate}

Do NOT include section headings like "General Description" or "Business Value" in the output. Do NOT mention row counts or number of records — tables change over time.`
    : '1. "table_comment": A 1-2 sentence description of what this table contains. Reference specific data patterns you observe. Do NOT mention row counts or number of records — tables change over time.';

  const columnInstruction = effectiveColumnTemplate
    ? `2. "columns": An object where each key is a column name and the value is an object with:
   - "description": Follow this format: ${effectiveColumnTemplate}`
    : `2. "columns": An object where each key is a column name and the value is an object with:
   - "description": A concise description (1 sentence) that helps Genie understand the column's meaning, typical values, and business context.`;

  return `You are a metadata expert for Databricks Unity Catalog. Generate concise, Genie-optimized metadata for the table below.

TABLE: ${tableName}${tierHeader}
USER CONTEXT: ${userContext}

COLUMNS:
${columnsInfo}

SAMPLE ROWS:
${sampleStr}

Generate a JSON response with:
${tableInstruction}
${columnInstruction}

Focus on being specific to the actual data patterns. Mention value ranges, common categories, and business meaning.
Return ONLY valid JSON, no markdown fences.`;
}

export function stripCodeFences(s: string): string {
  const trimmed = s.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const firstNl = trimmed.indexOf('\n');
  if (firstNl < 0) return trimmed;
  const body = trimmed.slice(firstNl + 1);
  const closeIdx = body.lastIndexOf('```');
  return (closeIdx >= 0 ? body.slice(0, closeIdx) : body).trim();
}

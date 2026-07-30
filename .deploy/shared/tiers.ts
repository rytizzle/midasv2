/**
 * DAWG 0003 — Minimum Required Metadata, encoded as per-tier templates.
 *
 * A table's tier comes from the DAWG 0002 governed tag (default key
 * `data_tier`, override with MIDAS_TIER_TAG_KEY). Each tier has a different
 * set of required/optional metadata and therefore a different generation
 * template. Tier 0 (critical) has the strongest requirements; tier 4 /
 * non-tiered has the lightest.
 *
 * This module is the single source of truth shared by the server (prompt
 * construction in server/lib/prompt.ts) and the client (required-field
 * checklists in the Review step).
 */

export type Tier = '0' | '1' | '2' | '3' | '4';

/** Canonical DAWG 0002 tier values we recognize + how to normalize tag values. */
export const TIER_ORDER: Tier[] = ['0', '1', '2', '3', '4'];

/** Sensitivity classifications from DAWG 0003. */
export const SENSITIVITY_TYPES = [
  'None',
  'Direct Identifier',
  'Indirect Identifier',
  'Attribute/Behavioral Data',
  'Financial',
  'Secret_Game_Code_Name',
] as const;

/** Allowed Time_Grain values (Grain requirement). */
export const TIME_GRAINS = ['Event_Timestamp', 'Daily', 'Weekly', 'Monthly'] as const;

/** Lifecycle_Status values. */
export const LIFECYCLE_STATUSES = ['Draft', 'Active', 'Deprecated'] as const;

export interface TierField {
  /** Stable key used in metadata objects and tag names. */
  key: string;
  /** Human label shown in the UI. */
  label: string;
  required: boolean;
  /** Optional enum of allowed values (renders a hint / select). */
  values?: readonly string[];
  /** Short helper text for the UI + prompt. */
  hint?: string;
}

export interface TierSpec {
  tier: Tier;
  label: string;
  /** True for Tier 0 — the critical tier with the strongest requirements. */
  critical: boolean;
  /** Fields required/optional at this tier (table-level metadata). */
  fields: TierField[];
  /** Whether per-column descriptions are required at this tier. */
  columnDescriptionsRequired: boolean;
  /** The table-comment generation template shown to the LLM + editable in UI. */
  tableTemplate: string;
  /** The column-description generation template. */
  columnTemplate: string;
}

const OWNER: TierField = {
  key: 'owner',
  label: 'Owner',
  required: true,
  hint: 'Owning group per DAWG 0001 (from the owner governed tag).',
};
const DESCRIPTION: TierField = {
  key: 'description',
  label: 'Description',
  required: true,
  hint: 'Clear, concise explanation of what the dataset represents.',
};
const SENSITIVITY: TierField = {
  key: 'sensitivity_type',
  label: 'Sensitivity_Type',
  required: true,
  values: SENSITIVITY_TYPES,
  hint: 'Data sensitivity classification.',
};
const DATA_TIER: TierField = {
  key: 'data_tier',
  label: 'Data_Tier',
  required: true,
  values: TIER_ORDER,
  hint: 'DAWG 0002 tier of this table.',
};
const GRAIN: TierField = {
  key: 'grain',
  label: 'Grain',
  required: true,
  values: TIME_GRAINS,
  hint: 'Time grain of a row: Event_Timestamp | Daily | Weekly | Monthly.',
};
const LIFECYCLE: TierField = {
  key: 'lifecycle_status',
  label: 'Lifecycle_Status',
  required: true,
  values: LIFECYCLE_STATUSES,
  hint: 'Draft, Active, or Deprecated (include deprecated date if Deprecated).',
};

// Tier 0 also calls out optional description sub-fields.
const TIER0_OPTIONAL: TierField[] = [
  { key: 'usage_notes', label: 'Usage Notes', required: false },
  { key: 'join_keys', label: 'Join Keys', required: false },
  { key: 'known_issues', label: 'Known Issues', required: false },
  { key: 'event_trigger', label: 'Event creation trigger', required: false },
];

const TIER0_TABLE_TEMPLATE = [
  'General Description: what this table contains and its primary purpose.',
  'Business Value: who uses this data and what decisions or workflows it supports.',
  'Key Relationships / Join Keys: tables it joins to and the keys used.',
  'Usage Notes: important caveats or guidance for consumers.',
  'Known Issues: any data-quality caveats consumers should be aware of.',
  'Event Creation Trigger: what event or process produces rows (if applicable).',
].join('\n');

const STANDARD_TABLE_TEMPLATE = [
  'General Description: what this table contains and its primary purpose.',
  'Business Value: who uses this data and what decisions or workflows it supports.',
  'Key Relationships: tables it joins to and the join keys.',
  'Filters & Segments: common ways users filter or group this data.',
].join('\n');

const MINIMAL_TABLE_TEMPLATE = [
  'General Description: a clear, concise explanation of what this dataset represents and its primary purpose.',
].join('\n');

const TIER0_COLUMN_TEMPLATE =
  "2-3 sentences: precise business definition, typical values or categories, and any join-key role or known caveats. Example: 'Total hours logged for the session. Common values: 1, 2, 4, 8. Joins to dim_time on hour_id.'";

const STANDARD_COLUMN_TEMPLATE =
  "1-2 sentences: business definition, then typical values or categories. Example: 'Total hours logged. Common values: 1, 2, 4, 8 hours.'";

const MINIMAL_COLUMN_TEMPLATE =
  '1 sentence: the business meaning of the column.';

export const TIER_SPECS: Record<Tier, TierSpec> = {
  '0': {
    tier: '0',
    label: 'Tier 0 (Critical)',
    critical: true,
    fields: [OWNER, DESCRIPTION, ...TIER0_OPTIONAL, SENSITIVITY, DATA_TIER, GRAIN, LIFECYCLE],
    columnDescriptionsRequired: true,
    tableTemplate: TIER0_TABLE_TEMPLATE,
    columnTemplate: TIER0_COLUMN_TEMPLATE,
  },
  '1': {
    tier: '1',
    label: 'Tier 1',
    critical: false,
    fields: [OWNER, DESCRIPTION, SENSITIVITY, DATA_TIER, GRAIN, LIFECYCLE],
    columnDescriptionsRequired: false,
    tableTemplate: STANDARD_TABLE_TEMPLATE,
    columnTemplate: STANDARD_COLUMN_TEMPLATE,
  },
  '2': {
    tier: '2',
    label: 'Tier 2',
    critical: false,
    fields: [OWNER, DESCRIPTION, SENSITIVITY, DATA_TIER, GRAIN, LIFECYCLE],
    columnDescriptionsRequired: false,
    tableTemplate: STANDARD_TABLE_TEMPLATE,
    columnTemplate: STANDARD_COLUMN_TEMPLATE,
  },
  '3': {
    tier: '3',
    label: 'Tier 3',
    critical: false,
    fields: [OWNER, DESCRIPTION, SENSITIVITY, DATA_TIER, GRAIN, LIFECYCLE],
    columnDescriptionsRequired: false,
    tableTemplate: STANDARD_TABLE_TEMPLATE,
    columnTemplate: STANDARD_COLUMN_TEMPLATE,
  },
  '4': {
    tier: '4',
    label: 'Tier 4 / Non-Tiered',
    critical: false,
    fields: [OWNER, DESCRIPTION, LIFECYCLE],
    columnDescriptionsRequired: false,
    tableTemplate: MINIMAL_TABLE_TEMPLATE,
    columnTemplate: MINIMAL_COLUMN_TEMPLATE,
  },
};

/** The tier used when a table has no recognizable data_tier tag. */
export const DEFAULT_TIER: Tier = '4';

/**
 * Normalize an arbitrary governed-tag value into a known Tier.
 * Accepts "0", "tier 0", "Tier0", "T0", "critical" (→ 0), etc.
 * Returns null when it can't be mapped so callers can fall back.
 */
export function normalizeTier(raw: string | null | undefined): Tier | null {
  if (!raw) return null;
  const s = raw.toString().trim().toLowerCase();
  if (s === 'critical') return '0';
  const m = s.match(/(?:tier|t)?\s*([0-4])/);
  if (m && TIER_ORDER.includes(m[1] as Tier)) return m[1] as Tier;
  return null;
}

export function tierSpec(tier: Tier): TierSpec {
  return TIER_SPECS[tier];
}

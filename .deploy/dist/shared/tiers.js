//#region shared/tiers.ts
/** Canonical DAWG 0002 tier values we recognize + how to normalize tag values. */
const TIER_ORDER = [
	"0",
	"1",
	"2",
	"3",
	"4"
];
/** Sensitivity classifications from DAWG 0003. */
const SENSITIVITY_TYPES = [
	"None",
	"Direct Identifier",
	"Indirect Identifier",
	"Attribute/Behavioral Data",
	"Financial",
	"Secret_Game_Code_Name"
];
/** Allowed Time_Grain values (Grain requirement). */
const TIME_GRAINS = [
	"Event_Timestamp",
	"Daily",
	"Weekly",
	"Monthly"
];
/** Lifecycle_Status values. */
const LIFECYCLE_STATUSES = [
	"Draft",
	"Active",
	"Deprecated"
];
const OWNER = {
	key: "owner",
	label: "Owner",
	required: true,
	hint: "Owning group per DAWG 0001 (from the owner governed tag)."
};
const DESCRIPTION = {
	key: "description",
	label: "Description",
	required: true,
	hint: "Clear, concise explanation of what the dataset represents."
};
const SENSITIVITY = {
	key: "sensitivity_type",
	label: "Sensitivity_Type",
	required: true,
	values: SENSITIVITY_TYPES,
	hint: "Data sensitivity classification."
};
const DATA_TIER = {
	key: "data_tier",
	label: "Data_Tier",
	required: true,
	values: TIER_ORDER,
	hint: "DAWG 0002 tier of this table."
};
const GRAIN = {
	key: "grain",
	label: "Grain",
	required: true,
	values: TIME_GRAINS,
	hint: "Time grain of a row: Event_Timestamp | Daily | Weekly | Monthly."
};
const LIFECYCLE = {
	key: "lifecycle_status",
	label: "Lifecycle_Status",
	required: true,
	values: LIFECYCLE_STATUSES,
	hint: "Draft, Active, or Deprecated (include deprecated date if Deprecated)."
};
const TIER0_OPTIONAL = [
	{
		key: "usage_notes",
		label: "Usage Notes",
		required: false
	},
	{
		key: "join_keys",
		label: "Join Keys",
		required: false
	},
	{
		key: "known_issues",
		label: "Known Issues",
		required: false
	},
	{
		key: "event_trigger",
		label: "Event creation trigger",
		required: false
	}
];
const TIER0_TABLE_TEMPLATE = [
	"General Description: what this table contains and its primary purpose.",
	"Business Value: who uses this data and what decisions or workflows it supports.",
	"Key Relationships / Join Keys: tables it joins to and the keys used.",
	"Usage Notes: important caveats or guidance for consumers.",
	"Known Issues: any data-quality caveats consumers should be aware of.",
	"Event Creation Trigger: what event or process produces rows (if applicable)."
].join("\n");
const STANDARD_TABLE_TEMPLATE = [
	"General Description: what this table contains and its primary purpose.",
	"Business Value: who uses this data and what decisions or workflows it supports.",
	"Key Relationships: tables it joins to and the join keys.",
	"Filters & Segments: common ways users filter or group this data."
].join("\n");
const MINIMAL_TABLE_TEMPLATE = ["General Description: a clear, concise explanation of what this dataset represents and its primary purpose."].join("\n");
const TIER0_COLUMN_TEMPLATE = "2-3 sentences: precise business definition, typical values or categories, and any join-key role or known caveats. Example: 'Total hours logged for the session. Common values: 1, 2, 4, 8. Joins to dim_time on hour_id.'";
const STANDARD_COLUMN_TEMPLATE = "1-2 sentences: business definition, then typical values or categories. Example: 'Total hours logged. Common values: 1, 2, 4, 8 hours.'";
const MINIMAL_COLUMN_TEMPLATE = "1 sentence: the business meaning of the column.";
const TIER_SPECS = {
	"0": {
		tier: "0",
		label: "Tier 0 (Critical)",
		critical: true,
		fields: [
			OWNER,
			DESCRIPTION,
			...TIER0_OPTIONAL,
			SENSITIVITY,
			DATA_TIER,
			GRAIN,
			LIFECYCLE
		],
		columnDescriptionsRequired: true,
		tableTemplate: TIER0_TABLE_TEMPLATE,
		columnTemplate: TIER0_COLUMN_TEMPLATE
	},
	"1": {
		tier: "1",
		label: "Tier 1",
		critical: false,
		fields: [
			OWNER,
			DESCRIPTION,
			SENSITIVITY,
			DATA_TIER,
			GRAIN,
			LIFECYCLE
		],
		columnDescriptionsRequired: false,
		tableTemplate: STANDARD_TABLE_TEMPLATE,
		columnTemplate: STANDARD_COLUMN_TEMPLATE
	},
	"2": {
		tier: "2",
		label: "Tier 2",
		critical: false,
		fields: [
			OWNER,
			DESCRIPTION,
			SENSITIVITY,
			DATA_TIER,
			GRAIN,
			LIFECYCLE
		],
		columnDescriptionsRequired: false,
		tableTemplate: STANDARD_TABLE_TEMPLATE,
		columnTemplate: STANDARD_COLUMN_TEMPLATE
	},
	"3": {
		tier: "3",
		label: "Tier 3",
		critical: false,
		fields: [
			OWNER,
			DESCRIPTION,
			SENSITIVITY,
			DATA_TIER,
			GRAIN,
			LIFECYCLE
		],
		columnDescriptionsRequired: false,
		tableTemplate: STANDARD_TABLE_TEMPLATE,
		columnTemplate: STANDARD_COLUMN_TEMPLATE
	},
	"4": {
		tier: "4",
		label: "Tier 4 / Non-Tiered",
		critical: false,
		fields: [
			OWNER,
			DESCRIPTION,
			LIFECYCLE
		],
		columnDescriptionsRequired: false,
		tableTemplate: MINIMAL_TABLE_TEMPLATE,
		columnTemplate: MINIMAL_COLUMN_TEMPLATE
	}
};
/** The tier used when a table has no recognizable data_tier tag. */
const DEFAULT_TIER = "4";
/**
* Normalize an arbitrary governed-tag value into a known Tier.
* Accepts "0", "tier 0", "Tier0", "T0", "critical" (→ 0), etc.
* Returns null when it can't be mapped so callers can fall back.
*/
function normalizeTier(raw) {
	if (!raw) return null;
	const s = raw.toString().trim().toLowerCase();
	if (s === "critical") return "0";
	const m = s.match(/(?:tier|t)?\s*([0-4])/);
	if (m && TIER_ORDER.includes(m[1])) return m[1];
	return null;
}
function tierSpec(tier) {
	return TIER_SPECS[tier];
}

//#endregion
export { DEFAULT_TIER, TIER_ORDER, normalizeTier, tierSpec };
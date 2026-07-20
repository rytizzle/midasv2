# Feedback implementation — `ddexter/feedback`

This branch implements four pieces of review feedback.

## 1. Default "show all tables" view
- New `GET /api/catalog/all-tables` lists every table across a catalog in one
  bounded `INFORMATION_SCHEMA.TABLES` query (LIMIT/OFFSET), joined to the owner
  and `data_tier` governed tags. Columns are **not** hydrated in the list — that
  happens only for selected tables via `POST /api/catalog/tables/hydrate` — so a
  ~39k-table catalog never streams in full.
- `BrowseMode` now auto-selects the first catalog and shows all tables
  immediately, with a debounced server-side search box, an optional schema
  filter, and prev/next paging. No catalog→schema drill-down required.
- Performance guards: page size capped at 500 (`MAX_TABLE_PAGE`), 300ms search
  debounce, and columns fetched lazily on selection.

## 2. Pre-vs-post diff review
- New `client/src/lib/diff.ts` (word-level LCS diff) + `DiffView` component
  render current vs. proposed values with add/remove highlighting.
- The **Review & Apply** wizard step has a Diff/Edit toggle (defaults to Diff)
  so submitters verify changes before submitting.
- The reviewer/approval view (`ChangeDiff`) now shows the same side-by-side diff
  instead of a collapsed "current value" details block.

## 3. Owner-group-based approval
- A change can be approved only by a member of the table's **owner group**,
  resolved from the `owner` governed tag at submit time and stored on
  `midas.change_proposals.owner_group`.
- `server/lib/admin.ts` exposes `callerGroups()` / `canApprove()` using the
  cached `currentUser.me().groups` SCIM lookup. `POST /sessions/:id/decide`
  gates each selected change on its owner group and 403s if the caller lacks
  authority over any of them.
- Session list/detail visibility widened so owner-group members see submissions
  they can act on. `GET /api/me/role` now returns `groups` + `can_approve`.
- Config: `MIDAS_OWNER_TAG_KEY` (default `owner`), optional `MIDAS_ADMIN_OVERRIDE`
  group. Untagged tables fall back to workspace-admin approval so nothing sticks.

## 4. Tier-based metadata templates (DAWG 0003)
- `shared/tiers.ts` encodes the DAWG 0003 per-tier requirements (Tier 0 critical
  through Tier 4 / non-tiered) as the single source of truth for server prompts
  and client checklists.
- A table's tier comes from the `data_tier` governed tag
  (`MIDAS_TIER_TAG_KEY`). Each tier drives a different generation template;
  `buildPrompt` applies the tier template unless the user overrides it in the
  shared context (now empty by default).
- The Review step shows a per-table **DAWG 0003 requirements checklist** and a
  tier badge; the Context step's templates are opt-in overrides with
  "load standard default" affordances.

### Schema migration
`midas.change_proposals` gains a nullable `owner_group` column (added
idempotently in `ensureSchema`); existing rows backfill to `null`
(admin-approved).

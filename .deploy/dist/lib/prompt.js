import { tierSpec } from "../shared/tiers.js";

//#region server/lib/prompt.ts
function buildPrompt(tableName, profile, ctx, tierCtx) {
	const userContextParts = [];
	if (ctx.blurb) userContextParts.push(ctx.blurb);
	if (ctx.docs) userContextParts.push(`Additional docs: ${ctx.docs}`);
	const userContext = userContextParts.join("\n\n") || "None provided";
	const firstNonBlank = (...vals) => vals.find((v) => v != null && v.trim() !== "");
	const spec = tierCtx?.tier ? tierSpec(tierCtx.tier) : null;
	const effectiveTableTemplate = firstNonBlank(tierCtx?.tableTemplate, ctx.tableTemplate, spec?.tableTemplate);
	const effectiveColumnTemplate = firstNonBlank(tierCtx?.columnTemplate, ctx.columnTemplate, spec?.columnTemplate);
	const tierHeader = spec ? `\nDATA TIER: ${spec.label} (DAWG 0003). ${spec.critical ? "This is CRITICAL data — be thorough and precise." : "Apply the metadata depth appropriate to this tier."}` : "";
	const columns = profile.columns ?? [];
	const sampleRows = profile.sample_rows ?? [];
	return `You are a metadata expert for Databricks Unity Catalog. Generate concise, Genie-optimized metadata for the table below.

TABLE: ${tableName}${tierHeader}
USER CONTEXT: ${userContext}

COLUMNS:
${columns.map((c) => `- ${c.name} (${c.type}): ${c.distinct_count ?? "?"} distinct, ${c.null_pct ?? "?"}% null, samples: ${JSON.stringify(c.sample_values ?? [])}`).join("\n")}

SAMPLE ROWS:
${sampleRows.length ? JSON.stringify(sampleRows.slice(0, 5), null, 2) : "No samples"}

Generate a JSON response with:
${effectiveTableTemplate ? `1. "table_comment": A flowing prose description (no section headings or labels). Use the following template ONLY as a guide for what topics to cover, but write it as clean continuous text:
${effectiveTableTemplate}

Do NOT include section headings like "General Description" or "Business Value" in the output. Do NOT mention row counts or number of records — tables change over time.` : "1. \"table_comment\": A 1-2 sentence description of what this table contains. Reference specific data patterns you observe. Do NOT mention row counts or number of records — tables change over time."}
${effectiveColumnTemplate ? `2. "columns": An object where each key is a column name and the value is an object with:
   - "description": Follow this format: ${effectiveColumnTemplate}` : `2. "columns": An object where each key is a column name and the value is an object with:
   - "description": A concise description (1 sentence) that helps Genie understand the column's meaning, typical values, and business context.`}

Focus on being specific to the actual data patterns. Mention value ranges, common categories, and business meaning.
Return ONLY valid JSON, no markdown fences.`;
}
function stripCodeFences(s) {
	const trimmed = s.trim();
	if (!trimmed.startsWith("```")) return trimmed;
	const firstNl = trimmed.indexOf("\n");
	if (firstNl < 0) return trimmed;
	const body = trimmed.slice(firstNl + 1);
	const closeIdx = body.lastIndexOf("```");
	return (closeIdx >= 0 ? body.slice(0, closeIdx) : body).trim();
}

//#endregion
export { buildPrompt, stripCodeFences };
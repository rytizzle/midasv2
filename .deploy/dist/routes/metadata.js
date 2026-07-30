import { buildPrompt, stripCodeFences } from "../lib/prompt.js";

//#region server/routes/metadata.ts
async function callServing(req, body) {
	const endpoint = process.env.DATABRICKS_SERVING_ENDPOINT_NAME || "databricks-gpt-5-4";
	const host = process.env.DATABRICKS_HOST || "";
	const token = req.header("x-forwarded-access-token");
	if (!host) throw new Error("DATABRICKS_HOST not set");
	if (!token) throw new Error("Missing user OAuth token");
	const url = `${host.startsWith("http") ? host : `https://${host}`}/serving-endpoints/${endpoint}/invocations`;
	const resp = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`
		},
		body: JSON.stringify(body)
	});
	if (!resp.ok) {
		const errText = await resp.text();
		throw new Error(`Serving ${endpoint} ${resp.status}: ${errText.slice(0, 300)}`);
	}
	return await resp.json();
}
async function generateForTable(req, tableName, profile, ctx, tierCtx) {
	const text = (await callServing(req, {
		messages: [{
			role: "user",
			content: buildPrompt(tableName, profile, ctx, tierCtx)
		}],
		max_tokens: 4096,
		temperature: .3
	})).choices?.[0]?.message?.content ?? "";
	if (!text) throw new Error("LLM returned empty content");
	const stripped = stripCodeFences(text);
	try {
		return JSON.parse(stripped);
	} catch (e) {
		throw new Error(`LLM output not JSON: ${stripped.slice(0, 200)}`);
	}
}
function registerMetadataRoutes(appkit) {
	appkit.server.extend((app) => {
		app.post("/api/metadata/generate", async (req, res) => {
			try {
				const body = req.body;
				const tables = body.tables ?? {};
				const ctx = body.context ?? {};
				const tiers = body.tiers ?? {};
				const results = {};
				for (const [fqn, profile] of Object.entries(tables)) try {
					results[fqn] = await generateForTable(req, fqn, profile, ctx, tiers[fqn]);
				} catch (e) {
					results[fqn] = { error: String(e.message ?? e) };
				}
				res.json(results);
			} catch (err) {
				res.status(500).json({ error: String(err.message ?? err) });
			}
		});
	});
}

//#endregion
export { registerMetadataRoutes };
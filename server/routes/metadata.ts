import type { Application, Request, Response } from 'express';
import { buildPrompt, stripCodeFences, type GenerationContext, type TableProfile } from '../lib/prompt';

interface AppKit {
  server: { extend(fn: (app: Application) => void): void };
}

interface GenerateRequest {
  tables?: Record<string, TableProfile>;
  context?: GenerationContext;
}

interface ColumnMeta {
  description: string;
}

interface TableMeta {
  table_comment: string;
  columns: Record<string, ColumnMeta>;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

async function callServing(
  req: Request,
  body: { messages: Array<{ role: string; content: string }>; max_tokens?: number; temperature?: number },
): Promise<ChatCompletionResponse> {
  const endpoint = process.env.DATABRICKS_SERVING_ENDPOINT_NAME || 'databricks-gpt-5-4';
  const host = process.env.DATABRICKS_HOST || '';
  const token = req.header('x-forwarded-access-token');
  if (!host) throw new Error('DATABRICKS_HOST not set');
  if (!token) throw new Error('Missing user OAuth token');
  const normalizedHost = host.startsWith('http') ? host : `https://${host}`;
  const url = `${normalizedHost}/serving-endpoints/${endpoint}/invocations`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Serving ${endpoint} ${resp.status}: ${errText.slice(0, 300)}`);
  }
  return (await resp.json()) as ChatCompletionResponse;
}

async function generateForTable(
  req: Request,
  tableName: string,
  profile: TableProfile,
  ctx: GenerationContext,
): Promise<TableMeta> {
  const prompt = buildPrompt(tableName, profile, ctx);
  const resp = await callServing(req, {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4096,
    temperature: 0.3,
  });
  const text = resp.choices?.[0]?.message?.content ?? '';
  if (!text) {
    throw new Error('LLM returned empty content');
  }
  const stripped = stripCodeFences(text);
  try {
    return JSON.parse(stripped) as TableMeta;
  } catch (e) {
    throw new Error(`LLM output not JSON: ${stripped.slice(0, 200)}`);
  }
}

export function registerMetadataRoutes(appkit: AppKit) {
  appkit.server.extend((app) => {
    app.post('/api/metadata/generate', async (req: Request, res: Response) => {
      try {
        const body = req.body as GenerateRequest;
        const tables = body.tables ?? {};
        const ctx = body.context ?? {};
        const results: Record<string, TableMeta | { error: string }> = {};
        for (const [fqn, profile] of Object.entries(tables)) {
          try {
            results[fqn] = await generateForTable(req, fqn, profile, ctx);
          } catch (e) {
            results[fqn] = { error: String((e as Error).message ?? e) };
          }
        }
        res.json(results);
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });
  });
}

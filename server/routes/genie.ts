import type { Application, Request, Response } from 'express';
import { userWorkspaceClient } from '../lib/user-client';

interface AppKit {
  server: { extend(fn: (app: Application) => void): void };
}

interface RoomLink {
  catalog: string;
  schema: string;
}

// In-memory link state (mirrors the original Python implementation).
// Resets on app restart; persist to UC or Lakebase if durability matters.
const roomLinks = new Map<string, RoomLink>();

export function registerGenieRoutes(appkit: AppKit) {
  appkit.server.extend((app) => {
    app.get('/api/genie/rooms', async (req: Request, res: Response) => {
      try {
        const ws = userWorkspaceClient(req);
        const pageToken =
          typeof req.query.page_token === 'string' ? req.query.page_token : undefined;
        const resp = await ws.genie.listSpaces({ page_token: pageToken });
        const rooms = (resp.spaces ?? []).map((s) => {
          const link = s.space_id ? roomLinks.get(s.space_id) : undefined;
          return {
            space_id: s.space_id,
            title: s.title || 'Untitled',
            description: s.description || '',
            linked: link != null,
            catalog: link?.catalog ?? null,
            schema: link?.schema ?? null,
          };
        });
        res.json({ rooms, next_page_token: resp.next_page_token ?? null });
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    app.get('/api/genie/rooms/:space_id/tables', async (req: Request, res: Response) => {
      const spaceId = String(req.params.space_id);
      try {
        const ws = userWorkspaceClient(req);
        const space = await ws.genie.getSpace({ space_id: spaceId });

        // The JS SDK doesn't surface serialized_space, so we resolve tables
        // from the user-defined link if present.
        const link = roomLinks.get(spaceId);
        const tableFqns: string[] = [];
        if (link) {
          for await (const t of ws.tables.list({
            catalog_name: link.catalog,
            schema_name: link.schema,
          })) {
            if (t.full_name) tableFqns.push(t.full_name);
          }
        }

        const tables: Array<Record<string, unknown>> = [];
        for (const fqn of tableFqns) {
          try {
            const t = await ws.tables.get({ full_name: fqn });
            const columns = (t.columns ?? []).map((col) => ({
              name: col.name ?? '',
              type: col.type_text ?? String(col.type_name ?? ''),
              comment: col.comment ?? '',
            }));
            tables.push({
              name: t.name ?? '',
              full_name: t.full_name ?? '',
              table_type: t.table_type ?? 'TABLE',
              comment: t.comment ?? '',
              columns,
              column_count: columns.length,
            });
          } catch {
            // Skip tables the user cannot read.
          }
        }

        res.json({
          space_id: space.space_id,
          title: space.title || 'Untitled',
          description: space.description || '',
          tables,
          ...(link ? {} : { hint: 'link_room_to_resolve_tables' }),
        });
      } catch (err) {
        res.status(500).json({ error: String((err as Error).message ?? err) });
      }
    });

    app.post('/api/genie/rooms/:space_id/link', (req: Request, res: Response) => {
      const spaceId = String(req.params.space_id);
      const body = req.body as { catalog?: string; schema_name?: string };
      if (!body.catalog || !body.schema_name) {
        res.status(400).json({ error: 'catalog and schema_name are required' });
        return;
      }
      roomLinks.set(spaceId, { catalog: body.catalog, schema: body.schema_name });
      res.json({ status: 'linked', catalog: body.catalog, schema: body.schema_name });
    });
  });
}

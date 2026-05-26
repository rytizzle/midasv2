import type { Request } from 'express';
import { WorkspaceClient } from '@databricks/sdk-experimental';

/**
 * Build an on-behalf-of-user WorkspaceClient from the Databricks Apps
 * X-Forwarded-* headers. Falls back to default SDK auth if the user token
 * is missing (e.g. when running outside the Apps runtime).
 */
export function userWorkspaceClient(req: Request): WorkspaceClient {
  const token = req.header('x-forwarded-access-token');
  // In Databricks Apps the X-Forwarded-Host header is the app's own URL,
  // not the workspace host. Always target DATABRICKS_HOST (workspace) and
  // use the forwarded user token for OBO. Falls back to default SDK auth.
  const host = process.env.DATABRICKS_HOST || '';

  if (token && host) {
    const normalizedHost = host.startsWith('http') ? host : `https://${host}`;
    return new WorkspaceClient({ host: normalizedHost, token, authType: 'pat' });
  }
  return new WorkspaceClient({});
}

export function userInfo(req: Request) {
  return {
    email: req.header('x-forwarded-email') || '',
    name: req.header('x-forwarded-preferred-username') || '',
    userId: req.header('x-forwarded-user') || '',
    token: req.header('x-forwarded-access-token') || '',
    host: req.header('x-forwarded-host') || '',
  };
}

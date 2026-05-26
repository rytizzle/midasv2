#!/usr/bin/env node
/*
 * Seed governed tags on the jira_* schemas in midas_catalog.
 *
 * - Creates governed tags (CREATE GOVERNED TAG ... VALUES (...)) if they
 *   don't already exist (errors with `already exists` are silently swallowed).
 * - Applies tags to specific tables via ALTER TABLE ... SET TAGS (...).
 *
 * Run:
 *   DATABRICKS_CONFIG_PROFILE=midas DATABRICKS_WAREHOUSE_ID=<id> \
 *     node scripts/seed-tags.mjs
 */

import { WorkspaceClient } from '@databricks/sdk-experimental';

const WAREHOUSE_ID = process.env.DATABRICKS_WAREHOUSE_ID;
if (!WAREHOUSE_ID) {
  console.error('Set DATABRICKS_WAREHOUSE_ID');
  process.exit(1);
}

const CATALOG = 'midas_catalog';

// NOTE: `pii` and `data_domain` already exist on this workspace with values that
// don't match what we want (pii = ssn/address, data_domain = train). We use
// `contains_pii` (already exists, true/false) and a new `business_domain` tag
// instead so we don't collide.
const governedTags = [
  {
    name: 'source_system',
    description: 'Upstream source system the dataset originates from',
    values: ['jira', 'salesforce', 'marketing', 'finance', 'product', 'platform'],
  },
  {
    name: 'medallion_layer',
    description: 'Bronze / silver / gold layer in the medallion architecture',
    values: ['bronze', 'silver', 'gold'],
  },
  {
    name: 'owner_team',
    description: 'Team responsible for the dataset',
    values: ['platform', 'analytics', 'customer_data', 'eng_productivity'],
  },
  {
    name: 'genie_ready',
    description: 'Whether the dataset has been documented and is ready for Genie',
    values: ['true', 'false'],
  },
];

// Tags to apply, keyed by table FQN
const tableTags = {
  'midas_catalog.jira_bronze.boards': {
    source_system: 'jira',
    medallion_layer: 'bronze',
    owner_team: 'eng_productivity',
    contains_pii: 'false',
    genie_ready: 'false',
  },
  'midas_catalog.jira_bronze.issues': {
    source_system: 'jira',
    medallion_layer: 'bronze',
    owner_team: 'eng_productivity',
    contains_pii: 'true',
    genie_ready: 'false',
  },
  'midas_catalog.jira_bronze.projects': {
    source_system: 'jira',
    medallion_layer: 'bronze',
    owner_team: 'eng_productivity',
    contains_pii: 'false',
    genie_ready: 'false',
  },
  'midas_catalog.jira_bronze.users': {
    source_system: 'jira',
    medallion_layer: 'bronze',
    owner_team: 'eng_productivity',
    contains_pii: 'true',
    genie_ready: 'false',
  },
  'midas_catalog.jira_bronze.worklogs': {
    source_system: 'jira',
    medallion_layer: 'bronze',
    owner_team: 'eng_productivity',
    contains_pii: 'false',
    genie_ready: 'false',
  },
  'midas_catalog.jira_silver.silver_issues': {
    source_system: 'jira',
    medallion_layer: 'silver',
    owner_team: 'eng_productivity',
    contains_pii: 'true',
    genie_ready: 'true',
  },
  'midas_catalog.jira_silver.silver_projects': {
    source_system: 'jira',
    medallion_layer: 'silver',
    owner_team: 'eng_productivity',
    contains_pii: 'false',
    genie_ready: 'true',
  },
  'midas_catalog.jira_silver.silver_users': {
    source_system: 'jira',
    medallion_layer: 'silver',
    owner_team: 'eng_productivity',
    contains_pii: 'true',
    genie_ready: 'true',
  },
  'midas_catalog.jira_silver.silver_worklogs': {
    source_system: 'jira',
    medallion_layer: 'silver',
    owner_team: 'eng_productivity',
    contains_pii: 'false',
    genie_ready: 'true',
  },
};

async function execSql(ws, statement) {
  let resp = await ws.statementExecution.executeStatement({
    statement,
    warehouse_id: WAREHOUSE_ID,
    wait_timeout: '50s',
    disposition: 'INLINE',
    format: 'JSON_ARRAY',
    on_wait_timeout: 'CONTINUE',
  });
  while (
    resp.statement_id &&
    resp.status?.state &&
    !['SUCCEEDED', 'FAILED', 'CANCELED', 'CLOSED'].includes(resp.status.state)
  ) {
    await new Promise((r) => setTimeout(r, 1000));
    resp = await ws.statementExecution.getStatement({ statement_id: resp.statement_id });
  }
  if (resp.status?.state !== 'SUCCEEDED') {
    const msg = resp.status?.error?.message ?? `state=${resp.status?.state}`;
    throw new Error(msg);
  }
  return resp;
}

function quote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

async function startWarehouseIfStopped(ws) {
  const wh = await ws.warehouses.get({ id: WAREHOUSE_ID });
  if (wh.state === 'RUNNING' || wh.state === 'STARTING') return;
  console.log(`Starting warehouse ${WAREHOUSE_ID}…`);
  await ws.warehouses.start({ id: WAREHOUSE_ID });
  // Poll until running
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const w = await ws.warehouses.get({ id: WAREHOUSE_ID });
    if (w.state === 'RUNNING') {
      console.log('Warehouse running.');
      return;
    }
  }
  throw new Error('Warehouse did not start within 5 minutes');
}

async function main() {
  const ws = new WorkspaceClient({});
  await startWarehouseIfStopped(ws);

  // 1) Create governed tags (ignore "already exists")
  for (const tag of governedTags) {
    const valuesClause = tag.values.length
      ? ` VALUES (${tag.values.map(quote).join(', ')})`
      : '';
    const descClause = tag.description ? ` DESCRIPTION ${quote(tag.description)}` : '';
    const stmt = `CREATE GOVERNED TAG ${tag.name}${descClause}${valuesClause}`;
    process.stdout.write(`Tag ${tag.name}: `);
    try {
      await execSql(ws, stmt);
      console.log('created.');
    } catch (e) {
      const msg = String(e.message ?? e);
      if (/already exists|TAG_ALREADY_EXISTS/i.test(msg)) {
        console.log('already exists.');
      } else {
        console.log(`error → ${msg.slice(0, 200)}`);
      }
    }
  }

  // 2) Apply tags to each table
  for (const [fqn, tags] of Object.entries(tableTags)) {
    const pairs = Object.entries(tags)
      .map(([k, v]) => `'${k}' = '${v}'`)
      .join(', ');
    const stmt = `ALTER TABLE ${fqn} SET TAGS (${pairs})`;
    process.stdout.write(`${fqn}: `);
    try {
      await execSql(ws, stmt);
      console.log('tagged.');
    } catch (e) {
      const msg = String(e.message ?? e);
      console.log(`error → ${msg.slice(0, 200)}`);
    }
  }

  // 3) Verify by reading INFORMATION_SCHEMA.TABLE_TAGS
  console.log('\nCurrent table tags in midas_catalog.jira_*:');
  const verify = await execSql(
    ws,
    `SELECT table_name, tag_name, tag_value
     FROM ${CATALOG}.INFORMATION_SCHEMA.TABLE_TAGS
     WHERE schema_name IN ('jira_bronze','jira_silver','jira_gold')
     ORDER BY table_name, tag_name`,
  );
  const rows = verify.result?.data_array ?? [];
  for (const [table, tag, value] of rows) {
    console.log(`  ${table.padEnd(20)} ${tag.padEnd(20)} = ${value}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

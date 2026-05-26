#!/usr/bin/env node
/*
 * Build a minimal .deploy/ payload for Databricks Apps:
 *  - dist/                  → server bundle (unbundled tsdown output)
 *  - client/dist/           → React client assets
 *  - shared/appkit-types/   → generated types AppKit's runtime tooling reads
 *  - package.json           → runtime deps only (no dev deps, no postinstall)
 *  - app.yaml               → command: ['npm', 'run', 'start']
 *  - appkit.plugins.json    → required by the plugin sync at runtime
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const deployDir = path.join(root, '.deploy');

function cpDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function main() {
  fs.rmSync(deployDir, { recursive: true, force: true });
  fs.mkdirSync(deployDir, { recursive: true });

  // Copy build outputs
  cpDir(path.join(root, 'dist'), path.join(deployDir, 'dist'));
  cpDir(path.join(root, 'client', 'dist'), path.join(deployDir, 'client', 'dist'));
  cpDir(path.join(root, 'shared'), path.join(deployDir, 'shared'));

  // Slim package.json — runtime deps only, no postinstall
  const src = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const runtime = {
    name: src.name,
    version: src.version,
    private: true,
    type: src.type,
    main: src.main,
    scripts: {
      start: 'NODE_ENV=production node --env-file-if-exists=./.env ./dist/server.js',
    },
    dependencies: src.dependencies,
  };
  fs.writeFileSync(
    path.join(deployDir, 'package.json'),
    JSON.stringify(runtime, null, 2) + '\n',
  );

  // app.yaml — copy from root so any env changes flow through
  fs.copyFileSync(path.join(root, 'app.yaml'), path.join(deployDir, 'app.yaml'));

  // Carry over appkit.plugins.json (runtime references it via env validation)
  const pluginsSrc = path.join(root, 'appkit.plugins.json');
  if (fs.existsSync(pluginsSrc)) {
    fs.copyFileSync(pluginsSrc, path.join(deployDir, 'appkit.plugins.json'));
  }

  console.log(`Deploy payload ready in ${path.relative(root, deployDir)}/`);
}

main();

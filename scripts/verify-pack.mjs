#!/usr/bin/env node
/**
 * verify-pack.mjs — prepublish invariant guard for @controlvector/cv-git.
 *
 * The DOA-install bug (published 1.5.0) was: the esbuild bundle marks native
 * modules as `--external:...` but the CLI package.json declared none of them,
 * so `npm install` fetched zero of them and every graph command died.
 *
 * Invariant enforced here:
 *   Every module marked `--external:` in the bundle script MUST appear in
 *   `dependencies` or `optionalDependencies` of packages/cli/package.json.
 *
 * A module that is intentionally bundled must NOT be in the externals list
 * (drop the `--external:` flag), so this guard needs no allow-list.
 *
 * Run from anywhere; resolves the CLI package.json relative to this file.
 * Exits non-zero (failing the pack/publish) if the invariant is violated.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cliPkgPath = join(here, '..', 'packages', 'cli', 'package.json');
const pkg = JSON.parse(readFileSync(cliPkgPath, 'utf8'));

const bundleScript = pkg.scripts?.bundle ?? '';
const externals = [...bundleScript.matchAll(/--external:([^\s]+)/g)].map((m) => m[1]);

if (externals.length === 0) {
  console.error('[verify-pack] Could not find any --external: flags in the bundle script.');
  console.error('[verify-pack] Refusing to publish: the guard cannot verify an unknown bundle config.');
  process.exit(1);
}

const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
]);

const missing = externals.filter((name) => !declared.has(name));

console.log(`[verify-pack] bundle externals (${externals.length}): ${externals.join(', ')}`);
console.log(`[verify-pack] declared deps (${declared.size}): ${[...declared].join(', ') || '(none)'}`);

if (missing.length > 0) {
  console.error('');
  console.error('[verify-pack] FAIL — these modules are external in the bundle but NOT declared');
  console.error('[verify-pack] in dependencies/optionalDependencies, so `npm install` will not');
  console.error('[verify-pack] fetch them and the graph path will be dead on arrival:');
  for (const name of missing) console.error(`  - ${name}`);
  console.error('');
  console.error('[verify-pack] Fix: add each to (optional)dependencies, or stop externalizing it.');
  process.exit(1);
}

console.log('[verify-pack] OK — every externalized module is declared. Safe to pack/publish.');

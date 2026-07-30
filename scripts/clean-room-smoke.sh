#!/usr/bin/env bash
#
# clean-room-smoke.sh — the regression guard whose absence let cv-git ship
# broken since May. It packs the REAL artifact, installs it into a directory
# with NO monorepo around it, and runs the actual graph path end to end.
#
# `cv --version` proves nothing; the graph path is what breaks. This script
# fails loudly if:
#   - the pack does not install its graph dependencies (the DOA bug), or
#   - the core CLI does not load, or
#   - indexing + a real Cypher query does not return a real result.
#
# Requirements:
#   - node >= 20, npm
#   - a FalkorDB server reachable at $FALKORDB_URL (default redis://localhost:6379)
#     In CI: `docker run -d -p 6379:6379 falkordb/falkordb:latest`
#
# Usage: scripts/clean-room-smoke.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FALKORDB_URL="${FALKORDB_URL:-redis://localhost:6379}"
WORK="$(mktemp -d /tmp/cv-cleanroom.XXXXXX)"
FIX="$(mktemp -d /tmp/cv-fixture.XXXXXX)"
cleanup() { rm -rf "$WORK" "$FIX"; }
trap cleanup EXIT

say() { printf '\n=== %s ===\n' "$1"; }

say "1. Static invariant guard (verify-pack)"
node "$REPO_ROOT/scripts/verify-pack.mjs"

say "2. Build + pack the CLI artifact"
( cd "$REPO_ROOT" && pnpm build >/dev/null 2>&1 )
TGZ="$(cd "$REPO_ROOT/packages/cli" && npm pack --silent)"
TGZ="$REPO_ROOT/packages/cli/$TGZ"
echo "packed: $TGZ"

say "3. Install into a clean room (no monorepo)"
( cd "$WORK" && echo '{"name":"cleanroom","version":"1.0.0","private":true}' > package.json \
  && npm install "$TGZ" --no-audit --no-fund )
CV="$WORK/node_modules/@controlvector/cv-git/dist/bundle.cjs"

say "4. Runtime invariant: externalized graph modules actually resolve"
node -e "
  const base = '$WORK/node_modules/@controlvector/cv-git';
  const req = require('module').createRequire(base + '/package.json');
  const mods = ['keytar','tree-sitter','falkordblite','@ladybugdb/core','tree-sitter-typescript'];
  const missing = mods.filter(m => { try { req.resolve(m); return false; } catch { return true; } });
  if (missing.length) { console.error('MISSING after install:', missing.join(', ')); process.exit(1); }
  console.log('resolved:', mods.join(', '));
"

say "5. Core loads (non-graph)"
node "$CV" --version
node "$CV" config list >/dev/null
echo "core OK"

say "6. Graph path end to end (index + query) against $FALKORDB_URL"
export CV_GIT_GRAPH_BACKEND=redis
export CV_FALKORDB_URL="$FALKORDB_URL"
cd "$FIX"
git init -q && git config user.email t@t.co && git config user.name t
mkdir -p src
printf 'export function add(a,b){return a+b;}\nexport function mul(a,b){return add(a,a);}\n' > src/math.ts
printf "import {add,mul} from './math';\nexport function run(){return add(mul(2,3),4);}\n" > src/main.ts
git add -A && git -c user.email=t@t.co -c user.name=t commit -qm init
node "$CV" init -y >/dev/null
node "$CV" sync --no-embeddings --full >/dev/null
ROWS="$(node "$CV" graph query "MATCH (f:File)-[:DEFINES]->(s:Symbol) RETURN s.name AS symbol ORDER BY symbol" 2>/dev/null)"
echo "$ROWS"
for sym in add mul run; do
  echo "$ROWS" | grep -q "$sym" || { echo "SMOKE FAIL: expected symbol '$sym' not in graph query result"; exit 1; }
done

say "SMOKE PASS: pack installs its deps, core loads, graph indexes and queries."

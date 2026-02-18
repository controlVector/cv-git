#!/usr/bin/env node
/**
 * Context Manifold Performance Benchmarks
 *
 * Measures lifecycle, refresh, ranking, assembly, persistence, memory,
 * MCP round-trip, and cache behaviour of the 9-dimension context manifold.
 *
 * Usage:
 *   node manifold-benchmark.mjs [options]
 *
 * Options:
 *   --json           Output results as JSON
 *   --save-baseline  Save results as new baseline
 *   --compare        Compare against baseline
 *   --output=<file>  Output file path (default: stdout for json)
 */

import { spawn } from 'child_process';
import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const BASELINE_FILE = path.join(ROOT_DIR, 'benchmarks', 'manifold-baseline.json');

// Parse CLI arguments
const args = process.argv.slice(2);
const outputJson = args.includes('--json');
const saveBaseline = args.includes('--save-baseline');
const compareBaseline = args.includes('--compare');
const outputArg = args.find(a => a.startsWith('--output='));
const outputFile = outputArg ? outputArg.split('=')[1] : null;

// ============================================================================
// Utility Functions
// ============================================================================

async function benchmark(name, fn, iterations = 10) {
  const times = [];

  // Warmup
  try {
    await fn();
  } catch (e) {
    return { name, error: e.message, skipped: true };
  }

  // Measured runs
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try {
      await fn();
    } catch (e) {
      return { name, error: e.message, skipped: true };
    }
    times.push(performance.now() - start);
  }

  const avgMs = times.reduce((a, b) => a + b, 0) / iterations;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);
  const stdDev = Math.sqrt(times.reduce((sum, t) => sum + Math.pow(t - avgMs, 2), 0) / iterations);

  return {
    name,
    iterations,
    avgMs: Number(avgMs.toFixed(3)),
    minMs: Number(minMs.toFixed(3)),
    maxMs: Number(maxMs.toFixed(3)),
    stdDev: Number(stdDev.toFixed(3)),
    opsPerSecond: Number((1000 / avgMs).toFixed(2)),
    skipped: false,
  };
}

function getMemoryUsage() {
  const mem = process.memoryUsage();
  return {
    heapUsedMB: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
    heapTotalMB: Number((mem.heapTotal / 1024 / 1024).toFixed(2)),
    rssMB: Number((mem.rss / 1024 / 1024).toFixed(2)),
    externalMB: Number((mem.external / 1024 / 1024).toFixed(2)),
  };
}

function loadBaseline() {
  try {
    if (fs.existsSync(BASELINE_FILE)) {
      return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error(`Warning: Could not load baseline: ${e.message}`);
  }
  return null;
}

function compareWithBaseline(results, baseline) {
  if (!baseline) return results;

  const compared = { ...results };
  compared.comparison = {};

  for (const [category, benchmarks] of Object.entries(results.benchmarks || {})) {
    compared.comparison[category] = {};

    for (const bench of benchmarks) {
      if (bench.skipped) continue;

      const baselineCategory = baseline.benchmarks?.[category];
      const baselineBench = baselineCategory?.find(b => b.name === bench.name);

      if (baselineBench && !baselineBench.skipped) {
        const diff = bench.avgMs - baselineBench.avgMs;
        const diffPercent = (diff / baselineBench.avgMs) * 100;

        compared.comparison[category][bench.name] = {
          baseline: baselineBench.avgMs,
          current: bench.avgMs,
          diffMs: Number(diff.toFixed(3)),
          diffPercent: Number(diffPercent.toFixed(2)),
          regression: diffPercent > 20,
          improvement: diffPercent < -10,
        };
      }
    }
  }

  return compared;
}

// ============================================================================
// Setup helpers
// ============================================================================

async function createBenchManifold() {
  const { createManifoldService } = await import(
    path.join(ROOT_DIR, 'packages/core/dist/services/index.js')
  );
  const { GraphManager } = await import(
    path.join(ROOT_DIR, 'packages/core/dist/graph/index.js')
  );
  const { GitManager } = await import(
    path.join(ROOT_DIR, 'packages/core/dist/git/index.js')
  );

  let graph = null;
  try {
    graph = new GraphManager({ url: 'redis://localhost:6379', repoId: 'cv-git' });
    await graph.connect();
  } catch {
    graph = null;
  }

  let git = null;
  try {
    git = new GitManager(ROOT_DIR);
  } catch {
    git = null;
  }

  const manifold = createManifoldService({
    repoRoot: ROOT_DIR,
    repoId: 'cv-git',
    graph,
    vector: null,
    git,
  });

  return { manifold, graph, git };
}

// MCP helpers
function sendRequest(server, request) {
  server.stdin.write(JSON.stringify(request) + '\n');
}

function waitForResponse(server, id, timeout = 20000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for response id=${id}`));
    }, timeout);

    const handler = (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.id === id) {
            clearTimeout(timer);
            server.stdout.off('data', handler);
            resolve(json);
            return;
          }
        } catch {
          // Not JSON
        }
      }
    };
    server.stdout.on('data', handler);
  });
}

// ============================================================================
// Benchmark Suites
// ============================================================================

async function runLifecycleBenchmarks() {
  const benchmarks = [];
  const { createManifoldService } = await import(
    path.join(ROOT_DIR, 'packages/core/dist/services/index.js')
  );
  const statePath = path.join(ROOT_DIR, '.cv', 'manifold', 'state.json');

  // Cold init — delete state then initialize
  benchmarks.push(await benchmark('manifold:init:cold', async () => {
    try { fs.unlinkSync(statePath); } catch { /* ok */ }
    const m = createManifoldService({ repoRoot: ROOT_DIR, repoId: 'cv-git' });
    await m.initialize();
    await m.close();
  }, 5));

  // Warm init — load existing state
  // First ensure a state file exists
  const setup = createManifoldService({ repoRoot: ROOT_DIR, repoId: 'cv-git' });
  await setup.initialize();
  await setup.save();
  await setup.close();

  benchmarks.push(await benchmark('manifold:init:warm', async () => {
    const m = createManifoldService({ repoRoot: ROOT_DIR, repoId: 'cv-git' });
    await m.initialize();
    await m.close();
  }, 10));

  return benchmarks;
}

async function runRefreshBenchmarks() {
  const benchmarks = [];
  const { manifold, graph, git } = await createBenchManifold();

  try {
    await manifold.initialize();

    // Full refreshAll
    benchmarks.push(await benchmark('manifold:refreshAll', async () => {
      await manifold.refreshAll();
    }, 5));

    // Individual dimensions
    benchmarks.push(await benchmark('manifold:update:structural', async () => {
      await manifold.updateStructural();
    }, 10));

    benchmarks.push(await benchmark('manifold:update:semantic', async () => {
      await manifold.updateSemantic();
    }, 10));

    benchmarks.push(await benchmark('manifold:update:temporal', async () => {
      await manifold.updateTemporal();
    }, 10));

    benchmarks.push(await benchmark('manifold:update:requirements', async () => {
      await manifold.updateRequirements();
    }, 10));

    benchmarks.push(await benchmark('manifold:update:summary', async () => {
      await manifold.updateSummary();
    }, 10));

    benchmarks.push(await benchmark('manifold:update:navigational', async () => {
      await manifold.updateNavigational();
    }, 10));

    benchmarks.push(await benchmark('manifold:update:session', async () => {
      await manifold.updateDevSession();
    }, 10));

    benchmarks.push(await benchmark('manifold:update:intent', async () => {
      await manifold.updateIntent();
    }, 10));

    benchmarks.push(await benchmark('manifold:update:impact', async () => {
      await manifold.updateImpact();
    }, 10));
  } finally {
    await manifold.close();
    if (graph) await graph.close();
  }

  return benchmarks;
}

async function runQueryBenchmarks() {
  const benchmarks = [];
  const { manifold, graph } = await createBenchManifold();

  try {
    await manifold.initialize();
    await manifold.refreshAll();

    // Ranking benchmarks — pure in-memory
    benchmarks.push(await benchmark('manifold:rank:structural', () => {
      manifold.rankDimensions('call dependencies', {}, 20000);
    }, 20));

    benchmarks.push(await benchmark('manifold:rank:semantic', () => {
      manifold.rankDimensions('find similar code', {}, 20000);
    }, 20));

    benchmarks.push(await benchmark('manifold:rank:temporal', () => {
      manifold.rankDimensions('recent changes', {}, 20000);
    }, 20));

    // End-to-end assembly
    benchmarks.push(await benchmark('manifold:assembleContext', async () => {
      await manifold.assembleContext('code overview', { budget: 20000 });
    }, 5));
  } finally {
    await manifold.close();
    if (graph) await graph.close();
  }

  return benchmarks;
}

async function runPersistenceBenchmarks() {
  const benchmarks = [];
  const { manifold, graph } = await createBenchManifold();

  try {
    await manifold.initialize();
    await manifold.refreshAll();

    benchmarks.push(await benchmark('manifold:save', async () => {
      await manifold.save();
    }, 10));

    const { createManifoldService } = await import(
      path.join(ROOT_DIR, 'packages/core/dist/services/index.js')
    );

    benchmarks.push(await benchmark('manifold:load', async () => {
      const m2 = createManifoldService({ repoRoot: ROOT_DIR, repoId: 'cv-git' });
      await m2.initialize();
      // No close needed — state is null after close, just let it GC
    }, 10));
  } finally {
    await manifold.close();
    if (graph) await graph.close();
  }

  return benchmarks;
}

async function runMemoryBenchmarks() {
  const benchmarks = [];

  if (global.gc) global.gc();
  const baseline = getMemoryUsage();

  const { manifold, graph } = await createBenchManifold();

  try {
    await manifold.initialize();
    await manifold.refreshAll();

    if (global.gc) global.gc();
    const after = getMemoryUsage();

    benchmarks.push({
      name: 'manifold:memory',
      heapUsedMB: after.heapUsedMB,
      rssMB: after.rssMB,
      deltaMB: Number((after.heapUsedMB - baseline.heapUsedMB).toFixed(2)),
      skipped: false,
    });
  } catch (e) {
    benchmarks.push({ name: 'manifold:memory', error: e.message, skipped: true });
  } finally {
    await manifold.close();
    if (graph) await graph.close();
  }

  return benchmarks;
}

async function runMcpBenchmarks() {
  const benchmarks = [];

  benchmarks.push(await benchmark('manifold:mcp:autocontext', async () => {
    const server = spawn('node', ['packages/mcp-server/dist/index.js'], {
      cwd: ROOT_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CV_LOG_LEVEL: 'error' },
    });

    try {
      // Initialize
      sendRequest(server, {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'bench', version: '1.0' },
        },
      });
      await waitForResponse(server, 1, 20000);

      // Call cv_auto_context
      sendRequest(server, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'cv_auto_context',
          arguments: { query: 'authentication flow', budget: 5000 },
        },
      });
      await waitForResponse(server, 2, 20000);
    } finally {
      server.kill();
    }
  }, 3));

  return benchmarks;
}

async function runCacheBenchmarks() {
  const benchmarks = [];
  const { manifold, graph } = await createBenchManifold();

  try {
    await manifold.initialize();
    await manifold.refreshAll();

    // Measure first vs repeat call
    const firstTimes = [];
    const secondTimes = [];
    const iterations = 5;

    for (let i = 0; i < iterations; i++) {
      const start1 = performance.now();
      await manifold.assembleContext('code overview', { budget: 20000 });
      firstTimes.push(performance.now() - start1);

      const start2 = performance.now();
      await manifold.assembleContext('code overview', { budget: 20000 });
      secondTimes.push(performance.now() - start2);
    }

    const avgFirst = firstTimes.reduce((a, b) => a + b, 0) / iterations;
    const avgSecond = secondTimes.reduce((a, b) => a + b, 0) / iterations;
    const ratio = avgSecond > 0 ? avgFirst / avgSecond : 1;

    benchmarks.push({
      name: 'manifold:cache:repeat',
      iterations,
      avgFirstMs: Number(avgFirst.toFixed(3)),
      avgSecondMs: Number(avgSecond.toFixed(3)),
      ratio: Number(ratio.toFixed(2)),
      skipped: false,
    });
  } catch (e) {
    benchmarks.push({ name: 'manifold:cache:repeat', error: e.message, skipped: true });
  } finally {
    await manifold.close();
    if (graph) await graph.close();
  }

  return benchmarks;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const startTime = new Date().toISOString();
  const results = {
    timestamp: startTime,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    benchmarks: {},
  };

  if (!outputJson) {
    console.log('');
    console.log('Context Manifold Performance Benchmarks');
    console.log('');
    console.log(`Node: ${process.version}`);
    console.log(`Platform: ${process.platform} ${process.arch}`);
    console.log(`Time: ${startTime}`);
    console.log('');
  }

  // --- Lifecycle ---
  if (!outputJson) console.log('Lifecycle Benchmarks');
  results.benchmarks.lifecycle = await runLifecycleBenchmarks();
  if (!outputJson) {
    for (const b of results.benchmarks.lifecycle) {
      if (b.skipped) {
        console.log(`  ${b.name}: SKIPPED (${b.error})`);
      } else {
        console.log(`  ${b.name}: ${b.avgMs.toFixed(2)}ms avg (${b.opsPerSecond} ops/sec)`);
      }
    }
    console.log('');
  }

  // --- Refresh ---
  if (!outputJson) console.log('Refresh Benchmarks');
  results.benchmarks.refresh = await runRefreshBenchmarks();
  if (!outputJson) {
    for (const b of results.benchmarks.refresh) {
      if (b.skipped) {
        console.log(`  ${b.name}: SKIPPED (${b.error})`);
      } else {
        console.log(`  ${b.name}: ${b.avgMs.toFixed(2)}ms avg (${b.opsPerSecond} ops/sec)`);
      }
    }
    console.log('');
  }

  // --- Query ---
  if (!outputJson) console.log('Query Benchmarks');
  results.benchmarks.query = await runQueryBenchmarks();
  if (!outputJson) {
    for (const b of results.benchmarks.query) {
      if (b.skipped) {
        console.log(`  ${b.name}: SKIPPED (${b.error})`);
      } else {
        console.log(`  ${b.name}: ${b.avgMs.toFixed(2)}ms avg (${b.opsPerSecond} ops/sec)`);
      }
    }
    console.log('');
  }

  // --- Persistence ---
  if (!outputJson) console.log('Persistence Benchmarks');
  results.benchmarks.persistence = await runPersistenceBenchmarks();
  if (!outputJson) {
    for (const b of results.benchmarks.persistence) {
      if (b.skipped) {
        console.log(`  ${b.name}: SKIPPED (${b.error})`);
      } else {
        console.log(`  ${b.name}: ${b.avgMs.toFixed(2)}ms avg (${b.opsPerSecond} ops/sec)`);
      }
    }
    console.log('');
  }

  // --- Memory ---
  if (!outputJson) console.log('Memory Benchmarks');
  results.benchmarks.memory = await runMemoryBenchmarks();
  if (!outputJson) {
    for (const b of results.benchmarks.memory) {
      if (b.skipped) {
        console.log(`  ${b.name}: SKIPPED (${b.error})`);
      } else {
        console.log(`  ${b.name}: ${b.heapUsedMB}MB heap (+${b.deltaMB}MB delta), ${b.rssMB}MB RSS`);
      }
    }
    console.log('');
  }

  // --- MCP ---
  if (!outputJson) console.log('MCP Round-trip Benchmarks');
  results.benchmarks.mcp = await runMcpBenchmarks();
  if (!outputJson) {
    for (const b of results.benchmarks.mcp) {
      if (b.skipped) {
        console.log(`  ${b.name}: SKIPPED (${b.error})`);
      } else {
        console.log(`  ${b.name}: ${b.avgMs.toFixed(2)}ms avg`);
      }
    }
    console.log('');
  }

  // --- Cache ---
  if (!outputJson) console.log('Cache Benchmarks');
  results.benchmarks.cache = await runCacheBenchmarks();
  if (!outputJson) {
    for (const b of results.benchmarks.cache) {
      if (b.skipped) {
        console.log(`  ${b.name}: SKIPPED (${b.error})`);
      } else {
        console.log(`  ${b.name}: first=${b.avgFirstMs.toFixed(2)}ms, repeat=${b.avgSecondMs.toFixed(2)}ms, ratio=${b.ratio}x`);
      }
    }
    console.log('');
  }

  // Compare with baseline if requested
  let finalResults = results;
  if (compareBaseline) {
    const baseline = loadBaseline();
    if (baseline) {
      finalResults = compareWithBaseline(results, baseline);

      if (!outputJson && finalResults.comparison) {
        console.log('Baseline Comparison');
        for (const [category, comparisons] of Object.entries(finalResults.comparison)) {
          for (const [name, comp] of Object.entries(comparisons)) {
            const arrow = comp.regression ? '!!!' : comp.improvement ? '+++' : '   ';
            const sign = comp.diffPercent >= 0 ? '+' : '';
            console.log(`  ${arrow} ${name}: ${sign}${comp.diffPercent}% (${comp.baseline}ms -> ${comp.current}ms)`);
          }
        }
        console.log('');
      }
    } else {
      if (!outputJson) console.log('No baseline found for comparison\n');
    }
  }

  // Save baseline if requested
  if (saveBaseline) {
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(results, null, 2));
    if (!outputJson) console.log(`Baseline saved to ${BASELINE_FILE}\n`);
  }

  // Output JSON if requested
  if (outputJson) {
    const jsonOutput = JSON.stringify(finalResults, null, 2);
    if (outputFile) {
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });
      fs.writeFileSync(outputFile, jsonOutput);
    } else {
      console.log(jsonOutput);
    }
  } else {
    // Summary table
    console.log('Summary');
    console.log('| Benchmark | Avg (ms) | Min | Max | Ops/sec |');
    console.log('|-----------|----------|-----|-----|---------|');
    for (const [category, benchmarks] of Object.entries(results.benchmarks)) {
      for (const b of benchmarks) {
        if (!b.skipped && b.avgMs !== undefined) {
          console.log(`| ${b.name.padEnd(30)} | ${b.avgMs.toFixed(2).padStart(8)} | ${b.minMs?.toFixed(2).padStart(5) || '  N/A'} | ${b.maxMs?.toFixed(2).padStart(5) || '  N/A'} | ${(b.opsPerSecond || 0).toString().padStart(7)} |`);
        }
      }
    }
    console.log('');
    console.log('Benchmarks complete');
  }

  // Check for regressions
  if (finalResults.comparison) {
    const regressions = [];
    for (const [category, comparisons] of Object.entries(finalResults.comparison)) {
      for (const [name, comp] of Object.entries(comparisons)) {
        if (comp.regression) {
          regressions.push(`${name}: +${comp.diffPercent}%`);
        }
      }
    }
    if (regressions.length > 0) {
      console.error('\nPerformance regressions detected:');
      regressions.forEach(r => console.error(`  - ${r}`));
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});

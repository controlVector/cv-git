/**
 * Context Manifold Integration Tests
 *
 * Tests the 9-dimension context manifold: lifecycle, ranking, assembly, health,
 * persistence, and MCP tool integration.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import assert from 'assert';
import { promises as fs } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const ALL_DIMENSIONS = [
  'structural', 'semantic', 'temporal', 'requirements', 'summary',
  'navigational', 'session', 'intent', 'impact'
];

// ============================================================================
// Helpers — Direct service tests
// ============================================================================

async function createTestManifold() {
  const { createManifoldService } = await import(
    '../../packages/core/dist/services/index.js'
  );
  const { GraphManager } = await import(
    '../../packages/core/dist/graph/index.js'
  );
  const { GitManager } = await import(
    '../../packages/core/dist/git/index.js'
  );

  let graph = null;
  try {
    graph = new GraphManager({ url: 'redis://localhost:6379', repoId: 'cv-git' });
    await graph.connect();
  } catch {
    graph = null; // FalkorDB unavailable — tests degrade gracefully
  }

  let git = null;
  try {
    git = new GitManager(PROJECT_ROOT);
  } catch {
    git = null;
  }

  const manifold = createManifoldService({
    repoRoot: PROJECT_ROOT,
    repoId: 'cv-git',
    graph,
    vector: null, // No Qdrant dependency
    git,
  });

  return { manifold, graph, git };
}

// ============================================================================
// Helpers — MCP spawn tests
// ============================================================================

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
          // Not JSON, continue
        }
      }
    };

    server.stdout.on('data', handler);
  });
}

function startServer() {
  const server = spawn('node', ['packages/mcp-server/dist/index.js'], {
    cwd: PROJECT_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CV_LOG_LEVEL: 'error' },
  });

  let stderr = '';
  server.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  return { server, getStderr: () => stderr };
}

async function initializeServer(server) {
  sendRequest(server, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'manifold-test', version: '1.0' },
    },
  });
  return await waitForResponse(server, 1);
}

// ============================================================================
// Test runner
// ============================================================================

async function runTests() {
  const tests = [];
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // === TEST DEFINITIONS ===

  // ---- Test 1: Initializes and creates state file ----
  test('Initializes and creates state file', async () => {
    const { manifold, graph } = await createTestManifold();
    try {
      await manifold.initialize();

      // getState() should return valid state
      const state = manifold.getState();
      assert(state, 'getState() should return non-null');
      assert.strictEqual(state.version, 1, 'State version should be 1');

      // All 9 dimension keys should be present
      for (const dim of ALL_DIMENSIONS) {
        assert(
          state.dimensions[dim] !== undefined,
          `Dimension "${dim}" should be present in state`
        );
      }

      // save() persists state file to disk
      await manifold.save();
      const statePath = path.join(PROJECT_ROOT, '.cv', 'manifold', 'state.json');
      const stat = await fs.stat(statePath);
      assert(stat.isFile(), 'State file should exist after save');
    } finally {
      await manifold.close();
      if (graph) await graph.close();
    }
  });

  // ---- Test 2: All dimensions populate after refreshAll ----
  test('All dimensions populate after refreshAll', async () => {
    const { manifold, graph, git } = await createTestManifold();
    try {
      await manifold.initialize();
      await manifold.refreshAll();

      const state = manifold.getState();
      assert(state, 'State should exist after refresh');

      // Dimensions that depend on git should populate if git is available
      if (git) {
        const gitDims = ['temporal', 'session', 'intent'];
        for (const dim of gitDims) {
          assert(
            state.dimensions[dim].lastUpdated > 0,
            `Git dimension "${dim}" should have lastUpdated > 0`
          );
        }
      }

      // Impact should always update (even with empty modified files)
      assert(
        state.dimensions.impact.lastUpdated > 0,
        'Impact dimension should have lastUpdated > 0'
      );

      // Summary should always update
      assert(
        state.dimensions.summary.lastUpdated > 0,
        'Summary dimension should have lastUpdated > 0'
      );

      // Navigational should always update
      assert(
        state.dimensions.navigational.lastUpdated > 0,
        'Navigational dimension should have lastUpdated > 0'
      );

      // Structural should update if graph is available
      if (graph) {
        assert(
          state.dimensions.structural.lastUpdated > 0,
          'Structural dimension should have lastUpdated > 0 when graph available'
        );
      }
    } finally {
      await manifold.close();
      if (graph) await graph.close();
    }
  });

  // ---- Test 3: rankDimensions returns signals for all dimensions ----
  test('rankDimensions returns signals for all dimensions', async () => {
    const { manifold, graph } = await createTestManifold();
    try {
      await manifold.initialize();
      await manifold.refreshAll();

      const signals = manifold.rankDimensions('call dependencies', {}, 20000);

      assert.strictEqual(signals.length, 9, 'Should return 9 signals');

      for (const signal of signals) {
        assert(signal.dimension, 'Signal should have dimension');
        assert(typeof signal.score === 'number', 'Signal should have numeric score');
        assert(typeof signal.tokenBudget === 'number', 'Signal should have numeric tokenBudget');
        assert(Array.isArray(signal.refs), 'Signal should have refs array');
        assert(typeof signal.available === 'boolean', 'Signal should have boolean available');
      }

      // Total token budget should approximately equal 20000
      const totalBudget = signals.reduce((sum, s) => sum + s.tokenBudget, 0);
      assert(totalBudget > 0, 'Total token budget should be > 0');
      // Allow some slack due to floor rounding
      assert(
        totalBudget <= 20000,
        `Total budget (${totalBudget}) should not exceed 20000`
      );
    } finally {
      await manifold.close();
      if (graph) await graph.close();
    }
  });

  // ---- Test 4: Rankings vary by query type ----
  test('Rankings vary by query type', async () => {
    const { manifold, graph } = await createTestManifold();
    try {
      await manifold.initialize();
      await manifold.refreshAll();

      const structuralQuery = manifold.rankDimensions('call dependencies graph', {}, 20000);
      const semanticQuery = manifold.rankDimensions('find similar code search', {}, 20000);
      const temporalQuery = manifold.rankDimensions('recent changes history', {}, 20000);

      // Get top dimension for each query
      const topStructural = structuralQuery[0].dimension;
      const topSemantic = semanticQuery[0].dimension;
      const topTemporal = temporalQuery[0].dimension;

      // At least two of the three top dimensions should be different
      const unique = new Set([topStructural, topSemantic, topTemporal]);
      assert(
        unique.size >= 2,
        `At least 2 different top dimensions expected, got: ${[topStructural, topSemantic, topTemporal].join(', ')}`
      );
    } finally {
      await manifold.close();
      if (graph) await graph.close();
    }
  });

  // ---- Test 5: assembleContext respects token budget ----
  test('assembleContext respects token budget', async () => {
    const { manifold, graph } = await createTestManifold();
    try {
      await manifold.initialize();
      await manifold.refreshAll();

      const smallResult = await manifold.assembleContext('code overview', { budget: 500 });
      const largeResult = await manifold.assembleContext('code overview', { budget: 20000 });

      assert(smallResult.context !== undefined, 'Small result should have context');
      assert(largeResult.context !== undefined, 'Large result should have context');
      assert(smallResult.metadata, 'Small result should have metadata');
      assert(largeResult.metadata, 'Large result should have metadata');

      // Large budget should produce longer or equal context
      assert(
        largeResult.context.length >= smallResult.context.length,
        `Large budget context (${largeResult.context.length}) should be >= small budget context (${smallResult.context.length})`
      );
    } finally {
      await manifold.close();
      if (graph) await graph.close();
    }
  });

  // ---- Test 6: assembleContext format options work ----
  test('assembleContext format options work', async () => {
    const { manifold, graph } = await createTestManifold();
    try {
      await manifold.initialize();
      await manifold.refreshAll();

      const xmlResult = await manifold.assembleContext('overview', { format: 'xml', budget: 5000 });
      const mdResult = await manifold.assembleContext('overview', { format: 'markdown', budget: 5000 });
      const jsonResult = await manifold.assembleContext('overview', { format: 'json', budget: 5000 });

      // XML should contain manifold_context tag
      if (xmlResult.context.length > 0) {
        assert(
          xmlResult.context.includes('<manifold_context>'),
          'XML output should contain <manifold_context>'
        );
      }

      // Markdown should contain # Context header
      if (mdResult.context.length > 0) {
        assert(
          mdResult.context.includes('# Context'),
          'Markdown output should contain "# Context"'
        );
      }

      // JSON should be parseable
      if (jsonResult.context.length > 0) {
        let parsed;
        try {
          parsed = JSON.parse(jsonResult.context);
        } catch (e) {
          assert.fail(`JSON output should be parseable: ${e.message}`);
        }
        assert(parsed.query, 'JSON output should have query field');
      }
    } finally {
      await manifold.close();
      if (graph) await graph.close();
    }
  });

  // ---- Test 7: Graceful degradation without vector ----
  test('Graceful degradation without vector', async () => {
    const { manifold, graph } = await createTestManifold();
    try {
      await manifold.initialize();
      await manifold.refreshAll();

      // Vector is null, so semantic dimension should be unavailable
      const signals = manifold.rankDimensions('find similar code', {}, 20000);
      const semantic = signals.find(s => s.dimension === 'semantic');

      assert(semantic, 'Should have semantic signal');
      assert.strictEqual(semantic.available, false, 'Semantic should be unavailable without vector');

      // assembleContext should still succeed
      const result = await manifold.assembleContext('search code', { budget: 5000 });
      assert(result, 'assembleContext should succeed without vector');
      assert(result.metadata, 'Result should have metadata');
    } finally {
      await manifold.close();
      if (graph) await graph.close();
    }
  });

  // ---- Test 8: Auto-creates state from scratch ----
  test('Auto-creates state from scratch', async () => {
    const { manifold, graph } = await createTestManifold();
    try {
      // Delete existing state file
      const statePath = path.join(PROJECT_ROOT, '.cv', 'manifold', 'state.json');
      try {
        await fs.unlink(statePath);
      } catch {
        // File may not exist
      }

      // Initialize should create fresh state without error
      await manifold.initialize();

      const state = manifold.getState();
      assert(state, 'State should be created from scratch');
      assert.strictEqual(state.version, 1, 'Fresh state should have version 1');

      // State file should be recreated after save
      await manifold.save();
      const stat = await fs.stat(statePath);
      assert(stat.isFile(), 'State file should be recreated after save');
    } finally {
      await manifold.close();
      if (graph) await graph.close();
    }
  });

  // ---- Test 9: getHealth returns valid report ----
  test('getHealth returns valid report', async () => {
    const { manifold, graph } = await createTestManifold();
    try {
      await manifold.initialize();
      await manifold.refreshAll();

      const health = await manifold.getHealth();

      assert(health.overall, 'Health should have overall status');
      assert(
        ['healthy', 'degraded', 'unavailable'].includes(health.overall),
        `Overall status should be valid, got: ${health.overall}`
      );

      // All 9 dimensions should be present in health report
      for (const dim of ALL_DIMENSIONS) {
        assert(
          health.dimensions[dim] !== undefined,
          `Health should have dimension "${dim}"`
        );
        assert(
          health.dimensions[dim].status,
          `Dimension "${dim}" should have status`
        );
        assert(
          typeof health.dimensions[dim].lastUpdated !== 'undefined',
          `Dimension "${dim}" should have lastUpdated`
        );
      }

      // State file info
      assert(health.stateFile, 'Health should have stateFile info');
      assert(typeof health.stateFile.exists === 'boolean', 'stateFile should have exists');
    } finally {
      await manifold.close();
      if (graph) await graph.close();
    }
  });

  // ---- Test 10: State persistence round-trip ----
  test('State persistence round-trip', async () => {
    const { manifold, graph } = await createTestManifold();
    try {
      await manifold.initialize();
      await manifold.refreshAll();
      await manifold.save();

      // Capture state as JSON
      const originalState = JSON.stringify(manifold.getState());

      // Create a new manifold instance and load the same state
      const { createManifoldService } = await import(
        '../../packages/core/dist/services/index.js'
      );
      const manifold2 = createManifoldService({
        repoRoot: PROJECT_ROOT,
        repoId: 'cv-git',
        graph,
        vector: null,
      });

      await manifold2.initialize();

      const loadedState = JSON.stringify(manifold2.getState());
      assert.strictEqual(
        loadedState,
        originalState,
        'Loaded state should match saved state'
      );

      await manifold2.close();
    } finally {
      await manifold.close();
      if (graph) await graph.close();
    }
  });

  // ---- Test 11: MCP cv_manifold_status returns health ----
  test('MCP: cv_manifold_status returns health', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      sendRequest(server, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'cv_manifold_status',
          arguments: { refresh: false },
        },
      });

      const response = await waitForResponse(server, 2, 20000);

      assert(response.result, 'Should have result');
      assert(Array.isArray(response.result.content), 'content should be an array');

      const textContent = response.result.content.find(c => c.type === 'text');
      assert(textContent, 'Should have text content');

      const text = textContent.text.toLowerCase();
      // Should mention dimension names
      assert(
        text.includes('structural') || text.includes('dimension') || text.includes('manifold'),
        'Response should contain manifold-related terms'
      );
    } finally {
      server.kill();
    }
  });

  // ---- Test 12: MCP cv_auto_context returns context ----
  test('MCP: cv_auto_context returns context', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      sendRequest(server, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'cv_auto_context',
          arguments: {
            query: 'authentication flow',
            format: 'xml',
            budget: 5000,
          },
        },
      });

      const response = await waitForResponse(server, 3, 20000);

      assert(response.result, 'Should have result');
      assert(Array.isArray(response.result.content), 'content should be an array');

      const textContent = response.result.content.find(c => c.type === 'text');
      assert(textContent, 'Should have text content');
      assert(textContent.text.length > 0, 'Response text should be non-empty');
    } finally {
      server.kill();
    }
  });

  // === RUN TESTS ===

  console.log('\nRunning Context Manifold Integration Tests\n');
  console.log('='.repeat(50));

  for (const { name, fn } of tests) {
    process.stdout.write(`  ${name}... `);
    try {
      await fn();
      console.log('PASSED');
      passed++;
    } catch (error) {
      console.log('FAILED');
      console.error(`    Error: ${error.message}`);
      if (process.env.VERBOSE) {
        console.error(`    Stack: ${error.stack}`);
      }
      failed++;
    }
  }

  console.log('='.repeat(50));
  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});

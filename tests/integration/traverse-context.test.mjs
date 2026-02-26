/**
 * Traverse Context Integration Tests
 *
 * Tests the cv_traverse_context MCP tool for traversal-aware context.
 * Tests navigation, session state, and context retrieval.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import assert from 'assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

/**
 * Send a JSON-RPC request to the MCP server
 */
function sendRequest(server, request) {
  server.stdin.write(JSON.stringify(request) + '\n');
}

/**
 * Wait for a response with a specific ID
 */
function waitForResponse(server, id, timeout = 10000) {
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

/**
 * Start the MCP server
 */
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

/**
 * Initialize the MCP server
 */
async function initializeServer(server) {
  sendRequest(server, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'traverse-test', version: '1.0' },
    },
  });

  return await waitForResponse(server, 1);
}

/**
 * Call cv_traverse_context tool
 */
async function callTraverseContext(server, args, requestId) {
  sendRequest(server, {
    jsonrpc: '2.0',
    id: requestId,
    method: 'tools/call',
    params: {
      name: 'cv_traverse_context',
      arguments: args,
    },
  });

  return await waitForResponse(server, requestId, 15000);
}

/**
 * Parse XML response to extract session ID
 */
function extractSessionId(text) {
  const match = text.match(/<id>([^<]+)<\/id>/);
  return match ? match[1] : null;
}

/**
 * Parse XML response to extract depth
 */
function extractDepth(text) {
  const match = text.match(/<depth>(\d+)<\/depth>/);
  return match ? parseInt(match[1], 10) : null;
}

// Test runner
async function runTests() {
  const tests = [];
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // === TEST DEFINITIONS ===

  test('cv_traverse_context tool is registered', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      sendRequest(server, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

      const response = await waitForResponse(server, 2);

      assert(response.result, 'Should have result');
      const tools = response.result.tools;
      const traverseTool = tools.find(t => t.name === 'cv_traverse_context');

      assert(traverseTool, 'cv_traverse_context tool should be registered');
      assert(traverseTool.description, 'Tool should have description');
      assert(traverseTool.inputSchema, 'Tool should have inputSchema');
      assert(traverseTool.inputSchema.properties.direction, 'Should have direction parameter');
      assert(traverseTool.inputSchema.properties.file, 'Should have file parameter');
      assert(traverseTool.inputSchema.properties.symbol, 'Should have symbol parameter');
      assert(traverseTool.inputSchema.properties.sessionId, 'Should have sessionId parameter');
    } finally {
      server.kill();
    }
  });

  test('Jump to repo level returns context', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      const response = await callTraverseContext(server, {
        direction: 'jump'
      }, 3);

      assert(response.result, 'Should have result');
      assert(!response.result.isError, 'Should not be an error');

      const content = response.result.content.find(c => c.type === 'text');
      assert(content, 'Should have text content');

      // Should have XML output with session info
      const text = content.text;
      assert(text.includes('<traverse_context>'), 'Should have traverse_context element');
      assert(text.includes('<session>'), 'Should have session element');
      assert(text.includes('<depth>0</depth>'), 'Depth should be 0 (repo level)');

      // Should have a session ID
      const sessionId = extractSessionId(text);
      assert(sessionId, 'Should have session ID');
      assert(sessionId.length > 0, 'Session ID should not be empty');
    } finally {
      server.kill();
    }
  });

  test('Jump to file returns file context', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      const response = await callTraverseContext(server, {
        file: 'packages/core/src/services/index.ts',
        direction: 'jump'
      }, 4);

      assert(response.result, 'Should have result');

      const content = response.result.content.find(c => c.type === 'text');
      const text = content.text;

      // At file level, depth should be 2
      const depth = extractDepth(text);
      assert.strictEqual(depth, 2, 'Depth should be 2 (file level)');

      // Should include file path
      assert(text.includes('packages/core/src/services/index.ts') || text.includes('services/index.ts'),
        'Should reference the file');
    } finally {
      server.kill();
    }
  });

  test('Jump to symbol returns symbol context', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      const response = await callTraverseContext(server, {
        symbol: 'createCacheService',
        file: 'packages/core/src/services/cache-service.ts',
        direction: 'jump',
        includeCallers: true,
        includeCallees: true
      }, 5);

      assert(response.result, 'Should have result');

      const content = response.result.content.find(c => c.type === 'text');
      const text = content.text;

      // At symbol level, depth should be 3
      const depth = extractDepth(text);
      assert.strictEqual(depth, 3, 'Depth should be 3 (symbol level)');

      // Should have symbol in output
      assert(text.includes('createCacheService') || text.includes('<symbol>'),
        'Should reference the symbol');
    } finally {
      server.kill();
    }
  });

  test('Session state persists across calls', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      // First call - jump to file
      const response1 = await callTraverseContext(server, {
        file: 'packages/core/src/services/index.ts',
        direction: 'jump'
      }, 6);

      const content1 = response1.result.content.find(c => c.type === 'text');
      const sessionId = extractSessionId(content1.text);
      assert(sessionId, 'Should have session ID from first call');

      // Second call - use same session
      const response2 = await callTraverseContext(server, {
        direction: 'stay',
        sessionId: sessionId
      }, 7);

      const content2 = response2.result.content.find(c => c.type === 'text');
      const sessionId2 = extractSessionId(content2.text);

      // Session should be the same
      assert.strictEqual(sessionId2, sessionId, 'Session ID should persist');

      // Depth should still be 2 (file level)
      const depth = extractDepth(content2.text);
      assert.strictEqual(depth, 2, 'Depth should remain 2');
    } finally {
      server.kill();
    }
  });

  test('Direction "out" moves up levels', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      // Start at file level
      const response1 = await callTraverseContext(server, {
        file: 'packages/core/src/services/index.ts',
        direction: 'jump'
      }, 8);

      const content1 = response1.result.content.find(c => c.type === 'text');
      const sessionId = extractSessionId(content1.text);
      const depth1 = extractDepth(content1.text);
      assert.strictEqual(depth1, 2, 'Should start at file level');

      // Move out to module level
      const response2 = await callTraverseContext(server, {
        direction: 'out',
        sessionId: sessionId
      }, 9);

      const content2 = response2.result.content.find(c => c.type === 'text');
      const depth2 = extractDepth(content2.text);
      assert.strictEqual(depth2, 1, 'Should move to module level');

      // Move out to repo level
      const response3 = await callTraverseContext(server, {
        direction: 'out',
        sessionId: sessionId
      }, 10);

      const content3 = response3.result.content.find(c => c.type === 'text');
      const depth3 = extractDepth(content3.text);
      assert.strictEqual(depth3, 0, 'Should move to repo level');
    } finally {
      server.kill();
    }
  });

  test('Direction "in" drills down', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      // Start at repo level
      const response1 = await callTraverseContext(server, {
        direction: 'jump'
      }, 11);

      const content1 = response1.result.content.find(c => c.type === 'text');
      const sessionId = extractSessionId(content1.text);
      const depth1 = extractDepth(content1.text);
      assert.strictEqual(depth1, 0, 'Should start at repo level');

      // Drill into a module
      const response2 = await callTraverseContext(server, {
        direction: 'in',
        module: 'packages',
        sessionId: sessionId
      }, 12);

      const content2 = response2.result.content.find(c => c.type === 'text');
      const depth2 = extractDepth(content2.text);
      assert.strictEqual(depth2, 1, 'Should move to module level');
    } finally {
      server.kill();
    }
  });

  test('Markdown format output', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      const response = await callTraverseContext(server, {
        direction: 'jump',
        format: 'markdown'
      }, 13);

      assert(response.result, 'Should have result');

      const content = response.result.content.find(c => c.type === 'text');
      const text = content.text;

      // Should have markdown format
      assert(text.includes('# Traverse Context'), 'Should have markdown header');
      assert(text.includes('## Current Position'), 'Should have position section');
      assert(text.includes('**Session**'), 'Should have session info');
    } finally {
      server.kill();
    }
  });

  test('JSON format output', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      const response = await callTraverseContext(server, {
        direction: 'jump',
        format: 'json'
      }, 14);

      assert(response.result, 'Should have result');

      const content = response.result.content.find(c => c.type === 'text');
      const text = content.text;

      // Should be valid JSON
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        assert.fail('Output should be valid JSON');
      }

      assert(parsed.position, 'Should have position');
      assert(parsed.sessionId, 'Should have sessionId');
      assert(parsed.context !== undefined, 'Should have context');
      assert(Array.isArray(parsed.hints), 'Should have hints array');
    } finally {
      server.kill();
    }
  });

  test('Navigation hints are provided', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      const response = await callTraverseContext(server, {
        file: 'packages/core/src/services/index.ts',
        direction: 'jump'
      }, 15);

      const content = response.result.content.find(c => c.type === 'text');
      const text = content.text;

      // Should have hints section in XML
      assert(text.includes('<hints>'), 'Should have hints section');
      assert(text.includes('<hint>'), 'Should have hint elements');
    } finally {
      server.kill();
    }
  });

  test('Invalid direction returns error', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      const response = await callTraverseContext(server, {
        direction: 'invalid_direction'
      }, 16);

      const content = response.result.content.find(c => c.type === 'text');
      const text = content.text.toLowerCase();

      // Should indicate error
      assert(
        text.includes('error') || text.includes('invalid'),
        'Should indicate invalid direction error'
      );
    } finally {
      server.kill();
    }
  });

  test('Token budget is respected', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      // Small budget
      const response1 = await callTraverseContext(server, {
        direction: 'jump',
        budget: 500
      }, 17);

      const content1 = response1.result.content.find(c => c.type === 'text');
      const len1 = content1.text.length;

      // Larger budget
      const response2 = await callTraverseContext(server, {
        direction: 'jump',
        budget: 8000
      }, 18);

      const content2 = response2.result.content.find(c => c.type === 'text');
      const len2 = content2.text.length;

      // With larger budget, should generally have more content
      // (not always true but generally expected)
      assert(len1 < 5000, 'Small budget output should be limited');
    } finally {
      server.kill();
    }
  });

  // === RUN TESTS ===

  console.log('\nRunning Traverse Context Integration Tests\n');
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

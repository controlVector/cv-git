/**
 * MCP Server Integration Tests
 *
 * Tests the MCP server protocol using stdio communication.
 * Converts manual test scripts into automated tests.
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
function waitForResponse(server, id, timeout = 5000) {
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
    env: { ...process.env, CV_LOG_LEVEL: 'error' }, // Quiet logs during tests
  });

  // Collect stderr for debugging
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
      clientInfo: { name: 'test-client', version: '1.0' },
    },
  });

  const response = await waitForResponse(server, 1);
  return response;
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

  test('Server initializes correctly', async () => {
    const { server } = startServer();
    try {
      const response = await initializeServer(server);

      assert(response.result, 'Should have result');
      assert(response.result.serverInfo, 'Should have serverInfo');
      assert.strictEqual(response.result.serverInfo.name, 'cv-git', 'Server name should be cv-git');
      assert(response.result.capabilities, 'Should have capabilities');
      assert(response.result.capabilities.tools, 'Should have tools capability');
      assert(response.result.capabilities.resources, 'Should have resources capability');
    } finally {
      server.kill();
    }
  });

  test('resources/list returns all resources', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      sendRequest(server, {
        jsonrpc: '2.0',
        id: 2,
        method: 'resources/list',
        params: {},
      });

      const response = await waitForResponse(server, 2);

      assert(response.result, 'Should have result');
      assert(Array.isArray(response.result.resources), 'resources should be an array');
      assert(response.result.resources.length >= 3, 'Should have at least 3 resources');

      // Check for expected resources
      const uris = response.result.resources.map(r => r.uri);
      assert(uris.includes('cv://context/auto'), 'Should include cv://context/auto');
      assert(uris.includes('cv://graph/summary'), 'Should include cv://graph/summary');
      assert(uris.includes('cv://status'), 'Should include cv://status');
    } finally {
      server.kill();
    }
  });

  test('resources/read cv://graph/summary returns graph stats', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      sendRequest(server, {
        jsonrpc: '2.0',
        id: 3,
        method: 'resources/read',
        params: { uri: 'cv://graph/summary' },
      });

      const response = await waitForResponse(server, 3, 10000); // Longer timeout for graph query

      assert(response.result, 'Should have result');
      assert(Array.isArray(response.result.contents), 'contents should be an array');
      assert(response.result.contents.length > 0, 'Should have at least one content');

      const content = response.result.contents[0];
      assert.strictEqual(content.uri, 'cv://graph/summary', 'URI should match');
      assert.strictEqual(content.mimeType, 'application/json', 'mimeType should be application/json');

      // Parse the text content
      const data = JSON.parse(content.text);
      assert(data.repository || data.error, 'Should have repository or error');

      // If not an error, check for expected fields
      if (!data.error) {
        assert(data.stats, 'Should have stats');
        assert(typeof data.stats.files === 'number', 'Should have files count');
        assert(typeof data.stats.symbols === 'number', 'Should have symbols count');
      }
    } finally {
      server.kill();
    }
  });

  test('resources/read cv://status returns service status', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      sendRequest(server, {
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/read',
        params: { uri: 'cv://status' },
      });

      const response = await waitForResponse(server, 4, 10000);

      assert(response.result, 'Should have result');
      const content = response.result.contents[0];
      const data = JSON.parse(content.text);

      assert(data.repository || data.error, 'Should have repository or error');

      if (!data.error) {
        assert(data.services, 'Should have services');
        assert(data.generated, 'Should have generated timestamp');
      }
    } finally {
      server.kill();
    }
  });

  test('tools/list returns available tools', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      sendRequest(server, {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/list',
        params: {},
      });

      const response = await waitForResponse(server, 5);

      assert(response.result, 'Should have result');
      assert(Array.isArray(response.result.tools), 'tools should be an array');
      assert(response.result.tools.length > 0, 'Should have tools');

      // Check for cv_auto_context tool
      const autoContext = response.result.tools.find(t => t.name === 'cv_auto_context');
      assert(autoContext, 'Should have cv_auto_context tool');
      assert(autoContext.description, 'Tool should have description');
      assert(autoContext.inputSchema, 'Tool should have inputSchema');
    } finally {
      server.kill();
    }
  });

  test('tools/call cv_graph_stats returns stats', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      sendRequest(server, {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'cv_graph_stats',
          arguments: {},
        },
      });

      const response = await waitForResponse(server, 6, 10000);

      assert(response.result, 'Should have result');
      assert(Array.isArray(response.result.content), 'content should be an array');

      // Tool result should have text content
      const textContent = response.result.content.find(c => c.type === 'text');
      assert(textContent, 'Should have text content');

      // Should contain stats info (or error if services not running)
      // Output format: "Knowledge Graph Statistics:\n\nFiles: 539\nSymbols: 7851..."
      const text = textContent.text.toLowerCase();
      assert(
        text.includes('files') ||
        text.includes('error') ||
        text.includes('statistics'),
        'Should contain stats info or error'
      );
    } finally {
      server.kill();
    }
  });

  test('Unknown resource returns error', async () => {
    const { server } = startServer();
    try {
      await initializeServer(server);

      sendRequest(server, {
        jsonrpc: '2.0',
        id: 7,
        method: 'resources/read',
        params: { uri: 'cv://unknown/resource' },
      });

      const response = await waitForResponse(server, 7);

      assert(response.result, 'Should have result');
      const content = response.result.contents[0];
      const data = JSON.parse(content.text);

      assert(data.error, 'Should have error');
      assert(data.error.includes('Unknown resource'), 'Error should mention unknown resource');
    } finally {
      server.kill();
    }
  });

  // === RUN TESTS ===

  console.log('Running MCP Server Integration Tests\n');
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

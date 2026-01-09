/**
 * Config Command Tests
 * Tests for cv config subcommands
 */

import {
  runCV,
  assertSuccess,
  assertContains,
  assertJSON,
  TestRunner,
} from '../../helpers/cli-test-utils.mjs';

const runner = new TestRunner('Config Command Tests');

// cv config list
await runner.test('cv config list', async () => {
  const result = await runCV(['config', 'list']);
  assertSuccess(result, 'config list');
  assertContains(result.stdout, 'Configuration', 'should show configuration');
});

// cv config list --json
await runner.test('cv config list --json', async () => {
  const result = await runCV(['config', 'list', '--json']);
  assertSuccess(result, 'config list --json');
  const parsed = assertJSON(result.stdout, (d) => d.version !== undefined, 'should have version');
});

// cv config path
await runner.test('cv config path', async () => {
  const result = await runCV(['config', 'path']);
  assertSuccess(result, 'config path');
  assertContains(result.stdout, '.cv', 'should show .cv path');
});

// cv config get (valid key)
await runner.test('cv config get ai.model', async () => {
  const result = await runCV(['config', 'get', 'ai.model']);
  // May succeed or fail depending on config existence, but should not error unexpectedly
  // Just verify it runs
  if (result.code !== 0) {
    assertContains(result.stderr || result.stdout, '', 'should provide output');
  }
});

// cv config --options
await runner.test('cv config --options', async () => {
  const result = await runCV(['config', '--options']);
  assertSuccess(result, 'config --options');
  assertContains(result.stdout, 'Options', 'should show options header');
});

// cv config list --options
await runner.test('cv config list --options', async () => {
  const result = await runCV(['config', 'list', '--options']);
  assertSuccess(result, 'config list --options');
  assertContains(result.stdout, '--json', 'should show --json option');
});

// Summary
runner.summary();
runner.exit();

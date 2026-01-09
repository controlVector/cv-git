/**
 * Verify Command Tests
 * Tests for cv verify command
 */

import {
  runCV,
  assertSuccess,
  assertContains,
  assertJSON,
  TestRunner,
} from '../../helpers/cli-test-utils.mjs';

const runner = new TestRunner('Verify Command Tests');

// cv verify --quick
await runner.test('cv verify --quick', async () => {
  const result = await runCV(['verify', '--quick'], { timeout: 60000 });
  // Verify should complete even if some tests fail
  assertContains(result.stdout, 'Summary', 'should show summary');
});

// cv verify --quick --json
await runner.test('cv verify --quick --json', async () => {
  const result = await runCV(['verify', '--quick', '--json'], { timeout: 60000 });
  const parsed = assertJSON(result.stdout, (d) => d.summary !== undefined, 'should have summary');
});

// cv verify --options
await runner.test('cv verify --options', async () => {
  const result = await runCV(['verify', '--options']);
  assertSuccess(result, 'verify --options');
  assertContains(result.stdout, '--all', 'should show --all option');
  assertContains(result.stdout, '--quick', 'should show --quick option');
});

// Summary
runner.summary();
runner.exit();

/**
 * Doctor Command Tests
 * Tests for cv doctor diagnostic command
 */

import {
  runCV,
  assertSuccess,
  assertContains,
  assertJSON,
  TestRunner,
} from '../../helpers/cli-test-utils.mjs';

const runner = new TestRunner('Doctor Command Tests');

// cv doctor
await runner.test('cv doctor', async () => {
  const result = await runCV(['doctor']);
  // Doctor may exit with non-zero if checks fail, but should produce output
  assertContains(result.stdout, 'Diagnostics', 'should show diagnostics');
});

// cv doctor --json
await runner.test('cv doctor --json', async () => {
  const result = await runCV(['doctor', '--json']);
  const parsed = assertJSON(result.stdout, (d) => Array.isArray(d.results), 'should have results array');
});

// cv doctor --options
await runner.test('cv doctor --options', async () => {
  const result = await runCV(['doctor', '--options']);
  assertSuccess(result, 'doctor --options');
  assertContains(result.stdout, 'Options', 'should show options');
  assertContains(result.stdout, '--fix', 'should show --fix option');
});

// Summary
runner.summary();
runner.exit();

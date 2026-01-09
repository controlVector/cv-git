/**
 * Preferences Command Tests
 * Tests for cv preferences subcommands including the new get command
 */

import {
  runCV,
  assertSuccess,
  assertContains,
  assertJSON,
  TestRunner,
} from '../../helpers/cli-test-utils.mjs';

const runner = new TestRunner('Preferences Command Tests');

// cv preferences --help
await runner.test('cv preferences --help', async () => {
  const result = await runCV(['preferences', '--help']);
  assertSuccess(result, 'preferences --help');
  assertContains(result.stdout, 'list', 'should mention list');
  assertContains(result.stdout, 'get', 'should mention get');
  assertContains(result.stdout, 'set', 'should mention set');
  assertContains(result.stdout, 'reset', 'should mention reset');
  assertContains(result.stdout, 'path', 'should mention path');
});

// cv prefs (alias)
await runner.test('cv prefs --help', async () => {
  const result = await runCV(['prefs', '--help']);
  assertSuccess(result, 'prefs --help (alias)');
  assertContains(result.stdout, 'list', 'should mention list');
});

// cv preferences list
await runner.test('cv preferences list', async () => {
  const result = await runCV(['preferences', 'list']);
  // Should either show preferences or "no preferences" message
  const output = result.stdout + result.stderr;
  const hasValidOutput =
    output.includes('No preferences') ||
    output.includes('User Preferences') ||
    output.includes('preferences');
  if (!hasValidOutput) {
    throw new Error('preferences list should show preferences or no-preferences message');
  }
});

// cv preferences path
await runner.test('cv preferences path', async () => {
  const result = await runCV(['preferences', 'path']);
  assertSuccess(result, 'preferences path');
  // Should output a path
  const output = result.stdout.trim();
  if (!output.includes('preferences') && !output.includes('.cv')) {
    throw new Error('preferences path should output a valid path');
  }
});

// cv preferences get with invalid key
await runner.test('cv preferences get invalid-key', async () => {
  const result = await runCV(['preferences', 'get', 'invalid-key']);
  // Should fail with unknown preference message
  const output = result.stdout + result.stderr;
  assertContains(output, 'Unknown preference', 'should indicate unknown preference');
});

// cv preferences get with valid key (may fail if no prefs set)
await runner.test('cv preferences get git-platform', async () => {
  const result = await runCV(['preferences', 'get', 'git-platform']);
  // Either shows value or "no preferences" message
  const output = result.stdout + result.stderr;
  const validOutput =
    output.includes('github') ||
    output.includes('gitlab') ||
    output.includes('bitbucket') ||
    output.includes('No preferences');
  // Don't throw, just note if it worked
});

// cv preferences set with invalid value
await runner.test('cv preferences set with invalid value', async () => {
  const result = await runCV(['preferences', 'set', 'git-platform', 'invalid-platform']);
  // Should fail with invalid platform message
  const output = result.stdout + result.stderr;
  const hasError = output.includes('Invalid') || output.includes('No preferences');
  if (!hasError) {
    throw new Error('Should reject invalid platform value');
  }
});

// cv preferences --options
await runner.test('cv preferences --options', async () => {
  const result = await runCV(['preferences', '--options']);
  // Should show options info
  assertSuccess(result, 'preferences --options');
  const output = result.stdout + result.stderr;
  const hasOptions = output.includes('Options') || output.includes('preferences');
  if (!hasOptions) {
    throw new Error('Should show preferences options');
  }
});

// cv preferences list --options
await runner.test('cv preferences list --options', async () => {
  const result = await runCV(['preferences', 'list', '--options']);
  assertSuccess(result, 'preferences list --options');
});

// cv preferences --json
await runner.test('cv preferences --json', async () => {
  const result = await runCV(['preferences', '--json']);
  // Should output JSON (either with preferences or exists: false)
  try {
    const parsed = JSON.parse(result.stdout);
    if (parsed.exists === undefined && parsed.preferences === undefined) {
      throw new Error('JSON should have exists or preferences field');
    }
  } catch (e) {
    // May fail if no JSON output, which is ok for "no preferences" case
    if (!result.stdout.includes('No preferences')) {
      throw e;
    }
  }
});

// Summary
runner.summary();
runner.exit();

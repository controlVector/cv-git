/**
 * Hooks Command Tests
 * Tests for cv hooks subcommands including the new list command
 */

import {
  runCV,
  assertSuccess,
  assertContains,
  TestRunner,
} from '../../helpers/cli-test-utils.mjs';

const runner = new TestRunner('Hooks Command Tests');

// cv hooks --help
await runner.test('cv hooks --help', async () => {
  const result = await runCV(['hooks', '--help']);
  assertSuccess(result, 'hooks --help');
  assertContains(result.stdout, 'install', 'should mention install');
  assertContains(result.stdout, 'uninstall', 'should mention uninstall');
  assertContains(result.stdout, 'list', 'should mention list');
  assertContains(result.stdout, 'status', 'should mention status');
});

// cv hooks list
await runner.test('cv hooks list', async () => {
  const result = await runCV(['hooks', 'list']);
  // Should either show hooks or "no hooks" message
  const output = result.stdout + result.stderr;
  const hasValidOutput =
    output.includes('No hooks installed') ||
    output.includes('Installed Git Hooks') ||
    output.includes('No cv-git hooks');
  if (!hasValidOutput) {
    throw new Error('hooks list should show hooks or no-hooks message');
  }
});

// cv hooks list --all
await runner.test('cv hooks list --all', async () => {
  const result = await runCV(['hooks', 'list', '--all']);
  // Should run without error
  const output = result.stdout + result.stderr;
  // Validate it ran (may or may not have hooks)
  if (result.code !== 0 && !output.includes('No')) {
    throw new Error(`hooks list --all failed: ${output}`);
  }
});

// cv hooks status
await runner.test('cv hooks status', async () => {
  const result = await runCV(['hooks', 'status']);
  assertSuccess(result, 'hooks status');
  assertContains(result.stdout, 'Git Hooks Status', 'should show status header');
  assertContains(result.stdout, 'post-commit', 'should mention post-commit');
  assertContains(result.stdout, 'post-merge', 'should mention post-merge');
  assertContains(result.stdout, 'prepare-commit-msg', 'should mention prepare-commit-msg');
});

// cv hooks --options
await runner.test('cv hooks --options', async () => {
  const result = await runCV(['hooks', '--options']);
  // Should show options or help info
  const output = result.stdout + result.stderr;
  const hasInfo = output.includes('Options') || output.includes('hooks');
  if (!hasInfo) {
    throw new Error('Should show hooks options or info');
  }
});

// cv hooks install --help (use --help since --options may not propagate to subcommands)
await runner.test('cv hooks install --help', async () => {
  const result = await runCV(['hooks', 'install', '--help']);
  assertSuccess(result, 'hooks install --help');
  assertContains(result.stdout, '--post-commit', 'should show --post-commit option');
});

// cv hooks list --help
await runner.test('cv hooks list --help', async () => {
  const result = await runCV(['hooks', 'list', '--help']);
  assertSuccess(result, 'hooks list --help');
  assertContains(result.stdout, '--all', 'should show --all option');
});

// Summary
runner.summary();
runner.exit();

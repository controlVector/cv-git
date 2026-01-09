/**
 * Auth Command Tests
 * Tests for cv auth subcommands including category routing
 */

import {
  runCV,
  assertSuccess,
  assertContains,
  assertJSON,
  TestRunner,
} from '../../helpers/cli-test-utils.mjs';

const runner = new TestRunner('Auth Command Tests');

// cv auth list
await runner.test('cv auth list', async () => {
  const result = await runCV(['auth', 'list']);
  assertSuccess(result, 'auth list');
  // Output should show either credentials or "no credentials" message
  const output = result.stdout + result.stderr;
  const hasOutput = output.includes('Credentials') || output.includes('No credentials');
  if (!hasOutput) {
    throw new Error('auth list should show credentials or no-credentials message');
  }
});

// cv auth setup --help
await runner.test('cv auth setup --help', async () => {
  const result = await runCV(['auth', 'setup', '--help']);
  assertSuccess(result, 'auth setup --help');
  assertContains(result.stdout, 'dns/cloudflare', 'should mention dns/cloudflare');
  assertContains(result.stdout, 'devops', 'should mention devops');
});

// cv auth test with unknown service
await runner.test('cv auth test unknown-service', async () => {
  const result = await runCV(['auth', 'test', 'unknown-service']);
  // Should fail but gracefully
  assertContains(
    result.stdout + result.stderr,
    'Unknown service',
    'should indicate unknown service'
  );
});

// cv auth test cloudflare (without credentials)
await runner.test('cv auth test cloudflare (no creds)', async () => {
  const result = await runCV(['auth', 'test', 'cloudflare']);
  // Should indicate no credential found
  const output = result.stdout + result.stderr;
  const expectedMsg = output.includes('not found') || output.includes('Cloudflare');
  if (!expectedMsg) {
    throw new Error('Should indicate cloudflare credential not found');
  }
});

// cv auth test aws (without credentials)
await runner.test('cv auth test aws (no creds)', async () => {
  const result = await runCV(['auth', 'test', 'aws']);
  // Should indicate no credential found
  const output = result.stdout + result.stderr;
  const expectedMsg = output.includes('not found') || output.includes('AWS');
  if (!expectedMsg) {
    throw new Error('Should indicate AWS credential not found');
  }
});

// cv auth test digitalocean (without credentials)
await runner.test('cv auth test digitalocean (no creds)', async () => {
  const result = await runCV(['auth', 'test', 'digitalocean']);
  // Should indicate no credential found
  const output = result.stdout + result.stderr;
  const expectedMsg = output.includes('not found') || output.includes('DigitalOcean');
  if (!expectedMsg) {
    throw new Error('Should indicate DigitalOcean credential not found');
  }
});

// cv auth list --options
await runner.test('cv auth list --options', async () => {
  const result = await runCV(['auth', 'list', '--options']);
  // May succeed or show the actual list (if --options not supported on this subcommand)
  // Either way, should not error
  const output = result.stdout + result.stderr;
  if (result.code !== 0 && !output.includes('Credentials')) {
    throw new Error(`auth list --options failed unexpectedly: ${output}`);
  }
});

// cv auth test --options
await runner.test('cv auth test --options', async () => {
  const result = await runCV(['auth', 'test', '--options']);
  // Should show options even though it requires an argument
  const output = result.stdout + result.stderr;
  const hasOptions = output.includes('Options') || output.includes('service');
  if (!hasOptions) {
    throw new Error('Should show options or usage info');
  }
});

// Summary
runner.summary();
runner.exit();

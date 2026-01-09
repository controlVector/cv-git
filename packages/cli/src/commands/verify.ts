/**
 * Verify Command
 * Test CLI commands and report what works
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { addGlobalOptions, createOutput } from '../utils/output.js';

interface VerifyResult {
  command: string;
  status: 'pass' | 'fail' | 'skip';
  message?: string;
  duration: number;
}

interface VerifyTest {
  cmd: string[];
  name: string;
  requiresInit?: boolean;
  requiresServices?: boolean;
  expectedOutput?: string | RegExp;
}

/**
 * List of commands to verify
 */
const VERIFY_TESTS: VerifyTest[] = [
  // Core CLI
  { cmd: ['--version'], name: 'version' },

  // Config
  { cmd: ['config', 'list'], name: 'config list' },
  { cmd: ['config', 'list', '--json'], name: 'config list --json' },
  { cmd: ['config', 'path'], name: 'config path' },

  // Status & Diagnostics
  { cmd: ['doctor'], name: 'doctor' },
  { cmd: ['doctor', '--json'], name: 'doctor --json' },
  { cmd: ['status'], name: 'status', requiresInit: true },
  { cmd: ['status', '--json'], name: 'status --json', requiresInit: true },

  // Preferences
  { cmd: ['preferences', 'list'], name: 'preferences list' },

  // Cache
  { cmd: ['cache', 'stats'], name: 'cache stats' },

  // Auth (list only, no mutation)
  { cmd: ['auth', 'list'], name: 'auth list' },

  // Graph (requires init and services)
  { cmd: ['graph', 'stats'], name: 'graph stats', requiresInit: true, requiresServices: true },

  // Hooks
  { cmd: ['hooks', 'list'], name: 'hooks list', requiresInit: true },

  // Docs
  { cmd: ['docs', 'list'], name: 'docs list', requiresInit: true, requiresServices: true },

  // PRD
  { cmd: ['prd', 'list'], name: 'prd list', requiresInit: true, requiresServices: true },

  // Options flag tests (only for commands without required arguments)
  { cmd: ['sync', '--options'], name: 'sync --options' },
  { cmd: ['doctor', '--options'], name: 'doctor --options' },
  { cmd: ['verify', '--options'], name: 'verify --options' },
];

export function verifyCommand(): Command {
  const cmd = new Command('verify');

  cmd
    .description('Verify CLI commands are working')
    .option('--all', 'Run all tests including those requiring services')
    .option('--quick', 'Run only quick tests (no service dependencies)')
    .option('--timeout <ms>', 'Timeout per command in milliseconds', '10000')
    .option('--category <cat>', 'Run tests for specific category (config, status, graph, etc.)');

  addGlobalOptions(cmd);

  cmd.action(async (options) => {
    const output = createOutput(options);
    const results: VerifyResult[] = [];
    const timeout = parseInt(options.timeout) || 10000;

    // Check environment
    const isInitialized = await checkIfInitialized();
    const servicesAvailable = options.all ? await checkServicesAvailable() : false;

    if (!options.quiet && !options.json) {
      console.log(chalk.bold('\n🔍 CV-Git Command Verification\n'));
      console.log(chalk.gray(`Timeout: ${timeout}ms per command`));
      console.log(chalk.gray(`Initialized: ${isInitialized ? 'Yes' : 'No'}`));
      if (options.all) {
        console.log(chalk.gray(`Services: ${servicesAvailable ? 'Available' : 'Not available'}`));
      }
      console.log(chalk.gray('─'.repeat(50)));
      console.log();
    }

    // Filter tests based on options
    let testsToRun = [...VERIFY_TESTS];

    if (options.category) {
      testsToRun = testsToRun.filter(t => t.name.startsWith(options.category));
    }

    if (options.quick) {
      testsToRun = testsToRun.filter(t => !t.requiresInit && !t.requiresServices);
    }

    // Run tests
    for (const test of testsToRun) {
      // Skip tests that require initialization if not initialized
      if (test.requiresInit && !isInitialized) {
        results.push({
          command: test.name,
          status: 'skip',
          message: 'requires cv init',
          duration: 0,
        });
        if (!options.quiet && !options.json) {
          console.log(chalk.gray(`⊘ ${test.name} (skipped: requires init)`));
        }
        continue;
      }

      // Skip tests that require services if not available
      if (test.requiresServices && !servicesAvailable && !options.all) {
        results.push({
          command: test.name,
          status: 'skip',
          message: 'requires services (use --all)',
          duration: 0,
        });
        if (!options.quiet && !options.json) {
          console.log(chalk.gray(`⊘ ${test.name} (skipped: requires services)`));
        }
        continue;
      }

      const start = Date.now();
      try {
        const result = await runCVCommand(test.cmd, timeout);
        const duration = Date.now() - start;

        if (result.code === 0) {
          results.push({
            command: test.name,
            status: 'pass',
            duration,
          });
          if (!options.quiet && !options.json) {
            console.log(chalk.green(`✓ ${test.name}`) + chalk.gray(` (${duration}ms)`));
          }
        } else {
          results.push({
            command: test.name,
            status: 'fail',
            message: result.stderr.slice(0, 200) || `exit code ${result.code}`,
            duration,
          });
          if (!options.quiet && !options.json) {
            console.log(chalk.red(`✗ ${test.name}`) + chalk.gray(` (${duration}ms)`));
            if (options.verbose && result.stderr) {
              console.log(chalk.gray(`  ${result.stderr.slice(0, 100)}`));
            }
          }
        }
      } catch (error: any) {
        const duration = Date.now() - start;
        results.push({
          command: test.name,
          status: 'fail',
          message: error.message,
          duration,
        });
        if (!options.quiet && !options.json) {
          console.log(chalk.red(`✗ ${test.name}`) + chalk.gray(` (timeout or error)`));
        }
      }
    }

    // Generate summary
    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    const skipped = results.filter(r => r.status === 'skip').length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    const summary = {
      total: results.length,
      passed,
      failed,
      skipped,
      duration: totalDuration,
      passRate: results.length > 0 ? Math.round((passed / (passed + failed)) * 100) : 0,
    };

    // Output results
    if (options.json) {
      console.log(JSON.stringify({ results, summary }, null, 2));
    } else if (!options.quiet) {
      console.log();
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.bold('\nSummary:'));
      console.log(chalk.green(`  ✓ ${passed} passed`));
      if (failed > 0) console.log(chalk.red(`  ✗ ${failed} failed`));
      if (skipped > 0) console.log(chalk.gray(`  ⊘ ${skipped} skipped`));
      console.log(chalk.gray(`  Total: ${totalDuration}ms`));
      console.log();

      if (failed === 0) {
        console.log(chalk.green.bold(`✅ All tests passed! (${summary.passRate}% pass rate)\n`));
      } else {
        console.log(chalk.yellow(`⚠️  ${failed} test(s) failed (${summary.passRate}% pass rate)\n`));
      }
    }

    // Exit with appropriate code
    process.exit(failed > 0 ? 1 : 0);
  });

  return cmd;
}

/**
 * Run a CV command and capture output
 */
async function runCVCommand(
  args: string[],
  timeout: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Get the path to the cv CLI
    const cvPath = process.argv[1];

    const proc = spawn('node', [cvPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Command timeout'));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });

    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * Check if CV-Git is initialized in the current directory
 */
async function checkIfInitialized(): Promise<boolean> {
  try {
    await fs.access('.cv');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if required services (FalkorDB, Qdrant) are available
 */
async function checkServicesAvailable(): Promise<boolean> {
  try {
    // Quick check for Qdrant
    const qdrantResponse = await fetch('http://localhost:6333/collections', {
      signal: AbortSignal.timeout(2000),
    });
    if (!qdrantResponse.ok) return false;

    // Quick check for FalkorDB (Redis)
    const { createClient } = await import('redis');
    const client = createClient({ url: 'redis://localhost:6379' });
    await client.connect();
    await client.ping();
    await client.disconnect();

    return true;
  } catch {
    return false;
  }
}

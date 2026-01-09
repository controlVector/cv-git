/**
 * CLI Test Utilities
 * Helper functions for testing CV-Git CLI commands
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CLI_PATH = path.join(__dirname, '../../packages/cli/dist/index.js');

/**
 * Run a CV command and capture output
 */
export async function runCV(args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [CLI_PATH, ...args], {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0', ...options.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = options.timeout || 30000;
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Command timeout after ${timeout}ms`));
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
 * Assert that a command succeeded (exit code 0)
 */
export function assertSuccess(result, message = 'Command should succeed') {
  if (result.code !== 0) {
    throw new Error(
      `${message}: exit code ${result.code}\nstdout: ${result.stdout.slice(0, 200)}\nstderr: ${result.stderr.slice(0, 200)}`
    );
  }
}

/**
 * Assert that a command failed (non-zero exit code)
 */
export function assertFailed(result, message = 'Command should fail') {
  if (result.code === 0) {
    throw new Error(`${message}: expected non-zero exit code but got 0`);
  }
}

/**
 * Assert that output contains expected string
 */
export function assertContains(output, expected, message = 'Output should contain expected string') {
  if (!output.includes(expected)) {
    throw new Error(`${message}: expected "${expected}" in output:\n${output.slice(0, 500)}`);
  }
}

/**
 * Assert that output does not contain string
 */
export function assertNotContains(output, unexpected, message = 'Output should not contain string') {
  if (output.includes(unexpected)) {
    throw new Error(`${message}: did not expect "${unexpected}" in output`);
  }
}

/**
 * Assert that output matches regex
 */
export function assertMatches(output, regex, message = 'Output should match regex') {
  if (!regex.test(output)) {
    throw new Error(`${message}: expected output to match ${regex}`);
  }
}

/**
 * Assert that output is valid JSON and optionally validate structure
 */
export function assertJSON(output, validator = null, message = 'Output should be valid JSON') {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (e) {
    throw new Error(`${message}: failed to parse JSON: ${e.message}\nOutput: ${output.slice(0, 500)}`);
  }

  if (validator && typeof validator === 'function') {
    const isValid = validator(parsed);
    if (!isValid) {
      throw new Error(`${message}: JSON validation failed`);
    }
  }

  return parsed;
}

/**
 * Create a temporary directory for testing
 */
export async function createTempDir(prefix = 'cv-test-') {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return tempDir;
}

/**
 * Clean up a temporary directory
 */
export async function cleanupTempDir(tempDir) {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Initialize a git repo in a directory
 */
export async function initGitRepo(dir) {
  await runCV(['--version'], { cwd: dir }); // Ensure CLI is accessible
  const result = await new Promise((resolve, reject) => {
    const proc = spawn('git', ['init'], { cwd: dir });
    proc.on('close', (code) => resolve({ code }));
    proc.on('error', reject);
  });
  return result.code === 0;
}

/**
 * Simple test runner for individual test files
 */
export class TestRunner {
  constructor(name) {
    this.name = name;
    this.passed = 0;
    this.failed = 0;
    this.tests = [];
  }

  async test(name, fn) {
    const start = Date.now();
    try {
      await fn();
      const duration = Date.now() - start;
      console.log(`✅ ${name} (${duration}ms)`);
      this.passed++;
      this.tests.push({ name, status: 'pass', duration });
    } catch (e) {
      const duration = Date.now() - start;
      console.log(`❌ ${name}: ${e.message}`);
      this.failed++;
      this.tests.push({ name, status: 'fail', duration, error: e.message });
    }
  }

  summary() {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`${this.name}: ${this.passed} passed, ${this.failed} failed`);
    return this.failed === 0;
  }

  exit() {
    process.exit(this.failed > 0 ? 1 : 0);
  }
}

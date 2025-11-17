#!/usr/bin/env node

/**
 * Test Runner for CV-Git
 * Runs all integration tests and reports results
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TESTS_DIR = join(__dirname, 'integration');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function runTest(testFile) {
  return new Promise((resolve) => {
    const testName = testFile.replace('.test.mjs', '');
    const testPath = join(TESTS_DIR, testFile);

    log(`\n${'='.repeat(60)}`, 'cyan');
    log(`Running: ${testName}`, 'cyan');
    log('='.repeat(60), 'cyan');

    const startTime = Date.now();
    const proc = spawn('node', [testPath], {
      stdio: 'inherit',
      env: { ...process.env },
    });

    proc.on('close', (code) => {
      const duration = Date.now() - startTime;
      const durationStr = `(${duration}ms)`;

      if (code === 0) {
        log(`✅ ${testName} PASSED ${durationStr}`, 'green');
        resolve({ name: testName, passed: true, duration });
      } else {
        log(`❌ ${testName} FAILED ${durationStr}`, 'red');
        resolve({ name: testName, passed: false, duration });
      }
    });
  });
}

async function main() {
  log('\n🧪 CV-Git Test Suite\n', 'bold');

  try {
    // Find all test files
    const files = await fs.readdir(TESTS_DIR);
    const testFiles = files.filter(f => f.endsWith('.test.mjs'));

    if (testFiles.length === 0) {
      log('No test files found', 'yellow');
      process.exit(0);
    }

    log(`Found ${testFiles.length} test file(s)\n`, 'cyan');

    // Run all tests
    const results = [];
    for (const testFile of testFiles) {
      const result = await runTest(testFile);
      results.push(result);
    }

    // Print summary
    log('\n' + '='.repeat(60), 'cyan');
    log('Test Summary', 'bold');
    log('='.repeat(60), 'cyan');

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => r.passed === false).length;
    const total = results.length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    results.forEach(result => {
      const icon = result.passed ? '✅' : '❌';
      const color = result.passed ? 'green' : 'red';
      log(`${icon} ${result.name} (${result.duration}ms)`, color);
    });

    log('');
    log(`Total: ${total} tests`, 'cyan');
    log(`Passed: ${passed}`, 'green');
    if (failed > 0) {
      log(`Failed: ${failed}`, 'red');
    }
    log(`Duration: ${totalDuration}ms`, 'cyan');

    if (failed === 0) {
      log('\n🎉 All tests passed!', 'green');
      process.exit(0);
    } else {
      log('\n❌ Some tests failed', 'red');
      process.exit(1);
    }

  } catch (error) {
    log(`\n❌ Test runner error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

main();

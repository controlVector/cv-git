#!/usr/bin/env node

/**
 * Integration Test: CLI Commands (config, status, doctor)
 * Tests the new Week 1 commands
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLI_PATH = path.join(__dirname, '../../packages/cli/dist/index.js');

async function runCommand(args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [CLI_PATH, ...args], {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        code,
        stdout,
        stderr,
      });
    });

    proc.on('error', reject);

    // Timeout after 10 seconds
    setTimeout(() => {
      proc.kill();
      reject(new Error('Command timeout'));
    }, 10000);
  });
}

async function runTests() {
  console.log('🧪 Testing CLI Commands\n');

  let testCount = 0;
  let passedCount = 0;

  // Test 1: cv config list
  testCount++;
  console.log('Test 1: cv config list');
  try {
    const result = await runCommand(['config', 'list']);
    if (result.code === 0 && result.stdout.includes('CV-Git Configuration')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Unexpected output or exit code\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 2: cv config get
  testCount++;
  console.log('Test 2: cv config get ai.model');
  try {
    const result = await runCommand(['config', 'get', 'ai.model']);
    if (result.code === 0 && result.stdout.includes('claude')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Unexpected output\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 3: cv config list --json
  testCount++;
  console.log('Test 3: cv config list --json');
  try {
    const result = await runCommand(['config', 'list', '--json']);
    const parsed = JSON.parse(result.stdout);
    if (result.code === 0 && parsed.version && parsed.platform) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Invalid JSON or missing fields\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 4: cv config set
  testCount++;
  console.log('Test 4: cv config set features.test true');
  try {
    const result = await runCommand(['config', 'set', 'features.test', 'true']);
    if (result.code === 0) {
      // Verify it was set
      const verify = await runCommand(['config', 'get', 'features.test']);
      if (verify.stdout.includes('true')) {
        console.log('✅ PASS\n');
        passedCount++;
      } else {
        console.log('❌ FAIL: Value not set correctly\n');
      }
    } else {
      console.log('❌ FAIL: Set command failed\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 5: cv config path
  testCount++;
  console.log('Test 5: cv config path');
  try {
    const result = await runCommand(['config', 'path']);
    if (result.code === 0 && result.stdout.includes('.cv/config.json')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Unexpected path\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 6: cv status (in cv-git repo)
  testCount++;
  console.log('Test 6: cv status');
  try {
    const result = await runCommand(['status'], {
      cwd: path.join(__dirname, '../..'),
    });
    if (result.code === 0 && result.stdout.includes('CV-Git Status')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Unexpected output\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 7: cv status --json
  testCount++;
  console.log('Test 7: cv status --json');
  try {
    const result = await runCommand(['status', '--json'], {
      cwd: path.join(__dirname, '../..'),
    });
    const parsed = JSON.parse(result.stdout);
    if (result.code === 0 && parsed.git && parsed.cvGit && parsed.services) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Invalid JSON structure\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 8: cv doctor
  testCount++;
  console.log('Test 8: cv doctor');
  try {
    const result = await runCommand(['doctor'], {
      cwd: path.join(__dirname, '../..'),
    });
    if (result.stdout.includes('Running CV-Git Diagnostics') &&
        result.stdout.includes('Summary:')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Unexpected output\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 9: cv doctor --json
  testCount++;
  console.log('Test 9: cv doctor --json');
  try {
    const result = await runCommand(['doctor', '--json'], {
      cwd: path.join(__dirname, '../..'),
    });
    const parsed = JSON.parse(result.stdout);
    if (parsed.results && Array.isArray(parsed.results)) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Invalid JSON structure\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 10: cv --help includes new commands
  testCount++;
  console.log('Test 10: cv --help includes new commands');
  try {
    const result = await runCommand(['--help']);
    if (result.stdout.includes('config') &&
        result.stdout.includes('status') &&
        result.stdout.includes('doctor')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing commands in help\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 11: Error handling - invalid config key
  testCount++;
  console.log('Test 11: Error handling - invalid config key');
  try {
    const result = await runCommand(['config', 'get', 'nonexistent.key']);
    if (result.code !== 0 && result.stderr.includes('not found')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Should fail with error\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 12: Help for subcommands
  testCount++;
  console.log('Test 12: cv config --help');
  try {
    const result = await runCommand(['config', '--help']);
    if (result.stdout.includes('get') &&
        result.stdout.includes('set') &&
        result.stdout.includes('list')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing subcommands in help\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  console.log('🎉 CLI command tests complete!\n');
  console.log(`✅ Success: ${passedCount}/${testCount} tests passed`);

  return {
    success: passedCount === testCount,
    testsRun: testCount,
    testsPassed: passedCount,
  };
}

// Run tests
runTests()
  .then(result => {
    if (result.success) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });

#!/usr/bin/env node

/**
 * Integration Tests: Git Wrapper Commands
 * Tests the cv equivalents of git commands
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLI_PATH = path.join(__dirname, '../../packages/cli/dist/index.js');
const REPO_ROOT = path.join(__dirname, '../..');

async function runCommand(args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [CLI_PATH, ...args], {
      cwd: options.cwd || REPO_ROOT,
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
      resolve({ code, stdout, stderr });
    });

    proc.on('error', reject);

    setTimeout(() => {
      proc.kill();
      reject(new Error('Command timeout'));
    }, 15000);
  });
}

async function runTests() {
  console.log('🧪 Testing Git Wrapper Commands\n');
  console.log('━'.repeat(60) + '\n');

  let testCount = 0;
  let passedCount = 0;

  // ===========================================
  // cv add tests
  // ===========================================

  // Test 1: cv add --help
  testCount++;
  console.log('Test 1: cv add --help');
  try {
    const result = await runCommand(['add', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('Stage files') &&
        result.stdout.includes('--all') &&
        result.stdout.includes('--patch')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected options\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 2: cv add --dry-run (should work even with no files)
  testCount++;
  console.log('Test 2: cv add --dry-run .');
  try {
    const result = await runCommand(['add', '--dry-run', '.']);
    // Dry run should succeed (exit 0) even if nothing to add
    if (result.code === 0) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Dry run failed\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv diff tests
  // ===========================================

  // Test 3: cv diff --help
  testCount++;
  console.log('Test 3: cv diff --help');
  try {
    const result = await runCommand(['diff', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('--staged') &&
        result.stdout.includes('--analyze') &&
        result.stdout.includes('--stat')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected options\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 4: cv diff --stat (should work on clean repo)
  testCount++;
  console.log('Test 4: cv diff --stat');
  try {
    const result = await runCommand(['diff', '--stat']);
    // Should succeed even with no changes
    if (result.code === 0) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Diff stat failed\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv log tests
  // ===========================================

  // Test 5: cv log --help
  testCount++;
  console.log('Test 5: cv log --help');
  try {
    const result = await runCommand(['log', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('--oneline') &&
        result.stdout.includes('--symbol') &&
        result.stdout.includes('--graph')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected options\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 6: cv log -3 --oneline
  testCount++;
  console.log('Test 6: cv log -3 --oneline');
  try {
    const result = await runCommand(['log', '-3', '--oneline']);
    if (result.code === 0 && result.stdout.trim().split('\n').length >= 1) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: No log output\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv branch tests
  // ===========================================

  // Test 7: cv branch --help
  testCount++;
  console.log('Test 7: cv branch --help');
  try {
    const result = await runCommand(['branch', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('--all') &&
        result.stdout.includes('--delete') &&
        result.stdout.includes('--move')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected options\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 8: cv branch (list branches)
  testCount++;
  console.log('Test 8: cv branch (list)');
  try {
    const result = await runCommand(['branch']);
    if (result.code === 0 && result.stdout.includes('main')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Could not list branches\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 9: cv branch --json
  testCount++;
  console.log('Test 9: cv branch --json');
  try {
    const result = await runCommand(['branch', '--json']);
    const parsed = JSON.parse(result.stdout);
    if (result.code === 0 &&
        parsed.branches &&
        Array.isArray(parsed.branches) &&
        parsed.current) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Invalid JSON output\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv checkout/switch tests
  // ===========================================

  // Test 10: cv checkout --help
  testCount++;
  console.log('Test 10: cv checkout --help');
  try {
    const result = await runCommand(['checkout', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('--create') &&
        result.stdout.includes('--force') &&
        result.stdout.includes('auto-sync')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected options\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 11: cv switch --help
  testCount++;
  console.log('Test 11: cv switch --help');
  try {
    const result = await runCommand(['switch', '--help']);
    if (result.code === 0 && result.stdout.includes('Switch branches')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected description\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv stash tests
  // ===========================================

  // Test 12: cv stash --help
  testCount++;
  console.log('Test 12: cv stash --help');
  try {
    const result = await runCommand(['stash', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('push') &&
        result.stdout.includes('pop') &&
        result.stdout.includes('--message')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected options\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 13: cv stash list
  testCount++;
  console.log('Test 13: cv stash list');
  try {
    const result = await runCommand(['stash', 'list']);
    // Should succeed even if stash is empty
    if (result.code === 0) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Stash list failed\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv merge tests
  // ===========================================

  // Test 14: cv merge --help
  testCount++;
  console.log('Test 14: cv merge --help');
  try {
    const result = await runCommand(['merge', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('--no-ff') &&
        result.stdout.includes('--squash') &&
        result.stdout.includes('--abort')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected options\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv fetch tests
  // ===========================================

  // Test 15: cv fetch --help
  testCount++;
  console.log('Test 15: cv fetch --help');
  try {
    const result = await runCommand(['fetch', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('--all') &&
        result.stdout.includes('--prune') &&
        result.stdout.includes('--tags')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected options\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv remote tests
  // ===========================================

  // Test 16: cv remote --help
  testCount++;
  console.log('Test 16: cv remote --help');
  try {
    const result = await runCommand(['remote', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('add') &&
        result.stdout.includes('remove') &&
        result.stdout.includes('--verbose')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected options\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 17: cv remote (list remotes)
  testCount++;
  console.log('Test 17: cv remote (list)');
  try {
    const result = await runCommand(['remote']);
    if (result.code === 0 && result.stdout.includes('origin')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Could not list remotes\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 18: cv remote --json
  testCount++;
  console.log('Test 18: cv remote --json');
  try {
    const result = await runCommand(['remote', '--json']);
    const parsed = JSON.parse(result.stdout);
    if (result.code === 0 &&
        parsed.remotes &&
        Array.isArray(parsed.remotes)) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Invalid JSON output\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv reset tests
  // ===========================================

  // Test 19: cv reset --help
  testCount++;
  console.log('Test 19: cv reset --help');
  try {
    const result = await runCommand(['reset', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('--soft') &&
        result.stdout.includes('--hard') &&
        result.stdout.includes('--mixed')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected options\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv revert tests
  // ===========================================

  // Test 20: cv revert --help
  testCount++;
  console.log('Test 20: cv revert --help');
  try {
    const result = await runCommand(['revert', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('--no-commit') &&
        result.stdout.includes('--abort') &&
        result.stdout.includes('--continue')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected options\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv tag tests
  // ===========================================

  // Test 21: cv tag --help
  testCount++;
  console.log('Test 21: cv tag --help');
  try {
    const result = await runCommand(['tag', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('--annotate') &&
        result.stdout.includes('--delete') &&
        result.stdout.includes('--message')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected options\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 22: cv tag --list
  testCount++;
  console.log('Test 22: cv tag --list');
  try {
    const result = await runCommand(['tag', '--list']);
    // Should succeed and show tags (we have v0.4.x tags)
    if (result.code === 0) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Tag list failed\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 23: cv tag --json
  testCount++;
  console.log('Test 23: cv tag --json');
  try {
    const result = await runCommand(['tag', '--json']);
    const parsed = JSON.parse(result.stdout);
    if (result.code === 0 &&
        parsed.tags &&
        Array.isArray(parsed.tags)) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Invalid JSON output\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv --help includes all new commands
  // ===========================================

  // Test 24: All new commands in --help
  testCount++;
  console.log('Test 24: All git wrapper commands in cv --help');
  try {
    const result = await runCommand(['--help']);
    const commands = ['add', 'diff', 'log', 'branch', 'checkout', 'switch',
                      'stash', 'merge', 'fetch', 'remote', 'reset', 'revert', 'tag'];
    const allPresent = commands.every(cmd => result.stdout.includes(cmd));
    // Note: --help may exit with non-zero due to commander.help exception, check output only
    if (allPresent) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      const missing = commands.filter(cmd => !result.stdout.includes(cmd));
      console.log(`❌ FAIL: Missing commands: ${missing.join(', ')}\n`);
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv absorb tests
  // ===========================================

  // Test 25: cv absorb --help
  testCount++;
  console.log('Test 25: cv absorb --help');
  try {
    const result = await runCommand(['absorb', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('--and-rebase') &&
        result.stdout.includes('--dry-run') &&
        result.stdout.includes('--base')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected options\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 26: cv absorb (no staged changes)
  testCount++;
  console.log('Test 26: cv absorb (no staged changes)');
  try {
    const result = await runCommand(['absorb']);
    // Should handle gracefully when no changes staged
    if (result.stdout.includes('No staged changes') || result.code === 0) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Should handle no staged changes\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv undo tests
  // ===========================================

  // Test 27: cv undo --help
  testCount++;
  console.log('Test 27: cv undo --help');
  try {
    const result = await runCommand(['undo', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('--hard') &&
        result.stdout.includes('--steps')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected options\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 28: cv reflog
  testCount++;
  console.log('Test 28: cv reflog');
  try {
    const result = await runCommand(['reflog', '-n', '5']);
    if (result.code === 0 &&
        result.stdout.includes('Recent operations') &&
        result.stdout.includes('HEAD@{')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Unexpected reflog output\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv stack tests
  // ===========================================

  // Test 29: cv stack --help
  testCount++;
  console.log('Test 29: cv stack --help');
  try {
    const result = await runCommand(['stack', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('status') &&
        result.stdout.includes('push') &&
        result.stdout.includes('rebase') &&
        result.stdout.includes('submit')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected subcommands\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 30: cv stack status
  testCount++;
  console.log('Test 30: cv stack status');
  try {
    const result = await runCommand(['stack', 'status']);
    // Should show stack status (may have commits or be empty)
    if (result.code === 0 || result.stdout.includes('Stack') || result.stdout.includes('stack')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Unexpected stack status output\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv split tests
  // ===========================================

  // Test 31: cv split --help
  testCount++;
  console.log('Test 31: cv split --help');
  try {
    const result = await runCommand(['split', '--help']);
    if (result.code === 0 &&
        result.stdout.includes('--by-file') &&
        result.stdout.includes('--interactive')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing expected options\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // cv log enhanced tests
  // ===========================================

  // Test 32: cv log --smart
  testCount++;
  console.log('Test 32: cv log --smart -n 5');
  try {
    const result = await runCommand(['log', '--smart', '-n', '5']);
    if (result.stdout.includes('Smart Log') || result.code === 0) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Smart log failed\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 33: cv log --stack
  testCount++;
  console.log('Test 33: cv log --stack');
  try {
    const result = await runCommand(['log', '--stack']);
    if (result.stdout.includes('Stack Log') || result.code === 0) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Stack log failed\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // Test 34: cv log --mine
  testCount++;
  console.log('Test 34: cv log --mine -3');
  try {
    const result = await runCommand(['log', '--mine', '-3']);
    // Should work, may or may not have commits by current user
    if (result.code === 0) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Mine log failed\n');
    }
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}\n`);
  }

  // ===========================================
  // Summary
  // ===========================================

  console.log('━'.repeat(60));
  console.log('🎉 Git wrapper command tests complete!\n');
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

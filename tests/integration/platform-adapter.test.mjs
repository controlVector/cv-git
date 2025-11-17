#!/usr/bin/env node

/**
 * Integration Test: Platform Adapter
 * Tests platform detection, adapter creation, and configuration
 */

import {
  createPlatformAdapter,
  detectPlatformFromRemote,
  getDefaultApiUrl,
  getDefaultWebUrl,
  GitHubAdapter
} from '../../packages/platform/dist/index.js';
import { CredentialManager } from '../../packages/credentials/dist/index.js';

async function runTests() {
  console.log('🧪 Testing Platform Adapter\n');

  try {
    let testCount = 0;
    let passedCount = 0;

    // Test 1: Detect GitHub from URL
    testCount++;
    console.log('Test 1: Detect GitHub platform from remote URL');
    const githubPlatform1 = detectPlatformFromRemote('https://github.com/user/repo.git');
    console.log(`Detected: ${githubPlatform1}`);
    if (githubPlatform1 === 'github') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "github"\n');
    }

    // Test 2: Detect GitHub from SSH URL
    testCount++;
    console.log('Test 2: Detect GitHub from SSH URL');
    const githubPlatform2 = detectPlatformFromRemote('git@github.com:user/repo.git');
    console.log(`Detected: ${githubPlatform2}`);
    if (githubPlatform2 === 'github') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "github"\n');
    }

    // Test 3: Get default GitHub API URL
    testCount++;
    console.log('Test 3: Get default GitHub API URL');
    const githubApiUrl = getDefaultApiUrl('github');
    console.log(`API URL: ${githubApiUrl}`);
    if (githubApiUrl === 'https://api.github.com') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "https://api.github.com"\n');
    }

    // Test 4: Get default GitHub web URL
    testCount++;
    console.log('Test 4: Get default GitHub web URL');
    const githubWebUrl = getDefaultWebUrl('github');
    console.log(`Web URL: ${githubWebUrl}`);
    if (githubWebUrl === 'https://github.com') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "https://github.com"\n');
    }

    // Test 5: Create GitHub adapter (without real credentials)
    testCount++;
    console.log('Test 5: Create GitHub adapter instance');
    try {
      const mockCredentials = new CredentialManager();
      const adapter = new GitHubAdapter(mockCredentials);
      console.log(`Adapter created: ${adapter.constructor.name}`);
      console.log('✅ PASS\n');
      passedCount++;
    } catch (error) {
      console.log(`❌ FAIL: ${error.message}\n`);
    }

    // Test 6: GitHubAdapter has required methods
    testCount++;
    console.log('Test 6: Verify GitHubAdapter has required methods');
    const mockCredentials = new CredentialManager();
    const adapter = new GitHubAdapter(mockCredentials);
    const requiredMethods = [
      'init',
      'getRepoInfo',
      'createPR',
      'listPRs',
      'getPR',
      'updatePR',
      'mergePR',
      'createRelease',
      'listReleases',
      'getRelease',
      'deleteRelease',
      'validateToken',
      'getTokenScopes'
    ];

    let allMethodsExist = true;
    const missingMethods = [];

    for (const method of requiredMethods) {
      if (typeof adapter[method] !== 'function') {
        allMethodsExist = false;
        missingMethods.push(method);
      }
    }

    if (allMethodsExist) {
      console.log(`All ${requiredMethods.length} required methods exist`);
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log(`❌ FAIL: Missing methods: ${missingMethods.join(', ')}\n`);
    }

    // Test 7: Platform factory with GitHub
    testCount++;
    console.log('Test 7: Create adapter using factory');
    try {
      const factoryAdapter = createPlatformAdapter(
        { type: 'github', url: 'https://github.com', api: 'https://api.github.com' },
        mockCredentials
      );
      console.log(`Factory created: ${factoryAdapter.constructor.name}`);
      if (factoryAdapter instanceof GitHubAdapter) {
        console.log('✅ PASS\n');
        passedCount++;
      } else {
        console.log('❌ FAIL: Not a GitHubAdapter instance\n');
      }
    } catch (error) {
      console.log(`❌ FAIL: ${error.message}\n`);
    }

    // Test 8: Unknown platform throws error
    testCount++;
    console.log('Test 8: Unknown platform should throw error');
    try {
      createPlatformAdapter(
        { type: 'unknown-platform', url: 'https://example.com' },
        mockCredentials
      );
      console.log('❌ FAIL: Should have thrown error\n');
    } catch (error) {
      if (error.message.includes('Unknown platform')) {
        console.log(`Correctly threw error: ${error.message}`);
        console.log('✅ PASS\n');
        passedCount++;
      } else {
        console.log(`❌ FAIL: Wrong error: ${error.message}\n`);
      }
    }

    console.log('🎉 Platform adapter tests complete!\n');
    console.log(`✅ Success: ${passedCount}/${testCount} tests passed`);

    return {
      success: passedCount === testCount,
      testsRun: testCount,
      testsPassed: passedCount,
    };

  } catch (error) {
    console.error('❌ Test suite failed:', error.message);
    console.error(error.stack);
    return {
      success: false,
      error: error.message,
    };
  }
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

#!/usr/bin/env node

/**
 * Integration Test: CV-Hub Platform Adapter
 * Tests factory detection, adapter construction, interface compliance,
 * authentication error handling, and optional live API smoke tests.
 */

import {
  createPlatformAdapter,
  detectPlatformFromRemote,
  getDefaultApiUrl,
  getDefaultWebUrl,
  CVHubAdapter,
} from '../../packages/platform/dist/index.js';
import { CredentialManager, GitPlatform } from '../../packages/credentials/dist/index.js';

/**
 * Mock CredentialManager that returns a configurable token for CV-Hub
 */
function createMockCredentials(token = null) {
  return {
    getGitPlatformToken: async (platform) => {
      if (platform === GitPlatform.CV_HUB) return token;
      return null;
    },
  };
}

async function runTests() {
  console.log('🧪 Testing CV-Hub Platform Adapter\n');

  try {
    let testCount = 0;
    let passedCount = 0;

    // ============================================================================
    // Factory & Detection Tests
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Factory & Detection Tests');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 1: detectPlatformFromRemote identifies CV-Hub HTTPS URLs
    testCount++;
    console.log('Test 1: detectPlatformFromRemote identifies CV-Hub URLs');
    const urls = [
      'https://git.hub.controlvector.io/owner/repo.git',
      'git@git.hub.controlvector.io:owner/repo.git',
      'https://controlfab.ai/owner/repo.git',
    ];
    let allDetected = true;
    for (const url of urls) {
      const detected = detectPlatformFromRemote(url);
      if (detected !== GitPlatform.CV_HUB) {
        console.log(`  ❌ ${url} → ${detected} (expected ${GitPlatform.CV_HUB})`);
        allDetected = false;
      } else {
        console.log(`  ✓ ${url} → ${detected}`);
      }
    }
    if (allDetected) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL\n');
    }

    // Test 2: createPlatformAdapter creates CVHubAdapter
    testCount++;
    console.log('Test 2: createPlatformAdapter creates CVHubAdapter for CV_HUB');
    try {
      const mockCreds = createMockCredentials('fake-token');
      const adapter = createPlatformAdapter({ type: GitPlatform.CV_HUB }, mockCreds);
      if (adapter instanceof CVHubAdapter) {
        console.log(`  Created: ${adapter.constructor.name}`);
        console.log('✅ PASS\n');
        passedCount++;
      } else {
        console.log(`  ❌ Got ${adapter.constructor.name}, expected CVHubAdapter`);
        console.log('❌ FAIL\n');
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      console.log('❌ FAIL\n');
    }

    // Test 3: getDefaultApiUrl and getDefaultWebUrl return CV-Hub URLs
    testCount++;
    console.log('Test 3: getDefaultApiUrl and getDefaultWebUrl return CV-Hub URLs');
    const apiUrl = getDefaultApiUrl(GitPlatform.CV_HUB);
    const webUrl = getDefaultWebUrl(GitPlatform.CV_HUB);
    console.log(`  API URL: ${apiUrl}`);
    console.log(`  Web URL: ${webUrl}`);
    if (apiUrl === 'https://api.controlfab.ai/v1' && webUrl === 'https://hub.controlvector.io') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL\n');
    }

    // ============================================================================
    // Adapter Construction Tests
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Adapter Construction Tests');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 4: CVHubAdapter.getPlatformName returns 'cv-hub'
    testCount++;
    console.log('Test 4: CVHubAdapter.getPlatformName() returns "cv-hub"');
    const adapter4 = new CVHubAdapter(createMockCredentials());
    const platformName = adapter4.getPlatformName();
    console.log(`  Platform name: ${platformName}`);
    if (platformName === 'cv-hub') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL\n');
    }

    // Test 5: CVHubAdapter accepts custom apiUrl and webUrl
    testCount++;
    console.log('Test 5: CVHubAdapter accepts custom apiUrl and webUrl');
    try {
      const customAdapter = new CVHubAdapter(createMockCredentials(), {
        apiUrl: 'https://custom-api.example.com',
        webUrl: 'https://custom-web.example.com',
      });
      console.log(`  Created adapter with custom URLs: ${customAdapter.constructor.name}`);
      console.log('✅ PASS\n');
      passedCount++;
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      console.log('❌ FAIL\n');
    }

    // ============================================================================
    // Authentication Tests
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Authentication Tests');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 6: init throws without credentials
    testCount++;
    console.log('Test 6: init() throws when no CV-Hub token is stored');
    try {
      const noTokenAdapter = new CVHubAdapter(createMockCredentials(null));
      await noTokenAdapter.init();
      console.log('  ❌ Should have thrown');
      console.log('❌ FAIL\n');
    } catch (error) {
      if (error.message.includes('CV-Hub token not found')) {
        console.log(`  Correctly threw: "${error.message}"`);
        console.log('✅ PASS\n');
        passedCount++;
      } else {
        console.log(`  ❌ Wrong error: ${error.message}`);
        console.log('❌ FAIL\n');
      }
    }

    // Test 7: init succeeds with a token
    testCount++;
    console.log('Test 7: init() succeeds when token is available');
    try {
      const tokenAdapter = new CVHubAdapter(createMockCredentials('test-token-123'));
      await tokenAdapter.init();
      console.log('  init() completed without error');
      console.log('✅ PASS\n');
      passedCount++;
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      console.log('❌ FAIL\n');
    }

    // ============================================================================
    // Interface Compliance Tests
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Interface Compliance Tests');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 8: CVHubAdapter has all required methods
    testCount++;
    console.log('Test 8: CVHubAdapter has all required interface methods');
    const requiredMethods = [
      'init',
      'getPlatformName',
      'getWebUrl',
      'getRepoInfo',
      'getRepo',
      'createPR',
      'getPR',
      'listPRs',
      'updatePR',
      'mergePR',
      'createRelease',
      'getRelease',
      'listReleases',
      'deleteRelease',
      'createIssue',
      'getIssue',
      'listIssues',
      'updateIssue',
      'getCommits',
      'getCommit',
      'listBranches',
      'getBranch',
      'validateToken',
      'getTokenScopes',
    ];
    const complianceAdapter = new CVHubAdapter(createMockCredentials());
    let allMethodsExist = true;
    const missingMethods = [];
    for (const method of requiredMethods) {
      if (typeof complianceAdapter[method] !== 'function') {
        allMethodsExist = false;
        missingMethods.push(method);
      }
    }
    if (allMethodsExist) {
      console.log(`  All ${requiredMethods.length} required methods exist`);
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log(`  ❌ Missing methods: ${missingMethods.join(', ')}`);
      console.log('❌ FAIL\n');
    }

    // ============================================================================
    // Error Handling Tests
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Error Handling Tests');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 9: validateToken throws on invalid token (network error expected — no live server)
    testCount++;
    console.log('Test 9: validateToken handles API errors gracefully');
    try {
      const errAdapter = new CVHubAdapter(createMockCredentials(), {
        apiUrl: 'http://localhost:1', // non-existent endpoint
      });
      await errAdapter.validateToken('bad-token');
      console.log('  ❌ Should have thrown');
      console.log('❌ FAIL\n');
    } catch (error) {
      console.log(`  Correctly threw: "${error.message.substring(0, 80)}..."`);
      console.log('✅ PASS\n');
      passedCount++;
    }

    // Test 10: Factory creates CVHubAdapter with custom URLs
    testCount++;
    console.log('Test 10: Factory creates CVHubAdapter with custom URLs');
    try {
      const factoryCustom = createPlatformAdapter(
        {
          type: GitPlatform.CV_HUB,
          apiUrl: 'https://custom.controlfab.ai/v1',
          webUrl: 'https://custom.hub.controlvector.io',
        },
        createMockCredentials()
      );
      if (factoryCustom instanceof CVHubAdapter) {
        console.log(`  Factory created: ${factoryCustom.constructor.name}`);
        console.log('✅ PASS\n');
        passedCount++;
      } else {
        console.log('  ❌ Not a CVHubAdapter instance');
        console.log('❌ FAIL\n');
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      console.log('❌ FAIL\n');
    }

    // ============================================================================
    // Live API Smoke Tests (optional — skip with CV_HUB_SKIP_LIVE=1)
    // ============================================================================
    if (!process.env.CV_HUB_SKIP_LIVE) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Live API Smoke Tests (set CV_HUB_SKIP_LIVE=1 to skip)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      let liveAdapter = null;
      try {
        const creds = new CredentialManager();
        const token = await creds.getGitPlatformToken(GitPlatform.CV_HUB);
        if (token) {
          liveAdapter = new CVHubAdapter(creds, {
            apiUrl: process.env.CV_HUB_URL || 'https://api.controlfab.ai',
          });
        }
      } catch {
        // No credentials available
      }

      if (!liveAdapter) {
        console.log('  ⏭ Skipping live tests — no CV-Hub credentials found\n');
      } else {
        // Test 11: getRepoInfo with live adapter
        testCount++;
        console.log('Test 11: [LIVE] getRepoInfo returns repository');
        try {
          const repoInfo = await liveAdapter.getRepoInfo();
          console.log(`  Repo: ${repoInfo.fullName} (default branch: ${repoInfo.defaultBranch})`);
          if (repoInfo.owner && repoInfo.name && repoInfo.fullName && repoInfo.defaultBranch) {
            console.log('✅ PASS\n');
            passedCount++;
          } else {
            console.log('  ❌ Missing required fields');
            console.log('❌ FAIL\n');
          }
        } catch (error) {
          console.log(`  ❌ Error: ${error.message}`);
          console.log('❌ FAIL\n');
        }

        // Test 12: listBranches with live adapter
        testCount++;
        console.log('Test 12: [LIVE] listBranches returns at least one branch');
        try {
          const branches = await liveAdapter.listBranches();
          console.log(`  Found ${branches.length} branches`);
          if (Array.isArray(branches) && branches.length >= 1) {
            console.log(`  First branch: ${branches[0].name}`);
            console.log('✅ PASS\n');
            passedCount++;
          } else {
            console.log('  ❌ Expected at least one branch');
            console.log('❌ FAIL\n');
          }
        } catch (error) {
          console.log(`  ❌ Error: ${error.message}`);
          console.log('❌ FAIL\n');
        }

        // Test 13: listPRs with live adapter
        testCount++;
        console.log('Test 13: [LIVE] listPRs returns array');
        try {
          const prs = await liveAdapter.listPRs();
          console.log(`  Found ${prs.length} pull requests`);
          if (Array.isArray(prs)) {
            console.log('✅ PASS\n');
            passedCount++;
          } else {
            console.log('  ❌ Expected array');
            console.log('❌ FAIL\n');
          }
        } catch (error) {
          console.log(`  ❌ Error: ${error.message}`);
          console.log('❌ FAIL\n');
        }

        // Test 14: listReleases with live adapter
        testCount++;
        console.log('Test 14: [LIVE] listReleases returns array');
        try {
          const releases = await liveAdapter.listReleases();
          console.log(`  Found ${releases.length} releases`);
          if (Array.isArray(releases)) {
            console.log('✅ PASS\n');
            passedCount++;
          } else {
            console.log('  ❌ Expected array');
            console.log('❌ FAIL\n');
          }
        } catch (error) {
          console.log(`  ❌ Error: ${error.message}`);
          console.log('❌ FAIL\n');
        }
      }
    } else {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Live API Smoke Tests — SKIPPED (CV_HUB_SKIP_LIVE=1)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }

    // ============================================================================
    // Summary
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 CV-Hub adapter tests complete!\n');
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

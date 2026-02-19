#!/usr/bin/env node

/**
 * Integration Test: CV-Hub Platform Adapter
 * Tests factory detection, adapter construction, interface compliance,
 * authentication error handling, and optional live API smoke tests.
 *
 * Now covers both ControlVector Hub (CV_HUB) and Control Fabric (CONTROLFAB).
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
 * Mock CredentialManager that returns a configurable token for a given platform
 */
function createMockCredentials(token = null, platform = GitPlatform.CV_HUB) {
  return {
    getGitPlatformToken: async (p) => {
      if (p === platform) return token;
      return null;
    },
  };
}

async function runTests() {
  console.log('🧪 Testing CV-Hub & Control Fabric Platform Adapters\n');

  try {
    let testCount = 0;
    let passedCount = 0;

    // ============================================================================
    // Factory & Detection Tests
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Factory & Detection Tests');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 1: detectPlatformFromRemote identifies ControlVector Hub URLs as CV_HUB
    testCount++;
    console.log('Test 1: detectPlatformFromRemote identifies ControlVector Hub URLs as CV_HUB');
    const cvHubUrls = [
      'https://hub.controlvector.io/owner/repo.git',
      'git@hub.controlvector.io:owner/repo.git',
      'https://git.hub.controlvector.io/owner/repo.git',
    ];
    let allDetected = true;
    for (const url of cvHubUrls) {
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

    // Test 2: detectPlatformFromRemote identifies Control Fabric URLs as CONTROLFAB
    testCount++;
    console.log('Test 2: detectPlatformFromRemote identifies Control Fabric URLs as CONTROLFAB');
    const controlfabUrls = [
      'https://controlfab.ai/owner/repo.git',
      'https://hub.controlfab.ai/owner/repo.git',
      'git@controlfab.ai:owner/repo.git',
    ];
    let allCFDetected = true;
    for (const url of controlfabUrls) {
      const detected = detectPlatformFromRemote(url);
      if (detected !== GitPlatform.CONTROLFAB) {
        console.log(`  ❌ ${url} → ${detected} (expected ${GitPlatform.CONTROLFAB})`);
        allCFDetected = false;
      } else {
        console.log(`  ✓ ${url} → ${detected}`);
      }
    }
    if (allCFDetected) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL\n');
    }

    // Test 3: createPlatformAdapter creates CVHubAdapter for CV_HUB
    testCount++;
    console.log('Test 3: createPlatformAdapter creates CVHubAdapter for CV_HUB');
    try {
      const mockCreds = createMockCredentials('fake-token', GitPlatform.CV_HUB);
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

    // Test 4: createPlatformAdapter creates CVHubAdapter for CONTROLFAB
    testCount++;
    console.log('Test 4: createPlatformAdapter creates CVHubAdapter for CONTROLFAB');
    try {
      const mockCreds = createMockCredentials('fake-token', GitPlatform.CONTROLFAB);
      const adapter = createPlatformAdapter({ type: GitPlatform.CONTROLFAB }, mockCreds);
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

    // Test 5: getDefaultApiUrl returns correct URLs for each platform
    testCount++;
    console.log('Test 5: getDefaultApiUrl and getDefaultWebUrl return correct URLs');
    const cvHubApiUrl = getDefaultApiUrl(GitPlatform.CV_HUB);
    const cvHubWebUrl = getDefaultWebUrl(GitPlatform.CV_HUB);
    const cfApiUrl = getDefaultApiUrl(GitPlatform.CONTROLFAB);
    const cfWebUrl = getDefaultWebUrl(GitPlatform.CONTROLFAB);
    console.log(`  CV_HUB API URL: ${cvHubApiUrl}`);
    console.log(`  CV_HUB Web URL: ${cvHubWebUrl}`);
    console.log(`  CONTROLFAB API URL: ${cfApiUrl}`);
    console.log(`  CONTROLFAB Web URL: ${cfWebUrl}`);
    if (
      cvHubApiUrl === 'https://api.hub.controlvector.io/v1' &&
      cvHubWebUrl === 'https://hub.controlvector.io' &&
      cfApiUrl === 'https://api.controlfab.ai/v1' &&
      cfWebUrl === 'https://hub.controlfab.ai'
    ) {
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

    // Test 6: CVHubAdapter.getPlatformName returns 'cv-hub' for CV_HUB
    testCount++;
    console.log('Test 6: CVHubAdapter.getPlatformName() returns "cv-hub" for CV_HUB');
    const adapter6 = new CVHubAdapter(createMockCredentials(), { platform: GitPlatform.CV_HUB });
    const platformName6 = adapter6.getPlatformName();
    console.log(`  Platform name: ${platformName6}`);
    if (platformName6 === 'cv-hub') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL\n');
    }

    // Test 7: CVHubAdapter.getPlatformName returns 'controlfab' for CONTROLFAB
    testCount++;
    console.log('Test 7: CVHubAdapter.getPlatformName() returns "controlfab" for CONTROLFAB');
    const adapter7 = new CVHubAdapter(createMockCredentials(null, GitPlatform.CONTROLFAB), {
      platform: GitPlatform.CONTROLFAB,
    });
    const platformName7 = adapter7.getPlatformName();
    console.log(`  Platform name: ${platformName7}`);
    if (platformName7 === 'controlfab') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL\n');
    }

    // Test 8: CVHubAdapter accepts custom apiUrl and webUrl
    testCount++;
    console.log('Test 8: CVHubAdapter accepts custom apiUrl and webUrl');
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

    // Test 9: init throws without credentials (CV_HUB)
    testCount++;
    console.log('Test 9: init() throws when no CV_HUB token is stored');
    try {
      const noTokenAdapter = new CVHubAdapter(createMockCredentials(null), { platform: GitPlatform.CV_HUB });
      await noTokenAdapter.init();
      console.log('  ❌ Should have thrown');
      console.log('❌ FAIL\n');
    } catch (error) {
      if (error.message.includes('ControlVector Hub token not found')) {
        console.log(`  Correctly threw: "${error.message}"`);
        console.log('✅ PASS\n');
        passedCount++;
      } else {
        console.log(`  ❌ Wrong error: ${error.message}`);
        console.log('❌ FAIL\n');
      }
    }

    // Test 10: init throws without credentials (CONTROLFAB)
    testCount++;
    console.log('Test 10: init() throws when no CONTROLFAB token is stored');
    try {
      const noTokenAdapter = new CVHubAdapter(createMockCredentials(null, GitPlatform.CONTROLFAB), {
        platform: GitPlatform.CONTROLFAB,
      });
      await noTokenAdapter.init();
      console.log('  ❌ Should have thrown');
      console.log('❌ FAIL\n');
    } catch (error) {
      if (error.message.includes('Control Fabric token not found')) {
        console.log(`  Correctly threw: "${error.message}"`);
        console.log('✅ PASS\n');
        passedCount++;
      } else {
        console.log(`  ❌ Wrong error: ${error.message}`);
        console.log('❌ FAIL\n');
      }
    }

    // Test 11: init succeeds with a token (CV_HUB)
    testCount++;
    console.log('Test 11: init() succeeds when CV_HUB token is available');
    try {
      const tokenAdapter = new CVHubAdapter(createMockCredentials('test-token-123', GitPlatform.CV_HUB), {
        platform: GitPlatform.CV_HUB,
      });
      await tokenAdapter.init();
      console.log('  init() completed without error');
      console.log('✅ PASS\n');
      passedCount++;
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      console.log('❌ FAIL\n');
    }

    // Test 12: init succeeds with a token (CONTROLFAB)
    testCount++;
    console.log('Test 12: init() succeeds when CONTROLFAB token is available');
    try {
      const tokenAdapter = new CVHubAdapter(
        createMockCredentials('test-token-456', GitPlatform.CONTROLFAB),
        { platform: GitPlatform.CONTROLFAB }
      );
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

    // Test 13: CVHubAdapter has all required methods
    testCount++;
    console.log('Test 13: CVHubAdapter has all required interface methods');
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

    // Test 14: validateToken throws on invalid token (network error expected — no live server)
    testCount++;
    console.log('Test 14: validateToken handles API errors gracefully');
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

    // Test 15: Factory creates CVHubAdapter with custom URLs (CV_HUB)
    testCount++;
    console.log('Test 15: Factory creates CVHubAdapter with custom URLs for CV_HUB');
    try {
      const factoryCustom = createPlatformAdapter(
        {
          type: GitPlatform.CV_HUB,
          apiUrl: 'https://custom.hub.controlvector.io/v1',
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

    // Test 16: Factory creates CVHubAdapter with custom URLs (CONTROLFAB)
    testCount++;
    console.log('Test 16: Factory creates CVHubAdapter with custom URLs for CONTROLFAB');
    try {
      const factoryCustom = createPlatformAdapter(
        {
          type: GitPlatform.CONTROLFAB,
          apiUrl: 'https://custom.controlfab.ai/v1',
          webUrl: 'https://custom.hub.controlfab.ai',
        },
        createMockCredentials(null, GitPlatform.CONTROLFAB)
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
            apiUrl: process.env.CV_HUB_URL || 'https://api.hub.controlvector.io',
            platform: GitPlatform.CV_HUB,
          });
        }
      } catch {
        // No credentials available
      }

      if (!liveAdapter) {
        console.log('  ⏭ Skipping live tests — no CV-Hub credentials found\n');
      } else {
        // Test 17: getRepoInfo with live adapter
        testCount++;
        console.log('Test 17: [LIVE] getRepoInfo returns repository');
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

        // Test 18: listBranches with live adapter
        testCount++;
        console.log('Test 18: [LIVE] listBranches returns at least one branch');
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

        // Test 19: listPRs with live adapter
        testCount++;
        console.log('Test 19: [LIVE] listPRs returns array');
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

        // Test 20: listReleases with live adapter
        testCount++;
        console.log('Test 20: [LIVE] listReleases returns array');
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
    console.log('🎉 CV-Hub & Control Fabric adapter tests complete!\n');
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

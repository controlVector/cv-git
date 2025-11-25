#!/usr/bin/env node

/**
 * Integration Test: Platform Adapters
 * Tests platform detection, adapter creation, configuration, and interface compliance
 * for GitHub, GitLab, and Bitbucket adapters.
 */

import {
  createPlatformAdapter,
  detectPlatformFromRemote,
  getDefaultApiUrl,
  getDefaultWebUrl,
  GitHubAdapter,
  GitLabAdapter,
  BitbucketAdapter,
  PullRequestState,
  IssueState,
} from '../../packages/platform/dist/index.js';
import { CredentialManager, GitPlatform } from '../../packages/credentials/dist/index.js';

async function runTests() {
  console.log('🧪 Testing Platform Adapters\n');

  try {
    let testCount = 0;
    let passedCount = 0;

    // ============================================================================
    // Platform Detection Tests
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Platform Detection Tests');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 1: Detect GitHub from HTTPS URL
    testCount++;
    console.log('Test 1: Detect GitHub platform from HTTPS URL');
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

    // Test 3: Detect GitLab from HTTPS URL
    testCount++;
    console.log('Test 3: Detect GitLab platform from HTTPS URL');
    const gitlabPlatform1 = detectPlatformFromRemote('https://gitlab.com/user/repo.git');
    console.log(`Detected: ${gitlabPlatform1}`);
    if (gitlabPlatform1 === 'gitlab') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "gitlab"\n');
    }

    // Test 4: Detect GitLab from SSH URL
    testCount++;
    console.log('Test 4: Detect GitLab from SSH URL');
    const gitlabPlatform2 = detectPlatformFromRemote('git@gitlab.com:group/subgroup/repo.git');
    console.log(`Detected: ${gitlabPlatform2}`);
    if (gitlabPlatform2 === 'gitlab') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "gitlab"\n');
    }

    // Test 5: Detect Bitbucket from HTTPS URL
    testCount++;
    console.log('Test 5: Detect Bitbucket platform from HTTPS URL');
    const bitbucketPlatform1 = detectPlatformFromRemote('https://bitbucket.org/workspace/repo.git');
    console.log(`Detected: ${bitbucketPlatform1}`);
    if (bitbucketPlatform1 === 'bitbucket') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "bitbucket"\n');
    }

    // Test 6: Detect Bitbucket from SSH URL
    testCount++;
    console.log('Test 6: Detect Bitbucket from SSH URL');
    const bitbucketPlatform2 = detectPlatformFromRemote('git@bitbucket.org:workspace/repo.git');
    console.log(`Detected: ${bitbucketPlatform2}`);
    if (bitbucketPlatform2 === 'bitbucket') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "bitbucket"\n');
    }

    // ============================================================================
    // Default URL Tests
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Default URL Tests');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 7: GitHub API URL
    testCount++;
    console.log('Test 7: Get default GitHub API URL');
    const githubApiUrl = getDefaultApiUrl('github');
    console.log(`API URL: ${githubApiUrl}`);
    if (githubApiUrl === 'https://api.github.com') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "https://api.github.com"\n');
    }

    // Test 8: GitHub Web URL
    testCount++;
    console.log('Test 8: Get default GitHub web URL');
    const githubWebUrl = getDefaultWebUrl('github');
    console.log(`Web URL: ${githubWebUrl}`);
    if (githubWebUrl === 'https://github.com') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "https://github.com"\n');
    }

    // Test 9: GitLab API URL
    testCount++;
    console.log('Test 9: Get default GitLab API URL');
    const gitlabApiUrl = getDefaultApiUrl('gitlab');
    console.log(`API URL: ${gitlabApiUrl}`);
    if (gitlabApiUrl === 'https://gitlab.com/api/v4') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "https://gitlab.com/api/v4"\n');
    }

    // Test 10: GitLab Web URL
    testCount++;
    console.log('Test 10: Get default GitLab web URL');
    const gitlabWebUrl = getDefaultWebUrl('gitlab');
    console.log(`Web URL: ${gitlabWebUrl}`);
    if (gitlabWebUrl === 'https://gitlab.com') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "https://gitlab.com"\n');
    }

    // Test 11: Bitbucket API URL
    testCount++;
    console.log('Test 11: Get default Bitbucket API URL');
    const bitbucketApiUrl = getDefaultApiUrl('bitbucket');
    console.log(`API URL: ${bitbucketApiUrl}`);
    if (bitbucketApiUrl === 'https://api.bitbucket.org/2.0') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "https://api.bitbucket.org/2.0"\n');
    }

    // Test 12: Bitbucket Web URL
    testCount++;
    console.log('Test 12: Get default Bitbucket web URL');
    const bitbucketWebUrl = getDefaultWebUrl('bitbucket');
    console.log(`Web URL: ${bitbucketWebUrl}`);
    if (bitbucketWebUrl === 'https://bitbucket.org') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "https://bitbucket.org"\n');
    }

    // ============================================================================
    // Adapter Instantiation Tests
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Adapter Instantiation Tests');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const mockCredentials = new CredentialManager();

    // Test 13: Create GitHub adapter directly
    testCount++;
    console.log('Test 13: Create GitHub adapter instance');
    try {
      const githubAdapter = new GitHubAdapter(mockCredentials);
      console.log(`Adapter created: ${githubAdapter.constructor.name}`);
      if (githubAdapter instanceof GitHubAdapter) {
        console.log('✅ PASS\n');
        passedCount++;
      } else {
        console.log('❌ FAIL: Not a GitHubAdapter instance\n');
      }
    } catch (error) {
      console.log(`❌ FAIL: ${error.message}\n`);
    }

    // Test 14: Create GitLab adapter directly
    testCount++;
    console.log('Test 14: Create GitLab adapter instance');
    try {
      const gitlabAdapter = new GitLabAdapter(mockCredentials);
      console.log(`Adapter created: ${gitlabAdapter.constructor.name}`);
      if (gitlabAdapter instanceof GitLabAdapter) {
        console.log('✅ PASS\n');
        passedCount++;
      } else {
        console.log('❌ FAIL: Not a GitLabAdapter instance\n');
      }
    } catch (error) {
      console.log(`❌ FAIL: ${error.message}\n`);
    }

    // Test 15: Create Bitbucket adapter directly
    testCount++;
    console.log('Test 15: Create Bitbucket adapter instance');
    try {
      const bitbucketAdapter = new BitbucketAdapter(mockCredentials);
      console.log(`Adapter created: ${bitbucketAdapter.constructor.name}`);
      if (bitbucketAdapter instanceof BitbucketAdapter) {
        console.log('✅ PASS\n');
        passedCount++;
      } else {
        console.log('❌ FAIL: Not a BitbucketAdapter instance\n');
      }
    } catch (error) {
      console.log(`❌ FAIL: ${error.message}\n`);
    }

    // Test 16: Create GitLab adapter with custom URLs
    testCount++;
    console.log('Test 16: Create GitLab adapter with custom URLs (self-hosted)');
    try {
      const gitlabSelfHosted = new GitLabAdapter(mockCredentials, {
        apiUrl: 'https://gitlab.mycompany.com/api/v4',
        webUrl: 'https://gitlab.mycompany.com',
      });
      console.log(`Self-hosted adapter created: ${gitlabSelfHosted.constructor.name}`);
      console.log('✅ PASS\n');
      passedCount++;
    } catch (error) {
      console.log(`❌ FAIL: ${error.message}\n`);
    }

    // Test 17: Create Bitbucket adapter with custom URLs
    testCount++;
    console.log('Test 17: Create Bitbucket adapter with custom URLs (self-hosted)');
    try {
      const bitbucketSelfHosted = new BitbucketAdapter(mockCredentials, {
        apiUrl: 'https://bitbucket.mycompany.com/rest/api/2.0',
        webUrl: 'https://bitbucket.mycompany.com',
      });
      console.log(`Self-hosted adapter created: ${bitbucketSelfHosted.constructor.name}`);
      console.log('✅ PASS\n');
      passedCount++;
    } catch (error) {
      console.log(`❌ FAIL: ${error.message}\n`);
    }

    // ============================================================================
    // Factory Tests
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Factory Tests');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 18: Factory creates GitHub adapter
    testCount++;
    console.log('Test 18: Factory creates GitHub adapter');
    try {
      const factoryGithub = createPlatformAdapter(
        { type: GitPlatform.GITHUB },
        mockCredentials
      );
      console.log(`Factory created: ${factoryGithub.constructor.name}`);
      if (factoryGithub instanceof GitHubAdapter) {
        console.log('✅ PASS\n');
        passedCount++;
      } else {
        console.log('❌ FAIL: Not a GitHubAdapter instance\n');
      }
    } catch (error) {
      console.log(`❌ FAIL: ${error.message}\n`);
    }

    // Test 19: Factory creates GitLab adapter
    testCount++;
    console.log('Test 19: Factory creates GitLab adapter');
    try {
      const factoryGitlab = createPlatformAdapter(
        { type: GitPlatform.GITLAB },
        mockCredentials
      );
      console.log(`Factory created: ${factoryGitlab.constructor.name}`);
      if (factoryGitlab instanceof GitLabAdapter) {
        console.log('✅ PASS\n');
        passedCount++;
      } else {
        console.log('❌ FAIL: Not a GitLabAdapter instance\n');
      }
    } catch (error) {
      console.log(`❌ FAIL: ${error.message}\n`);
    }

    // Test 20: Factory creates Bitbucket adapter
    testCount++;
    console.log('Test 20: Factory creates Bitbucket adapter');
    try {
      const factoryBitbucket = createPlatformAdapter(
        { type: GitPlatform.BITBUCKET },
        mockCredentials
      );
      console.log(`Factory created: ${factoryBitbucket.constructor.name}`);
      if (factoryBitbucket instanceof BitbucketAdapter) {
        console.log('✅ PASS\n');
        passedCount++;
      } else {
        console.log('❌ FAIL: Not a BitbucketAdapter instance\n');
      }
    } catch (error) {
      console.log(`❌ FAIL: ${error.message}\n`);
    }

    // Test 21: Factory with custom URLs
    testCount++;
    console.log('Test 21: Factory creates GitLab adapter with custom URLs');
    try {
      const factoryCustom = createPlatformAdapter(
        {
          type: GitPlatform.GITLAB,
          apiUrl: 'https://gitlab.enterprise.com/api/v4',
          webUrl: 'https://gitlab.enterprise.com',
        },
        mockCredentials
      );
      console.log(`Factory created: ${factoryCustom.constructor.name}`);
      console.log('✅ PASS\n');
      passedCount++;
    } catch (error) {
      console.log(`❌ FAIL: ${error.message}\n`);
    }

    // Test 22: Unknown platform throws error
    testCount++;
    console.log('Test 22: Unknown platform should throw error');
    try {
      createPlatformAdapter(
        { type: 'unknown-platform' },
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

    // ============================================================================
    // Interface Compliance Tests - GitHub
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Interface Compliance Tests - GitHub');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

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

    // Test 23: GitHub adapter has all required methods
    testCount++;
    console.log('Test 23: GitHubAdapter has all required methods');
    const githubAdapter = new GitHubAdapter(mockCredentials);
    let githubAllMethodsExist = true;
    const githubMissingMethods = [];

    for (const method of requiredMethods) {
      if (typeof githubAdapter[method] !== 'function') {
        githubAllMethodsExist = false;
        githubMissingMethods.push(method);
      }
    }

    if (githubAllMethodsExist) {
      console.log(`All ${requiredMethods.length} required methods exist`);
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log(`❌ FAIL: Missing methods: ${githubMissingMethods.join(', ')}\n`);
    }

    // Test 24: GitHub getPlatformName returns correct value
    testCount++;
    console.log('Test 24: GitHubAdapter.getPlatformName() returns "github"');
    const githubPlatformName = githubAdapter.getPlatformName();
    console.log(`Platform name: ${githubPlatformName}`);
    if (githubPlatformName === 'github') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "github"\n');
    }

    // ============================================================================
    // Interface Compliance Tests - GitLab
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Interface Compliance Tests - GitLab');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 25: GitLab adapter has all required methods
    testCount++;
    console.log('Test 25: GitLabAdapter has all required methods');
    const gitlabAdapter = new GitLabAdapter(mockCredentials);
    let gitlabAllMethodsExist = true;
    const gitlabMissingMethods = [];

    for (const method of requiredMethods) {
      if (typeof gitlabAdapter[method] !== 'function') {
        gitlabAllMethodsExist = false;
        gitlabMissingMethods.push(method);
      }
    }

    if (gitlabAllMethodsExist) {
      console.log(`All ${requiredMethods.length} required methods exist`);
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log(`❌ FAIL: Missing methods: ${gitlabMissingMethods.join(', ')}\n`);
    }

    // Test 26: GitLab getPlatformName returns correct value
    testCount++;
    console.log('Test 26: GitLabAdapter.getPlatformName() returns "gitlab"');
    const gitlabPlatformName = gitlabAdapter.getPlatformName();
    console.log(`Platform name: ${gitlabPlatformName}`);
    if (gitlabPlatformName === 'gitlab') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "gitlab"\n');
    }

    // ============================================================================
    // Interface Compliance Tests - Bitbucket
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Interface Compliance Tests - Bitbucket');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 27: Bitbucket adapter has all required methods
    testCount++;
    console.log('Test 27: BitbucketAdapter has all required methods');
    const bitbucketAdapter = new BitbucketAdapter(mockCredentials);
    let bitbucketAllMethodsExist = true;
    const bitbucketMissingMethods = [];

    for (const method of requiredMethods) {
      if (typeof bitbucketAdapter[method] !== 'function') {
        bitbucketAllMethodsExist = false;
        bitbucketMissingMethods.push(method);
      }
    }

    if (bitbucketAllMethodsExist) {
      console.log(`All ${requiredMethods.length} required methods exist`);
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log(`❌ FAIL: Missing methods: ${bitbucketMissingMethods.join(', ')}\n`);
    }

    // Test 28: Bitbucket getPlatformName returns correct value
    testCount++;
    console.log('Test 28: BitbucketAdapter.getPlatformName() returns "bitbucket"');
    const bitbucketPlatformName = bitbucketAdapter.getPlatformName();
    console.log(`Platform name: ${bitbucketPlatformName}`);
    if (bitbucketPlatformName === 'bitbucket') {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Expected "bitbucket"\n');
    }

    // ============================================================================
    // Type Export Tests
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Type Export Tests');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 29: PullRequestState enum is properly exported
    testCount++;
    console.log('Test 29: PullRequestState enum is properly exported');
    const prStates = [PullRequestState.OPEN, PullRequestState.CLOSED, PullRequestState.MERGED];
    console.log(`PR States: ${prStates.join(', ')}`);
    if (prStates.length === 3 && prStates.includes('open') && prStates.includes('closed') && prStates.includes('merged')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing PR states\n');
    }

    // Test 30: IssueState enum is properly exported
    testCount++;
    console.log('Test 30: IssueState enum is properly exported');
    const issueStates = [IssueState.OPEN, IssueState.CLOSED];
    console.log(`Issue States: ${issueStates.join(', ')}`);
    if (issueStates.length === 2 && issueStates.includes('open') && issueStates.includes('closed')) {
      console.log('✅ PASS\n');
      passedCount++;
    } else {
      console.log('❌ FAIL: Missing Issue states\n');
    }

    // ============================================================================
    // Summary
    // ============================================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
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

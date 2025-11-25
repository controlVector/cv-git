#!/usr/bin/env node

/**
 * Manual Test: GitLab Adapter against a real repository
 *
 * Usage:
 *   GITLAB_TOKEN=your_token node tests/manual/test-gitlab-repo.mjs
 *
 * Or set up credentials first:
 *   cv auth setup gitlab
 *   node tests/manual/test-gitlab-repo.mjs
 */

import { CredentialManager, GitPlatform } from '../../packages/credentials/dist/index.js';

// Test configuration
const TEST_REPO = {
  owner: 'MaxnervaEV/ai-data-center',  // GitLab uses full path for groups/subgroups
  name: 'test',
  fullPath: 'MaxnervaEV/ai-data-center/test',
};

const GITLAB_API_URL = 'https://gitlab.com/api/v4';

class GitLabTestClient {
  constructor(token) {
    this.token = token;
    this.baseUrl = GITLAB_API_URL;
  }

  async request(method, endpoint, body) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      method,
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitLab API error (${response.status}): ${errorText}`);
    }

    if (response.status === 204) {
      return undefined;
    }

    return response.json();
  }

  // Authentication
  async validateToken() {
    const data = await this.request('GET', '/user');
    return {
      username: data.username,
      name: data.name,
      email: data.email,
      avatarUrl: data.avatar_url,
      url: data.web_url,
    };
  }

  async getTokenScopes() {
    try {
      const data = await this.request('GET', '/personal_access_tokens/self');
      return data.scopes || [];
    } catch {
      return [];
    }
  }

  // Repository
  async getRepo(projectPath) {
    const encodedPath = encodeURIComponent(projectPath);
    const project = await this.request('GET', `/projects/${encodedPath}`);

    const pathParts = project.path_with_namespace.split('/');
    const owner = pathParts.slice(0, -1).join('/');

    return {
      owner,
      name: project.path,
      fullName: project.path_with_namespace,
      description: project.description || undefined,
      defaultBranch: project.default_branch,
      url: project.web_url,
      isPrivate: project.visibility === 'private',
      cloneUrl: project.http_url_to_repo,
      sshUrl: project.ssh_url_to_repo,
    };
  }

  // Branches
  async listBranches(projectPath) {
    const encodedPath = encodeURIComponent(projectPath);
    const branches = await this.request('GET', `/projects/${encodedPath}/repository/branches`);

    return branches.map(branch => ({
      name: branch.name,
      isProtected: branch.protected,
      isDefault: branch.default,
      commit: {
        hash: branch.commit.id,
        shortHash: branch.commit.short_id,
        message: branch.commit.message,
        author: branch.commit.author_name,
        date: new Date(branch.commit.authored_date),
      },
    }));
  }

  async getBranch(projectPath, branchName) {
    const encodedPath = encodeURIComponent(projectPath);
    const branch = await this.request('GET', `/projects/${encodedPath}/repository/branches/${encodeURIComponent(branchName)}`);

    return {
      name: branch.name,
      isProtected: branch.protected,
      isDefault: branch.default,
      commit: {
        hash: branch.commit.id,
        shortHash: branch.commit.short_id,
        message: branch.commit.message,
        author: branch.commit.author_name,
        date: new Date(branch.commit.authored_date),
      },
    };
  }

  // Merge Requests
  async listMergeRequests(projectPath, options = {}) {
    const encodedPath = encodeURIComponent(projectPath);
    const params = new URLSearchParams({
      state: options.state || 'opened',
      per_page: String(options.limit || 30),
    });

    const mrs = await this.request('GET', `/projects/${encodedPath}/merge_requests?${params}`);

    return mrs.map(mr => ({
      number: mr.iid,
      title: mr.title,
      body: mr.description || '',
      state: mr.state === 'merged' ? 'merged' : mr.state === 'closed' ? 'closed' : 'open',
      head: mr.source_branch,
      base: mr.target_branch,
      author: {
        username: mr.author.username,
        name: mr.author.name,
        avatarUrl: mr.author.avatar_url,
        url: mr.author.web_url,
      },
      url: mr.web_url,
      createdAt: new Date(mr.created_at),
      updatedAt: new Date(mr.updated_at),
      mergedAt: mr.merged_at ? new Date(mr.merged_at) : undefined,
      isDraft: mr.draft,
    }));
  }

  async getMergeRequest(projectPath, mrNumber) {
    const encodedPath = encodeURIComponent(projectPath);
    const mr = await this.request('GET', `/projects/${encodedPath}/merge_requests/${mrNumber}`);

    return {
      number: mr.iid,
      title: mr.title,
      body: mr.description || '',
      state: mr.state === 'merged' ? 'merged' : mr.state === 'closed' ? 'closed' : 'open',
      head: mr.source_branch,
      base: mr.target_branch,
      author: {
        username: mr.author.username,
        name: mr.author.name,
        avatarUrl: mr.author.avatar_url,
        url: mr.author.web_url,
      },
      url: mr.web_url,
      createdAt: new Date(mr.created_at),
      updatedAt: new Date(mr.updated_at),
      mergedAt: mr.merged_at ? new Date(mr.merged_at) : undefined,
      isDraft: mr.draft,
      changedFiles: mr.changes_count ? parseInt(mr.changes_count, 10) : undefined,
    };
  }

  // Issues
  async listIssues(projectPath, options = {}) {
    const encodedPath = encodeURIComponent(projectPath);
    const params = new URLSearchParams({
      state: options.state || 'opened',
      per_page: String(options.limit || 30),
    });

    const issues = await this.request('GET', `/projects/${encodedPath}/issues?${params}`);

    return issues.map(issue => ({
      number: issue.iid,
      title: issue.title,
      body: issue.description || '',
      state: issue.state === 'closed' ? 'closed' : 'open',
      author: {
        username: issue.author.username,
        name: issue.author.name,
        avatarUrl: issue.author.avatar_url,
        url: issue.author.web_url,
      },
      url: issue.web_url,
      labels: issue.labels,
      assignees: issue.assignees.map(a => ({
        username: a.username,
        name: a.name,
        avatarUrl: a.avatar_url,
        url: a.web_url,
      })),
      createdAt: new Date(issue.created_at),
      updatedAt: new Date(issue.updated_at),
      closedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
      comments: issue.user_notes_count,
    }));
  }

  async getIssue(projectPath, issueNumber) {
    const encodedPath = encodeURIComponent(projectPath);
    const issue = await this.request('GET', `/projects/${encodedPath}/issues/${issueNumber}`);

    return {
      number: issue.iid,
      title: issue.title,
      body: issue.description || '',
      state: issue.state === 'closed' ? 'closed' : 'open',
      author: {
        username: issue.author.username,
        name: issue.author.name,
        avatarUrl: issue.author.avatar_url,
        url: issue.author.web_url,
      },
      url: issue.web_url,
      labels: issue.labels,
      assignees: issue.assignees.map(a => ({
        username: a.username,
        name: a.name,
        avatarUrl: a.avatar_url,
        url: a.web_url,
      })),
      createdAt: new Date(issue.created_at),
      updatedAt: new Date(issue.updated_at),
      closedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
      comments: issue.user_notes_count,
    };
  }

  // Releases
  async listReleases(projectPath, limit = 30) {
    const encodedPath = encodeURIComponent(projectPath);
    const releases = await this.request('GET', `/projects/${encodedPath}/releases?per_page=${limit}`);

    return releases.map(release => ({
      id: release.tag_name,
      tag: release.tag_name,
      name: release.name || release.tag_name,
      body: release.description || '',
      url: release._links?.self,
      author: {
        username: release.author.username,
        name: release.author.name,
        avatarUrl: release.author.avatar_url,
        url: release.author.web_url,
      },
      createdAt: new Date(release.created_at),
      publishedAt: release.released_at ? new Date(release.released_at) : undefined,
      isDraft: false,
      isPrerelease: release.upcoming_release,
      targetCommitish: release.commit?.id,
    }));
  }

  async getRelease(projectPath, tag) {
    const encodedPath = encodeURIComponent(projectPath);
    const encodedTag = encodeURIComponent(tag);
    const release = await this.request('GET', `/projects/${encodedPath}/releases/${encodedTag}`);

    return {
      id: release.tag_name,
      tag: release.tag_name,
      name: release.name || release.tag_name,
      body: release.description || '',
      url: release._links?.self,
      author: {
        username: release.author.username,
        name: release.author.name,
        avatarUrl: release.author.avatar_url,
        url: release.author.web_url,
      },
      createdAt: new Date(release.created_at),
      publishedAt: release.released_at ? new Date(release.released_at) : undefined,
      isDraft: false,
      isPrerelease: release.upcoming_release,
      targetCommitish: release.commit?.id,
    };
  }

  // Commits
  async getCommit(projectPath, hash) {
    const encodedPath = encodeURIComponent(projectPath);
    const commit = await this.request('GET', `/projects/${encodedPath}/repository/commits/${hash}`);

    return {
      hash: commit.id,
      shortHash: commit.short_id,
      message: commit.message,
      author: {
        username: commit.author_name,
        name: commit.author_name,
        email: commit.author_email,
      },
      date: new Date(commit.authored_date),
      parents: commit.parent_ids || [],
      url: commit.web_url,
    };
  }
}

async function runTests() {
  console.log('🧪 Testing GitLab Adapter against real repository\n');
  console.log(`Repository: https://gitlab.com/${TEST_REPO.fullPath}\n`);

  // Get token from environment or credential manager
  let token = process.env.GITLAB_TOKEN;

  if (!token) {
    console.log('Attempting to use stored credentials...\n');
    try {
      const credentials = new CredentialManager();
      token = await credentials.getGitPlatformToken(GitPlatform.GITLAB);
    } catch (error) {
      // Ignore credential errors
    }

    if (!token) {
      console.error('❌ No GitLab token found.');
      console.error('\nTo run this test, provide a GitLab personal access token:');
      console.error('  GITLAB_TOKEN=your_token node tests/manual/test-gitlab-repo.mjs\n');
      console.error('Or set up credentials:');
      console.error('  cv auth setup gitlab\n');
      process.exit(1);
    }
  } else {
    console.log('Using token from GITLAB_TOKEN environment variable\n');
  }

  const client = new GitLabTestClient(token);
  const projectPath = TEST_REPO.fullPath;

  let testCount = 0;
  let passedCount = 0;
  let failedTests = [];

  // Helper function
  async function runTest(name, testFn) {
    testCount++;
    console.log(`Test ${testCount}: ${name}`);
    try {
      const result = await testFn();
      console.log('✅ PASS');
      if (result) {
        const output = JSON.stringify(result, null, 2);
        const lines = output.split('\n');
        if (lines.length > 20) {
          console.log(`   ${lines.slice(0, 20).join('\n   ')}`);
          console.log(`   ... (${lines.length - 20} more lines)`);
        } else {
          console.log(`   ${lines.join('\n   ')}`);
        }
      }
      console.log('');
      passedCount++;
      return result;
    } catch (error) {
      console.log(`❌ FAIL: ${error.message}`);
      console.log('');
      failedTests.push({ name, error: error.message });
      return null;
    }
  }

  // ============================================================================
  // Authentication Tests
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Authentication Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await runTest('Validate token and get user info', async () => {
    const user = await client.validateToken();
    return {
      username: user.username,
      name: user.name,
      url: user.url,
    };
  });

  await runTest('Get token scopes', async () => {
    const scopes = await client.getTokenScopes();
    return { scopes: scopes.length > 0 ? scopes : '(scopes not exposed via API)' };
  });

  // ============================================================================
  // Repository Tests
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Repository Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const repo = await runTest('Get repository info', async () => {
    const repo = await client.getRepo(projectPath);
    return {
      fullName: repo.fullName,
      description: repo.description || '(no description)',
      defaultBranch: repo.defaultBranch,
      isPrivate: repo.isPrivate,
      url: repo.url,
    };
  });

  // ============================================================================
  // Branch Tests
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Branch Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const branches = await runTest('List branches', async () => {
    const branches = await client.listBranches(projectPath);
    return {
      count: branches.length,
      branches: branches.slice(0, 5).map(b => ({
        name: b.name,
        isDefault: b.isDefault,
        isProtected: b.isProtected,
      })),
    };
  });

  if (branches && branches.count > 0) {
    const defaultBranchName = repo?.defaultBranch || 'main';

    await runTest(`Get branch: ${defaultBranchName}`, async () => {
      const branch = await client.getBranch(projectPath, defaultBranchName);
      return {
        name: branch.name,
        isDefault: branch.isDefault,
        latestCommit: {
          hash: branch.commit?.shortHash,
          message: branch.commit?.message?.split('\n')[0],
          author: branch.commit?.author,
        },
      };
    });
  }

  // ============================================================================
  // Merge Request Tests
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Merge Request Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const openMrs = await runTest('List open merge requests', async () => {
    const mrs = await client.listMergeRequests(projectPath, { state: 'opened', limit: 10 });
    return {
      count: mrs.length,
      mergeRequests: mrs.slice(0, 3).map(mr => ({
        number: mr.number,
        title: mr.title,
        state: mr.state,
        author: mr.author?.username,
      })),
    };
  });

  await runTest('List all merge requests', async () => {
    const allMrs = await client.listMergeRequests(projectPath, { state: 'all', limit: 10 });
    return {
      count: allMrs.length,
      states: [...new Set(allMrs.map(mr => mr.state))],
    };
  });

  if (openMrs && openMrs.count > 0) {
    const mrNumber = openMrs.mergeRequests[0].number;
    await runTest(`Get merge request #${mrNumber}`, async () => {
      const mr = await client.getMergeRequest(projectPath, mrNumber);
      return {
        number: mr.number,
        title: mr.title,
        state: mr.state,
        sourceBranch: mr.head,
        targetBranch: mr.base,
        author: mr.author?.username,
        isDraft: mr.isDraft,
        createdAt: mr.createdAt?.toISOString(),
      };
    });
  }

  // ============================================================================
  // Issue Tests
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Issue Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const openIssues = await runTest('List open issues', async () => {
    const issues = await client.listIssues(projectPath, { state: 'opened', limit: 10 });
    return {
      count: issues.length,
      issues: issues.slice(0, 3).map(issue => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        author: issue.author?.username,
      })),
    };
  });

  await runTest('List all issues', async () => {
    const allIssues = await client.listIssues(projectPath, { state: 'all', limit: 10 });
    return {
      count: allIssues.length,
      states: [...new Set(allIssues.map(i => i.state))],
    };
  });

  if (openIssues && openIssues.count > 0) {
    const issueNumber = openIssues.issues[0].number;
    await runTest(`Get issue #${issueNumber}`, async () => {
      const issue = await client.getIssue(projectPath, issueNumber);
      return {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: issue.labels,
        author: issue.author?.username,
        createdAt: issue.createdAt?.toISOString(),
      };
    });
  }

  // ============================================================================
  // Release Tests
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Release Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const releases = await runTest('List releases', async () => {
    const releases = await client.listReleases(projectPath, 10);
    return {
      count: releases.length,
      releases: releases.slice(0, 3).map(r => ({
        tag: r.tag,
        name: r.name,
        createdAt: r.createdAt?.toISOString(),
      })),
    };
  });

  if (releases && releases.count > 0) {
    const releaseTag = releases.releases[0].tag;
    await runTest(`Get release: ${releaseTag}`, async () => {
      const release = await client.getRelease(projectPath, releaseTag);
      return {
        tag: release.tag,
        name: release.name,
        body: release.body?.substring(0, 100) + (release.body?.length > 100 ? '...' : ''),
        author: release.author?.username,
      };
    });
  }

  // ============================================================================
  // Commit Tests
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Commit Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (branches && branches.count > 0) {
    const defaultBranchName = repo?.defaultBranch || 'main';

    await runTest(`Get latest commit on ${defaultBranchName}`, async () => {
      const branch = await client.getBranch(projectPath, defaultBranchName);
      if (branch.commit) {
        const commit = await client.getCommit(projectPath, branch.commit.hash);
        return {
          hash: commit.shortHash,
          message: commit.message?.split('\n')[0],
          author: commit.author?.name,
          date: commit.date?.toISOString(),
        };
      }
      return { message: 'No commits found' };
    });
  }

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`Total: ${testCount} tests`);
  console.log(`Passed: ${passedCount}`);
  console.log(`Failed: ${testCount - passedCount}`);

  if (failedTests.length > 0) {
    console.log('\nFailed tests:');
    for (const { name, error } of failedTests) {
      console.log(`  - ${name}: ${error}`);
    }
  }

  console.log('');

  if (passedCount === testCount) {
    console.log('🎉 All tests passed!');
    return { success: true };
  } else {
    console.log('⚠️  Some tests failed');
    return { success: false };
  }
}

// Run tests
runTests()
  .then(result => {
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });

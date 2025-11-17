/**
 * GitHub Platform Adapter
 *
 * Implements GitPlatformAdapter for GitHub.
 * Converts GitHub-specific API responses to platform-agnostic types.
 */

import { Octokit } from '@octokit/rest';
import { simpleGit, SimpleGit } from 'simple-git';
import type { CredentialManager } from '@cv-git/credentials';
import { GitPlatform } from '@cv-git/credentials';
import type {
  GitPlatformAdapter,
  CreatePROptions,
  ListPROptions,
  CreateReleaseOptions,
  CreateIssueOptions,
  ListIssueOptions,
} from '../adapter.js';
import {
  type Repository,
  type PullRequest,
  PullRequestState,
  type Release,
  type Issue,
  IssueState,
  type User,
  type Commit,
  type Branch,
} from '../types/common.js';

export class GitHubAdapter implements GitPlatformAdapter {
  private octokit!: Octokit;
  private git: SimpleGit;
  private initialized = false;

  constructor(private credentials: CredentialManager) {
    this.git = simpleGit();
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    const token = await this.credentials.getGitPlatformToken(GitPlatform.GITHUB);
    if (!token) {
      throw new Error(
        'GitHub token not found. Run: cv auth setup github'
      );
    }

    this.octokit = new Octokit({ auth: token });
    this.initialized = true;
  }

  getPlatformName(): string {
    return 'github';
  }

  async getWebUrl(): Promise<string> {
    const { owner, name } = await this.getRepoInfo();
    return `https://github.com/${owner}/${name}`;
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  async validateToken(token: string): Promise<User> {
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.users.getAuthenticated();

    return {
      username: data.login,
      name: data.name || undefined,
      email: data.email || undefined,
      avatarUrl: data.avatar_url,
      url: data.html_url,
    };
  }

  async getTokenScopes(token: string): Promise<string[]> {
    const octokit = new Octokit({ auth: token });
    const response = await octokit.request('HEAD /');
    const scopes = response.headers['x-oauth-scopes'];
    return scopes ? scopes.split(',').map((s) => s.trim()) : [];
  }

  // ============================================================================
  // Repository
  // ============================================================================

  async getRepoInfo(): Promise<Repository> {
    const remotes = await this.git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');

    if (!origin?.refs?.push) {
      throw new Error('No git remote found. Not a git repository?');
    }

    // Parse GitHub URL (https or ssh)
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    const match = origin.refs.push.match(
      /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/
    );

    if (!match) {
      throw new Error('Not a GitHub repository');
    }

    const owner = match[1];
    const name = match[2];

    return await this.getRepo(owner, name);
  }

  async getRepo(owner: string, repo: string): Promise<Repository> {
    await this.init();

    const { data } = await this.octokit.repos.get({ owner, repo });

    return {
      owner: data.owner.login,
      name: data.name,
      fullName: data.full_name,
      description: data.description || undefined,
      defaultBranch: data.default_branch,
      url: data.html_url,
      isPrivate: data.private,
      cloneUrl: data.clone_url,
      sshUrl: data.ssh_url,
    };
  }

  // ============================================================================
  // Pull Requests
  // ============================================================================

  async createPR(options: CreatePROptions): Promise<PullRequest> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    const { data } = await this.octokit.pulls.create({
      owner,
      repo: name,
      title: options.title,
      body: options.body || '',
      base: options.base,
      head: options.head,
      draft: options.draft || false,
    });

    return this.convertGitHubPR(data);
  }

  async getPR(number: number): Promise<PullRequest> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    const { data } = await this.octokit.pulls.get({
      owner,
      repo: name,
      pull_number: number,
    });

    return this.convertGitHubPR(data);
  }

  async listPRs(options?: ListPROptions): Promise<PullRequest[]> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    // Map our platform-agnostic state to GitHub's state
    let githubState: 'open' | 'closed' | 'all' = 'open';
    if (options?.state === 'all') {
      githubState = 'all';
    } else if (options?.state === PullRequestState.CLOSED || options?.state === PullRequestState.MERGED) {
      githubState = 'closed';
    } else if (options?.state === PullRequestState.OPEN) {
      githubState = 'open';
    }

    const { data } = await this.octokit.pulls.list({
      owner,
      repo: name,
      state: githubState,
      per_page: options?.limit || 30,
      sort: options?.sort || 'created',
      direction: options?.direction || 'desc',
    });

    return data.map((pr) => this.convertGitHubPR(pr));
  }

  async updatePR(
    number: number,
    updates: { title?: string; body?: string; state?: PullRequestState }
  ): Promise<PullRequest> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    const { data } = await this.octokit.pulls.update({
      owner,
      repo: name,
      pull_number: number,
      title: updates.title,
      body: updates.body,
      state: updates.state === PullRequestState.CLOSED ? 'closed' : 'open',
    });

    return this.convertGitHubPR(data);
  }

  async mergePR(
    number: number,
    options?: { commitMessage?: string; mergeMethod?: 'merge' | 'squash' | 'rebase' }
  ): Promise<PullRequest> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    await this.octokit.pulls.merge({
      owner,
      repo: name,
      pull_number: number,
      commit_message: options?.commitMessage,
      merge_method: options?.mergeMethod || 'merge',
    });

    return await this.getPR(number);
  }

  private convertGitHubPR(pr: any): PullRequest {
    let state: PullRequestState;
    if (pr.merged_at) {
      state = PullRequestState.MERGED;
    } else if (pr.state === 'closed') {
      state = PullRequestState.CLOSED;
    } else {
      state = PullRequestState.OPEN;
    }

    return {
      number: pr.number,
      title: pr.title,
      body: pr.body || '',
      state,
      base: pr.base.ref,
      head: pr.head.ref,
      author: {
        username: pr.user.login,
        name: pr.user.name,
        avatarUrl: pr.user.avatar_url,
        url: pr.user.html_url,
      },
      url: pr.html_url,
      createdAt: new Date(pr.created_at),
      updatedAt: new Date(pr.updated_at),
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : undefined,
      isDraft: pr.draft || false,
      commits: pr.commits,
      changedFiles: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
    };
  }

  // ============================================================================
  // Releases
  // ============================================================================

  async createRelease(options: CreateReleaseOptions): Promise<Release> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    const { data } = await this.octokit.repos.createRelease({
      owner,
      repo: name,
      tag_name: options.tag,
      name: options.name || options.tag,
      body: options.body || '',
      target_commitish: options.targetCommitish,
      draft: options.draft || false,
      prerelease: options.prerelease || false,
    });

    return this.convertGitHubRelease(data);
  }

  async getRelease(tag: string): Promise<Release> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    const { data } = await this.octokit.repos.getReleaseByTag({
      owner,
      repo: name,
      tag,
    });

    return this.convertGitHubRelease(data);
  }

  async listReleases(limit = 30): Promise<Release[]> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    const { data } = await this.octokit.repos.listReleases({
      owner,
      repo: name,
      per_page: limit,
    });

    return data.map((release) => this.convertGitHubRelease(release));
  }

  async deleteRelease(tag: string): Promise<void> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    // Get release by tag to get its ID
    const { data } = await this.octokit.repos.getReleaseByTag({
      owner,
      repo: name,
      tag,
    });

    await this.octokit.repos.deleteRelease({
      owner,
      repo: name,
      release_id: data.id,
    });
  }

  private convertGitHubRelease(release: any): Release {
    return {
      id: release.id.toString(),
      tag: release.tag_name,
      name: release.name || release.tag_name,
      body: release.body || '',
      url: release.html_url,
      author: {
        username: release.author.login,
        avatarUrl: release.author.avatar_url,
        url: release.author.html_url,
      },
      createdAt: new Date(release.created_at),
      publishedAt: release.published_at ? new Date(release.published_at) : undefined,
      isDraft: release.draft,
      isPrerelease: release.prerelease,
      targetCommitish: release.target_commitish,
    };
  }

  // ============================================================================
  // Issues
  // ============================================================================

  async createIssue(options: CreateIssueOptions): Promise<Issue> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    const { data } = await this.octokit.issues.create({
      owner,
      repo: name,
      title: options.title,
      body: options.body || '',
      labels: options.labels,
      assignees: options.assignees,
    });

    return this.convertGitHubIssue(data);
  }

  async getIssue(number: number): Promise<Issue> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    const { data } = await this.octokit.issues.get({
      owner,
      repo: name,
      issue_number: number,
    });

    return this.convertGitHubIssue(data);
  }

  async listIssues(options?: ListIssueOptions): Promise<Issue[]> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    const { data } = await this.octokit.issues.listForRepo({
      owner,
      repo: name,
      state: options?.state || 'open',
      labels: options?.labels?.join(','),
      per_page: options?.limit || 30,
      sort: options?.sort || 'created',
      direction: options?.direction || 'desc',
    });

    // Filter out pull requests (GitHub API returns both)
    return data
      .filter((issue) => !issue.pull_request)
      .map((issue) => this.convertGitHubIssue(issue));
  }

  async updateIssue(
    number: number,
    updates: { title?: string; body?: string; state?: IssueState; labels?: string[] }
  ): Promise<Issue> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    const { data } = await this.octokit.issues.update({
      owner,
      repo: name,
      issue_number: number,
      title: updates.title,
      body: updates.body,
      state: updates.state,
      labels: updates.labels,
    });

    return this.convertGitHubIssue(data);
  }

  private convertGitHubIssue(issue: any): Issue {
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body || '',
      state: issue.state === 'closed' ? IssueState.CLOSED : IssueState.OPEN,
      author: {
        username: issue.user.login,
        avatarUrl: issue.user.avatar_url,
        url: issue.user.html_url,
      },
      url: issue.html_url,
      labels: issue.labels.map((l: any) => (typeof l === 'string' ? l : l.name)),
      assignees: issue.assignees.map((a: any) => ({
        username: a.login,
        avatarUrl: a.avatar_url,
        url: a.html_url,
      })),
      createdAt: new Date(issue.created_at),
      updatedAt: new Date(issue.updated_at),
      closedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
      comments: issue.comments,
    };
  }

  // ============================================================================
  // Commits & Branches
  // ============================================================================

  async getCommits(base: string, head: string): Promise<Commit[]> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    const { data } = await this.octokit.repos.compareCommits({
      owner,
      repo: name,
      base,
      head,
    });

    return data.commits.map((commit) => this.convertGitHubCommit(commit));
  }

  async getCommit(hash: string): Promise<Commit> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    const { data } = await this.octokit.repos.getCommit({
      owner,
      repo: name,
      ref: hash,
    });

    return this.convertGitHubCommit(data);
  }

  async listBranches(): Promise<Branch[]> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    const [{ data: branches }, repo] = await Promise.all([
      this.octokit.repos.listBranches({ owner, repo: name }),
      this.getRepo(owner, name),
    ]);

    return branches.map((branch) => ({
      name: branch.name,
      commit: {
        hash: branch.commit.sha,
        shortHash: branch.commit.sha.substring(0, 7),
        message: '',
        author: { username: '' },
        date: new Date(),
        parents: [],
        url: branch.commit.url,
      },
      isProtected: branch.protected,
      isDefault: branch.name === repo.defaultBranch,
    }));
  }

  async getBranch(branchName: string): Promise<Branch> {
    await this.init();
    const { owner, name } = await this.getRepoInfo();

    const [{ data: branch }, repo] = await Promise.all([
      this.octokit.repos.getBranch({ owner, repo: name, branch: branchName }),
      this.getRepo(owner, name),
    ]);

    return {
      name: branch.name,
      commit: this.convertGitHubCommit(branch.commit),
      isProtected: branch.protected,
      isDefault: branch.name === repo.defaultBranch,
    };
  }

  private convertGitHubCommit(commit: any): Commit {
    const gitCommit = commit.commit || commit;

    return {
      hash: commit.sha,
      shortHash: commit.sha.substring(0, 7),
      message: gitCommit.message,
      author: {
        username: commit.author?.login || gitCommit.author?.name || 'unknown',
        name: gitCommit.author?.name,
        email: gitCommit.author?.email,
        avatarUrl: commit.author?.avatar_url,
        url: commit.author?.html_url,
      },
      date: new Date(gitCommit.author?.date || gitCommit.committer?.date),
      parents: commit.parents?.map((p: any) => p.sha) || [],
      url: commit.html_url,
    };
  }
}

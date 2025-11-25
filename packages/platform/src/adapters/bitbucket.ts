/**
 * Bitbucket Platform Adapter
 *
 * Implements GitPlatformAdapter for Bitbucket Cloud.
 * Converts Bitbucket-specific API responses to platform-agnostic types.
 */

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

/**
 * Bitbucket API response types
 */
interface BitbucketRepository {
  uuid: string;
  slug: string;
  full_name: string;
  name: string;
  description: string;
  mainbranch: { name: string } | null;
  links: {
    html: { href: string };
    clone: Array<{ href: string; name: string }>;
  };
  is_private: boolean;
  owner: {
    username?: string;
    nickname?: string;
    display_name: string;
    account_id: string;
  };
  workspace: {
    slug: string;
  };
}

interface BitbucketUser {
  account_id: string;
  username?: string;
  nickname?: string;
  display_name: string;
  links: {
    avatar: { href: string };
    html: { href: string };
  };
}

interface BitbucketPullRequest {
  id: number;
  title: string;
  description: string;
  state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
  source: {
    branch: { name: string };
  };
  destination: {
    branch: { name: string };
  };
  author: BitbucketUser;
  links: {
    html: { href: string };
  };
  created_on: string;
  updated_on: string;
  merge_commit?: { hash: string };
  task_count: number;
  comment_count: number;
}

interface BitbucketTag {
  name: string;
  target: {
    hash: string;
    date: string;
    message: string;
    author: {
      raw: string;
      user?: BitbucketUser;
    };
  };
  links: {
    html: { href: string };
  };
}

interface BitbucketIssue {
  id: number;
  title: string;
  content: { raw: string };
  state: 'new' | 'open' | 'resolved' | 'on hold' | 'invalid' | 'duplicate' | 'wontfix' | 'closed';
  reporter: BitbucketUser;
  links: {
    html: { href: string };
  };
  priority: string;
  assignee: BitbucketUser | null;
  created_on: string;
  updated_on: string;
}

interface BitbucketCommit {
  hash: string;
  message: string;
  author: {
    raw: string;
    user?: BitbucketUser;
  };
  date: string;
  links: {
    html: { href: string };
  };
  parents: Array<{ hash: string }>;
}

interface BitbucketBranch {
  name: string;
  target: BitbucketCommit;
}

interface BitbucketPaginatedResponse<T> {
  values: T[];
  pagelen: number;
  page?: number;
  size?: number;
  next?: string;
}

export class BitbucketAdapter implements GitPlatformAdapter {
  private token: string | null = null;
  private git: SimpleGit;
  private initialized = false;
  private baseUrl = 'https://api.bitbucket.org/2.0';
  private webUrl = 'https://bitbucket.org';

  constructor(
    private credentials: CredentialManager,
    options?: { apiUrl?: string; webUrl?: string }
  ) {
    this.git = simpleGit();
    if (options?.apiUrl) {
      this.baseUrl = options.apiUrl;
    }
    if (options?.webUrl) {
      this.webUrl = options.webUrl;
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    const token = await this.credentials.getGitPlatformToken(GitPlatform.BITBUCKET);
    if (!token) {
      throw new Error('Bitbucket app password not found. Run: cv auth setup bitbucket');
    }

    this.token = token;
    this.initialized = true;
  }

  getPlatformName(): string {
    return 'bitbucket';
  }

  async getWebUrl(): Promise<string> {
    const { fullName } = await this.getRepoInfo();
    return `${this.webUrl}/${fullName}`;
  }

  // ============================================================================
  // HTTP Helper
  // ============================================================================

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    await this.init();

    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bitbucket API error (${response.status}): ${errorText}`);
    }

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return undefined as unknown as T;
    }

    return response.json() as Promise<T>;
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  async validateToken(token: string): Promise<User> {
    const response = await fetch(`${this.baseUrl}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Invalid Bitbucket token');
    }

    const data = (await response.json()) as BitbucketUser;

    return this.convertBitbucketUser(data);
  }

  async getTokenScopes(token: string): Promise<string[]> {
    // Bitbucket app passwords don't expose scopes via API
    // Return common scopes that might be available
    return ['repository', 'pullrequest', 'issue'];
  }

  // ============================================================================
  // Repository
  // ============================================================================

  private async getRepoPath(): Promise<{ workspace: string; repo: string }> {
    const remotes = await this.git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');

    if (!origin?.refs?.push) {
      throw new Error('No git remote found. Not a git repository?');
    }

    // Parse Bitbucket URL (https or ssh)
    // https://bitbucket.org/workspace/repo.git
    // git@bitbucket.org:workspace/repo.git
    const match = origin.refs.push.match(/bitbucket\.org[:/]([^/]+)\/(.+?)(?:\.git)?$/);

    if (!match) {
      throw new Error('Not a Bitbucket repository');
    }

    return { workspace: match[1], repo: match[2] };
  }

  async getRepoInfo(): Promise<Repository> {
    const { workspace, repo } = await this.getRepoPath();
    return this.getRepo(workspace, repo);
  }

  async getRepo(owner: string, repo: string): Promise<Repository> {
    const repository = await this.request<BitbucketRepository>(
      'GET',
      `/repositories/${owner}/${repo}`
    );

    return this.convertBitbucketRepo(repository);
  }

  private convertBitbucketRepo(repo: BitbucketRepository): Repository {
    const httpsClone = repo.links.clone.find((c) => c.name === 'https');
    const sshClone = repo.links.clone.find((c) => c.name === 'ssh');

    return {
      owner: repo.workspace.slug,
      name: repo.slug,
      fullName: repo.full_name,
      description: repo.description || undefined,
      defaultBranch: repo.mainbranch?.name || 'main',
      url: repo.links.html.href,
      isPrivate: repo.is_private,
      cloneUrl: httpsClone?.href || '',
      sshUrl: sshClone?.href,
    };
  }

  // ============================================================================
  // Pull Requests
  // ============================================================================

  async createPR(options: CreatePROptions): Promise<PullRequest> {
    const { workspace, repo } = await this.getRepoPath();

    const pr = await this.request<BitbucketPullRequest>(
      'POST',
      `/repositories/${workspace}/${repo}/pullrequests`,
      {
        title: options.title,
        description: options.body || '',
        source: { branch: { name: options.head } },
        destination: { branch: { name: options.base } },
      }
    );

    return this.convertBitbucketPR(pr);
  }

  async getPR(number: number): Promise<PullRequest> {
    const { workspace, repo } = await this.getRepoPath();

    const pr = await this.request<BitbucketPullRequest>(
      'GET',
      `/repositories/${workspace}/${repo}/pullrequests/${number}`
    );

    return this.convertBitbucketPR(pr);
  }

  async listPRs(options?: ListPROptions): Promise<PullRequest[]> {
    const { workspace, repo } = await this.getRepoPath();

    // Map platform-agnostic state to Bitbucket state
    let state: string = 'OPEN';
    if (options?.state === 'all') {
      state = '';
    } else if (options?.state === PullRequestState.CLOSED) {
      state = 'DECLINED';
    } else if (options?.state === PullRequestState.MERGED) {
      state = 'MERGED';
    } else if (options?.state === PullRequestState.OPEN) {
      state = 'OPEN';
    }

    const params = new URLSearchParams({
      pagelen: String(options?.limit || 30),
    });
    if (state) {
      params.set('state', state);
    }

    const response = await this.request<BitbucketPaginatedResponse<BitbucketPullRequest>>(
      'GET',
      `/repositories/${workspace}/${repo}/pullrequests?${params}`
    );

    return response.values.map((pr) => this.convertBitbucketPR(pr));
  }

  async updatePR(
    number: number,
    updates: { title?: string; body?: string; state?: PullRequestState }
  ): Promise<PullRequest> {
    const { workspace, repo } = await this.getRepoPath();

    const updateBody: Record<string, unknown> = {};
    if (updates.title) updateBody.title = updates.title;
    if (updates.body !== undefined) updateBody.description = updates.body;

    const pr = await this.request<BitbucketPullRequest>(
      'PUT',
      `/repositories/${workspace}/${repo}/pullrequests/${number}`,
      updateBody
    );

    // Handle state changes separately (decline)
    if (updates.state === PullRequestState.CLOSED) {
      await this.request<void>(
        'POST',
        `/repositories/${workspace}/${repo}/pullrequests/${number}/decline`
      );
      return this.getPR(number);
    }

    return this.convertBitbucketPR(pr);
  }

  async mergePR(
    number: number,
    options?: { commitMessage?: string; mergeMethod?: 'merge' | 'squash' | 'rebase' }
  ): Promise<PullRequest> {
    const { workspace, repo } = await this.getRepoPath();

    const mergeBody: Record<string, unknown> = {};
    if (options?.commitMessage) {
      mergeBody.message = options.commitMessage;
    }
    if (options?.mergeMethod === 'squash') {
      mergeBody.merge_strategy = 'squash';
    } else if (options?.mergeMethod === 'rebase') {
      // Bitbucket calls it fast-forward for rebase-like behavior
      mergeBody.merge_strategy = 'fast_forward';
    }

    const pr = await this.request<BitbucketPullRequest>(
      'POST',
      `/repositories/${workspace}/${repo}/pullrequests/${number}/merge`,
      mergeBody
    );

    return this.convertBitbucketPR(pr);
  }

  private convertBitbucketPR(pr: BitbucketPullRequest): PullRequest {
    let state: PullRequestState;
    if (pr.state === 'MERGED') {
      state = PullRequestState.MERGED;
    } else if (pr.state === 'DECLINED' || pr.state === 'SUPERSEDED') {
      state = PullRequestState.CLOSED;
    } else {
      state = PullRequestState.OPEN;
    }

    return {
      number: pr.id,
      title: pr.title,
      body: pr.description || '',
      state,
      base: pr.destination.branch.name,
      head: pr.source.branch.name,
      author: this.convertBitbucketUser(pr.author),
      url: pr.links.html.href,
      createdAt: new Date(pr.created_on),
      updatedAt: new Date(pr.updated_on),
      mergedAt: pr.merge_commit ? new Date(pr.updated_on) : undefined,
      isDraft: false, // Bitbucket doesn't have draft PRs
    };
  }

  // ============================================================================
  // Releases (Tags in Bitbucket - Bitbucket doesn't have releases, only tags)
  // ============================================================================

  async createRelease(options: CreateReleaseOptions): Promise<Release> {
    const { workspace, repo } = await this.getRepoPath();

    // Bitbucket doesn't have releases, so we create an annotated tag
    const tag = await this.request<BitbucketTag>(
      'POST',
      `/repositories/${workspace}/${repo}/refs/tags`,
      {
        name: options.tag,
        target: { hash: options.targetCommitish || 'HEAD' },
        message: options.body || options.name || options.tag,
      }
    );

    return this.convertBitbucketTag(tag, options.name, options.body);
  }

  async getRelease(tag: string): Promise<Release> {
    const { workspace, repo } = await this.getRepoPath();

    const tagData = await this.request<BitbucketTag>(
      'GET',
      `/repositories/${workspace}/${repo}/refs/tags/${encodeURIComponent(tag)}`
    );

    return this.convertBitbucketTag(tagData);
  }

  async listReleases(limit = 30): Promise<Release[]> {
    const { workspace, repo } = await this.getRepoPath();

    const response = await this.request<BitbucketPaginatedResponse<BitbucketTag>>(
      'GET',
      `/repositories/${workspace}/${repo}/refs/tags?pagelen=${limit}`
    );

    return response.values.map((tag) => this.convertBitbucketTag(tag));
  }

  async deleteRelease(tag: string): Promise<void> {
    const { workspace, repo } = await this.getRepoPath();

    await this.request<void>(
      'DELETE',
      `/repositories/${workspace}/${repo}/refs/tags/${encodeURIComponent(tag)}`
    );
  }

  private convertBitbucketTag(tag: BitbucketTag, name?: string, body?: string): Release {
    return {
      id: tag.name,
      tag: tag.name,
      name: name || tag.name,
      body: body || tag.target.message || '',
      url: tag.links.html.href,
      author: tag.target.author.user
        ? this.convertBitbucketUser(tag.target.author.user)
        : { username: tag.target.author.raw },
      createdAt: new Date(tag.target.date),
      publishedAt: new Date(tag.target.date),
      isDraft: false,
      isPrerelease: false,
      targetCommitish: tag.target.hash,
    };
  }

  // ============================================================================
  // Issues
  // ============================================================================

  async createIssue(options: CreateIssueOptions): Promise<Issue> {
    const { workspace, repo } = await this.getRepoPath();

    const issue = await this.request<BitbucketIssue>(
      'POST',
      `/repositories/${workspace}/${repo}/issues`,
      {
        title: options.title,
        content: { raw: options.body || '' },
        kind: 'bug',
        priority: 'major',
      }
    );

    return this.convertBitbucketIssue(issue);
  }

  async getIssue(number: number): Promise<Issue> {
    const { workspace, repo } = await this.getRepoPath();

    const issue = await this.request<BitbucketIssue>(
      'GET',
      `/repositories/${workspace}/${repo}/issues/${number}`
    );

    return this.convertBitbucketIssue(issue);
  }

  async listIssues(options?: ListIssueOptions): Promise<Issue[]> {
    const { workspace, repo } = await this.getRepoPath();

    const params = new URLSearchParams({
      pagelen: String(options?.limit || 30),
    });

    // Map state
    if (options?.state === IssueState.CLOSED) {
      params.set('q', 'state="closed" OR state="resolved"');
    } else if (options?.state === IssueState.OPEN || !options?.state) {
      params.set('q', 'state="new" OR state="open"');
    }

    const response = await this.request<BitbucketPaginatedResponse<BitbucketIssue>>(
      'GET',
      `/repositories/${workspace}/${repo}/issues?${params}`
    );

    return response.values.map((issue) => this.convertBitbucketIssue(issue));
  }

  async updateIssue(
    number: number,
    updates: { title?: string; body?: string; state?: IssueState; labels?: string[] }
  ): Promise<Issue> {
    const { workspace, repo } = await this.getRepoPath();

    const updateBody: Record<string, unknown> = {};
    if (updates.title) updateBody.title = updates.title;
    if (updates.body !== undefined) updateBody.content = { raw: updates.body };
    if (updates.state === IssueState.CLOSED) {
      updateBody.state = 'closed';
    } else if (updates.state === IssueState.OPEN) {
      updateBody.state = 'open';
    }

    const issue = await this.request<BitbucketIssue>(
      'PUT',
      `/repositories/${workspace}/${repo}/issues/${number}`,
      updateBody
    );

    return this.convertBitbucketIssue(issue);
  }

  private convertBitbucketIssue(issue: BitbucketIssue): Issue {
    const closedStates = ['resolved', 'closed', 'invalid', 'duplicate', 'wontfix'];
    const state = closedStates.includes(issue.state) ? IssueState.CLOSED : IssueState.OPEN;

    return {
      number: issue.id,
      title: issue.title,
      body: issue.content.raw || '',
      state,
      author: this.convertBitbucketUser(issue.reporter),
      url: issue.links.html.href,
      labels: [issue.priority], // Bitbucket doesn't have labels, use priority
      assignees: issue.assignee ? [this.convertBitbucketUser(issue.assignee)] : [],
      createdAt: new Date(issue.created_on),
      updatedAt: new Date(issue.updated_on),
      closedAt: undefined, // Bitbucket doesn't provide this
      comments: 0, // Would need separate API call
    };
  }

  // ============================================================================
  // Commits & Branches
  // ============================================================================

  async getCommits(base: string, head: string): Promise<Commit[]> {
    const { workspace, repo } = await this.getRepoPath();

    // Bitbucket uses diffstat for comparing branches
    const response = await this.request<BitbucketPaginatedResponse<BitbucketCommit>>(
      'GET',
      `/repositories/${workspace}/${repo}/commits?include=${encodeURIComponent(head)}&exclude=${encodeURIComponent(base)}`
    );

    return response.values.map((commit) => this.convertBitbucketCommit(commit));
  }

  async getCommit(hash: string): Promise<Commit> {
    const { workspace, repo } = await this.getRepoPath();

    const commit = await this.request<BitbucketCommit>(
      'GET',
      `/repositories/${workspace}/${repo}/commit/${hash}`
    );

    return this.convertBitbucketCommit(commit);
  }

  async listBranches(): Promise<Branch[]> {
    const { workspace, repo } = await this.getRepoPath();

    const response = await this.request<BitbucketPaginatedResponse<BitbucketBranch>>(
      'GET',
      `/repositories/${workspace}/${repo}/refs/branches`
    );

    const repoInfo = await this.getRepoInfo();

    return response.values.map((branch) => this.convertBitbucketBranch(branch, repoInfo.defaultBranch));
  }

  async getBranch(name: string): Promise<Branch> {
    const { workspace, repo } = await this.getRepoPath();

    const branch = await this.request<BitbucketBranch>(
      'GET',
      `/repositories/${workspace}/${repo}/refs/branches/${encodeURIComponent(name)}`
    );

    const repoInfo = await this.getRepoInfo();

    return this.convertBitbucketBranch(branch, repoInfo.defaultBranch);
  }

  private convertBitbucketCommit(commit: BitbucketCommit): Commit {
    return {
      hash: commit.hash,
      shortHash: commit.hash.substring(0, 7),
      message: commit.message,
      author: commit.author.user
        ? this.convertBitbucketUser(commit.author.user)
        : { username: commit.author.raw },
      date: new Date(commit.date),
      parents: commit.parents?.map((p) => p.hash) || [],
      url: commit.links.html.href,
    };
  }

  private convertBitbucketBranch(branch: BitbucketBranch, defaultBranch: string): Branch {
    return {
      name: branch.name,
      commit: this.convertBitbucketCommit(branch.target),
      isProtected: false, // Would need branch restrictions API
      isDefault: branch.name === defaultBranch,
    };
  }

  private convertBitbucketUser(user: BitbucketUser): User {
    return {
      username: user.username || user.nickname || user.display_name,
      name: user.display_name,
      avatarUrl: user.links.avatar.href,
      url: user.links.html.href,
    };
  }
}

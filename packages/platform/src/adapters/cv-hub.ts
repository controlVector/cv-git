/**
 * CV-Hub Platform Adapter
 *
 * Implements GitPlatformAdapter for CV-Hub.
 * Converts CV-Hub API responses to platform-agnostic types.
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

// =============================================================================
// CV-Hub API Response Types
// =============================================================================

interface CVHubUser {
  id: string;
  username: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  web_url?: string;
}

interface CVHubRepository {
  id: string;
  owner: string;
  name: string;
  full_name: string;
  description?: string;
  default_branch: string;
  web_url: string;
  is_private: boolean;
  clone_url: string;
  ssh_url?: string;
}

interface CVHubPullRequest {
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed' | 'merged';
  base_branch: string;
  head_branch: string;
  author: CVHubUser;
  web_url: string;
  created_at: string;
  updated_at: string;
  merged_at?: string;
  is_draft: boolean;
  commits?: number;
  changed_files?: number;
  additions?: number;
  deletions?: number;
}

interface CVHubRelease {
  id: string;
  tag_name: string;
  name?: string;
  body?: string;
  web_url: string;
  author: CVHubUser;
  created_at: string;
  published_at?: string;
  is_draft: boolean;
  is_prerelease: boolean;
  target_commitish?: string;
}

interface CVHubIssue {
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  author: CVHubUser;
  web_url: string;
  labels: string[];
  assignees: CVHubUser[];
  created_at: string;
  updated_at: string;
  closed_at?: string;
  comment_count: number;
}

interface CVHubCommit {
  sha: string;
  message: string;
  author_name: string;
  author_email: string;
  date: string;
  web_url?: string;
  parents: string[];
}

interface CVHubBranch {
  name: string;
  commit: CVHubCommit;
  is_protected: boolean;
  is_default: boolean;
}

export class CVHubAdapter implements GitPlatformAdapter {
  private token: string | null = null;
  private git: SimpleGit;
  private initialized = false;
  private baseUrl: string;
  private webUrl: string;
  private platform: GitPlatform;

  constructor(
    private credentials: CredentialManager,
    options?: { apiUrl?: string; webUrl?: string; platform?: GitPlatform }
  ) {
    this.git = simpleGit();
    this.platform = options?.platform || GitPlatform.CV_HUB;

    const isControlfab = this.platform === GitPlatform.CONTROLFAB;
    const defaultApiUrl = isControlfab ? 'https://api.controlfab.ai' : 'https://api.hub.controlvector.io';
    const defaultWebUrl = isControlfab ? 'https://hub.controlfab.ai' : 'https://hub.controlvector.io';
    const envApiUrl = isControlfab ? process.env.CONTROLFAB_URL : process.env.CV_HUB_URL;
    const envWebUrl = isControlfab ? process.env.CONTROLFAB_APP_URL : process.env.CV_HUB_APP_URL;

    this.baseUrl = options?.apiUrl || envApiUrl || defaultApiUrl;
    this.webUrl = options?.webUrl || envWebUrl || defaultWebUrl;
  }

  // ============================================================================
  // Initialization & Authentication
  // ============================================================================

  async init(): Promise<void> {
    if (this.initialized) return;

    const token = await this.credentials.getGitPlatformToken(this.platform);
    if (!token) {
      const cmd = this.platform === GitPlatform.CONTROLFAB ? 'cv auth setup controlfab' : 'cv auth setup cv-hub';
      const name = this.platform === GitPlatform.CONTROLFAB ? 'Control Fabric' : 'ControlVector Hub';
      throw new Error(`${name} token not found. Run: ${cmd}`);
    }

    this.token = token;
    this.initialized = true;
  }

  async validateToken(token: string): Promise<User> {
    const response = await fetch(`${this.baseUrl}/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Invalid CV-Hub token');
    }

    const data = (await response.json()) as CVHubUser;
    return this.convertCVHubUser(data);
  }

  async getTokenScopes(token: string): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/v1/user/scopes`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data = (await response.json()) as { scopes?: string[] };
      return data.scopes || [];
    }

    return [];
  }

  getPlatformName(): string {
    return this.platform === GitPlatform.CONTROLFAB ? 'controlfab' : 'cv-hub';
  }

  async getWebUrl(): Promise<string> {
    const { owner, repo } = await this.getOwnerRepo();
    return `${this.webUrl}/${owner}/${repo}`;
  }

  // ============================================================================
  // HTTP Helper
  // ============================================================================

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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
      throw new Error(`CV-Hub API error (${response.status}): ${errorText}`);
    }

    if (response.status === 204) {
      return undefined as unknown as T;
    }

    return response.json() as Promise<T>;
  }

  // ============================================================================
  // Remote URL Detection
  // ============================================================================

  private async getOwnerRepo(): Promise<{ owner: string; repo: string }> {
    const remotes = await this.git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');

    if (!origin?.refs?.push) {
      throw new Error('No git remote found');
    }

    const match = origin.refs.push.match(
      /(?:hub\.controlvector\.io|controlfab\.ai)[:/]([^/]+)\/(.+?)(?:\.git)?$/
    );

    if (!match) {
      throw new Error('Not a CV-Hub repository');
    }

    return { owner: match[1], repo: match[2] };
  }

  // ============================================================================
  // Repository Operations
  // ============================================================================

  async getRepoInfo(): Promise<Repository> {
    const { owner, repo } = await this.getOwnerRepo();
    return this.getRepo(owner, repo);
  }

  async getRepo(owner: string, repo: string): Promise<Repository> {
    const data = await this.request<CVHubRepository>(
      'GET',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    );
    return this.convertCVHubRepo(data);
  }

  // ============================================================================
  // Pull Request Operations
  // ============================================================================

  async createPR(options: CreatePROptions): Promise<PullRequest> {
    const { owner, repo } = await this.getOwnerRepo();
    const pr = await this.request<CVHubPullRequest>(
      'POST',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
      {
        title: options.title,
        body: options.body || '',
        base: options.base,
        head: options.head,
        draft: options.draft || false,
      }
    );
    return this.convertCVHubPR(pr);
  }

  async getPR(number: number): Promise<PullRequest> {
    const { owner, repo } = await this.getOwnerRepo();
    const pr = await this.request<CVHubPullRequest>(
      'GET',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`
    );
    return this.convertCVHubPR(pr);
  }

  async listPRs(options?: ListPROptions): Promise<PullRequest[]> {
    const { owner, repo } = await this.getOwnerRepo();

    const params = new URLSearchParams();
    if (options?.state && options.state !== 'all') {
      params.set('state', options.state);
    } else if (options?.state === 'all') {
      params.set('state', 'all');
    }
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.sort) params.set('sort', options.sort);
    if (options?.direction) params.set('direction', options.direction);

    const query = params.toString();
    const endpoint = `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls${query ? `?${query}` : ''}`;
    const prs = await this.request<CVHubPullRequest[]>('GET', endpoint);
    return prs.map((pr) => this.convertCVHubPR(pr));
  }

  async updatePR(
    number: number,
    updates: { title?: string; body?: string; state?: PullRequestState }
  ): Promise<PullRequest> {
    const { owner, repo } = await this.getOwnerRepo();
    const updateBody: Record<string, unknown> = {};
    if (updates.title) updateBody.title = updates.title;
    if (updates.body !== undefined) updateBody.body = updates.body;
    if (updates.state) updateBody.state = updates.state;

    const pr = await this.request<CVHubPullRequest>(
      'PATCH',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`,
      updateBody
    );
    return this.convertCVHubPR(pr);
  }

  async mergePR(
    number: number,
    options?: { commitMessage?: string; mergeMethod?: 'merge' | 'squash' | 'rebase' }
  ): Promise<PullRequest> {
    const { owner, repo } = await this.getOwnerRepo();
    const mergeBody: Record<string, unknown> = {};
    if (options?.commitMessage) mergeBody.commit_message = options.commitMessage;
    if (options?.mergeMethod) mergeBody.merge_method = options.mergeMethod;

    const pr = await this.request<CVHubPullRequest>(
      'PUT',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/merge`,
      mergeBody
    );
    return this.convertCVHubPR(pr);
  }

  // ============================================================================
  // Release Operations
  // ============================================================================

  async createRelease(options: CreateReleaseOptions): Promise<Release> {
    const { owner, repo } = await this.getOwnerRepo();
    const release = await this.request<CVHubRelease>(
      'POST',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`,
      {
        tag_name: options.tag,
        name: options.name || options.tag,
        body: options.body || '',
        target_commitish: options.targetCommitish,
        draft: options.draft || false,
        prerelease: options.prerelease || false,
      }
    );
    return this.convertCVHubRelease(release);
  }

  async getRelease(tag: string): Promise<Release> {
    const { owner, repo } = await this.getOwnerRepo();
    const release = await this.request<CVHubRelease>(
      'GET',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tags/${encodeURIComponent(tag)}`
    );
    return this.convertCVHubRelease(release);
  }

  async listReleases(limit = 30): Promise<Release[]> {
    const { owner, repo } = await this.getOwnerRepo();
    const releases = await this.request<CVHubRelease[]>(
      'GET',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?limit=${limit}`
    );
    return releases.map((release) => this.convertCVHubRelease(release));
  }

  async deleteRelease(tag: string): Promise<void> {
    const { owner, repo } = await this.getOwnerRepo();
    await this.request<void>(
      'DELETE',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tags/${encodeURIComponent(tag)}`
    );
  }

  // ============================================================================
  // Issue Operations
  // ============================================================================

  async createIssue(options: CreateIssueOptions): Promise<Issue> {
    const { owner, repo } = await this.getOwnerRepo();
    const issue = await this.request<CVHubIssue>(
      'POST',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
      {
        title: options.title,
        body: options.body || '',
        labels: options.labels || [],
        assignees: options.assignees || [],
      }
    );
    return this.convertCVHubIssue(issue);
  }

  async getIssue(number: number): Promise<Issue> {
    const { owner, repo } = await this.getOwnerRepo();
    const issue = await this.request<CVHubIssue>(
      'GET',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`
    );
    return this.convertCVHubIssue(issue);
  }

  async listIssues(options?: ListIssueOptions): Promise<Issue[]> {
    const { owner, repo } = await this.getOwnerRepo();

    const params = new URLSearchParams();
    if (options?.state && options.state !== 'all') {
      params.set('state', options.state);
    } else if (options?.state === 'all') {
      params.set('state', 'all');
    }
    if (options?.labels?.length) params.set('labels', options.labels.join(','));
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.sort) params.set('sort', options.sort);
    if (options?.direction) params.set('direction', options.direction);

    const query = params.toString();
    const endpoint = `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues${query ? `?${query}` : ''}`;
    const issues = await this.request<CVHubIssue[]>('GET', endpoint);
    return issues.map((issue) => this.convertCVHubIssue(issue));
  }

  async updateIssue(
    number: number,
    updates: { title?: string; body?: string; state?: IssueState; labels?: string[] }
  ): Promise<Issue> {
    const { owner, repo } = await this.getOwnerRepo();
    const updateBody: Record<string, unknown> = {};
    if (updates.title) updateBody.title = updates.title;
    if (updates.body !== undefined) updateBody.body = updates.body;
    if (updates.state) updateBody.state = updates.state;
    if (updates.labels) updateBody.labels = updates.labels;

    const issue = await this.request<CVHubIssue>(
      'PATCH',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`,
      updateBody
    );
    return this.convertCVHubIssue(issue);
  }

  // ============================================================================
  // Commit & Branch Operations
  // ============================================================================

  async getCommits(base: string, head: string): Promise<Commit[]> {
    const { owner, repo } = await this.getOwnerRepo();
    const data = await this.request<{ commits: CVHubCommit[] }>(
      'GET',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`
    );
    return data.commits.map((commit) => this.convertCVHubCommit(commit));
  }

  async getCommit(hash: string): Promise<Commit> {
    const { owner, repo } = await this.getOwnerRepo();
    const commit = await this.request<CVHubCommit>(
      'GET',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(hash)}`
    );
    return this.convertCVHubCommit(commit);
  }

  async listBranches(): Promise<Branch[]> {
    const { owner, repo } = await this.getOwnerRepo();
    const branches = await this.request<CVHubBranch[]>(
      'GET',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`
    );
    return branches.map((branch) => this.convertCVHubBranch(branch));
  }

  async getBranch(name: string): Promise<Branch> {
    const { owner, repo } = await this.getOwnerRepo();
    const branch = await this.request<CVHubBranch>(
      'GET',
      `/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(name)}`
    );
    return this.convertCVHubBranch(branch);
  }

  // ============================================================================
  // Converters
  // ============================================================================

  private convertCVHubUser(user: CVHubUser): User {
    return {
      username: user.username,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
      url: user.web_url,
    };
  }

  private convertCVHubRepo(repo: CVHubRepository): Repository {
    return {
      owner: repo.owner,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description || undefined,
      defaultBranch: repo.default_branch,
      url: repo.web_url,
      isPrivate: repo.is_private,
      cloneUrl: repo.clone_url,
      sshUrl: repo.ssh_url,
    };
  }

  private convertCVHubPR(pr: CVHubPullRequest): PullRequest {
    let state: PullRequestState;
    if (pr.state === 'merged') {
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
      base: pr.base_branch,
      head: pr.head_branch,
      author: this.convertCVHubUser(pr.author),
      url: pr.web_url,
      createdAt: new Date(pr.created_at),
      updatedAt: new Date(pr.updated_at),
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : undefined,
      isDraft: pr.is_draft,
      commits: pr.commits,
      changedFiles: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
    };
  }

  private convertCVHubRelease(release: CVHubRelease): Release {
    return {
      id: release.id,
      tag: release.tag_name,
      name: release.name || release.tag_name,
      body: release.body || '',
      url: release.web_url,
      author: this.convertCVHubUser(release.author),
      createdAt: new Date(release.created_at),
      publishedAt: release.published_at ? new Date(release.published_at) : undefined,
      isDraft: release.is_draft,
      isPrerelease: release.is_prerelease,
      targetCommitish: release.target_commitish,
    };
  }

  private convertCVHubIssue(issue: CVHubIssue): Issue {
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body || '',
      state: issue.state === 'closed' ? IssueState.CLOSED : IssueState.OPEN,
      author: this.convertCVHubUser(issue.author),
      url: issue.web_url,
      labels: issue.labels,
      assignees: issue.assignees.map((a) => this.convertCVHubUser(a)),
      createdAt: new Date(issue.created_at),
      updatedAt: new Date(issue.updated_at),
      closedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
      comments: issue.comment_count,
    };
  }

  private convertCVHubCommit(commit: CVHubCommit): Commit {
    return {
      hash: commit.sha,
      shortHash: commit.sha.substring(0, 8),
      message: commit.message,
      author: {
        username: commit.author_name,
        name: commit.author_name,
        email: commit.author_email,
      },
      date: new Date(commit.date),
      parents: commit.parents || [],
      url: commit.web_url,
    };
  }

  private convertCVHubBranch(branch: CVHubBranch): Branch {
    return {
      name: branch.name,
      commit: this.convertCVHubCommit(branch.commit),
      isProtected: branch.is_protected,
      isDefault: branch.is_default,
    };
  }
}

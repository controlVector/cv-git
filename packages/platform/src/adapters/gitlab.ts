/**
 * GitLab Platform Adapter
 *
 * Implements GitPlatformAdapter for GitLab.
 * Converts GitLab-specific API responses to platform-agnostic types.
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
 * GitLab API response types
 */
interface GitLabProject {
  id: number;
  path: string;
  path_with_namespace: string;
  name: string;
  description: string | null;
  default_branch: string;
  web_url: string;
  visibility: string;
  http_url_to_repo: string;
  ssh_url_to_repo: string;
  namespace: {
    path: string;
    full_path: string;
  };
}

interface GitLabUser {
  id: number;
  username: string;
  name: string;
  email?: string;
  avatar_url: string;
  web_url: string;
}

interface GitLabMergeRequest {
  iid: number;
  title: string;
  description: string | null;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  source_branch: string;
  target_branch: string;
  author: GitLabUser;
  web_url: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  draft: boolean;
  user_notes_count: number;
  changes_count?: string;
  diff_refs?: {
    base_sha: string;
    head_sha: string;
    start_sha: string;
  };
}

interface GitLabRelease {
  tag_name: string;
  name: string;
  description: string | null;
  created_at: string;
  released_at: string | null;
  author: GitLabUser;
  _links: {
    self: string;
  };
  upcoming_release: boolean;
  commit: {
    id: string;
  };
}

interface GitLabIssue {
  iid: number;
  title: string;
  description: string | null;
  state: 'opened' | 'closed';
  author: GitLabUser;
  web_url: string;
  labels: string[];
  assignees: GitLabUser[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  user_notes_count: number;
}

interface GitLabCommit {
  id: string;
  short_id: string;
  message: string;
  author_name: string;
  author_email: string;
  authored_date: string;
  web_url: string;
  parent_ids: string[];
}

interface GitLabBranch {
  name: string;
  commit: GitLabCommit;
  protected: boolean;
  default: boolean;
}

export class GitLabAdapter implements GitPlatformAdapter {
  private token: string | null = null;
  private git: SimpleGit;
  private initialized = false;
  private baseUrl = 'https://gitlab.com/api/v4';
  private webUrl = 'https://gitlab.com';

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

    const token = await this.credentials.getGitPlatformToken(GitPlatform.GITLAB);
    if (!token) {
      throw new Error('GitLab token not found. Run: cv auth setup gitlab');
    }

    this.token = token;
    this.initialized = true;
  }

  getPlatformName(): string {
    return 'gitlab';
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
        'PRIVATE-TOKEN': this.token!,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitLab API error (${response.status}): ${errorText}`);
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
        'PRIVATE-TOKEN': token,
      },
    });

    if (!response.ok) {
      throw new Error('Invalid GitLab token');
    }

    const data = (await response.json()) as GitLabUser;

    return {
      username: data.username,
      name: data.name,
      email: data.email,
      avatarUrl: data.avatar_url,
      url: data.web_url,
    };
  }

  async getTokenScopes(token: string): Promise<string[]> {
    // GitLab personal access tokens don't expose scopes via API
    // We can check what operations work instead
    const response = await fetch(`${this.baseUrl}/personal_access_tokens/self`, {
      headers: {
        'PRIVATE-TOKEN': token,
      },
    });

    if (response.ok) {
      const data = (await response.json()) as { scopes?: string[] };
      return data.scopes || [];
    }

    // Fallback: return empty array if we can't determine scopes
    return [];
  }

  // ============================================================================
  // Repository
  // ============================================================================

  private async getProjectPath(): Promise<string> {
    const remotes = await this.git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');

    if (!origin?.refs?.push) {
      throw new Error('No git remote found. Not a git repository?');
    }

    // Parse GitLab URL (https or ssh)
    // https://gitlab.com/owner/repo.git
    // https://gitlab.com/group/subgroup/repo.git
    // git@gitlab.com:owner/repo.git
    // git@gitlab.com:group/subgroup/repo.git
    const match = origin.refs.push.match(/gitlab\.com[:/](.+?)(?:\.git)?$/);

    if (!match) {
      throw new Error('Not a GitLab repository');
    }

    return match[1];
  }

  async getRepoInfo(): Promise<Repository> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);
    const project = await this.request<GitLabProject>('GET', `/projects/${encodedPath}`);

    return this.convertGitLabProject(project);
  }

  async getRepo(owner: string, repo: string): Promise<Repository> {
    const projectPath = `${owner}/${repo}`;
    const encodedPath = encodeURIComponent(projectPath);
    const project = await this.request<GitLabProject>('GET', `/projects/${encodedPath}`);

    return this.convertGitLabProject(project);
  }

  private convertGitLabProject(project: GitLabProject): Repository {
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

  // ============================================================================
  // Merge Requests (Pull Requests in GitLab)
  // ============================================================================

  async createPR(options: CreatePROptions): Promise<PullRequest> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);

    const mr = await this.request<GitLabMergeRequest>(
      'POST',
      `/projects/${encodedPath}/merge_requests`,
      {
        title: options.title,
        description: options.body || '',
        source_branch: options.head,
        target_branch: options.base,
        draft: options.draft || false,
      }
    );

    return this.convertGitLabMR(mr);
  }

  async getPR(number: number): Promise<PullRequest> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);

    const mr = await this.request<GitLabMergeRequest>(
      'GET',
      `/projects/${encodedPath}/merge_requests/${number}`
    );

    return this.convertGitLabMR(mr);
  }

  async listPRs(options?: ListPROptions): Promise<PullRequest[]> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);

    // Map platform-agnostic state to GitLab state
    let state: string = 'opened';
    if (options?.state === 'all') {
      state = 'all';
    } else if (options?.state === PullRequestState.CLOSED) {
      state = 'closed';
    } else if (options?.state === PullRequestState.MERGED) {
      state = 'merged';
    } else if (options?.state === PullRequestState.OPEN) {
      state = 'opened';
    }

    // Map sort options
    let orderBy = 'created_at';
    if (options?.sort === 'updated') {
      orderBy = 'updated_at';
    }

    const params = new URLSearchParams({
      state,
      order_by: orderBy,
      sort: options?.direction || 'desc',
      per_page: String(options?.limit || 30),
    });

    const mrs = await this.request<GitLabMergeRequest[]>(
      'GET',
      `/projects/${encodedPath}/merge_requests?${params}`
    );

    return mrs.map((mr) => this.convertGitLabMR(mr));
  }

  async updatePR(
    number: number,
    updates: { title?: string; body?: string; state?: PullRequestState }
  ): Promise<PullRequest> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);

    const updateBody: Record<string, unknown> = {};
    if (updates.title) updateBody.title = updates.title;
    if (updates.body !== undefined) updateBody.description = updates.body;
    if (updates.state === PullRequestState.CLOSED) {
      updateBody.state_event = 'close';
    } else if (updates.state === PullRequestState.OPEN) {
      updateBody.state_event = 'reopen';
    }

    const mr = await this.request<GitLabMergeRequest>(
      'PUT',
      `/projects/${encodedPath}/merge_requests/${number}`,
      updateBody
    );

    return this.convertGitLabMR(mr);
  }

  async mergePR(
    number: number,
    options?: { commitMessage?: string; mergeMethod?: 'merge' | 'squash' | 'rebase' }
  ): Promise<PullRequest> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);

    const mergeBody: Record<string, unknown> = {};
    if (options?.commitMessage) {
      mergeBody.merge_commit_message = options.commitMessage;
    }
    if (options?.mergeMethod === 'squash') {
      mergeBody.squash = true;
    }

    const mr = await this.request<GitLabMergeRequest>(
      'PUT',
      `/projects/${encodedPath}/merge_requests/${number}/merge`,
      mergeBody
    );

    return this.convertGitLabMR(mr);
  }

  private convertGitLabMR(mr: GitLabMergeRequest): PullRequest {
    let state: PullRequestState;
    if (mr.state === 'merged') {
      state = PullRequestState.MERGED;
    } else if (mr.state === 'closed') {
      state = PullRequestState.CLOSED;
    } else {
      state = PullRequestState.OPEN;
    }

    return {
      number: mr.iid,
      title: mr.title,
      body: mr.description || '',
      state,
      base: mr.target_branch,
      head: mr.source_branch,
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

  // ============================================================================
  // Releases
  // ============================================================================

  async createRelease(options: CreateReleaseOptions): Promise<Release> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);

    const release = await this.request<GitLabRelease>(
      'POST',
      `/projects/${encodedPath}/releases`,
      {
        tag_name: options.tag,
        name: options.name || options.tag,
        description: options.body || '',
        ref: options.targetCommitish,
      }
    );

    return this.convertGitLabRelease(release);
  }

  async getRelease(tag: string): Promise<Release> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);
    const encodedTag = encodeURIComponent(tag);

    const release = await this.request<GitLabRelease>(
      'GET',
      `/projects/${encodedPath}/releases/${encodedTag}`
    );

    return this.convertGitLabRelease(release);
  }

  async listReleases(limit = 30): Promise<Release[]> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);

    const releases = await this.request<GitLabRelease[]>(
      'GET',
      `/projects/${encodedPath}/releases?per_page=${limit}`
    );

    return releases.map((release) => this.convertGitLabRelease(release));
  }

  async deleteRelease(tag: string): Promise<void> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);
    const encodedTag = encodeURIComponent(tag);

    await this.request<void>('DELETE', `/projects/${encodedPath}/releases/${encodedTag}`);
  }

  private convertGitLabRelease(release: GitLabRelease): Release {
    return {
      id: release.tag_name,
      tag: release.tag_name,
      name: release.name || release.tag_name,
      body: release.description || '',
      url: release._links.self,
      author: {
        username: release.author.username,
        name: release.author.name,
        avatarUrl: release.author.avatar_url,
        url: release.author.web_url,
      },
      createdAt: new Date(release.created_at),
      publishedAt: release.released_at ? new Date(release.released_at) : undefined,
      isDraft: false, // GitLab doesn't have draft releases in the same way
      isPrerelease: release.upcoming_release,
      targetCommitish: release.commit?.id,
    };
  }

  // ============================================================================
  // Issues
  // ============================================================================

  async createIssue(options: CreateIssueOptions): Promise<Issue> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);

    const issue = await this.request<GitLabIssue>(
      'POST',
      `/projects/${encodedPath}/issues`,
      {
        title: options.title,
        description: options.body || '',
        labels: options.labels?.join(','),
        assignee_ids: options.assignees, // GitLab uses user IDs, not usernames
      }
    );

    return this.convertGitLabIssue(issue);
  }

  async getIssue(number: number): Promise<Issue> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);

    const issue = await this.request<GitLabIssue>(
      'GET',
      `/projects/${encodedPath}/issues/${number}`
    );

    return this.convertGitLabIssue(issue);
  }

  async listIssues(options?: ListIssueOptions): Promise<Issue[]> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);

    const params = new URLSearchParams({
      state: options?.state || 'opened',
      order_by: options?.sort === 'comments' ? 'updated_at' : options?.sort || 'created_at',
      sort: options?.direction || 'desc',
      per_page: String(options?.limit || 30),
    });

    if (options?.labels?.length) {
      params.set('labels', options.labels.join(','));
    }

    const issues = await this.request<GitLabIssue[]>(
      'GET',
      `/projects/${encodedPath}/issues?${params}`
    );

    return issues.map((issue) => this.convertGitLabIssue(issue));
  }

  async updateIssue(
    number: number,
    updates: { title?: string; body?: string; state?: IssueState; labels?: string[] }
  ): Promise<Issue> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);

    const updateBody: Record<string, unknown> = {};
    if (updates.title) updateBody.title = updates.title;
    if (updates.body !== undefined) updateBody.description = updates.body;
    if (updates.labels) updateBody.labels = updates.labels.join(',');
    if (updates.state === IssueState.CLOSED) {
      updateBody.state_event = 'close';
    } else if (updates.state === IssueState.OPEN) {
      updateBody.state_event = 'reopen';
    }

    const issue = await this.request<GitLabIssue>(
      'PUT',
      `/projects/${encodedPath}/issues/${number}`,
      updateBody
    );

    return this.convertGitLabIssue(issue);
  }

  private convertGitLabIssue(issue: GitLabIssue): Issue {
    return {
      number: issue.iid,
      title: issue.title,
      body: issue.description || '',
      state: issue.state === 'closed' ? IssueState.CLOSED : IssueState.OPEN,
      author: {
        username: issue.author.username,
        name: issue.author.name,
        avatarUrl: issue.author.avatar_url,
        url: issue.author.web_url,
      },
      url: issue.web_url,
      labels: issue.labels,
      assignees: issue.assignees.map((a) => ({
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

  // ============================================================================
  // Commits & Branches
  // ============================================================================

  async getCommits(base: string, head: string): Promise<Commit[]> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);

    // GitLab uses compare API
    const comparison = await this.request<{ commits: GitLabCommit[] }>(
      'GET',
      `/projects/${encodedPath}/repository/compare?from=${encodeURIComponent(base)}&to=${encodeURIComponent(head)}`
    );

    return comparison.commits.map((commit) => this.convertGitLabCommit(commit));
  }

  async getCommit(hash: string): Promise<Commit> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);

    const commit = await this.request<GitLabCommit>(
      'GET',
      `/projects/${encodedPath}/repository/commits/${hash}`
    );

    return this.convertGitLabCommit(commit);
  }

  async listBranches(): Promise<Branch[]> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);

    const branches = await this.request<GitLabBranch[]>(
      'GET',
      `/projects/${encodedPath}/repository/branches`
    );

    return branches.map((branch) => this.convertGitLabBranch(branch));
  }

  async getBranch(name: string): Promise<Branch> {
    const projectPath = await this.getProjectPath();
    const encodedPath = encodeURIComponent(projectPath);

    const branch = await this.request<GitLabBranch>(
      'GET',
      `/projects/${encodedPath}/repository/branches/${encodeURIComponent(name)}`
    );

    return this.convertGitLabBranch(branch);
  }

  private convertGitLabCommit(commit: GitLabCommit): Commit {
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

  private convertGitLabBranch(branch: GitLabBranch): Branch {
    return {
      name: branch.name,
      commit: this.convertGitLabCommit(branch.commit),
      isProtected: branch.protected,
      isDefault: branch.default,
    };
  }
}

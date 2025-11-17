/**
 * Git Platform Adapter Interface
 *
 * Defines the contract that all platform adapters must implement.
 * This allows CV-Git to work with any git hosting platform (GitHub, CV Platform, GitLab, etc.)
 * by providing a consistent interface.
 */

import type {
  Repository,
  PullRequest,
  PullRequestState,
  Release,
  Issue,
  IssueState,
  User,
  Commit,
  Branch,
} from './types/common.js';

/**
 * Options for creating a pull request
 */
export interface CreatePROptions {
  /** Base branch (target) */
  base: string;

  /** Head branch (source) */
  head: string;

  /** PR title */
  title: string;

  /** PR body/description */
  body?: string;

  /** Create as draft */
  draft?: boolean;
}

/**
 * Options for listing pull requests
 */
export interface ListPROptions {
  /** Filter by state */
  state?: PullRequestState | 'all';

  /** Number of results to return */
  limit?: number;

  /** Sort by */
  sort?: 'created' | 'updated' | 'popularity';

  /** Sort direction */
  direction?: 'asc' | 'desc';
}

/**
 * Options for creating a release
 */
export interface CreateReleaseOptions {
  /** Git tag name */
  tag: string;

  /** Release name/title */
  name?: string;

  /** Release notes/body */
  body?: string;

  /** Target commit (defaults to HEAD) */
  targetCommitish?: string;

  /** Create as draft */
  draft?: boolean;

  /** Mark as pre-release */
  prerelease?: boolean;
}

/**
 * Options for creating an issue
 */
export interface CreateIssueOptions {
  /** Issue title */
  title: string;

  /** Issue body */
  body?: string;

  /** Labels */
  labels?: string[];

  /** Assignees */
  assignees?: string[];
}

/**
 * Options for listing issues
 */
export interface ListIssueOptions {
  /** Filter by state */
  state?: IssueState | 'all';

  /** Filter by labels */
  labels?: string[];

  /** Number of results */
  limit?: number;

  /** Sort by */
  sort?: 'created' | 'updated' | 'comments';

  /** Sort direction */
  direction?: 'asc' | 'desc';
}

/**
 * Git Platform Adapter
 *
 * All platform adapters (GitHub, CV Platform, GitLab, etc.) must implement this interface.
 */
export interface GitPlatformAdapter {
  // ============================================================================
  // Initialization & Authentication
  // ============================================================================

  /**
   * Initialize the adapter with credentials
   */
  init(): Promise<void>;

  /**
   * Validate a token and get user information
   *
   * @param token - The token to validate
   * @returns User information if valid
   */
  validateToken(token: string): Promise<User>;

  /**
   * Get token scopes/permissions
   *
   * @param token - The token to check
   * @returns Array of scope names
   */
  getTokenScopes(token: string): Promise<string[]>;

  // ============================================================================
  // Repository Operations
  // ============================================================================

  /**
   * Get current repository information from git remote
   *
   * @returns Repository information
   */
  getRepoInfo(): Promise<Repository>;

  /**
   * Get a specific repository
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @returns Repository information
   */
  getRepo(owner: string, repo: string): Promise<Repository>;

  // ============================================================================
  // Pull Request Operations
  // ============================================================================

  /**
   * Create a pull request
   *
   * @param options - PR creation options
   * @returns Created pull request
   */
  createPR(options: CreatePROptions): Promise<PullRequest>;

  /**
   * Get a specific pull request
   *
   * @param number - PR number
   * @returns Pull request information
   */
  getPR(number: number): Promise<PullRequest>;

  /**
   * List pull requests
   *
   * @param options - Listing options
   * @returns Array of pull requests
   */
  listPRs(options?: ListPROptions): Promise<PullRequest[]>;

  /**
   * Update a pull request
   *
   * @param number - PR number
   * @param updates - Fields to update
   * @returns Updated pull request
   */
  updatePR(
    number: number,
    updates: { title?: string; body?: string; state?: PullRequestState }
  ): Promise<PullRequest>;

  /**
   * Merge a pull request
   *
   * @param number - PR number
   * @param options - Merge options
   * @returns Merged pull request
   */
  mergePR(
    number: number,
    options?: { commitMessage?: string; mergeMethod?: 'merge' | 'squash' | 'rebase' }
  ): Promise<PullRequest>;

  // ============================================================================
  // Release Operations
  // ============================================================================

  /**
   * Create a release
   *
   * @param options - Release creation options
   * @returns Created release
   */
  createRelease(options: CreateReleaseOptions): Promise<Release>;

  /**
   * Get a specific release by tag
   *
   * @param tag - Release tag
   * @returns Release information
   */
  getRelease(tag: string): Promise<Release>;

  /**
   * List releases
   *
   * @param limit - Number of releases to return
   * @returns Array of releases
   */
  listReleases(limit?: number): Promise<Release[]>;

  /**
   * Delete a release
   *
   * @param tag - Release tag
   */
  deleteRelease(tag: string): Promise<void>;

  // ============================================================================
  // Issue Operations
  // ============================================================================

  /**
   * Create an issue
   *
   * @param options - Issue creation options
   * @returns Created issue
   */
  createIssue(options: CreateIssueOptions): Promise<Issue>;

  /**
   * Get a specific issue
   *
   * @param number - Issue number
   * @returns Issue information
   */
  getIssue(number: number): Promise<Issue>;

  /**
   * List issues
   *
   * @param options - Listing options
   * @returns Array of issues
   */
  listIssues(options?: ListIssueOptions): Promise<Issue[]>;

  /**
   * Update an issue
   *
   * @param number - Issue number
   * @param updates - Fields to update
   * @returns Updated issue
   */
  updateIssue(
    number: number,
    updates: { title?: string; body?: string; state?: IssueState; labels?: string[] }
  ): Promise<Issue>;

  // ============================================================================
  // Commit & Branch Operations
  // ============================================================================

  /**
   * Get commits in a range
   *
   * @param base - Base commit/branch
   * @param head - Head commit/branch
   * @returns Array of commits
   */
  getCommits(base: string, head: string): Promise<Commit[]>;

  /**
   * Get a specific commit
   *
   * @param hash - Commit hash
   * @returns Commit information
   */
  getCommit(hash: string): Promise<Commit>;

  /**
   * List branches
   *
   * @returns Array of branches
   */
  listBranches(): Promise<Branch[]>;

  /**
   * Get a specific branch
   *
   * @param name - Branch name
   * @returns Branch information
   */
  getBranch(name: string): Promise<Branch>;

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get the platform name (e.g., "github", "cv-platform", "gitlab")
   */
  getPlatformName(): string;

  /**
   * Get the platform's web URL for the current repository
   */
  getWebUrl(): Promise<string>;
}

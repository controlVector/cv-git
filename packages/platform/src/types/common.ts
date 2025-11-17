/**
 * Platform-Agnostic Git Hosting Types
 *
 * These types work with any git hosting platform (GitHub, CV Platform, GitLab, etc.)
 * Adapters convert platform-specific responses to these common types.
 */

/**
 * Repository information
 */
export interface Repository {
  /** Repository owner/organization */
  owner: string;

  /** Repository name */
  name: string;

  /** Full repository path (owner/name) */
  fullName: string;

  /** Repository description */
  description?: string;

  /** Default branch name */
  defaultBranch: string;

  /** Repository URL */
  url: string;

  /** Is private repository */
  isPrivate: boolean;

  /** Clone URL (HTTPS) */
  cloneUrl: string;

  /** SSH URL */
  sshUrl?: string;
}

/**
 * Pull request state
 */
export enum PullRequestState {
  OPEN = 'open',
  CLOSED = 'closed',
  MERGED = 'merged',
}

/**
 * Pull request
 */
export interface PullRequest {
  /** PR number */
  number: number;

  /** PR title */
  title: string;

  /** PR description/body */
  body: string;

  /** PR state */
  state: PullRequestState;

  /** Base branch (target) */
  base: string;

  /** Head branch (source) */
  head: string;

  /** PR author */
  author: User;

  /** PR URL */
  url: string;

  /** Creation date */
  createdAt: Date;

  /** Last update date */
  updatedAt: Date;

  /** Merge date (if merged) */
  mergedAt?: Date;

  /** Is draft PR */
  isDraft: boolean;

  /** Number of commits */
  commits?: number;

  /** Number of changed files */
  changedFiles?: number;

  /** Number of additions */
  additions?: number;

  /** Number of deletions */
  deletions?: number;
}

/**
 * Release
 */
export interface Release {
  /** Release ID */
  id: string;

  /** Git tag name */
  tag: string;

  /** Release name/title */
  name: string;

  /** Release notes/body */
  body: string;

  /** Release URL */
  url: string;

  /** Release author */
  author: User;

  /** Creation date */
  createdAt: Date;

  /** Publication date */
  publishedAt?: Date;

  /** Is draft */
  isDraft: boolean;

  /** Is pre-release */
  isPrerelease: boolean;

  /** Target commit hash */
  targetCommitish?: string;
}

/**
 * Issue state
 */
export enum IssueState {
  OPEN = 'open',
  CLOSED = 'closed',
}

/**
 * Issue
 */
export interface Issue {
  /** Issue number */
  number: number;

  /** Issue title */
  title: string;

  /** Issue body */
  body: string;

  /** Issue state */
  state: IssueState;

  /** Issue author */
  author: User;

  /** Issue URL */
  url: string;

  /** Labels */
  labels: string[];

  /** Assignees */
  assignees: User[];

  /** Creation date */
  createdAt: Date;

  /** Last update date */
  updatedAt: Date;

  /** Close date */
  closedAt?: Date;

  /** Number of comments */
  comments: number;
}

/**
 * User/Author information
 */
export interface User {
  /** Username */
  username: string;

  /** Display name */
  name?: string;

  /** Email */
  email?: string;

  /** Avatar URL */
  avatarUrl?: string;

  /** Profile URL */
  url?: string;
}

/**
 * Commit information
 */
export interface Commit {
  /** Commit hash */
  hash: string;

  /** Short hash */
  shortHash: string;

  /** Commit message */
  message: string;

  /** Commit author */
  author: User;

  /** Commit date */
  date: Date;

  /** Parent commit hashes */
  parents: string[];

  /** Commit URL */
  url?: string;
}

/**
 * Branch information
 */
export interface Branch {
  /** Branch name */
  name: string;

  /** Latest commit */
  commit: Commit;

  /** Is protected */
  isProtected: boolean;

  /** Is default branch */
  isDefault: boolean;
}

/**
 * Diff/Changes information
 */
export interface DiffStats {
  /** Files changed */
  files: number;

  /** Lines added */
  additions: number;

  /** Lines deleted */
  deletions: number;

  /** Total changes */
  total: number;
}

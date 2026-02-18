/**
 * @cv-git/platform
 *
 * Platform-agnostic git hosting adapter for CV-Git
 *
 * Features:
 * - Works with any git hosting platform (GitHub, CV Platform, GitLab, etc.)
 * - Platform-agnostic types (PR, Release, Issue, etc.)
 * - Easy platform switching via configuration
 * - Extensible adapter pattern
 */

// Main adapter interface
export {
  type GitPlatformAdapter,
  type CreatePROptions,
  type ListPROptions,
  type CreateReleaseOptions,
  type CreateIssueOptions,
  type ListIssueOptions,
} from './adapter.js';

// Platform-agnostic types
export {
  type Repository,
  type PullRequest,
  PullRequestState,
  type Release,
  type Issue,
  IssueState,
  type User,
  type Commit,
  type Branch,
  type DiffStats,
} from './types/index.js';

// Factory
export {
  createPlatformAdapter,
  detectPlatformFromRemote,
  getDefaultApiUrl,
  getDefaultWebUrl,
  type PlatformConfig,
} from './factory.js';

// Adapters
export { GitHubAdapter } from './adapters/github.js';
export { GitLabAdapter } from './adapters/gitlab.js';
export { BitbucketAdapter } from './adapters/bitbucket.js';
export { CVHubAdapter } from './adapters/cv-hub.js';

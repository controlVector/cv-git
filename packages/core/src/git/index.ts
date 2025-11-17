/**
 * Git compatibility layer
 * Wraps git operations and provides hooks for CV-Git
 */

import simpleGit, { SimpleGit, StatusResult, DiffResult, LogResult } from 'simple-git';
import * as path from 'path';
import { GitError, WorkingTreeStatus, GitCommit, GitDiff } from '@cv-git/shared';

export class GitManager {
  private git: SimpleGit;
  private repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    this.git = simpleGit(repoRoot);
  }

  /**
   * Check if directory is a git repository
   */
  async isGitRepo(): Promise<boolean> {
    try {
      await this.git.revparse(['--is-inside-work-tree']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize a new git repository
   */
  async init(): Promise<void> {
    try {
      await this.git.init();
    } catch (error: any) {
      throw new GitError(`Failed to initialize git repository: ${error.message}`, error);
    }
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string> {
    try {
      const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
      return branch.trim();
    } catch (error: any) {
      throw new GitError(`Failed to get current branch: ${error.message}`, error);
    }
  }

  /**
   * Get working tree status
   */
  async getStatus(): Promise<WorkingTreeStatus> {
    try {
      const status: StatusResult = await this.git.status();

      return {
        modified: status.modified,
        added: status.created,
        deleted: status.deleted,
        renamed: status.renamed.map(r => ({ from: r.from, to: r.to })),
        untracked: status.not_added,
        staged: status.staged
      };
    } catch (error: any) {
      throw new GitError(`Failed to get status: ${error.message}`, error);
    }
  }

  /**
   * Get list of tracked files
   */
  async getTrackedFiles(): Promise<string[]> {
    try {
      const result = await this.git.raw(['ls-files']);
      return result.trim().split('\n').filter(f => f.length > 0);
    } catch (error: any) {
      throw new GitError(`Failed to get tracked files: ${error.message}`, error);
    }
  }

  /**
   * Get recent commits
   */
  async getRecentCommits(limit: number = 10): Promise<GitCommit[]> {
    try {
      const log: LogResult = await this.git.log({ maxCount: limit });

      return log.all.map(commit => ({
        sha: commit.hash,
        message: commit.message,
        author: commit.author_name,
        authorEmail: commit.author_email,
        date: new Date(commit.date).getTime(),
        files: []
      }));
    } catch (error: any) {
      throw new GitError(`Failed to get commits: ${error.message}`, error);
    }
  }

  /**
   * Get commit by SHA
   */
  async getCommit(sha: string): Promise<GitCommit> {
    try {
      const log = await this.git.log({ maxCount: 1, from: sha, to: sha });

      if (log.all.length === 0) {
        throw new GitError(`Commit not found: ${sha}`);
      }

      const commit = log.all[0];

      // Get files changed in this commit
      const filesResult = await this.git.diff(['--name-only', `${sha}^`, sha]);
      const files = filesResult.trim().split('\n').filter(f => f.length > 0);

      return {
        sha: commit.hash,
        message: commit.message,
        author: commit.author_name,
        authorEmail: commit.author_email,
        date: new Date(commit.date).getTime(),
        files
      };
    } catch (error: any) {
      throw new GitError(`Failed to get commit ${sha}: ${error.message}`, error);
    }
  }

  /**
   * Get file history
   */
  async getFileHistory(filePath: string, limit: number = 10): Promise<GitCommit[]> {
    try {
      const log = await this.git.log({ file: filePath, maxCount: limit });

      return log.all.map(commit => ({
        sha: commit.hash,
        message: commit.message,
        author: commit.author_name,
        authorEmail: commit.author_email,
        date: new Date(commit.date).getTime(),
        files: [filePath]
      }));
    } catch (error: any) {
      throw new GitError(`Failed to get file history: ${error.message}`, error);
    }
  }

  /**
   * Get diff between two commits
   */
  async getDiff(fromCommit: string, toCommit: string = 'HEAD'): Promise<GitDiff[]> {
    try {
      const diffSummary = await this.git.diffSummary([fromCommit, toCommit]);

      return diffSummary.files.map(file => ({
        file: file.file,
        insertions: file.insertions,
        deletions: file.deletions,
        changes: file.changes.toString()
      }));
    } catch (error: any) {
      throw new GitError(`Failed to get diff: ${error.message}`, error);
    }
  }

  /**
   * Get detailed diff for a file
   */
  async getFileDiff(filePath: string, fromCommit?: string): Promise<string> {
    try {
      const args = fromCommit ? [fromCommit, '--', filePath] : ['--', filePath];
      const diff = await this.git.diff(args);
      return diff;
    } catch (error: any) {
      throw new GitError(`Failed to get file diff: ${error.message}`, error);
    }
  }

  /**
   * Create a new branch
   */
  async createBranch(branchName: string, checkout: boolean = true): Promise<void> {
    try {
      await this.git.checkoutLocalBranch(branchName);
    } catch (error: any) {
      throw new GitError(`Failed to create branch: ${error.message}`, error);
    }
  }

  /**
   * Checkout a branch
   */
  async checkout(branchName: string): Promise<void> {
    try {
      await this.git.checkout(branchName);
    } catch (error: any) {
      throw new GitError(`Failed to checkout branch: ${error.message}`, error);
    }
  }

  /**
   * Get last commit SHA
   */
  async getLastCommitSha(): Promise<string> {
    try {
      const sha = await this.git.revparse(['HEAD']);
      return sha.trim();
    } catch (error: any) {
      throw new GitError(`Failed to get last commit SHA: ${error.message}`, error);
    }
  }

  /**
   * Get files changed since a commit
   */
  async getChangedFilesSince(commitSha: string): Promise<string[]> {
    try {
      const diff = await this.git.diff(['--name-only', commitSha, 'HEAD']);
      return diff.trim().split('\n').filter(f => f.length > 0);
    } catch (error: any) {
      throw new GitError(`Failed to get changed files: ${error.message}`, error);
    }
  }

  /**
   * Get repository root directory
   */
  getRepoRoot(): string {
    return this.repoRoot;
  }

  /**
   * Install git hooks for CV-Git
   */
  async installHooks(): Promise<void> {
    // TODO: Implement hook installation
    // This will create post-commit, post-merge, post-checkout hooks
    // that trigger `cv sync --incremental`
  }
}

/**
 * Create a GitManager instance
 */
export function createGitManager(repoRoot: string): GitManager {
  return new GitManager(repoRoot);
}

/**
 * Git compatibility layer
 * Wraps git operations and provides hooks for CV-Git
 */

import { simpleGit, SimpleGit, StatusResult, DiffResult, LogResult } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GitError, WorkingTreeStatus, GitCommit, GitDiff } from '@cv-git/shared';

const HOOK_MARKER = '# CV-GIT HOOK';

const POST_COMMIT_HOOK = `#!/bin/sh
${HOOK_MARKER} - DO NOT EDIT THIS LINE
# Auto-sync knowledge graph after commit
# Runs in background to avoid slowing down commits

cv sync --incremental --quiet 2>/dev/null &
`;

const POST_MERGE_HOOK = `#!/bin/sh
${HOOK_MARKER} - DO NOT EDIT THIS LINE
# Auto-sync knowledge graph after merge/pull
# Runs in background to avoid slowing down merges

cv sync --incremental --quiet 2>/dev/null &
`;

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
      // Use log with -1 flag to get single commit by SHA
      const log = await this.git.log(['-1', sha]);

      if (log.all.length === 0) {
        throw new GitError(`Commit not found: ${sha}`);
      }

      const commit = log.all[0];

      // Get files changed in this commit
      let files: string[] = [];
      try {
        const filesResult = await this.git.diff(['--name-only', `${sha}^`, sha]);
        files = filesResult.trim().split('\n').filter(f => f.length > 0);
      } catch {
        // First commit or other issue - use show instead
        try {
          const showResult = await this.git.show(['--name-only', '--format=', sha]);
          files = showResult.trim().split('\n').filter(f => f.length > 0);
        } catch {
          // Fallback to empty files list
        }
      }

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

      return diffSummary.files
        .filter(file => 'insertions' in file && 'deletions' in file)
        .map(file => ({
          file: file.file,
          insertions: (file as any).insertions,
          deletions: (file as any).deletions,
          changes: ((file as any).changes || 0).toString()
        }));
    } catch (error: any) {
      throw new GitError(`Failed to get diff: ${error.message}`, error);
    }
  }

  /**
   * Get raw diff text (for review, etc.)
   */
  async getRawDiff(ref?: string): Promise<string> {
    try {
      const args = ref ? [ref] : [];
      const diff = await this.git.diff(args);
      return diff || '';
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
   * Get the git blob hash for a file
   * This is the SHA-1 hash of the file content as stored in git
   */
  async getFileHash(filePath: string): Promise<string> {
    try {
      // Use ls-files -s to get the staged/committed blob hash
      const result = await this.git.raw(['ls-files', '-s', filePath]);
      if (result.trim()) {
        // Format: "100644 <hash> <stage> <path>"
        const parts = result.trim().split(/\s+/);
        if (parts.length >= 2) {
          return parts[1];
        }
      }
      // File might be untracked, compute hash from content
      const hashResult = await this.git.raw(['hash-object', filePath]);
      return hashResult.trim();
    } catch (error: any) {
      // Return empty string if file is not in git
      return '';
    }
  }

  /**
   * Get git blob hashes for multiple files in batch
   * More efficient than calling getFileHash for each file
   */
  async getFileHashes(filePaths: string[]): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();

    if (filePaths.length === 0) {
      return hashes;
    }

    try {
      // Get all tracked file hashes in one call
      const result = await this.git.raw(['ls-files', '-s']);
      const lines = result.trim().split('\n').filter(l => l.length > 0);

      // Build a map of path -> hash
      for (const line of lines) {
        // Format: "100644 <hash> <stage> <path>"
        const match = line.match(/^\d+\s+([a-f0-9]+)\s+\d+\s+(.+)$/);
        if (match) {
          const [, hash, path] = match;
          hashes.set(path, hash);
        }
      }

      // For requested files not in the index, they're untracked
      // Leave them with empty hash (or could compute with hash-object)
      for (const filePath of filePaths) {
        if (!hashes.has(filePath)) {
          hashes.set(filePath, '');
        }
      }

      return hashes;
    } catch (error: any) {
      // Return empty hashes on error
      for (const filePath of filePaths) {
        hashes.set(filePath, '');
      }
      return hashes;
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
   * Creates post-commit and post-merge hooks that trigger `cv sync --incremental`
   */
  async installHooks(): Promise<{ installed: string[]; skipped: string[] }> {
    const hooksDir = path.join(this.repoRoot, '.git', 'hooks');
    const installed: string[] = [];
    const skipped: string[] = [];

    // Ensure hooks directory exists
    await fs.mkdir(hooksDir, { recursive: true });

    const hooks: Array<{ name: string; content: string }> = [
      { name: 'post-commit', content: POST_COMMIT_HOOK },
      { name: 'post-merge', content: POST_MERGE_HOOK }
    ];

    for (const hook of hooks) {
      const hookPath = path.join(hooksDir, hook.name);
      const wasInstalled = await this.installHook(hookPath, hook.content);
      if (wasInstalled) {
        installed.push(hook.name);
      } else {
        skipped.push(hook.name);
      }
    }

    return { installed, skipped };
  }

  /**
   * Install a single git hook, preserving existing non-cv hooks
   */
  private async installHook(hookPath: string, hookContent: string): Promise<boolean> {
    try {
      // Check if hook already exists
      let existingContent: string | null = null;
      try {
        existingContent = await fs.readFile(hookPath, 'utf-8');
      } catch {
        // File doesn't exist
      }

      if (existingContent) {
        // Check if it's already our hook
        if (existingContent.includes(HOOK_MARKER)) {
          return false; // Already installed
        }

        // There's an existing hook that's not ours - prepend our hook
        const combinedHook = hookContent + `
# Original hook preserved below
${existingContent.replace(/^#!.*\n/, '')}
`;
        await fs.writeFile(hookPath, combinedHook, { mode: 0o755 });
        return true;
      }

      // No existing hook, install fresh
      await fs.writeFile(hookPath, hookContent, { mode: 0o755 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Uninstall CV-Git hooks, preserving other hooks
   */
  async uninstallHooks(): Promise<{ removed: string[]; notFound: string[] }> {
    const hooksDir = path.join(this.repoRoot, '.git', 'hooks');
    const removed: string[] = [];
    const notFound: string[] = [];

    for (const hookName of ['post-commit', 'post-merge']) {
      const hookPath = path.join(hooksDir, hookName);
      const wasRemoved = await this.uninstallHook(hookPath);
      if (wasRemoved) {
        removed.push(hookName);
      } else {
        notFound.push(hookName);
      }
    }

    return { removed, notFound };
  }

  /**
   * Uninstall a single CV-Git hook
   */
  private async uninstallHook(hookPath: string): Promise<boolean> {
    try {
      const existingContent = await fs.readFile(hookPath, 'utf-8');

      if (!existingContent.includes(HOOK_MARKER)) {
        return false; // Not our hook
      }

      // Check if there's preserved content after our hook
      const preservedMatch = existingContent.match(/# Original hook preserved below\n([\s\S]*)/);

      if (preservedMatch && preservedMatch[1].trim()) {
        // Restore the original hook
        const originalContent = '#!/bin/sh\n' + preservedMatch[1];
        await fs.writeFile(hookPath, originalContent, { mode: 0o755 });
      } else {
        // Just delete the hook
        await fs.unlink(hookPath);
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if CV-Git hooks are installed
   */
  async getHooksStatus(): Promise<Record<string, 'cv-git' | 'other' | 'none'>> {
    const hooksDir = path.join(this.repoRoot, '.git', 'hooks');
    const status: Record<string, 'cv-git' | 'other' | 'none'> = {};

    for (const hookName of ['post-commit', 'post-merge']) {
      const hookPath = path.join(hooksDir, hookName);
      try {
        const content = await fs.readFile(hookPath, 'utf-8');
        status[hookName] = content.includes(HOOK_MARKER) ? 'cv-git' : 'other';
      } catch {
        status[hookName] = 'none';
      }
    }

    return status;
  }
}

/**
 * Create a GitManager instance
 */
export function createGitManager(repoRoot: string): GitManager {
  return new GitManager(repoRoot);
}

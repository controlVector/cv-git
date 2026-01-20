/**
 * Delta Sync Manager
 *
 * Tracks file state to enable efficient incremental syncing.
 * Only processes files that have actually changed since last sync.
 *
 * Uses file locking to prevent corruption from parallel sync operations.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { getCVDir } from '@cv-git/shared';
import { acquireLock, LockHandle } from './file-lock.js';

/**
 * Tracked file entry
 */
export interface TrackedFile {
  path: string;
  contentHash: string;
  lastSyncedAt: string;
  size: number;
  type: 'code' | 'document';
}

/**
 * Delta between two sync states
 */
export interface SyncDelta {
  added: string[];      // New files
  modified: string[];   // Changed files
  deleted: string[];    // Removed files
  unchanged: string[];  // No changes
}

/**
 * Delta state stored on disk
 */
interface DeltaState {
  version: string;
  lastSyncedAt: string;
  lastCommit: string;
  files: Record<string, TrackedFile>;
}

/**
 * Delta Sync Manager
 */
export class DeltaSyncManager {
  private cvDir: string;
  private statePath: string;
  private state: DeltaState | null = null;
  private loaded = false;
  private dirty = false;
  private lock: LockHandle | null = null;

  constructor(repoRoot: string) {
    this.cvDir = getCVDir(repoRoot);
    this.statePath = path.join(this.cvDir, 'delta_state.json');
  }

  /**
   * Acquire exclusive lock on the state file
   * Must be called before any operations that read/write state
   */
  async acquireLock(): Promise<void> {
    if (this.lock) return; // Already locked

    this.lock = await acquireLock(this.statePath, {
      timeout: 30000,
      staleTimeout: 60000,
    });
  }

  /**
   * Release the lock on the state file
   * Should be called when done with sync operations
   */
  async releaseLock(): Promise<void> {
    if (this.lock) {
      await this.lock.release();
      this.lock = null;
    }
  }

  /**
   * Load delta state from disk
   * Automatically acquires lock if not already held
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    // Ensure we have the lock before reading
    await this.acquireLock();

    try {
      const content = await fs.readFile(this.statePath, 'utf-8');
      this.state = JSON.parse(content) as DeltaState;
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        console.warn(`Failed to load delta state: ${err.message}`);
      }
      // Initialize fresh state
      this.state = {
        version: '1.0',
        lastSyncedAt: '',
        lastCommit: '',
        files: {}
      };
    }

    this.loaded = true;
  }

  /**
   * Save delta state to disk
   * Lock must be held (automatically acquired by load())
   */
  async save(): Promise<void> {
    if (!this.dirty || !this.state) return;

    if (!this.lock) {
      throw new Error('Cannot save delta state without holding lock. Call load() first.');
    }

    await fs.mkdir(this.cvDir, { recursive: true });
    await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2));
    this.dirty = false;
  }

  /**
   * Compute content hash of a file
   */
  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Compute delta between current files and last synced state
   *
   * @param currentFiles - Map of file paths to their content
   * @param fileType - Type of files being synced
   */
  async computeDelta(
    currentFiles: Map<string, string>,
    fileType: 'code' | 'document' = 'code'
  ): Promise<SyncDelta> {
    await this.load();

    const delta: SyncDelta = {
      added: [],
      modified: [],
      deleted: [],
      unchanged: []
    };

    const currentPaths = new Set(currentFiles.keys());

    // Check each current file
    for (const [filePath, content] of currentFiles) {
      const contentHash = this.computeHash(content);
      const tracked = this.state!.files[filePath];

      if (!tracked) {
        // New file
        delta.added.push(filePath);
      } else if (tracked.contentHash !== contentHash) {
        // Modified file
        delta.modified.push(filePath);
      } else {
        // Unchanged
        delta.unchanged.push(filePath);
      }
    }

    // Check for deleted files
    for (const filePath of Object.keys(this.state!.files)) {
      const tracked = this.state!.files[filePath];
      if (tracked.type === fileType && !currentPaths.has(filePath)) {
        delta.deleted.push(filePath);
      }
    }

    return delta;
  }

  /**
   * Update tracked state for files that were synced
   *
   * @param files - Map of file paths to their content
   * @param fileType - Type of files
   */
  async markSynced(
    files: Map<string, string>,
    fileType: 'code' | 'document' = 'code'
  ): Promise<void> {
    await this.load();

    const now = new Date().toISOString();

    for (const [filePath, content] of files) {
      const contentHash = this.computeHash(content);

      this.state!.files[filePath] = {
        path: filePath,
        contentHash,
        lastSyncedAt: now,
        size: content.length,
        type: fileType
      };
    }

    this.state!.lastSyncedAt = now;
    this.dirty = true;
  }

  /**
   * Remove deleted files from tracking
   */
  async markDeleted(filePaths: string[]): Promise<void> {
    await this.load();

    for (const filePath of filePaths) {
      delete this.state!.files[filePath];
    }

    this.dirty = true;
  }

  /**
   * Update last commit that was synced
   */
  async setLastCommit(commit: string): Promise<void> {
    await this.load();
    this.state!.lastCommit = commit;
    this.dirty = true;
  }

  /**
   * Get last synced commit
   */
  async getLastCommit(): Promise<string | null> {
    await this.load();
    return this.state!.lastCommit || null;
  }

  /**
   * Get last sync timestamp
   */
  async getLastSyncTime(): Promise<Date | null> {
    await this.load();
    if (!this.state!.lastSyncedAt) return null;
    return new Date(this.state!.lastSyncedAt);
  }

  /**
   * Get tracked file info
   */
  async getTrackedFile(filePath: string): Promise<TrackedFile | null> {
    await this.load();
    return this.state!.files[filePath] || null;
  }

  /**
   * Get all tracked files of a type
   */
  async getTrackedFiles(fileType?: 'code' | 'document'): Promise<TrackedFile[]> {
    await this.load();

    const files = Object.values(this.state!.files);
    if (fileType) {
      return files.filter(f => f.type === fileType);
    }
    return files;
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    totalFiles: number;
    codeFiles: number;
    documentFiles: number;
    lastSyncedAt: string | null;
    lastCommit: string | null;
  }> {
    await this.load();

    const files = Object.values(this.state!.files);
    const codeFiles = files.filter(f => f.type === 'code').length;
    const documentFiles = files.filter(f => f.type === 'document').length;

    return {
      totalFiles: files.length,
      codeFiles,
      documentFiles,
      lastSyncedAt: this.state!.lastSyncedAt || null,
      lastCommit: this.state!.lastCommit || null
    };
  }

  /**
   * Check if a full sync is needed
   */
  async needsFullSync(): Promise<boolean> {
    await this.load();

    // Full sync needed if no previous sync
    if (!this.state!.lastSyncedAt) {
      return true;
    }

    // Full sync needed if no files tracked
    if (Object.keys(this.state!.files).length === 0) {
      return true;
    }

    return false;
  }

  /**
   * Reset tracking state (force full sync)
   */
  async reset(): Promise<void> {
    this.state = {
      version: '1.0',
      lastSyncedAt: '',
      lastCommit: '',
      files: {}
    };
    this.dirty = true;
    await this.save();
  }

  /**
   * Close and save pending changes, release lock
   */
  async close(): Promise<void> {
    try {
      await this.save();
    } finally {
      await this.releaseLock();
    }
  }
}

/**
 * Create a delta sync manager instance
 */
export function createDeltaSyncManager(repoRoot: string): DeltaSyncManager {
  return new DeltaSyncManager(repoRoot);
}

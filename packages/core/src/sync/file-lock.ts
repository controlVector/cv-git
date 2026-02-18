/**
 * File Locking Utility
 *
 * Provides exclusive file locking to prevent concurrent access to state files.
 * Uses a simple .lock file mechanism with timeout and stale lock detection.
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface LockOptions {
  /** Timeout in milliseconds to acquire lock (default: 30000) */
  timeout?: number;
  /** Interval to retry acquiring lock in milliseconds (default: 100) */
  retryInterval?: number;
  /** Time in milliseconds after which a lock is considered stale (default: 60000) */
  staleTimeout?: number;
}

export interface LockHandle {
  /** Release the lock */
  release: () => Promise<void>;
  /** Path to the locked file */
  filePath: string;
  /** Path to the lock file */
  lockPath: string;
}

const DEFAULT_OPTIONS: Required<LockOptions> = {
  timeout: 30000,
  retryInterval: 100,
  staleTimeout: 60000,
};

/**
 * Lock file content for debugging and stale detection
 */
interface LockContent {
  pid: number;
  hostname: string;
  createdAt: string;
}

/**
 * Acquire an exclusive lock on a file
 *
 * @param filePath - Path to the file to lock
 * @param options - Lock options
 * @returns Lock handle with release function
 * @throws Error if lock cannot be acquired within timeout
 */
export async function acquireLock(
  filePath: string,
  options: LockOptions = {}
): Promise<LockHandle> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lockPath = `${filePath}.lock`;
  const startTime = Date.now();

  while (true) {
    try {
      // Try to create lock file exclusively
      const lockContent: LockContent = {
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: new Date().toISOString(),
      };

      await fs.writeFile(lockPath, JSON.stringify(lockContent, null, 2), {
        flag: 'wx', // Exclusive create - fails if file exists
      });

      // Lock acquired successfully
      return {
        filePath,
        lockPath,
        release: async () => {
          try {
            await fs.unlink(lockPath);
          } catch (error: unknown) {
            // Ignore errors when releasing lock (file may already be gone)
            const err = error as NodeJS.ErrnoException;
            if (err.code !== 'ENOENT') {
              console.warn(`Warning: Failed to release lock ${lockPath}: ${err.message}`);
            }
          }
        },
      };
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') {
        // Unexpected error
        throw new Error(`Failed to create lock file: ${err.message}`);
      }

      // Lock file exists - check if it's stale
      try {
        const stat = await fs.stat(lockPath);
        const lockAge = Date.now() - stat.mtimeMs;

        if (lockAge > opts.staleTimeout) {
          // Lock is stale - try to remove it
          console.warn(`Removing stale lock file (${Math.round(lockAge / 1000)}s old): ${lockPath}`);
          try {
            await fs.unlink(lockPath);
            // Continue to retry acquiring the lock
          } catch (unlinkError: unknown) {
            // Another process may have removed it or acquired it
            const unlinkErr = unlinkError as NodeJS.ErrnoException;
            if (unlinkErr.code !== 'ENOENT') {
              console.warn(`Failed to remove stale lock: ${unlinkErr.message}`);
            }
          }
        }
      } catch (statError: unknown) {
        const statErr = statError as NodeJS.ErrnoException;
        if (statErr.code === 'ENOENT') {
          // Lock was removed by another process, retry
          continue;
        }
        // Unexpected stat error
        console.warn(`Failed to stat lock file: ${statErr.message}`);
      }

      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed >= opts.timeout) {
        throw new Error(
          `Failed to acquire lock on ${filePath} within ${opts.timeout}ms. ` +
          `Another process may be syncing. If you're sure no other process is running, ` +
          `delete the lock file: ${lockPath}`
        );
      }

      // Wait before retrying
      await sleep(opts.retryInterval);
    }
  }
}

/**
 * Execute a function while holding a lock
 *
 * @param filePath - Path to the file to lock
 * @param fn - Function to execute while holding the lock
 * @param options - Lock options
 * @returns Result of the function
 */
export async function withLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  options: LockOptions = {}
): Promise<T> {
  const lock = await acquireLock(filePath, options);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

/**
 * Check if a file is currently locked
 */
export async function isLocked(filePath: string): Promise<boolean> {
  const lockPath = `${filePath}.lock`;
  try {
    await fs.access(lockPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get info about an existing lock (for debugging)
 */
export async function getLockInfo(filePath: string): Promise<LockContent | null> {
  const lockPath = `${filePath}.lock`;
  try {
    const content = await fs.readFile(lockPath, 'utf-8');
    return JSON.parse(content) as LockContent;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

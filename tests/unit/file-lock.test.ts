/**
 * File Lock Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { acquireLock, withLock, isLocked, getLockInfo } from '../../packages/core/src/sync/file-lock.js';

describe('File Locking', () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-lock-test-'));
    testFile = path.join(tempDir, 'test-state.json');
    await fs.writeFile(testFile, '{}');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('acquireLock', () => {
    it('should acquire lock on unlocked file', async () => {
      const lock = await acquireLock(testFile);
      expect(lock).toBeDefined();
      expect(lock.filePath).toBe(testFile);
      expect(lock.lockPath).toBe(`${testFile}.lock`);

      // Verify lock file exists
      const exists = await isLocked(testFile);
      expect(exists).toBe(true);

      await lock.release();
    });

    it('should release lock correctly', async () => {
      const lock = await acquireLock(testFile);
      expect(await isLocked(testFile)).toBe(true);

      await lock.release();
      expect(await isLocked(testFile)).toBe(false);
    });

    it('should block second lock attempt', async () => {
      const lock1 = await acquireLock(testFile);

      // Second lock should timeout
      await expect(
        acquireLock(testFile, { timeout: 200, retryInterval: 50 })
      ).rejects.toThrow(/Failed to acquire lock/);

      await lock1.release();
    });

    it('should allow lock after previous is released', async () => {
      const lock1 = await acquireLock(testFile);
      await lock1.release();

      const lock2 = await acquireLock(testFile);
      expect(lock2).toBeDefined();
      await lock2.release();
    });

    it('should detect and remove stale locks', async () => {
      // Create a stale lock file manually
      const lockPath = `${testFile}.lock`;
      const staleContent = {
        pid: 99999,
        hostname: 'old-host',
        createdAt: new Date(Date.now() - 120000).toISOString(), // 2 minutes ago
      };
      await fs.writeFile(lockPath, JSON.stringify(staleContent));

      // Set the file's mtime to be 2 minutes in the past (stale)
      const staleTime = new Date(Date.now() - 120000);
      await fs.utimes(lockPath, staleTime, staleTime);

      // Should acquire lock by removing stale lock
      const lock = await acquireLock(testFile, { staleTimeout: 60000 });
      expect(lock).toBeDefined();

      // Verify lock info is now ours
      const info = await getLockInfo(testFile);
      expect(info?.pid).toBe(process.pid);

      await lock.release();
    });
  });

  describe('withLock', () => {
    it('should execute function while holding lock', async () => {
      let executed = false;

      await withLock(testFile, async () => {
        executed = true;
        expect(await isLocked(testFile)).toBe(true);
      });

      expect(executed).toBe(true);
      expect(await isLocked(testFile)).toBe(false);
    });

    it('should release lock even if function throws', async () => {
      await expect(
        withLock(testFile, async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      // Lock should be released
      expect(await isLocked(testFile)).toBe(false);
    });

    it('should return function result', async () => {
      const result = await withLock(testFile, async () => {
        return 42;
      });

      expect(result).toBe(42);
    });
  });

  describe('getLockInfo', () => {
    it('should return null for unlocked file', async () => {
      const info = await getLockInfo(testFile);
      expect(info).toBeNull();
    });

    it('should return lock info for locked file', async () => {
      const lock = await acquireLock(testFile);

      const info = await getLockInfo(testFile);
      expect(info).toBeDefined();
      expect(info?.pid).toBe(process.pid);
      expect(info?.hostname).toBe(os.hostname());
      expect(info?.createdAt).toBeDefined();

      await lock.release();
    });
  });
});

/**
 * Delta Sync Manager Unit Tests
 * Tests for efficient incremental syncing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createDeltaSyncManager, DeltaSyncManager } from '@cv-git/core';

describe('DeltaSyncManager', () => {
  let tempDir: string;
  let manager: DeltaSyncManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-delta-test-'));
    // Create .cv directory
    await fs.mkdir(path.join(tempDir, '.cv'), { recursive: true });
    manager = createDeltaSyncManager(tempDir);
  });

  afterEach(async () => {
    await manager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('computeDelta', () => {
    it('should detect new files', async () => {
      const files = new Map([
        ['src/index.ts', 'console.log("hello")'],
        ['src/utils.ts', 'export const foo = 1']
      ]);

      const delta = await manager.computeDelta(files, 'code');

      expect(delta.added).toHaveLength(2);
      expect(delta.modified).toHaveLength(0);
      expect(delta.deleted).toHaveLength(0);
      expect(delta.unchanged).toHaveLength(0);
    });

    it('should detect modified files', async () => {
      // First sync
      const files1 = new Map([
        ['src/index.ts', 'console.log("v1")']
      ]);
      await manager.computeDelta(files1, 'code');
      await manager.markSynced(files1, 'code');

      // Second sync with modified content
      const files2 = new Map([
        ['src/index.ts', 'console.log("v2")']
      ]);
      const delta = await manager.computeDelta(files2, 'code');

      expect(delta.added).toHaveLength(0);
      expect(delta.modified).toHaveLength(1);
      expect(delta.modified[0]).toBe('src/index.ts');
      expect(delta.unchanged).toHaveLength(0);
    });

    it('should detect deleted files', async () => {
      // First sync
      const files1 = new Map([
        ['src/index.ts', 'content1'],
        ['src/utils.ts', 'content2']
      ]);
      await manager.computeDelta(files1, 'code');
      await manager.markSynced(files1, 'code');

      // Second sync with file removed
      const files2 = new Map([
        ['src/index.ts', 'content1']
      ]);
      const delta = await manager.computeDelta(files2, 'code');

      expect(delta.deleted).toHaveLength(1);
      expect(delta.deleted[0]).toBe('src/utils.ts');
    });

    it('should detect unchanged files', async () => {
      const files = new Map([
        ['src/index.ts', 'same content']
      ]);

      await manager.computeDelta(files, 'code');
      await manager.markSynced(files, 'code');

      const delta = await manager.computeDelta(files, 'code');

      expect(delta.unchanged).toHaveLength(1);
      expect(delta.added).toHaveLength(0);
      expect(delta.modified).toHaveLength(0);
    });

    it('should detect mixed changes', async () => {
      // First sync
      const files1 = new Map([
        ['src/keep.ts', 'unchanged'],
        ['src/modify.ts', 'original'],
        ['src/delete.ts', 'to be deleted']
      ]);
      await manager.markSynced(files1, 'code');

      // Second sync
      const files2 = new Map([
        ['src/keep.ts', 'unchanged'],
        ['src/modify.ts', 'modified'],
        ['src/new.ts', 'brand new']
      ]);
      const delta = await manager.computeDelta(files2, 'code');

      expect(delta.unchanged).toHaveLength(1);
      expect(delta.modified).toHaveLength(1);
      expect(delta.added).toHaveLength(1);
      expect(delta.deleted).toHaveLength(1);
    });
  });

  describe('file types', () => {
    it('should track code and documents separately', async () => {
      const codeFiles = new Map([
        ['src/index.ts', 'code content']
      ]);
      const docFiles = new Map([
        ['docs/README.md', 'doc content']
      ]);

      await manager.markSynced(codeFiles, 'code');
      await manager.markSynced(docFiles, 'document');

      // Delete code file
      const delta = await manager.computeDelta(new Map(), 'code');
      expect(delta.deleted).toHaveLength(1);
      expect(delta.deleted[0]).toBe('src/index.ts');

      // Documents should be unaffected
      const docDelta = await manager.computeDelta(docFiles, 'document');
      expect(docDelta.unchanged).toHaveLength(1);
    });
  });

  describe('needsFullSync', () => {
    it('should return true on first run', async () => {
      const needsFull = await manager.needsFullSync();
      expect(needsFull).toBe(true);
    });

    it('should return false after syncing files', async () => {
      const files = new Map([
        ['src/index.ts', 'content']
      ]);
      await manager.markSynced(files, 'code');

      const needsFull = await manager.needsFullSync();
      expect(needsFull).toBe(false);
    });
  });

  describe('persistence', () => {
    it('should persist state across instances', async () => {
      const files = new Map([
        ['src/index.ts', 'content']
      ]);
      await manager.markSynced(files, 'code');
      await manager.close();

      // Create new instance
      const newManager = createDeltaSyncManager(tempDir);
      const delta = await newManager.computeDelta(files, 'code');

      expect(delta.unchanged).toHaveLength(1);
      expect(delta.added).toHaveLength(0);

      await newManager.close();
    });

    it('should persist last commit', async () => {
      await manager.setLastCommit('abc123');
      await manager.close();

      const newManager = createDeltaSyncManager(tempDir);
      const commit = await newManager.getLastCommit();

      expect(commit).toBe('abc123');

      await newManager.close();
    });
  });

  describe('markDeleted', () => {
    it('should remove files from tracking', async () => {
      const files = new Map([
        ['src/a.ts', 'a'],
        ['src/b.ts', 'b']
      ]);
      await manager.markSynced(files, 'code');

      await manager.markDeleted(['src/a.ts']);

      const tracked = await manager.getTrackedFiles('code');
      expect(tracked).toHaveLength(1);
      expect(tracked[0].path).toBe('src/b.ts');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const codeFiles = new Map([
        ['src/a.ts', 'a'],
        ['src/b.ts', 'b']
      ]);
      const docFiles = new Map([
        ['docs/README.md', 'readme']
      ]);

      await manager.markSynced(codeFiles, 'code');
      await manager.markSynced(docFiles, 'document');
      await manager.setLastCommit('xyz789');

      const stats = await manager.getStats();

      expect(stats.totalFiles).toBe(3);
      expect(stats.codeFiles).toBe(2);
      expect(stats.documentFiles).toBe(1);
      expect(stats.lastCommit).toBe('xyz789');
      expect(stats.lastSyncedAt).not.toBeNull();
    });
  });

  describe('reset', () => {
    it('should clear all tracking state', async () => {
      const files = new Map([
        ['src/index.ts', 'content']
      ]);
      await manager.markSynced(files, 'code');
      await manager.setLastCommit('abc123');

      await manager.reset();

      expect(await manager.needsFullSync()).toBe(true);
      expect(await manager.getLastCommit()).toBeNull();
    });
  });

  describe('getTrackedFile', () => {
    it('should return file info', async () => {
      const files = new Map([
        ['src/index.ts', 'console.log("test")']
      ]);
      await manager.markSynced(files, 'code');

      const tracked = await manager.getTrackedFile('src/index.ts');

      expect(tracked).not.toBeNull();
      expect(tracked?.path).toBe('src/index.ts');
      expect(tracked?.type).toBe('code');
      expect(tracked?.size).toBe(19); // 'console.log("test")' = 19 chars
      expect(tracked?.contentHash).toBeDefined();
    });

    it('should return null for untracked file', async () => {
      const tracked = await manager.getTrackedFile('nonexistent.ts');
      expect(tracked).toBeNull();
    });
  });

  describe('content hash consistency', () => {
    it('should produce same hash for same content', async () => {
      const content = 'same content';
      const files1 = new Map([['file1.ts', content]]);
      const files2 = new Map([['file2.ts', content]]);

      await manager.markSynced(files1, 'code');
      await manager.markSynced(files2, 'code');

      const tracked1 = await manager.getTrackedFile('file1.ts');
      const tracked2 = await manager.getTrackedFile('file2.ts');

      expect(tracked1?.contentHash).toBe(tracked2?.contentHash);
    });

    it('should produce different hash for different content', async () => {
      const files = new Map([
        ['file1.ts', 'content A'],
        ['file2.ts', 'content B']
      ]);
      await manager.markSynced(files, 'code');

      const tracked1 = await manager.getTrackedFile('file1.ts');
      const tracked2 = await manager.getTrackedFile('file2.ts');

      expect(tracked1?.contentHash).not.toBe(tracked2?.contentHash);
    });
  });
});

/**
 * Ingest Manager Unit Tests
 * Tests for document ingestion and archival
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createIngestManager, IngestManager } from '@cv-git/core';

describe('IngestManager', () => {
  let tempDir: string;
  let manager: IngestManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-ingest-test-'));
    manager = createIngestManager(tempDir);
  });

  afterEach(async () => {
    await manager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('ingest', () => {
    it('should ingest a new document', async () => {
      const content = '# Test Doc\n\nThis is a test document.';
      const result = await manager.ingest('docs/test.md', content);

      expect(result.status).toBe('created');
      expect(result.path).toBe('docs/test.md');
      expect(result.archived).toBe(false);
    });

    it('should store content in .cv/documents/', async () => {
      const content = '# Hello World\n\nContent here.';
      await manager.ingest('docs/hello.md', content);

      const storedPath = path.join(tempDir, '.cv', 'documents', 'docs', 'hello.md');
      const storedContent = await fs.readFile(storedPath, 'utf-8');

      expect(storedContent).toBe(content);
    });

    it('should update existing document', async () => {
      const content1 = '# Version 1';
      const content2 = '# Version 2';

      await manager.ingest('docs/update.md', content1);
      const result = await manager.ingest('docs/update.md', content2);

      expect(result.status).toBe('updated');

      const stored = await manager.getContent('docs/update.md');
      expect(stored).toBe(content2);
    });

    it('should detect unchanged content', async () => {
      const content = '# Same Content';

      await manager.ingest('docs/same.md', content);
      const result = await manager.ingest('docs/same.md', content);

      expect(result.status).toBe('unchanged');
    });

    it('should force re-ingest even if unchanged', async () => {
      const content = '# Same Content';

      await manager.ingest('docs/force.md', content);
      const result = await manager.ingest('docs/force.md', content, { force: true });

      expect(result.status).toBe('updated');
    });

    it('should ingest with archive option', async () => {
      const content = '# Archive Me';
      const result = await manager.ingest('docs/archive.md', content, { archive: true });

      expect(result.status).toBe('created');
      expect(result.archived).toBe(true);

      const entry = await manager.getEntry('docs/archive.md');
      expect(entry?.archived).toBe(true);
      expect(entry?.archivedAt).toBeDefined();
    });

    it('should track word count', async () => {
      const content = '# Title\n\nOne two three four five.';
      await manager.ingest('docs/words.md', content);

      const entry = await manager.getEntry('docs/words.md');
      expect(entry?.wordCount).toBe(7); // # Title One two three four five.
    });

    it('should track section count (H2 headings)', async () => {
      const content = '# Title\n\n## Section 1\n\nText\n\n## Section 2\n\nMore text';
      await manager.ingest('docs/sections.md', content);

      const entry = await manager.getEntry('docs/sections.md');
      expect(entry?.sectionCount).toBe(2);
    });

    it('should track git commit if provided', async () => {
      const content = '# Committed';
      await manager.ingest('docs/committed.md', content, { gitCommit: 'abc123' });

      const entry = await manager.getEntry('docs/committed.md');
      expect(entry?.gitCommit).toBe('abc123');
    });
  });

  describe('archive', () => {
    it('should archive an ingested document', async () => {
      await manager.ingest('docs/to-archive.md', '# Content');
      const result = await manager.archive('docs/to-archive.md');

      expect(result).toBe(true);
      expect(await manager.isArchived('docs/to-archive.md')).toBe(true);
    });

    it('should return false if already archived', async () => {
      await manager.ingest('docs/already.md', '# Content', { archive: true });
      const result = await manager.archive('docs/already.md');

      expect(result).toBe(false);
    });

    it('should throw if document not ingested', async () => {
      await expect(manager.archive('docs/nonexistent.md'))
        .rejects.toThrow('Document not ingested');
    });
  });

  describe('restore', () => {
    it('should restore archived document content', async () => {
      const content = '# Restore Me';
      await manager.ingest('docs/restore.md', content, { archive: true });

      const restored = await manager.restore('docs/restore.md');

      expect(restored).toBe(content);
      expect(await manager.isArchived('docs/restore.md')).toBe(false);
    });

    it('should return null for non-ingested document', async () => {
      const result = await manager.restore('docs/nonexistent.md');
      expect(result).toBeNull();
    });
  });

  describe('getContent', () => {
    it('should return stored content', async () => {
      const content = '# Get Me';
      await manager.ingest('docs/get.md', content);

      const stored = await manager.getContent('docs/get.md');
      expect(stored).toBe(content);
    });

    it('should return null for non-ingested document', async () => {
      const result = await manager.getContent('docs/missing.md');
      expect(result).toBeNull();
    });
  });

  describe('queries', () => {
    beforeEach(async () => {
      await manager.ingest('docs/active1.md', '# Active 1');
      await manager.ingest('docs/active2.md', '# Active 2');
      await manager.ingest('docs/archived1.md', '# Archived 1', { archive: true });
      await manager.ingest('docs/archived2.md', '# Archived 2', { archive: true });
    });

    it('should get all entries', async () => {
      const entries = await manager.getAllEntries();
      expect(entries).toHaveLength(4);
    });

    it('should get archived entries', async () => {
      const entries = await manager.getArchivedEntries();
      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.archived)).toBe(true);
    });

    it('should get active entries', async () => {
      const entries = await manager.getActiveEntries();
      expect(entries).toHaveLength(2);
      expect(entries.every(e => !e.archived)).toBe(true);
    });

    it('should check if ingested', async () => {
      expect(await manager.isIngested('docs/active1.md')).toBe(true);
      expect(await manager.isIngested('docs/missing.md')).toBe(false);
    });

    it('should check if archived', async () => {
      expect(await manager.isArchived('docs/archived1.md')).toBe(true);
      expect(await manager.isArchived('docs/active1.md')).toBe(false);
    });
  });

  describe('remove', () => {
    it('should remove ingested document', async () => {
      await manager.ingest('docs/remove.md', '# Remove');
      const result = await manager.remove('docs/remove.md');

      expect(result).toBe(true);
      expect(await manager.isIngested('docs/remove.md')).toBe(false);
    });

    it('should return false for non-ingested document', async () => {
      const result = await manager.remove('docs/nonexistent.md');
      expect(result).toBe(false);
    });

    it('should delete stored file', async () => {
      await manager.ingest('docs/delete.md', '# Delete');
      await manager.remove('docs/delete.md');

      const storedPath = path.join(tempDir, '.cv', 'documents', 'docs', 'delete.md');
      await expect(fs.access(storedPath)).rejects.toThrow();
    });
  });

  describe('stats', () => {
    it('should return correct statistics', async () => {
      await manager.ingest('docs/a.md', '# A\n\n## S1\n\nWord word');
      await manager.ingest('docs/b.md', '# B\n\n## S2\n\n## S3\n\nMore words here', { archive: true });

      const stats = await manager.getStats();

      expect(stats.total).toBe(2);
      expect(stats.archived).toBe(1);
      expect(stats.active).toBe(1);
      expect(stats.totalWords).toBeGreaterThan(0);
      expect(stats.totalSections).toBe(3);
    });
  });

  describe('persistence', () => {
    it('should persist data across instances', async () => {
      await manager.ingest('docs/persist.md', '# Persist', { archive: true });
      await manager.close();

      const newManager = createIngestManager(tempDir);
      const entry = await newManager.getEntry('docs/persist.md');

      expect(entry).not.toBeNull();
      expect(entry?.path).toBe('docs/persist.md');
      expect(entry?.archived).toBe(true);

      await newManager.close();
    });

    it('should write to ingestion.jsonl', async () => {
      await manager.ingest('docs/jsonl.md', '# JSONL');
      await manager.close();

      const indexPath = path.join(tempDir, '.cv', 'ingestion.jsonl');
      const content = await fs.readFile(indexPath, 'utf-8');

      expect(content).toContain('docs/jsonl.md');
    });
  });

  describe('export and import', () => {
    it('should export ingestion data', async () => {
      await manager.ingest('docs/export.md', '# Export');

      const exported = await manager.export();

      expect(exported.version).toBe('1.0');
      expect(exported.exportedAt).toBeDefined();
      expect(exported.entries).toHaveLength(1);
      expect(exported.entries[0].path).toBe('docs/export.md');
    });

    it('should import ingestion data', async () => {
      await manager.ingest('docs/existing.md', '# Existing');

      const newEntry = {
        path: 'docs/imported.md',
        ingestedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contentHash: 'abc123',
        archived: false,
        wordCount: 10,
        sectionCount: 1
      };

      const result = await manager.import({ entries: [newEntry] });

      expect(result.imported).toBe(1);
      expect(await manager.isIngested('docs/imported.md')).toBe(true);
    });

    it('should update newer entries on import', async () => {
      await manager.ingest('docs/update-import.md', '# Old');
      const entry = await manager.getEntry('docs/update-import.md');

      await new Promise(resolve => setTimeout(resolve, 10));

      const newerEntry = {
        ...entry!,
        updatedAt: new Date().toISOString(),
        wordCount: 999
      };

      const result = await manager.import({ entries: [newerEntry] });

      expect(result.updated).toBe(1);
      const updated = await manager.getEntry('docs/update-import.md');
      expect(updated?.wordCount).toBe(999);
    });

    it('should skip older entries on import', async () => {
      await manager.ingest('docs/skip.md', '# Skip');

      const olderEntry = {
        path: 'docs/skip.md',
        ingestedAt: '2020-01-01T00:00:00Z',
        updatedAt: '2020-01-01T00:00:00Z',
        contentHash: 'old',
        archived: false,
        wordCount: 1,
        sectionCount: 0
      };

      const result = await manager.import({ entries: [olderEntry] });

      expect(result.skipped).toBe(1);
    });
  });

  describe('nested paths', () => {
    it('should handle deeply nested paths', async () => {
      const content = '# Deep';
      await manager.ingest('docs/api/v2/auth/handlers.md', content);

      const stored = await manager.getContent('docs/api/v2/auth/handlers.md');
      expect(stored).toBe(content);

      const storedPath = path.join(tempDir, '.cv', 'documents', 'docs', 'api', 'v2', 'auth', 'handlers.md');
      await expect(fs.access(storedPath)).resolves.toBeUndefined();
    });
  });

  describe('content hash', () => {
    it('should generate consistent hash for same content', async () => {
      const content = '# Consistent';
      await manager.ingest('docs/hash1.md', content);
      await manager.ingest('docs/hash2.md', content);

      const entry1 = await manager.getEntry('docs/hash1.md');
      const entry2 = await manager.getEntry('docs/hash2.md');

      expect(entry1?.contentHash).toBe(entry2?.contentHash);
    });

    it('should generate different hash for different content', async () => {
      await manager.ingest('docs/diff1.md', '# Content A');
      await manager.ingest('docs/diff2.md', '# Content B');

      const entry1 = await manager.getEntry('docs/diff1.md');
      const entry2 = await manager.getEntry('docs/diff2.md');

      expect(entry1?.contentHash).not.toBe(entry2?.contentHash);
    });
  });
});

/**
 * Authored Metadata Manager Unit Tests
 * Tests for preserving human-authored relationships and metadata
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createAuthoredMetadataManager, AuthoredMetadataManager } from '@cv-git/core';

describe('AuthoredMetadataManager', () => {
  let tempDir: string;
  let manager: AuthoredMetadataManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-authored-test-'));
    manager = createAuthoredMetadataManager(tempDir);
  });

  afterEach(async () => {
    await manager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('document metadata', () => {
    it('should store document metadata', async () => {
      const entry = await manager.upsertDocumentMeta('docs/API.md', {
        type: 'api_doc',
        status: 'active',
        tags: ['api', 'v2'],
        author: 'developer'
      }, {
        title: 'API Documentation',
        inferredType: 'unknown'
      });

      expect(entry.id).toBeDefined();
      expect(entry.type).toBe('document_meta');
      expect(entry.path).toBe('docs/API.md');
      expect(entry.frontmatter.type).toBe('api_doc');
      expect(entry.effectiveType).toBe('api_doc');
    });

    it('should retrieve document metadata', async () => {
      await manager.upsertDocumentMeta('docs/DESIGN.md', {
        type: 'design_spec',
        status: 'draft'
      });

      const retrieved = await manager.getDocumentMeta('docs/DESIGN.md');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.frontmatter.type).toBe('design_spec');
      expect(retrieved?.status).toBe('draft');
    });

    it('should update existing metadata', async () => {
      await manager.upsertDocumentMeta('docs/README.md', {
        type: 'readme',
        status: 'draft'
      });

      await manager.upsertDocumentMeta('docs/README.md', {
        type: 'readme',
        status: 'active',
        tags: ['main']
      });

      const retrieved = await manager.getDocumentMeta('docs/README.md');

      expect(retrieved?.frontmatter.status).toBe('active');
      expect(retrieved?.frontmatter.tags).toContain('main');
    });

    it('should use inferred type when frontmatter type not set', async () => {
      const entry = await manager.upsertDocumentMeta('docs/guide.md', {
        status: 'active'
      }, {
        inferredType: 'guide'
      });

      expect(entry.effectiveType).toBe('guide');
      expect(entry.inferredType).toBe('guide');
    });
  });

  describe('relationships', () => {
    it('should add a DESCRIBES relationship', async () => {
      const entry = await manager.addRelationship(
        'docs/AUTH.md',
        'src/auth/handler.ts',
        'DESCRIBES',
        { properties: { section: 'Authentication' } }
      );

      expect(entry.id).toBeDefined();
      expect(entry.type).toBe('relationship');
      expect(entry.relationType).toBe('DESCRIBES');
      expect(entry.targetPath).toBe('src/auth/handler.ts');
    });

    it('should add a REFERENCES_DOC relationship', async () => {
      const entry = await manager.addRelationship(
        'docs/API.md',
        'docs/AUTH.md',
        'REFERENCES_DOC'
      );

      expect(entry.relationType).toBe('REFERENCES_DOC');
    });

    it('should add a SUPERSEDES relationship for ADRs', async () => {
      const entry = await manager.addRelationship(
        'adr/0002-new-approach.md',
        'adr/0001-old-approach.md',
        'SUPERSEDES'
      );

      expect(entry.relationType).toBe('SUPERSEDES');
    });

    it('should get outgoing relationships', async () => {
      await manager.addRelationship('docs/API.md', 'src/api/index.ts', 'DESCRIBES');
      await manager.addRelationship('docs/API.md', 'src/api/handlers.ts', 'DESCRIBES');
      await manager.addRelationship('docs/API.md', 'docs/AUTH.md', 'REFERENCES_DOC');

      const relationships = await manager.getRelationships('docs/API.md');

      expect(relationships).toHaveLength(3);
      expect(relationships.filter(r => r.relationType === 'DESCRIBES')).toHaveLength(2);
    });

    it('should get incoming relationships', async () => {
      await manager.addRelationship('docs/API.md', 'src/auth/handler.ts', 'DESCRIBES');
      await manager.addRelationship('docs/DESIGN.md', 'src/auth/handler.ts', 'DESCRIBES');

      const incoming = await manager.getIncomingRelationships('src/auth/handler.ts');

      expect(incoming).toHaveLength(2);
    });

    it('should not duplicate relationships', async () => {
      await manager.addRelationship('docs/A.md', 'docs/B.md', 'REFERENCES_DOC');
      await manager.addRelationship('docs/A.md', 'docs/B.md', 'REFERENCES_DOC');

      const relationships = await manager.getRelationships('docs/A.md');

      expect(relationships).toHaveLength(1);
    });
  });

  describe('annotations', () => {
    it('should add an annotation', async () => {
      const entry = await manager.addAnnotation(
        'src/auth/handler.ts',
        'security_note',
        'This function handles sensitive data, ensure proper validation',
        { line: 42, metadata: { severity: 'high' } }
      );

      expect(entry.id).toBeDefined();
      expect(entry.type).toBe('annotation');
      expect(entry.annotationType).toBe('security_note');
      expect(entry.line).toBe(42);
    });

    it('should get annotations for a path', async () => {
      await manager.addAnnotation('src/api.ts', 'todo', 'Add rate limiting');
      await manager.addAnnotation('src/api.ts', 'review', 'Needs security review');
      await manager.addAnnotation('src/other.ts', 'todo', 'Other file');

      const annotations = await manager.getAnnotations('src/api.ts');

      expect(annotations).toHaveLength(2);
    });
  });

  describe('persistence', () => {
    it('should persist data across instances', async () => {
      await manager.upsertDocumentMeta('docs/test.md', {
        type: 'guide',
        status: 'active'
      });
      await manager.addRelationship('docs/test.md', 'src/test.ts', 'DESCRIBES');
      await manager.close();

      // Create new instance
      const newManager = createAuthoredMetadataManager(tempDir);

      const meta = await newManager.getDocumentMeta('docs/test.md');
      const rels = await newManager.getRelationships('docs/test.md');

      expect(meta).not.toBeNull();
      expect(meta?.frontmatter.type).toBe('guide');
      expect(rels).toHaveLength(1);

      await newManager.close();
    });

    it('should handle empty file gracefully', async () => {
      // No data saved yet
      const meta = await manager.getDocumentMeta('nonexistent.md');
      expect(meta).toBeNull();
    });
  });

  describe('deletion', () => {
    it('should delete entry by ID', async () => {
      const entry = await manager.upsertDocumentMeta('docs/delete-me.md', {
        type: 'guide'
      });

      const deleted = await manager.deleteEntry(entry.id);

      expect(deleted).toBe(true);
      expect(await manager.getDocumentMeta('docs/delete-me.md')).toBeNull();
    });

    it('should delete all entries for a path', async () => {
      await manager.upsertDocumentMeta('docs/old.md', { type: 'guide' });
      await manager.addRelationship('docs/old.md', 'src/test.ts', 'DESCRIBES');
      await manager.addAnnotation('docs/old.md', 'note', 'Some note');

      const deleted = await manager.deleteEntriesForPath('docs/old.md');

      expect(deleted).toBe(3);
      expect(await manager.getDocumentMeta('docs/old.md')).toBeNull();
      expect(await manager.getRelationships('docs/old.md')).toHaveLength(0);
    });

    it('should also delete relationships targeting a deleted path', async () => {
      await manager.addRelationship('docs/A.md', 'docs/B.md', 'REFERENCES_DOC');

      await manager.deleteEntriesForPath('docs/B.md');

      const rels = await manager.getRelationships('docs/A.md');
      expect(rels).toHaveLength(0);
    });
  });

  describe('statistics', () => {
    it('should track entry counts', async () => {
      await manager.upsertDocumentMeta('docs/A.md', { type: 'guide' });
      await manager.upsertDocumentMeta('docs/B.md', { type: 'readme' });
      await manager.addRelationship('docs/A.md', 'src/a.ts', 'DESCRIBES');
      await manager.addAnnotation('src/a.ts', 'note', 'Test');

      const stats = await manager.getStats();

      expect(stats.documentMeta).toBe(2);
      expect(stats.relationships).toBe(1);
      expect(stats.annotations).toBe(1);
    });
  });

  describe('export and import', () => {
    it('should export all entries', async () => {
      await manager.upsertDocumentMeta('docs/test.md', { type: 'guide' });
      await manager.addRelationship('docs/test.md', 'src/test.ts', 'DESCRIBES');

      const exported = await manager.export();

      expect(exported.version).toBe('1.0');
      expect(exported.entries).toHaveLength(2);
    });

    it('should import entries into fresh manager', async () => {
      await manager.upsertDocumentMeta('docs/test.md', { type: 'guide' });
      const exported = await manager.export();
      await manager.close();

      // Create new manager in different directory
      const newTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-import-test-'));
      const newManager = createAuthoredMetadataManager(newTempDir);

      const result = await newManager.import(exported);

      expect(result.imported).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);

      const meta = await newManager.getDocumentMeta('docs/test.md');
      expect(meta).not.toBeNull();

      await newManager.close();
      await fs.rm(newTempDir, { recursive: true, force: true });
    });

    it('should update newer entries on import', async () => {
      const entry = await manager.upsertDocumentMeta('docs/test.md', {
        type: 'guide',
        status: 'draft'
      });

      // Simulate time passing and update
      await new Promise(resolve => setTimeout(resolve, 10));

      const newerEntry = {
        ...entry,
        updatedAt: new Date().toISOString(),
        frontmatter: { type: 'guide' as const, status: 'active' as const }
      };

      const result = await manager.import({ entries: [newerEntry] });

      expect(result.updated).toBe(1);
    });
  });

  describe('sync with filesystem', () => {
    it('should remove entries for deleted files', async () => {
      await manager.upsertDocumentMeta('docs/exists.md', { type: 'guide' });
      await manager.upsertDocumentMeta('docs/deleted.md', { type: 'readme' });

      const existingPaths = new Set(['docs/exists.md']);
      const result = await manager.syncWithFilesystem(existingPaths);

      expect(result.removed).toBe(1);
      expect(await manager.getDocumentMeta('docs/exists.md')).not.toBeNull();
      expect(await manager.getDocumentMeta('docs/deleted.md')).toBeNull();
    });
  });

  describe('getEntriesByType', () => {
    it('should filter entries by type', async () => {
      await manager.upsertDocumentMeta('docs/A.md', { type: 'guide' });
      await manager.upsertDocumentMeta('docs/B.md', { type: 'readme' });
      await manager.addRelationship('docs/A.md', 'src/a.ts', 'DESCRIBES');

      const docMetas = await manager.getEntriesByType('document_meta');
      const relationships = await manager.getEntriesByType('relationship');

      expect(docMetas).toHaveLength(2);
      expect(relationships).toHaveLength(1);
    });
  });
});

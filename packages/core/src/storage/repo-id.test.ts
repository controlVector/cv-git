/**
 * Unit tests for Repository ID Generation
 */

import { describe, it, expect } from 'vitest';
import {
  generateRepoId,
  getGraphDatabaseName,
  getVectorCollectionName,
  getRepositoryInfo
} from './repo-id.js';
import * as path from 'path';
import * as os from 'os';

describe('Repository ID Generation', () => {
  describe('generateRepoId', () => {
    it('should generate a 12-character hex string', () => {
      const repoId = generateRepoId('/tmp/test-repo');
      expect(repoId).toMatch(/^[a-f0-9]{12}$/);
    });

    it('should generate deterministic IDs for the same path', () => {
      const repoPath = '/tmp/test-repo-deterministic';
      const id1 = generateRepoId(repoPath);
      const id2 = generateRepoId(repoPath);
      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different paths', () => {
      const id1 = generateRepoId('/tmp/repo-a');
      const id2 = generateRepoId('/tmp/repo-b');
      expect(id1).not.toBe(id2);
    });

    it('should handle paths with special characters', () => {
      const repoId = generateRepoId('/tmp/test repo with spaces');
      expect(repoId).toMatch(/^[a-f0-9]{12}$/);
    });

    it('should handle relative paths by resolving them', () => {
      // Relative paths get resolved to absolute, so same relative path = same ID
      const id1 = generateRepoId('.');
      const id2 = generateRepoId(process.cwd());
      expect(id1).toBe(id2);
    });
  });

  describe('getGraphDatabaseName', () => {
    it('should prefix repoId with cv_', () => {
      const dbName = getGraphDatabaseName('abc123def456');
      expect(dbName).toBe('cv_abc123def456');
    });

    it('should handle empty string', () => {
      const dbName = getGraphDatabaseName('');
      expect(dbName).toBe('cv_');
    });

    it('should produce valid database names', () => {
      const repoId = generateRepoId('/tmp/test');
      const dbName = getGraphDatabaseName(repoId);
      // Database names should be alphanumeric with underscore
      expect(dbName).toMatch(/^cv_[a-f0-9]{12}$/);
    });
  });

  describe('getVectorCollectionName', () => {
    it('should prefix collection with repoId', () => {
      const collectionName = getVectorCollectionName('abc123', 'code_chunks');
      expect(collectionName).toBe('abc123_code_chunks');
    });

    it('should work with different collection names', () => {
      const repoId = 'test123';
      expect(getVectorCollectionName(repoId, 'code_chunks')).toBe('test123_code_chunks');
      expect(getVectorCollectionName(repoId, 'docstrings')).toBe('test123_docstrings');
      expect(getVectorCollectionName(repoId, 'commits')).toBe('test123_commits');
      expect(getVectorCollectionName(repoId, 'document_chunks')).toBe('test123_document_chunks');
    });

    it('should produce valid collection names', () => {
      const repoId = generateRepoId('/tmp/test');
      const collectionName = getVectorCollectionName(repoId, 'code_chunks');
      // Collection names should be alphanumeric with underscore
      expect(collectionName).toMatch(/^[a-f0-9]{12}_code_chunks$/);
    });
  });

  describe('getRepositoryInfo', () => {
    it('should return repository info with id, name, and root', () => {
      const testPath = path.join(os.tmpdir(), 'test-repo-info');
      const info = getRepositoryInfo(testPath);

      expect(info).toHaveProperty('id');
      expect(info).toHaveProperty('name');
      expect(info).toHaveProperty('root');
      expect(info.id).toMatch(/^[a-f0-9]{12}$/);
      expect(info.name).toBe('test-repo-info');
      expect(info.root).toBe(testPath);
    });

    it('should extract name from path correctly', () => {
      const info = getRepositoryInfo('/home/user/projects/my-awesome-project');
      expect(info.name).toBe('my-awesome-project');
    });
  });

  describe('isolation guarantees', () => {
    it('should ensure different repos get different database names', () => {
      const repoA = '/projects/repo-a';
      const repoB = '/projects/repo-b';

      const dbNameA = getGraphDatabaseName(generateRepoId(repoA));
      const dbNameB = getGraphDatabaseName(generateRepoId(repoB));

      expect(dbNameA).not.toBe(dbNameB);
    });

    it('should ensure different repos get different collection names', () => {
      const repoA = '/projects/repo-a';
      const repoB = '/projects/repo-b';

      const idA = generateRepoId(repoA);
      const idB = generateRepoId(repoB);

      const collectionA = getVectorCollectionName(idA, 'code_chunks');
      const collectionB = getVectorCollectionName(idB, 'code_chunks');

      expect(collectionA).not.toBe(collectionB);
    });

    it('should maintain consistency across function calls', () => {
      const repoPath = '/projects/consistent-repo';

      // Multiple calls should return same values
      const id1 = generateRepoId(repoPath);
      const id2 = generateRepoId(repoPath);

      const db1 = getGraphDatabaseName(id1);
      const db2 = getGraphDatabaseName(id2);

      const col1 = getVectorCollectionName(id1, 'code_chunks');
      const col2 = getVectorCollectionName(id2, 'code_chunks');

      expect(id1).toBe(id2);
      expect(db1).toBe(db2);
      expect(col1).toBe(col2);
    });
  });
});

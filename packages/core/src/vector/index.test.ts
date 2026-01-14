/**
 * Unit tests for VectorManager Repository Isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VectorManager, VectorManagerOptions, createVectorManager } from './index.js';

// Mock Qdrant client to avoid actual connections
vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: vi.fn().mockImplementation(() => ({
    getCollections: vi.fn().mockResolvedValue({ collections: [] }),
    createCollection: vi.fn().mockResolvedValue(undefined),
    deleteCollection: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
    getCollection: vi.fn().mockResolvedValue({ config: { params: { vectors: { size: 768 } } } })
  }))
}));

// Mock OpenAI
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [{ embedding: new Array(768).fill(0) }]
      })
    }
  }))
}));

// Mock embedding cache
vi.mock('./embedding-cache.js', () => ({
  createEmbeddingCache: vi.fn(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    getBatch: vi.fn().mockResolvedValue({ cached: new Map(), missing: [] }),
    setBatch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockResolvedValue({ totalEntries: 0, hitRate: 0 })
  })),
  EmbeddingCache: vi.fn()
}));

describe('VectorManager Repository Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor with repoId', () => {
    it('should use repo-specific collection names when repoId is provided', () => {
      const manager = new VectorManager({
        url: 'http://localhost:6333',
        repoId: 'abc123def456',
        ollamaUrl: 'http://localhost:11434'
      });

      const collections = manager.getCollectionNames();
      expect(collections.codeChunks).toBe('abc123def456_code_chunks');
      expect(collections.docstrings).toBe('abc123def456_docstrings');
      expect(collections.commits).toBe('abc123def456_commits');
      expect(collections.documentChunks).toBe('abc123def456_document_chunks');
    });

    it('should return repoId via getter', () => {
      const manager = new VectorManager({
        url: 'http://localhost:6333',
        repoId: 'my-test-repo',
        ollamaUrl: 'http://localhost:11434'
      });

      expect(manager.getRepoId()).toBe('my-test-repo');
    });
  });

  describe('constructor without repoId (shared mode)', () => {
    it('should use default collection names when repoId is not provided', () => {
      const manager = new VectorManager({
        url: 'http://localhost:6333',
        ollamaUrl: 'http://localhost:11434'
      });

      const collections = manager.getCollectionNames();
      expect(collections.codeChunks).toBe('code_chunks');
      expect(collections.docstrings).toBe('docstrings');
      expect(collections.commits).toBe('commits');
      expect(collections.documentChunks).toBe('document_chunks');
    });

    it('should return undefined for repoId when not using isolation', () => {
      const manager = new VectorManager({
        url: 'http://localhost:6333',
        ollamaUrl: 'http://localhost:11434'
      });

      expect(manager.getRepoId()).toBeUndefined();
    });
  });

  describe('constructor with explicit collections', () => {
    it('should use explicit collections over repoId-based naming', () => {
      const manager = new VectorManager({
        url: 'http://localhost:6333',
        repoId: 'should-be-ignored-for-collections',
        collections: {
          codeChunks: 'custom_code',
          docstrings: 'custom_docs',
          commits: 'custom_commits',
          documentChunks: 'custom_doc_chunks'
        },
        ollamaUrl: 'http://localhost:11434'
      });

      const collections = manager.getCollectionNames();
      expect(collections.codeChunks).toBe('custom_code');
      expect(collections.docstrings).toBe('custom_docs');
      expect(collections.commits).toBe('custom_commits');
      expect(collections.documentChunks).toBe('custom_doc_chunks');
    });
  });

  describe('createVectorManager factory', () => {
    it('should create manager with options object including repoId', () => {
      const manager = createVectorManager({
        url: 'http://localhost:6333',
        repoId: 'factory-test',
        ollamaUrl: 'http://localhost:11434'
      });

      const collections = manager.getCollectionNames();
      expect(collections.codeChunks).toBe('factory-test_code_chunks');
    });

    it('should create manager without repoId (shared mode)', () => {
      const manager = createVectorManager({
        url: 'http://localhost:6333',
        ollamaUrl: 'http://localhost:11434'
      });

      const collections = manager.getCollectionNames();
      expect(collections.codeChunks).toBe('code_chunks');
    });
  });

  describe('collection isolation', () => {
    it('should create different collections for different repos', () => {
      const managerA = new VectorManager({
        url: 'http://localhost:6333',
        repoId: 'repo-aaa',
        ollamaUrl: 'http://localhost:11434'
      });

      const managerB = new VectorManager({
        url: 'http://localhost:6333',
        repoId: 'repo-bbb',
        ollamaUrl: 'http://localhost:11434'
      });

      const collectionsA = managerA.getCollectionNames();
      const collectionsB = managerB.getCollectionNames();

      expect(collectionsA.codeChunks).not.toBe(collectionsB.codeChunks);
      expect(collectionsA.codeChunks).toBe('repo-aaa_code_chunks');
      expect(collectionsB.codeChunks).toBe('repo-bbb_code_chunks');
    });

    it('should create same collection names for same repoId', () => {
      const manager1 = new VectorManager({
        url: 'http://localhost:6333',
        repoId: 'same-repo',
        ollamaUrl: 'http://localhost:11434'
      });

      const manager2 = new VectorManager({
        url: 'http://localhost:6333',
        repoId: 'same-repo',
        ollamaUrl: 'http://localhost:11434'
      });

      const collections1 = manager1.getCollectionNames();
      const collections2 = manager2.getCollectionNames();

      expect(collections1.codeChunks).toBe(collections2.codeChunks);
      expect(collections1.docstrings).toBe(collections2.docstrings);
      expect(collections1.commits).toBe(collections2.commits);
      expect(collections1.documentChunks).toBe(collections2.documentChunks);
    });
  });

  describe('all collection types', () => {
    it('should prefix all four collection types with repoId', () => {
      const repoId = 'test-all-collections';
      const manager = new VectorManager({
        url: 'http://localhost:6333',
        repoId,
        ollamaUrl: 'http://localhost:11434'
      });

      const collections = manager.getCollectionNames();

      // Verify all four collections are prefixed
      expect(collections.codeChunks).toBe(`${repoId}_code_chunks`);
      expect(collections.docstrings).toBe(`${repoId}_docstrings`);
      expect(collections.commits).toBe(`${repoId}_commits`);
      expect(collections.documentChunks).toBe(`${repoId}_document_chunks`);
    });
  });

  describe('getCollectionNames', () => {
    it('should return a copy of collections, not the internal object', () => {
      const manager = new VectorManager({
        url: 'http://localhost:6333',
        repoId: 'copy-test',
        ollamaUrl: 'http://localhost:11434'
      });

      const collections1 = manager.getCollectionNames();
      const collections2 = manager.getCollectionNames();

      // Should be equal in value
      expect(collections1).toEqual(collections2);

      // But not the same object reference
      expect(collections1).not.toBe(collections2);
    });
  });

  describe('backward compatibility', () => {
    it('should support legacy constructor signature', () => {
      // Legacy: new VectorManager(url, apiKey, collections, model)
      const manager = new VectorManager(
        'http://localhost:6333',
        'fake-api-key',
        { codeChunks: 'legacy_code' }
      );

      const collections = manager.getCollectionNames();
      expect(collections.codeChunks).toBe('legacy_code');
      expect(manager.getRepoId()).toBeUndefined();
    });
  });
});

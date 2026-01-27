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

describe('VectorManager Level-Aware Search', () => {
  let manager: VectorManager;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new VectorManager({
      url: 'http://localhost:6333',
      repoId: 'test-repo',
      ollamaUrl: 'http://localhost:11434'
    });

    // Create a mock client and inject it directly
    mockClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      createCollection: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
      getCollection: vi.fn().mockResolvedValue({ config: { params: { vectors: { size: 768 } } } })
    };
    (manager as any).client = mockClient;
  });

  describe('searchByLevel', () => {
    it('should filter by hierarchy level', async () => {
      // Mock search to return level-specific results
      mockClient.search.mockResolvedValueOnce([
        {
          id: 'point_1',
          score: 0.9,
          payload: {
            _id: 'file:src/index.ts',
            level: 2,
            path: 'src/index.ts',
            summary: 'Main entry point',
            file: 'src/index.ts',
            language: 'typescript'
          }
        }
      ]);

      // Mock embeddings
      vi.spyOn(manager, 'embed').mockResolvedValueOnce(new Array(768).fill(0));

      const results = await manager.searchByLevel('entry point', 2, { limit: 10 });

      expect(mockClient.search).toHaveBeenCalled();
      // Verify the filter includes level
      const searchCall = mockClient.search.mock.calls[0];
      expect(searchCall[1].filter.must).toContainEqual(
        expect.objectContaining({ key: 'level', match: { value: 2 } })
      );
    });

    it('should filter by path prefix when provided', async () => {
      mockClient.search.mockResolvedValueOnce([]);
      vi.spyOn(manager, 'embed').mockResolvedValueOnce(new Array(768).fill(0));

      await manager.searchByLevel('test', 2, { limit: 10, path: 'src/services/' });

      const searchCall = mockClient.search.mock.calls[0];
      // Should have both level and path filters
      expect(searchCall[1].filter.must.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('searchHierarchical', () => {
    it('should search multiple levels from high to low', async () => {
      // Mock search for each level
      mockClient.search.mockResolvedValue([]);
      vi.spyOn(manager, 'embed').mockResolvedValue(new Array(768).fill(0));

      const results = await manager.searchHierarchical('authentication', {
        startLevel: 3,
        endLevel: 1
      });

      // Should return a Map with results for levels 3, 2, 1
      expect(results).toBeInstanceOf(Map);
      expect(results.has(3)).toBe(true);
      expect(results.has(2)).toBe(true);
      expect(results.has(1)).toBe(true);
    });

    it('should use default levels when not specified', async () => {
      mockClient.search.mockResolvedValue([]);
      vi.spyOn(manager, 'embed').mockResolvedValue(new Array(768).fill(0));

      const results = await manager.searchHierarchical('test');

      // Default is startLevel=3, endLevel=1
      expect(results.has(3)).toBe(true);
      expect(results.has(2)).toBe(true);
      expect(results.has(1)).toBe(true);
    });
  });

  describe('getSummary', () => {
    it('should fetch summary by ID', async () => {
      mockClient.scroll.mockResolvedValueOnce({
        points: [
          {
            id: 'point_1',
            payload: {
              _id: 'file:src/index.ts',
              level: 2,
              summary: 'Main entry point',
              file: 'src/index.ts',
              language: 'typescript'
            }
          }
        ],
        next_page_offset: null
      });

      const result = await manager.getSummary('file:src/index.ts');

      expect(result).not.toBeNull();
      expect(result!.summary).toBe('Main entry point');
    });

    it('should return null when summary not found', async () => {
      mockClient.scroll.mockResolvedValueOnce({
        points: [],
        next_page_offset: null
      });

      const result = await manager.getSummary('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getSummaryChildren', () => {
    it('should fetch children summaries by parent ID', async () => {
      mockClient.scroll.mockResolvedValueOnce({
        points: [
          {
            id: 'child_1',
            payload: {
              _id: 'symbol:src/index.ts:main',
              level: 1,
              parent: 'file:src/index.ts',
              summary: 'Main function'
            }
          },
          {
            id: 'child_2',
            payload: {
              _id: 'symbol:src/index.ts:init',
              level: 1,
              parent: 'file:src/index.ts',
              summary: 'Init function'
            }
          }
        ],
        next_page_offset: null
      });

      const results = await manager.getSummaryChildren('file:src/index.ts');

      expect(results).toHaveLength(2);
      expect(results[0].payload.parent).toBe('file:src/index.ts');
    });

    it('should return empty array when no children', async () => {
      mockClient.scroll.mockResolvedValueOnce({
        points: [],
        next_page_offset: null
      });

      const results = await manager.getSummaryChildren('file:empty.ts');

      expect(results).toEqual([]);
    });
  });
});

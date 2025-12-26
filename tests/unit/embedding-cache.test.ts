/**
 * Embedding Cache Unit Tests
 * Tests for content-addressed embedding storage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EmbeddingCache, createEmbeddingCache } from '@cv-git/core';

describe('EmbeddingCache', () => {
  let tempDir: string;
  let cache: EmbeddingCache;

  beforeEach(async () => {
    // Create temp directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-cache-test-'));
    cache = createEmbeddingCache({
      cacheDir: tempDir,
      model: 'openai/text-embedding-3-small',
      dimensions: 1536
    });
    await cache.initialize();
  });

  afterEach(async () => {
    await cache.close();
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('computeEmbeddingId', () => {
    it('should generate consistent IDs for same text and model', () => {
      const id1 = EmbeddingCache.computeEmbeddingId('hello world', 'model-a');
      const id2 = EmbeddingCache.computeEmbeddingId('hello world', 'model-a');
      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different text', () => {
      const id1 = EmbeddingCache.computeEmbeddingId('hello world', 'model-a');
      const id2 = EmbeddingCache.computeEmbeddingId('goodbye world', 'model-a');
      expect(id1).not.toBe(id2);
    });

    it('should generate different IDs for different models', () => {
      const id1 = EmbeddingCache.computeEmbeddingId('hello world', 'model-a');
      const id2 = EmbeddingCache.computeEmbeddingId('hello world', 'model-b');
      expect(id1).not.toBe(id2);
    });

    it('should normalize whitespace', () => {
      const id1 = EmbeddingCache.computeEmbeddingId('hello   world', 'model-a');
      const id2 = EmbeddingCache.computeEmbeddingId('hello world', 'model-a');
      expect(id1).toBe(id2);
    });

    it('should trim leading/trailing whitespace', () => {
      const id1 = EmbeddingCache.computeEmbeddingId('  hello world  ', 'model-a');
      const id2 = EmbeddingCache.computeEmbeddingId('hello world', 'model-a');
      expect(id1).toBe(id2);
    });

    it('should return 16-character hex string', () => {
      const id = EmbeddingCache.computeEmbeddingId('test', 'model');
      expect(id).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('set and get', () => {
    it('should store and retrieve embeddings', async () => {
      const text = 'test embedding';
      const vector = Array.from({ length: 1536 }, (_, i) => i * 0.001);

      await cache.set(text, vector);
      const retrieved = await cache.get(text);

      expect(retrieved).not.toBeNull();
      expect(retrieved).toHaveLength(1536);
      expect(retrieved![0]).toBeCloseTo(vector[0], 5);
      expect(retrieved![100]).toBeCloseTo(vector[100], 5);
    });

    it('should return null for missing embeddings', async () => {
      const result = await cache.get('nonexistent text');
      expect(result).toBeNull();
    });

    it('should handle multiple embeddings', async () => {
      const texts = ['text one', 'text two', 'text three'];
      const vectors = texts.map((_, i) =>
        Array.from({ length: 1536 }, (_, j) => (i + 1) * j * 0.0001)
      );

      for (let i = 0; i < texts.length; i++) {
        await cache.set(texts[i], vectors[i]);
      }

      for (let i = 0; i < texts.length; i++) {
        const retrieved = await cache.get(texts[i]);
        expect(retrieved).not.toBeNull();
        expect(retrieved![0]).toBeCloseTo(vectors[i][0], 5);
      }
    });

    it('should update access stats on get', async () => {
      const text = 'test text';
      const vector = Array.from({ length: 1536 }, () => Math.random());

      await cache.set(text, vector);

      const statsBefore = await cache.getStats();
      expect(statsBefore.cacheHits).toBe(0);

      await cache.get(text);

      const statsAfter = await cache.getStats();
      expect(statsAfter.cacheHits).toBe(1);
    });
  });

  describe('has', () => {
    it('should return true for existing embeddings', async () => {
      const text = 'exists';
      await cache.set(text, Array.from({ length: 1536 }, () => 0.5));

      expect(await cache.has(text)).toBe(true);
    });

    it('should return false for missing embeddings', async () => {
      expect(await cache.has('does not exist')).toBe(false);
    });
  });

  describe('getBatch', () => {
    it('should return cached and missing separately', async () => {
      // Add some embeddings
      await cache.set('cached1', Array.from({ length: 1536 }, () => 0.1));
      await cache.set('cached2', Array.from({ length: 1536 }, () => 0.2));

      const texts = ['cached1', 'missing1', 'cached2', 'missing2'];
      const result = await cache.getBatch(texts);

      expect(result.cached.size).toBe(2);
      expect(result.missing).toHaveLength(2);
      expect(result.missing).toContain('missing1');
      expect(result.missing).toContain('missing2');
      expect(result.cached.has('cached1')).toBe(true);
      expect(result.cached.has('cached2')).toBe(true);
    });

    it('should return all as missing when cache is empty', async () => {
      const texts = ['a', 'b', 'c'];
      const result = await cache.getBatch(texts);

      expect(result.cached.size).toBe(0);
      expect(result.missing).toHaveLength(3);
    });

    it('should include embedding IDs in result', async () => {
      await cache.set('text1', Array.from({ length: 1536 }, () => 0.1));

      const result = await cache.getBatch(['text1', 'text2']);

      expect(result.ids.has('text1')).toBe(true);
      expect(result.ids.has('text2')).toBe(true);
      expect(result.ids.get('text1')).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('setBatch', () => {
    it('should store multiple embeddings', async () => {
      const embeddings = new Map<string, number[]>();
      embeddings.set('batch1', Array.from({ length: 1536 }, () => 0.1));
      embeddings.set('batch2', Array.from({ length: 1536 }, () => 0.2));
      embeddings.set('batch3', Array.from({ length: 1536 }, () => 0.3));

      const ids = await cache.setBatch(embeddings);

      expect(ids.size).toBe(3);
      expect(await cache.has('batch1')).toBe(true);
      expect(await cache.has('batch2')).toBe(true);
      expect(await cache.has('batch3')).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should track total entries', async () => {
      await cache.set('a', Array.from({ length: 1536 }, () => 0.1));
      await cache.set('b', Array.from({ length: 1536 }, () => 0.2));

      const stats = await cache.getStats();
      expect(stats.totalEntries).toBe(2);
    });

    it('should track storage size', async () => {
      await cache.set('a', Array.from({ length: 1536 }, () => 0.1));

      const stats = await cache.getStats();
      // 1536 floats * 4 bytes = 6144 bytes
      expect(stats.totalSizeBytes).toBeGreaterThanOrEqual(6144);
    });

    it('should track cache hits and misses', async () => {
      await cache.set('exists', Array.from({ length: 1536 }, () => 0.1));

      await cache.get('exists');  // hit
      await cache.get('exists');  // hit
      await cache.get('nope');    // miss

      const stats = await cache.getStats();
      expect(stats.cacheHits).toBe(2);
      expect(stats.cacheMisses).toBe(1);
    });

    it('should calculate hit rate', async () => {
      await cache.set('exists', Array.from({ length: 1536 }, () => 0.1));

      await cache.get('exists');  // hit
      await cache.get('exists');  // hit
      await cache.get('nope');    // miss
      await cache.get('nope2');   // miss

      const stats = await cache.getStats();
      expect(stats.hitRate).toBeCloseTo(0.5, 2);
    });

    it('should include model info', async () => {
      const stats = await cache.getStats();
      expect(stats.model).toBe('openai/text-embedding-3-small');
      expect(stats.dimensions).toBe(1536);
    });
  });

  describe('export and import', () => {
    it('should export embeddings', async () => {
      await cache.set('text1', Array.from({ length: 1536 }, (_, i) => i * 0.001));
      await cache.set('text2', Array.from({ length: 1536 }, (_, i) => i * 0.002));

      const exported = await cache.export();

      expect(exported.version).toBe('1.0');
      expect(exported.model).toBe('openai/text-embedding-3-small');
      expect(exported.embeddings).toHaveLength(2);
      expect(exported.embeddings[0].vector).toHaveLength(1536);
    });

    it('should export specific embeddings by ID', async () => {
      const id1 = await cache.set('text1', Array.from({ length: 1536 }, () => 0.1));
      await cache.set('text2', Array.from({ length: 1536 }, () => 0.2));

      const exported = await cache.export([id1]);

      expect(exported.embeddings).toHaveLength(1);
      expect(exported.embeddings[0].id).toBe(id1);
    });

    it('should import embeddings into fresh cache', async () => {
      // Export from original cache
      await cache.set('text1', Array.from({ length: 1536 }, (_, i) => i * 0.001));
      const exported = await cache.export();

      // Create new cache and import
      const newTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-cache-import-'));
      const newCache = createEmbeddingCache({
        cacheDir: newTempDir,
        model: 'openai/text-embedding-3-small',
        dimensions: 1536
      });
      await newCache.initialize();

      const result = await newCache.import(exported);

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);

      const stats = await newCache.getStats();
      expect(stats.totalEntries).toBe(1);

      await newCache.close();
      await fs.rm(newTempDir, { recursive: true, force: true });
    });

    it('should skip already existing embeddings on import', async () => {
      await cache.set('text1', Array.from({ length: 1536 }, () => 0.1));
      const exported = await cache.export();

      // Import into same cache (should skip)
      const result = await cache.import(exported);

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('should reject import with model mismatch', async () => {
      const wrongModelData = {
        model: 'different-model',
        embeddings: [{ id: 'abc', textHash: 'def', vector: [0.1] }]
      };

      await expect(cache.import(wrongModelData)).rejects.toThrow('Model mismatch');
    });
  });

  describe('clear', () => {
    it('should remove all embeddings', async () => {
      await cache.set('a', Array.from({ length: 1536 }, () => 0.1));
      await cache.set('b', Array.from({ length: 1536 }, () => 0.2));

      await cache.clear();

      const stats = await cache.getStats();
      expect(stats.totalEntries).toBe(0);
      expect(await cache.has('a')).toBe(false);
      expect(await cache.has('b')).toBe(false);
    });

    it('should reset statistics', async () => {
      await cache.set('a', Array.from({ length: 1536 }, () => 0.1));
      await cache.get('a');

      await cache.clear();

      const stats = await cache.getStats();
      expect(stats.cacheHits).toBe(0);
      expect(stats.cacheMisses).toBe(0);
      expect(stats.totalSizeBytes).toBe(0);
    });
  });

  describe('evictLRU', () => {
    it('should evict least recently used entries', async () => {
      // Add several embeddings
      await cache.set('old1', Array.from({ length: 1536 }, () => 0.1));
      await cache.set('old2', Array.from({ length: 1536 }, () => 0.2));
      await cache.set('new1', Array.from({ length: 1536 }, () => 0.3));

      // Access new1 to make it recently used
      await cache.get('new1');

      // Evict to keep only 1 entry worth of space (6144 bytes)
      const evicted = await cache.evictLRU(6144);

      expect(evicted).toBe(2);  // Should evict old1 and old2
      expect(await cache.has('new1')).toBe(true);
    });

    it('should not evict if under target size', async () => {
      await cache.set('a', Array.from({ length: 1536 }, () => 0.1));

      const evicted = await cache.evictLRU(100000);  // Large target

      expect(evicted).toBe(0);
    });
  });

  describe('persistence', () => {
    it('should persist data across cache instances', async () => {
      // Store data
      await cache.set('persistent', Array.from({ length: 1536 }, (_, i) => i * 0.001));
      await cache.close();

      // Create new instance with same directory
      const newCache = createEmbeddingCache({
        cacheDir: tempDir,
        model: 'openai/text-embedding-3-small',
        dimensions: 1536
      });
      await newCache.initialize();

      const retrieved = await newCache.get('persistent');
      expect(retrieved).not.toBeNull();
      expect(retrieved![0]).toBeCloseTo(0, 5);
      expect(retrieved![100]).toBeCloseTo(0.1, 5);

      await newCache.close();
    });

    it('should start fresh if model changes', async () => {
      await cache.set('data', Array.from({ length: 1536 }, () => 0.1));
      await cache.close();

      // Create new instance with different model
      const newCache = createEmbeddingCache({
        cacheDir: tempDir,
        model: 'different-model',
        dimensions: 768
      });
      await newCache.initialize();

      // Should start fresh (model mismatch warning logged)
      const stats = await newCache.getStats();
      expect(stats.totalEntries).toBe(0);

      await newCache.close();
    });
  });
});

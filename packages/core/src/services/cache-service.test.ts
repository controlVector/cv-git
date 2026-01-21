/**
 * Unit tests for CacheService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CacheService,
  createCacheService,
  getGlobalCache,
  resetGlobalCache,
  MemoryCacheStats,
  AllMemoryCacheStats
} from './cache-service.js';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetGlobalCache();
    cache = createCacheService({ maxSize: 100, ttl: 60000 });
  });

  afterEach(() => {
    resetGlobalCache();
  });

  describe('constructor and factory', () => {
    it('should create a cache service with default options', () => {
      const service = createCacheService();
      expect(service).toBeInstanceOf(CacheService);
    });

    it('should create a cache service with custom options', () => {
      const service = createCacheService({ maxSize: 50, ttl: 30000 });
      expect(service).toBeInstanceOf(CacheService);

      const stats = service.getStats('graph');
      expect(stats.maxSize).toBe(50);
    });
  });

  describe('global cache singleton', () => {
    it('should return the same instance on multiple calls', () => {
      const cache1 = getGlobalCache();
      const cache2 = getGlobalCache();
      expect(cache1).toBe(cache2);
    });

    it('should reset the global cache', () => {
      const cache1 = getGlobalCache();
      cache1.getOrComputeGraph('test', async () => 'value');

      resetGlobalCache();

      const cache2 = getGlobalCache();
      expect(cache1).not.toBe(cache2);
      expect(cache2.getStats('graph').size).toBe(0);
    });
  });

  describe('CacheService.key', () => {
    it('should generate consistent keys for same arguments', () => {
      const key1 = CacheService.key('findPath', 'funcA', 'funcB');
      const key2 = CacheService.key('findPath', 'funcA', 'funcB');
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different arguments', () => {
      const key1 = CacheService.key('findPath', 'funcA', 'funcB');
      const key2 = CacheService.key('findPath', 'funcA', 'funcC');
      expect(key1).not.toBe(key2);
    });

    it('should handle object arguments', () => {
      const key1 = CacheService.key('method', { a: 1, b: 2 });
      const key2 = CacheService.key('method', { b: 2, a: 1 });
      // Object keys should be sorted for consistency
      expect(key1).toBe(key2);
    });

    it('should handle null and undefined', () => {
      const key1 = CacheService.key('method', null);
      const key2 = CacheService.key('method', undefined);
      expect(key1).toContain('null');
      expect(key2).toContain('undefined');
    });

    it('should handle arrays', () => {
      const key = CacheService.key('method', [1, 2, 3]);
      expect(key).toContain('[1,2,3]');
    });
  });

  describe('getOrComputeGraph', () => {
    it('should compute and cache value on first call', async () => {
      const compute = vi.fn().mockResolvedValue({ result: 'data' });

      const result = await cache.getOrComputeGraph('key1', compute);

      expect(result).toEqual({ result: 'data' });
      expect(compute).toHaveBeenCalledTimes(1);
    });

    it('should return cached value on subsequent calls', async () => {
      const compute = vi.fn().mockResolvedValue({ result: 'data' });

      await cache.getOrComputeGraph('key1', compute);
      const result = await cache.getOrComputeGraph('key1', compute);

      expect(result).toEqual({ result: 'data' });
      expect(compute).toHaveBeenCalledTimes(1);
    });

    it('should track hits and misses', async () => {
      const compute = vi.fn().mockResolvedValue('value');

      await cache.getOrComputeGraph('key1', compute); // miss
      await cache.getOrComputeGraph('key1', compute); // hit
      await cache.getOrComputeGraph('key2', compute); // miss
      await cache.getOrComputeGraph('key1', compute); // hit

      const stats = cache.getStats('graph');
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
    });
  });

  describe('getOrComputeVector', () => {
    it('should cache vector operations separately', async () => {
      const graphCompute = vi.fn().mockResolvedValue('graph-data');
      const vectorCompute = vi.fn().mockResolvedValue('vector-data');

      await cache.getOrComputeGraph('key1', graphCompute);
      await cache.getOrComputeVector('key1', vectorCompute);

      // Same key, different namespace - both should be called
      expect(graphCompute).toHaveBeenCalledTimes(1);
      expect(vectorCompute).toHaveBeenCalledTimes(1);
    });

    it('should track vector cache stats separately', async () => {
      const compute = vi.fn().mockResolvedValue('value');

      await cache.getOrComputeVector('key1', compute);
      await cache.getOrComputeVector('key1', compute);

      const graphStats = cache.getStats('graph');
      const vectorStats = cache.getStats('vector');

      expect(graphStats.hits).toBe(0);
      expect(vectorStats.hits).toBe(1);
      expect(vectorStats.misses).toBe(1);
    });
  });

  describe('getOrComputeAI', () => {
    it('should cache AI responses', async () => {
      const compute = vi.fn().mockResolvedValue('AI response');

      await cache.getOrComputeAI('prompt-hash', compute);
      const result = await cache.getOrComputeAI('prompt-hash', compute);

      expect(result).toBe('AI response');
      expect(compute).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOrCompute (generic)', () => {
    it('should route to correct namespace', async () => {
      const compute = vi.fn().mockResolvedValue('value');

      await cache.getOrCompute('graph', 'key1', compute);
      await cache.getOrCompute('vector', 'key2', compute);
      await cache.getOrCompute('ai', 'key3', compute);

      expect(cache.getStats('graph').misses).toBe(1);
      expect(cache.getStats('vector').misses).toBe(1);
      expect(cache.getStats('ai').misses).toBe(1);
    });
  });

  describe('has', () => {
    it('should return false for non-existent key', () => {
      expect(cache.has('graph', 'nonexistent')).toBe(false);
    });

    it('should return true for cached key', async () => {
      await cache.getOrComputeGraph('key1', async () => 'value');
      expect(cache.has('graph', 'key1')).toBe(true);
    });

    it('should check correct namespace', async () => {
      await cache.getOrComputeGraph('key1', async () => 'value');

      expect(cache.has('graph', 'key1')).toBe(true);
      expect(cache.has('vector', 'key1')).toBe(false);
      expect(cache.has('ai', 'key1')).toBe(false);
    });
  });

  describe('invalidate', () => {
    it('should remove a specific key', async () => {
      await cache.getOrComputeGraph('key1', async () => 'value1');
      await cache.getOrComputeGraph('key2', async () => 'value2');

      cache.invalidate('graph', 'key1');

      expect(cache.has('graph', 'key1')).toBe(false);
      expect(cache.has('graph', 'key2')).toBe(true);
    });

    it('should only affect the specified namespace', async () => {
      await cache.getOrComputeGraph('key1', async () => 'graph-value');
      await cache.getOrComputeVector('key1', async () => 'vector-value');

      cache.invalidate('graph', 'key1');

      expect(cache.has('graph', 'key1')).toBe(false);
      expect(cache.has('vector', 'key1')).toBe(true);
    });
  });

  describe('invalidatePattern', () => {
    it('should remove keys matching pattern', async () => {
      await cache.getOrComputeGraph('findPath:funcA:funcB', async () => 'value1');
      await cache.getOrComputeGraph('findPath:funcA:funcC', async () => 'value2');
      await cache.getOrComputeGraph('getNeighborhood:funcA', async () => 'value3');

      const count = cache.invalidatePattern('graph', 'findPath:funcA');

      expect(count).toBe(2);
      expect(cache.has('graph', 'findPath:funcA:funcB')).toBe(false);
      expect(cache.has('graph', 'findPath:funcA:funcC')).toBe(false);
      expect(cache.has('graph', 'getNeighborhood:funcA')).toBe(true);
    });
  });

  describe('clearNamespace', () => {
    it('should clear all entries in a namespace', async () => {
      await cache.getOrComputeGraph('key1', async () => 'value1');
      await cache.getOrComputeGraph('key2', async () => 'value2');
      await cache.getOrComputeVector('key3', async () => 'value3');

      cache.clearNamespace('graph');

      expect(cache.getStats('graph').size).toBe(0);
      expect(cache.getStats('vector').size).toBe(1);
    });

    it('should reset hits and misses for the namespace', async () => {
      await cache.getOrComputeGraph('key1', async () => 'value');
      await cache.getOrComputeGraph('key1', async () => 'value');

      expect(cache.getStats('graph').hits).toBe(1);
      expect(cache.getStats('graph').misses).toBe(1);

      cache.clearNamespace('graph');

      expect(cache.getStats('graph').hits).toBe(0);
      expect(cache.getStats('graph').misses).toBe(0);
    });
  });

  describe('clearAll', () => {
    it('should clear all namespaces', async () => {
      await cache.getOrComputeGraph('key1', async () => 'value1');
      await cache.getOrComputeVector('key2', async () => 'value2');
      await cache.getOrComputeAI('key3', async () => 'value3');

      cache.clearAll();

      expect(cache.getStats('graph').size).toBe(0);
      expect(cache.getStats('vector').size).toBe(0);
      expect(cache.getStats('ai').size).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      await cache.getOrComputeGraph('key1', async () => 'value1');
      await cache.getOrComputeGraph('key2', async () => 'value2');
      await cache.getOrComputeGraph('key1', async () => 'value1'); // hit

      const stats = cache.getStats('graph');

      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(100);
      expect(stats.hitRate).toBe(33); // 1/3 = 33%
    });

    it('should return 0 hit rate when no requests', () => {
      const stats = cache.getStats('graph');
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('getAllStats', () => {
    it('should return combined statistics', async () => {
      await cache.getOrComputeGraph('g1', async () => 'g');
      await cache.getOrComputeGraph('g1', async () => 'g'); // hit
      await cache.getOrComputeVector('v1', async () => 'v');
      await cache.getOrComputeAI('a1', async () => 'a');

      const stats = cache.getAllStats();

      expect(stats.graph.hits).toBe(1);
      expect(stats.graph.misses).toBe(1);
      expect(stats.vector.misses).toBe(1);
      expect(stats.ai.misses).toBe(1);
      expect(stats.total.hits).toBe(1);
      expect(stats.total.misses).toBe(3);
      expect(stats.total.size).toBe(3);
      expect(stats.total.hitRate).toBe(25); // 1/4 = 25%
    });
  });

  describe('getEntries', () => {
    it('should return list of cached entries', async () => {
      await cache.getOrComputeGraph('key1', async () => 'value1');
      await cache.getOrComputeGraph('key2', async () => 'value2');

      const entries = cache.getEntries('graph');

      expect(entries).toHaveLength(2);
      expect(entries.map(e => e.key)).toContain('key1');
      expect(entries.map(e => e.key)).toContain('key2');
    });

    it('should include TTL information', async () => {
      await cache.getOrComputeGraph('key1', async () => 'value1');

      const entries = cache.getEntries('graph');

      expect(entries[0].age).toBeGreaterThan(0);
      expect(entries[0].age).toBeLessThanOrEqual(60000);
    });
  });

  describe('MemoryCacheStats interface', () => {
    it('should have correct structure', () => {
      const stats: MemoryCacheStats = {
        hits: 10,
        misses: 5,
        size: 15,
        maxSize: 100,
        hitRate: 67
      };

      expect(stats.hits).toBe(10);
      expect(stats.misses).toBe(5);
      expect(stats.size).toBe(15);
      expect(stats.maxSize).toBe(100);
      expect(stats.hitRate).toBe(67);
    });
  });

  describe('AllMemoryCacheStats interface', () => {
    it('should have correct structure', () => {
      const stats: AllMemoryCacheStats = {
        graph: { hits: 10, misses: 5, size: 15, maxSize: 100, hitRate: 67 },
        vector: { hits: 5, misses: 10, size: 8, maxSize: 100, hitRate: 33 },
        ai: { hits: 2, misses: 3, size: 5, maxSize: 100, hitRate: 40 },
        total: { hits: 17, misses: 18, size: 28, maxSize: 300, hitRate: 49 }
      };

      expect(stats.graph.hits).toBe(10);
      expect(stats.vector.misses).toBe(10);
      expect(stats.ai.size).toBe(5);
      expect(stats.total.hitRate).toBe(49);
    });
  });

  describe('error handling', () => {
    it('should propagate compute errors', async () => {
      const compute = vi.fn().mockRejectedValue(new Error('Compute failed'));

      await expect(cache.getOrComputeGraph('key1', compute)).rejects.toThrow('Compute failed');
    });

    it('should not cache failed computations', async () => {
      const compute = vi.fn()
        .mockRejectedValueOnce(new Error('First failed'))
        .mockResolvedValueOnce('success');

      await expect(cache.getOrComputeGraph('key1', compute)).rejects.toThrow();
      const result = await cache.getOrComputeGraph('key1', compute);

      expect(result).toBe('success');
      expect(compute).toHaveBeenCalledTimes(2);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entries when max size is reached', async () => {
      const smallCache = createCacheService({ maxSize: 3, ttl: 60000 });

      await smallCache.getOrComputeGraph('key1', async () => 'value1');
      await smallCache.getOrComputeGraph('key2', async () => 'value2');
      await smallCache.getOrComputeGraph('key3', async () => 'value3');
      await smallCache.getOrComputeGraph('key4', async () => 'value4');

      const stats = smallCache.getStats('graph');
      expect(stats.size).toBe(3);

      // key1 should have been evicted
      expect(smallCache.has('graph', 'key1')).toBe(false);
      expect(smallCache.has('graph', 'key4')).toBe(true);
    });
  });
});

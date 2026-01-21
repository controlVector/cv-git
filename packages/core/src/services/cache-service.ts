/**
 * Cache Service
 *
 * Provides LRU caching for graph, vector, and AI queries to improve performance.
 * Supports namespaced caches, TTL, and statistics tracking.
 */

import { LRUCache } from 'lru-cache';

// ========== Type Definitions ==========

/**
 * Cache statistics
 */
export interface MemoryCacheStats {
  /** Total number of cache hits */
  hits: number;
  /** Total number of cache misses */
  misses: number;
  /** Current number of items in cache */
  size: number;
  /** Maximum cache capacity */
  maxSize: number;
  /** Hit rate as percentage (0-100) */
  hitRate: number;
}

/**
 * Cache options
 */
export interface CacheOptions {
  /** Maximum number of items in cache (default: 1000) */
  maxSize?: number;
  /** Time-to-live in milliseconds (default: 5 minutes) */
  ttl?: number;
}

/**
 * Namespaced cache statistics
 */
export interface AllMemoryCacheStats {
  graph: MemoryCacheStats;
  vector: MemoryCacheStats;
  ai: MemoryCacheStats;
  total: MemoryCacheStats;
}

// ========== CacheService Implementation ==========

export class CacheService {
  private graphCache: LRUCache<string, any>;
  private vectorCache: LRUCache<string, any>;
  private aiCache: LRUCache<string, any>;

  private graphHits = 0;
  private graphMisses = 0;
  private vectorHits = 0;
  private vectorMisses = 0;
  private aiHits = 0;
  private aiMisses = 0;

  constructor(options: CacheOptions = {}) {
    const maxSize = options.maxSize || 1000;
    const ttl = options.ttl || 5 * 60 * 1000; // 5 minutes default

    const cacheOptions = {
      max: maxSize,
      ttl,
      updateAgeOnGet: true,
      updateAgeOnHas: true
    };

    this.graphCache = new LRUCache(cacheOptions);
    this.vectorCache = new LRUCache(cacheOptions);
    this.aiCache = new LRUCache(cacheOptions);
  }

  /**
   * Generate a cache key from function name and arguments
   */
  static key(fn: string, ...args: any[]): string {
    // Create a deterministic key from arguments
    const argsStr = args
      .map(arg => {
        if (arg === undefined) return 'undefined';
        if (arg === null) return 'null';
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, Object.keys(arg).sort());
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(':');

    return `${fn}:${argsStr}`;
  }

  /**
   * Get a value from graph cache or compute it
   */
  async getOrComputeGraph<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const cached = this.graphCache.get(key);
    if (cached !== undefined) {
      this.graphHits++;
      return cached as T;
    }

    this.graphMisses++;
    const value = await compute();
    this.graphCache.set(key, value);
    return value;
  }

  /**
   * Get a value from vector cache or compute it
   */
  async getOrComputeVector<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const cached = this.vectorCache.get(key);
    if (cached !== undefined) {
      this.vectorHits++;
      return cached as T;
    }

    this.vectorMisses++;
    const value = await compute();
    this.vectorCache.set(key, value);
    return value;
  }

  /**
   * Get a value from AI cache or compute it
   */
  async getOrComputeAI<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const cached = this.aiCache.get(key);
    if (cached !== undefined) {
      this.aiHits++;
      return cached as T;
    }

    this.aiMisses++;
    const value = await compute();
    this.aiCache.set(key, value);
    return value;
  }

  /**
   * Generic get or compute with namespace
   */
  async getOrCompute<T>(
    namespace: 'graph' | 'vector' | 'ai',
    key: string,
    compute: () => Promise<T>
  ): Promise<T> {
    switch (namespace) {
      case 'graph':
        return this.getOrComputeGraph(key, compute);
      case 'vector':
        return this.getOrComputeVector(key, compute);
      case 'ai':
        return this.getOrComputeAI(key, compute);
    }
  }

  /**
   * Check if a key exists in cache
   */
  has(namespace: 'graph' | 'vector' | 'ai', key: string): boolean {
    switch (namespace) {
      case 'graph':
        return this.graphCache.has(key);
      case 'vector':
        return this.vectorCache.has(key);
      case 'ai':
        return this.aiCache.has(key);
    }
  }

  /**
   * Invalidate a specific key
   */
  invalidate(namespace: 'graph' | 'vector' | 'ai', key: string): void {
    switch (namespace) {
      case 'graph':
        this.graphCache.delete(key);
        break;
      case 'vector':
        this.vectorCache.delete(key);
        break;
      case 'ai':
        this.aiCache.delete(key);
        break;
    }
  }

  /**
   * Invalidate all keys matching a pattern
   */
  invalidatePattern(namespace: 'graph' | 'vector' | 'ai', pattern: string): number {
    const cache = this.getCache(namespace);
    let count = 0;

    for (const key of cache.keys()) {
      if (key.includes(pattern)) {
        cache.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Clear a specific cache namespace
   */
  clearNamespace(namespace: 'graph' | 'vector' | 'ai'): void {
    switch (namespace) {
      case 'graph':
        this.graphCache.clear();
        this.graphHits = 0;
        this.graphMisses = 0;
        break;
      case 'vector':
        this.vectorCache.clear();
        this.vectorHits = 0;
        this.vectorMisses = 0;
        break;
      case 'ai':
        this.aiCache.clear();
        this.aiHits = 0;
        this.aiMisses = 0;
        break;
    }
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.clearNamespace('graph');
    this.clearNamespace('vector');
    this.clearNamespace('ai');
  }

  /**
   * Get statistics for a specific cache
   */
  getStats(namespace: 'graph' | 'vector' | 'ai'): MemoryCacheStats {
    const cache = this.getCache(namespace);
    const { hits, misses } = this.getHitsMisses(namespace);
    const total = hits + misses;

    return {
      hits,
      misses,
      size: cache.size,
      maxSize: cache.max,
      hitRate: total > 0 ? Math.round((hits / total) * 100) : 0
    };
  }

  /**
   * Get statistics for all caches
   */
  getAllStats(): AllMemoryCacheStats {
    const graph = this.getStats('graph');
    const vector = this.getStats('vector');
    const ai = this.getStats('ai');

    const totalHits = graph.hits + vector.hits + ai.hits;
    const totalMisses = graph.misses + vector.misses + ai.misses;
    const totalRequests = totalHits + totalMisses;

    return {
      graph,
      vector,
      ai,
      total: {
        hits: totalHits,
        misses: totalMisses,
        size: graph.size + vector.size + ai.size,
        maxSize: graph.maxSize + vector.maxSize + ai.maxSize,
        hitRate: totalRequests > 0 ? Math.round((totalHits / totalRequests) * 100) : 0
      }
    };
  }

  /**
   * Get cache entries for debugging
   */
  getEntries(namespace: 'graph' | 'vector' | 'ai'): Array<{ key: string; age: number }> {
    const cache = this.getCache(namespace);
    const entries: Array<{ key: string; age: number }> = [];

    for (const key of cache.keys()) {
      const remaining = cache.getRemainingTTL(key);
      entries.push({ key, age: remaining });
    }

    return entries;
  }

  // ========== Private Helpers ==========

  private getCache(namespace: 'graph' | 'vector' | 'ai'): LRUCache<string, any> {
    switch (namespace) {
      case 'graph':
        return this.graphCache;
      case 'vector':
        return this.vectorCache;
      case 'ai':
        return this.aiCache;
    }
  }

  private getHitsMisses(namespace: 'graph' | 'vector' | 'ai'): { hits: number; misses: number } {
    switch (namespace) {
      case 'graph':
        return { hits: this.graphHits, misses: this.graphMisses };
      case 'vector':
        return { hits: this.vectorHits, misses: this.vectorMisses };
      case 'ai':
        return { hits: this.aiHits, misses: this.aiMisses };
    }
  }
}

// ========== Singleton Instance ==========

let globalCache: CacheService | null = null;

/**
 * Get the global cache service instance
 */
export function getGlobalCache(): CacheService {
  if (!globalCache) {
    globalCache = new CacheService();
  }
  return globalCache;
}

/**
 * Create a new cache service instance
 */
export function createCacheService(options?: CacheOptions): CacheService {
  return new CacheService(options);
}

/**
 * Reset the global cache (useful for testing)
 */
export function resetGlobalCache(): void {
  if (globalCache) {
    globalCache.clearAll();
  }
  globalCache = null;
}

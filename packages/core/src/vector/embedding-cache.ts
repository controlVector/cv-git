/**
 * Content-Addressed Embedding Cache
 *
 * Implements deduplication for vector embeddings using content-based hashing.
 * Same text + same model = same embedding ID = stored once.
 *
 * Storage structure:
 * .cv/
 * └── embeddings/
 *     ├── index.json           # Maps embedding_id → metadata
 *     └── vectors/
 *         └── {embedding_id}.bin  # Binary float32 vector data
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export interface EmbeddingMetadata {
  id: string;
  model: string;
  dimensions: number;
  createdAt: string;
  accessCount: number;
  lastAccessed: string;
  textHash: string;  // Hash of original text (for verification)
}

export interface EmbeddingIndex {
  version: string;
  model: string;
  entries: Record<string, EmbeddingMetadata>;
  stats: {
    totalEntries: number;
    totalSizeBytes: number;
    cacheHits: number;
    cacheMisses: number;
    lastUpdated: string;
  };
}

export interface CacheStats {
  totalEntries: number;
  totalSizeBytes: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  model: string;
  dimensions: number;
}

export interface EmbeddingCacheConfig {
  cacheDir: string;           // Base directory for cache (e.g., .cv/embeddings)
  model: string;              // Embedding model name
  dimensions: number;         // Vector dimensions
  maxSizeBytes?: number;      // Max cache size (optional, for eviction)
}

/**
 * Content-addressed embedding cache
 *
 * Key insight: embeddings are deterministic - same text + same model = same vector.
 * We exploit this for deduplication across developers and branches.
 */
export class EmbeddingCache {
  private config: Required<EmbeddingCacheConfig>;
  private index: EmbeddingIndex | null = null;
  private indexPath: string;
  private vectorsDir: string;
  private dirty = false;

  constructor(config: EmbeddingCacheConfig) {
    this.config = {
      ...config,
      maxSizeBytes: config.maxSizeBytes ?? 1024 * 1024 * 1024  // 1GB default
    };
    this.indexPath = path.join(config.cacheDir, 'index.json');
    this.vectorsDir = path.join(config.cacheDir, 'vectors');
  }

  /**
   * Compute a content-addressed embedding ID
   *
   * The ID is derived from:
   * - The text content (normalized)
   * - The embedding model name
   *
   * This ensures same content = same ID across all users/branches.
   */
  static computeEmbeddingId(text: string, model: string): string {
    const normalizedText = text.trim().replace(/\s+/g, ' ');
    const content = `${model}:${normalizedText}`;
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Compute a hash of the text for verification
   */
  private computeTextHash(text: string): string {
    const normalizedText = text.trim().replace(/\s+/g, ' ');
    return createHash('sha256').update(normalizedText).digest('hex').substring(0, 32);
  }

  /**
   * Initialize the cache, creating directories and loading index
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.vectorsDir, { recursive: true });
    await this.loadIndex();
  }

  /**
   * Load the index from disk
   */
  private async loadIndex(): Promise<void> {
    try {
      const data = await fs.readFile(this.indexPath, 'utf-8');
      this.index = JSON.parse(data);

      // Validate index version and model
      if (this.index && this.index.model !== this.config.model) {
        console.warn(`Cache model mismatch: ${this.index.model} vs ${this.config.model}, starting fresh`);
        this.index = null;
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.warn(`Failed to load embedding cache index: ${error.message}`);
      }
    }

    if (!this.index) {
      this.index = {
        version: '1.0',
        model: this.config.model,
        entries: {},
        stats: {
          totalEntries: 0,
          totalSizeBytes: 0,
          cacheHits: 0,
          cacheMisses: 0,
          lastUpdated: new Date().toISOString()
        }
      };
      this.dirty = true;
    }
  }

  /**
   * Save the index to disk
   */
  async saveIndex(): Promise<void> {
    if (!this.dirty || !this.index) return;

    this.index.stats.lastUpdated = new Date().toISOString();
    await fs.writeFile(this.indexPath, JSON.stringify(this.index, null, 2));
    this.dirty = false;
  }

  /**
   * Check if an embedding exists in cache
   */
  async has(text: string): Promise<boolean> {
    if (!this.index) await this.initialize();

    const id = EmbeddingCache.computeEmbeddingId(text, this.config.model);
    return id in this.index!.entries;
  }

  /**
   * Get an embedding from cache
   * Returns null if not found
   */
  async get(text: string): Promise<number[] | null> {
    if (!this.index) await this.initialize();

    const id = EmbeddingCache.computeEmbeddingId(text, this.config.model);
    const metadata = this.index!.entries[id];

    if (!metadata) {
      this.index!.stats.cacheMisses++;
      this.dirty = true;
      return null;
    }

    try {
      const vectorPath = path.join(this.vectorsDir, `${id}.bin`);
      const buffer = await fs.readFile(vectorPath);
      const vector = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);

      // Update access stats
      metadata.accessCount++;
      metadata.lastAccessed = new Date().toISOString();
      this.index!.stats.cacheHits++;
      this.dirty = true;

      return Array.from(vector);
    } catch (error: any) {
      // Vector file missing, remove from index
      delete this.index!.entries[id];
      this.index!.stats.totalEntries--;
      this.index!.stats.cacheMisses++;
      this.dirty = true;
      return null;
    }
  }

  /**
   * Store an embedding in cache
   */
  async set(text: string, vector: number[]): Promise<string> {
    if (!this.index) await this.initialize();

    const id = EmbeddingCache.computeEmbeddingId(text, this.config.model);
    const textHash = this.computeTextHash(text);

    // Write vector to binary file
    const vectorPath = path.join(this.vectorsDir, `${id}.bin`);
    const buffer = Buffer.from(new Float32Array(vector).buffer);
    await fs.writeFile(vectorPath, buffer);

    const sizeBytes = buffer.length;

    // Update or create metadata
    const existing = this.index!.entries[id];
    if (!existing) {
      this.index!.stats.totalEntries++;
      this.index!.stats.totalSizeBytes += sizeBytes;
    }

    this.index!.entries[id] = {
      id,
      model: this.config.model,
      dimensions: vector.length,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      accessCount: existing?.accessCount ?? 0,
      lastAccessed: new Date().toISOString(),
      textHash
    };

    this.dirty = true;
    return id;
  }

  /**
   * Get multiple embeddings, returning which ones need to be computed
   * Returns: { cached: Map<text, vector>, missing: string[] }
   */
  async getBatch(texts: string[]): Promise<{
    cached: Map<string, number[]>;
    missing: string[];
    ids: Map<string, string>;  // text → embedding_id
  }> {
    if (!this.index) await this.initialize();

    const cached = new Map<string, number[]>();
    const missing: string[] = [];
    const ids = new Map<string, string>();

    for (const text of texts) {
      const id = EmbeddingCache.computeEmbeddingId(text, this.config.model);
      ids.set(text, id);

      const vector = await this.get(text);
      if (vector) {
        cached.set(text, vector);
      } else {
        missing.push(text);
      }
    }

    return { cached, missing, ids };
  }

  /**
   * Store multiple embeddings
   */
  async setBatch(embeddings: Map<string, number[]>): Promise<Map<string, string>> {
    const ids = new Map<string, string>();

    for (const [text, vector] of embeddings) {
      const id = await this.set(text, vector);
      ids.set(text, id);
    }

    await this.saveIndex();
    return ids;
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    if (!this.index) await this.initialize();

    const hits = this.index!.stats.cacheHits;
    const misses = this.index!.stats.cacheMisses;
    const total = hits + misses;

    return {
      totalEntries: this.index!.stats.totalEntries,
      totalSizeBytes: this.index!.stats.totalSizeBytes,
      cacheHits: hits,
      cacheMisses: misses,
      hitRate: total > 0 ? hits / total : 0,
      model: this.config.model,
      dimensions: this.config.dimensions
    };
  }

  /**
   * Export embeddings for sharing
   * Returns a portable format that can be imported by other developers
   */
  async export(embeddingIds?: string[]): Promise<{
    version: string;
    model: string;
    dimensions: number;
    exportedAt: string;
    embeddings: Array<{
      id: string;
      textHash: string;
      vector: number[];
    }>;
  }> {
    if (!this.index) await this.initialize();

    const idsToExport = embeddingIds ?? Object.keys(this.index!.entries);
    const embeddings: Array<{ id: string; textHash: string; vector: number[] }> = [];

    for (const id of idsToExport) {
      const metadata = this.index!.entries[id];
      if (!metadata) continue;

      try {
        const vectorPath = path.join(this.vectorsDir, `${id}.bin`);
        const buffer = await fs.readFile(vectorPath);
        const vector = Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4));

        embeddings.push({
          id,
          textHash: metadata.textHash,
          vector
        });
      } catch {
        // Skip missing vectors
      }
    }

    return {
      version: '1.0',
      model: this.config.model,
      dimensions: this.config.dimensions,
      exportedAt: new Date().toISOString(),
      embeddings
    };
  }

  /**
   * Import embeddings from another cache
   * Merges with existing cache (content-addressed = no conflicts)
   */
  async import(data: {
    model: string;
    embeddings: Array<{ id: string; textHash: string; vector: number[] }>;
  }): Promise<{ imported: number; skipped: number }> {
    if (!this.index) await this.initialize();

    if (data.model !== this.config.model) {
      throw new Error(`Model mismatch: expected ${this.config.model}, got ${data.model}`);
    }

    let imported = 0;
    let skipped = 0;

    for (const entry of data.embeddings) {
      // Skip if already exists (content-addressed = identical)
      if (this.index!.entries[entry.id]) {
        skipped++;
        continue;
      }

      // Write vector
      const vectorPath = path.join(this.vectorsDir, `${entry.id}.bin`);
      const buffer = Buffer.from(new Float32Array(entry.vector).buffer);
      await fs.writeFile(vectorPath, buffer);

      // Add to index
      this.index!.entries[entry.id] = {
        id: entry.id,
        model: this.config.model,
        dimensions: entry.vector.length,
        createdAt: new Date().toISOString(),
        accessCount: 0,
        lastAccessed: new Date().toISOString(),
        textHash: entry.textHash
      };

      this.index!.stats.totalEntries++;
      this.index!.stats.totalSizeBytes += buffer.length;
      imported++;
    }

    this.dirty = true;
    await this.saveIndex();

    return { imported, skipped };
  }

  /**
   * Clear the cache
   */
  async clear(): Promise<void> {
    if (!this.index) await this.initialize();

    // Remove all vector files
    for (const id of Object.keys(this.index!.entries)) {
      try {
        await fs.unlink(path.join(this.vectorsDir, `${id}.bin`));
      } catch {
        // Ignore missing files
      }
    }

    // Reset index
    this.index = {
      version: '1.0',
      model: this.config.model,
      entries: {},
      stats: {
        totalEntries: 0,
        totalSizeBytes: 0,
        cacheHits: 0,
        cacheMisses: 0,
        lastUpdated: new Date().toISOString()
      }
    };

    this.dirty = true;
    await this.saveIndex();
  }

  /**
   * Evict least recently used entries to stay under size limit
   */
  async evictLRU(targetSizeBytes?: number): Promise<number> {
    if (!this.index) await this.initialize();

    const target = targetSizeBytes ?? this.config.maxSizeBytes;
    if (this.index!.stats.totalSizeBytes <= target) {
      return 0;
    }

    // Sort entries by last accessed (oldest first)
    const entries = Object.values(this.index!.entries)
      .sort((a, b) => new Date(a.lastAccessed).getTime() - new Date(b.lastAccessed).getTime());

    let evicted = 0;
    let currentSize = this.index!.stats.totalSizeBytes;
    const bytesPerVector = this.config.dimensions * 4;  // float32

    for (const entry of entries) {
      if (currentSize <= target) break;

      try {
        await fs.unlink(path.join(this.vectorsDir, `${entry.id}.bin`));
        delete this.index!.entries[entry.id];
        this.index!.stats.totalEntries--;
        currentSize -= bytesPerVector;
        evicted++;
      } catch {
        // Ignore missing files
      }
    }

    this.index!.stats.totalSizeBytes = currentSize;
    this.dirty = true;
    await this.saveIndex();

    return evicted;
  }

  /**
   * Close the cache, saving any pending changes
   */
  async close(): Promise<void> {
    await this.saveIndex();
  }
}

/**
 * Create an embedding cache instance
 */
export function createEmbeddingCache(config: EmbeddingCacheConfig): EmbeddingCache {
  return new EmbeddingCache(config);
}

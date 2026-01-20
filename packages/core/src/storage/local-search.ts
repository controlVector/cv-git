/**
 * Local Vector Search
 *
 * Provides offline semantic search using cached vectors in .cv/vectors/.
 * Used as a fallback when Qdrant is unavailable.
 *
 * Note: This is slower than Qdrant but enables offline operation.
 */

import { getCVDir } from '@cv-git/shared';
import { readVectors, streamVectors, VectorCollection, hasVectors } from './vector-storage.js';
import { VectorEntry } from './types.js';

export interface LocalSearchResult {
  id: string;
  score: number;
  text: string;
  payload: {
    file: string;
    startLine: number;
    endLine: number;
    symbolName?: string;
    language?: string;
  };
}

export interface LocalSearchOptions {
  minScore?: number;
  language?: string;
  file?: string;
}

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Check if local vector cache is available
 */
export async function hasLocalVectors(repoRoot: string): Promise<boolean> {
  const cvDir = getCVDir(repoRoot);
  return hasVectors(cvDir, 'code_chunks');
}

/**
 * Search code using cached vectors (offline mode)
 *
 * This performs brute-force similarity search over the cached vectors.
 * Slower than Qdrant but works without a database connection.
 *
 * @param repoRoot - Repository root path
 * @param queryVector - The query embedding vector
 * @param limit - Maximum results to return
 * @param options - Search options (minScore, language filter, file filter)
 */
export async function searchLocalVectors(
  repoRoot: string,
  queryVector: number[],
  limit: number = 10,
  options: LocalSearchOptions = {}
): Promise<LocalSearchResult[]> {
  const { minScore = 0.5, language, file } = options;
  const cvDir = getCVDir(repoRoot);

  // Check if vectors exist
  if (!(await hasVectors(cvDir, 'code_chunks'))) {
    return [];
  }

  const results: LocalSearchResult[] = [];

  // Stream through vectors to avoid loading all into memory
  for await (const entry of streamVectors(cvDir, 'code_chunks')) {
    // Apply filters
    if (language && entry.metadata.language !== language) {
      continue;
    }
    if (file && !entry.metadata.file?.includes(file)) {
      continue;
    }

    // Compute similarity
    const score = cosineSimilarity(queryVector, entry.embedding);

    if (score >= minScore) {
      results.push({
        id: entry.id,
        score,
        text: entry.text,
        payload: {
          file: entry.metadata.file || '',
          startLine: entry.metadata.startLine || 0,
          endLine: entry.metadata.endLine || 0,
          symbolName: entry.metadata.symbolName,
          language: entry.metadata.language,
        },
      });
    }
  }

  // Sort by score descending and limit
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Search with pre-loaded vectors (faster for multiple searches)
 *
 * Use this when you need to perform multiple searches against the same dataset.
 */
export class LocalVectorIndex {
  private vectors: VectorEntry[] = [];
  private loaded = false;

  constructor(private repoRoot: string) {}

  /**
   * Load vectors into memory
   */
  async load(): Promise<number> {
    const cvDir = getCVDir(this.repoRoot);
    this.vectors = await readVectors(cvDir, 'code_chunks');
    this.loaded = true;
    return this.vectors.length;
  }

  /**
   * Check if index is loaded
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Get number of indexed vectors
   */
  size(): number {
    return this.vectors.length;
  }

  /**
   * Search the index
   */
  search(
    queryVector: number[],
    limit: number = 10,
    options: LocalSearchOptions = {}
  ): LocalSearchResult[] {
    if (!this.loaded) {
      throw new Error('Index not loaded. Call load() first.');
    }

    const { minScore = 0.5, language, file } = options;
    const results: LocalSearchResult[] = [];

    for (const entry of this.vectors) {
      // Apply filters
      if (language && entry.metadata.language !== language) {
        continue;
      }
      if (file && !entry.metadata.file?.includes(file)) {
        continue;
      }

      // Compute similarity
      const score = cosineSimilarity(queryVector, entry.embedding);

      if (score >= minScore) {
        results.push({
          id: entry.id,
          score,
          text: entry.text,
          payload: {
            file: entry.metadata.file || '',
            startLine: entry.metadata.startLine || 0,
            endLine: entry.metadata.endLine || 0,
            symbolName: entry.metadata.symbolName,
            language: entry.metadata.language,
          },
        });
      }
    }

    // Sort by score descending and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Clear the index from memory
   */
  clear(): void {
    this.vectors = [];
    this.loaded = false;
  }
}

/**
 * Get vector stats without loading all vectors
 */
export async function getLocalVectorStats(repoRoot: string): Promise<{
  available: boolean;
  count: number;
  collections: string[];
}> {
  const cvDir = getCVDir(repoRoot);

  const hasCodeChunks = await hasVectors(cvDir, 'code_chunks');

  if (!hasCodeChunks) {
    return { available: false, count: 0, collections: [] };
  }

  // Count vectors efficiently
  let count = 0;
  for await (const _ of streamVectors(cvDir, 'code_chunks')) {
    count++;
  }

  return {
    available: true,
    count,
    collections: ['code_chunks'],
  };
}

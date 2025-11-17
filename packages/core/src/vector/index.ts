/**
 * Vector Database Manager
 * Manages embeddings and semantic search using Qdrant
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import {
  VectorSearchResult,
  CodeChunkPayload,
  DocstringPayload,
  CommitPayload,
  VectorError,
  CodeChunk,
  VectorPayload
} from '@cv-git/shared';
import { chunkArray } from '@cv-git/shared';

export interface VectorCollections {
  codeChunks: string;
  docstrings: string;
  commits: string;
}

export class VectorManager {
  private client: QdrantClient | null = null;
  private openai: OpenAI | null = null;
  private collections: VectorCollections;
  private embeddingModel: string;
  private vectorSize: number;
  private connected: boolean = false;

  constructor(
    private url: string,
    private openaiApiKey?: string,
    collections?: Partial<VectorCollections>
  ) {
    this.collections = {
      codeChunks: collections?.codeChunks || 'code_chunks',
      docstrings: collections?.docstrings || 'docstrings',
      commits: collections?.commits || 'commits'
    };
    this.embeddingModel = 'text-embedding-3-small';
    this.vectorSize = 1536; // text-embedding-3-small dimension
  }

  /**
   * Connect to Qdrant and initialize OpenAI
   */
  async connect(): Promise<void> {
    try {
      // Initialize Qdrant client
      this.client = new QdrantClient({ url: this.url });

      // Test connection
      await this.client.getCollections();

      // Initialize OpenAI
      if (!this.openaiApiKey) {
        throw new VectorError('OpenAI API key not provided');
      }

      this.openai = new OpenAI({ apiKey: this.openaiApiKey });

      this.connected = true;

      // Ensure collections exist
      await this.ensureCollections();

    } catch (error: any) {
      throw new VectorError(`Failed to connect to Qdrant: ${error.message}`, error);
    }
  }

  /**
   * Ensure all collections exist
   */
  private async ensureCollections(): Promise<void> {
    if (!this.client) {
      throw new VectorError('Not connected to Qdrant');
    }

    // Create code chunks collection
    await this.ensureCollection(this.collections.codeChunks, this.vectorSize);

    // Create docstrings collection
    await this.ensureCollection(this.collections.docstrings, this.vectorSize);

    // Create commits collection
    await this.ensureCollection(this.collections.commits, this.vectorSize);
  }

  /**
   * Create collection if not exists
   */
  async ensureCollection(name: string, vectorSize: number): Promise<void> {
    if (!this.client) {
      throw new VectorError('Not connected to Qdrant');
    }

    try {
      // Check if collection exists
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === name);

      if (!exists) {
        // Create collection
        await this.client.createCollection(name, {
          vectors: {
            size: vectorSize,
            distance: 'Cosine'
          }
        });
      }
    } catch (error: any) {
      throw new VectorError(`Failed to ensure collection ${name}: ${error.message}`, error);
    }
  }

  /**
   * Generate embedding for text using OpenAI
   */
  async embed(text: string): Promise<number[]> {
    if (!this.openai) {
      throw new VectorError('OpenAI client not initialized');
    }

    try {
      const response = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input: text,
        encoding_format: 'float'
      });

      return response.data[0].embedding;
    } catch (error: any) {
      throw new VectorError(`Failed to generate embedding: ${error.message}`, error);
    }
  }

  /**
   * Generate embeddings for multiple texts in batches
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.openai) {
      throw new VectorError('OpenAI client not initialized');
    }

    try {
      // OpenAI allows up to 2048 inputs per request
      const batchSize = 100; // Use smaller batches to be safe
      const batches = chunkArray(texts, batchSize);
      const allEmbeddings: number[][] = [];

      for (const batch of batches) {
        const response = await this.openai.embeddings.create({
          model: this.embeddingModel,
          input: batch,
          encoding_format: 'float'
        });

        allEmbeddings.push(...response.data.map(d => d.embedding));
      }

      return allEmbeddings;
    } catch (error: any) {
      throw new VectorError(`Failed to generate batch embeddings: ${error.message}`, error);
    }
  }

  /**
   * Upsert a vector into a collection
   */
  async upsert(
    collection: string,
    id: string,
    vector: number[],
    payload: any
  ): Promise<void> {
    if (!this.client) {
      throw new VectorError('Not connected to Qdrant');
    }

    try {
      await this.client.upsert(collection, {
        wait: true,
        points: [
          {
            id: this.hashId(id),
            vector,
            payload: { ...payload, _id: id }
          }
        ]
      });
    } catch (error: any) {
      throw new VectorError(`Failed to upsert vector: ${error.message}`, error);
    }
  }

  /**
   * Upsert multiple vectors in batch
   */
  async upsertBatch(
    collection: string,
    items: Array<{ id: string; vector: number[]; payload: any }>
  ): Promise<void> {
    if (!this.client) {
      throw new VectorError('Not connected to Qdrant');
    }

    try {
      // Batch upsert in chunks
      const batchSize = 100;
      const batches = chunkArray(items, batchSize);

      for (const batch of batches) {
        await this.client.upsert(collection, {
          wait: true,
          points: batch.map(item => ({
            id: this.hashId(item.id),
            vector: item.vector,
            payload: { ...item.payload, _id: item.id }
          }))
        });
      }
    } catch (error: any) {
      throw new VectorError(`Failed to batch upsert: ${error.message}`, error);
    }
  }

  /**
   * Search vectors by query text
   */
  async search<T extends VectorPayload = CodeChunkPayload>(
    collection: string,
    query: string,
    limit: number = 10,
    filter?: any
  ): Promise<VectorSearchResult<T>[]> {
    if (!this.client) {
      throw new VectorError('Not connected to Qdrant');
    }

    try {
      // Generate embedding for query
      const queryVector = await this.embed(query);

      // Search
      const results = await this.client.search(collection, {
        vector: queryVector,
        limit,
        filter,
        with_payload: true
      });

      return results.map(result => ({
        id: result.payload?._id as string || String(result.id),
        score: result.score,
        payload: result.payload as T
      }));
    } catch (error: any) {
      throw new VectorError(`Search failed: ${error.message}`, error);
    }
  }

  /**
   * Search code chunks
   */
  async searchCode(
    query: string,
    limit: number = 10,
    options?: {
      language?: string;
      file?: string;
      minScore?: number;
    }
  ): Promise<VectorSearchResult<CodeChunkPayload>[]> {
    const filter: any = {};

    if (options?.language) {
      filter.must = filter.must || [];
      filter.must.push({
        key: 'language',
        match: { value: options.language }
      });
    }

    if (options?.file) {
      filter.must = filter.must || [];
      filter.must.push({
        key: 'file',
        match: { value: options.file }
      });
    }

    const results = await this.search<CodeChunkPayload>(
      this.collections.codeChunks,
      query,
      limit,
      Object.keys(filter).length > 0 ? filter : undefined
    );

    // Filter by minimum score if specified
    if (options?.minScore !== undefined) {
      return results.filter(r => r.score >= options.minScore!);
    }

    return results;
  }

  /**
   * Delete vector by ID
   */
  async delete(collection: string, id: string): Promise<void> {
    if (!this.client) {
      throw new VectorError('Not connected to Qdrant');
    }

    try {
      await this.client.delete(collection, {
        wait: true,
        points: [this.hashId(id)]
      });
    } catch (error: any) {
      throw new VectorError(`Failed to delete vector: ${error.message}`, error);
    }
  }

  /**
   * Clear entire collection
   */
  async clearCollection(collection: string): Promise<void> {
    if (!this.client) {
      throw new VectorError('Not connected to Qdrant');
    }

    try {
      await this.client.deleteCollection(collection);
      await this.ensureCollection(collection, this.vectorSize);
    } catch (error: any) {
      throw new VectorError(`Failed to clear collection: ${error.message}`, error);
    }
  }

  /**
   * Get collection statistics
   */
  async getCollectionInfo(collection: string): Promise<any> {
    if (!this.client) {
      throw new VectorError('Not connected to Qdrant');
    }

    try {
      return await this.client.getCollection(collection);
    } catch (error: any) {
      throw new VectorError(`Failed to get collection info: ${error.message}`, error);
    }
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    this.connected = false;
    this.client = null;
    this.openai = null;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Hash string ID to numeric ID for Qdrant
   */
  private hashId(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      const char = id.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Prepare code chunk text for embedding
   */
  prepareCodeForEmbedding(chunk: CodeChunk): string {
    const parts: string[] = [];

    // Add language context
    parts.push(`// Language: ${chunk.language}`);

    // Add file context
    parts.push(`// File: ${chunk.file}`);

    // Add symbol context if available
    if (chunk.symbolName) {
      parts.push(`// ${chunk.symbolKind}: ${chunk.symbolName}`);
    }

    // Add docstring if available
    if (chunk.docstring) {
      parts.push(`// ${chunk.docstring}`);
    }

    // Add the actual code
    parts.push('');
    parts.push(chunk.text);

    return parts.join('\n');
  }
}

/**
 * Create a VectorManager instance
 */
export function createVectorManager(
  url: string,
  openaiApiKey?: string,
  collections?: Partial<VectorCollections>
): VectorManager {
  return new VectorManager(url, openaiApiKey, collections);
}

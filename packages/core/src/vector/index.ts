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
import { EmbeddingCache, createEmbeddingCache, CacheStats } from './embedding-cache.js';
import { getVectorCollectionName } from '../storage/repo-id.js';

export interface VectorCollections {
  codeChunks: string;
  docstrings: string;
  commits: string;
  documentChunks: string;
}

// Embedding model configurations with their vector dimensions
const EMBEDDING_MODELS: Record<string, { dimension: number; provider: 'openai' | 'openrouter' | 'ollama' }> = {
  // OpenAI models (direct)
  'text-embedding-3-small': { dimension: 1536, provider: 'openai' },
  'text-embedding-3-large': { dimension: 3072, provider: 'openai' },
  'text-embedding-ada-002': { dimension: 1536, provider: 'openai' },
  // OpenRouter models (uses OpenAI-compatible API)
  'openai/text-embedding-3-small': { dimension: 1536, provider: 'openrouter' },
  'openai/text-embedding-3-large': { dimension: 3072, provider: 'openrouter' },
  'openai/text-embedding-ada-002': { dimension: 1536, provider: 'openrouter' },
  // Ollama models (local)
  'nomic-embed-text': { dimension: 768, provider: 'ollama' },
  'mxbai-embed-large': { dimension: 1024, provider: 'ollama' },
  'all-minilm': { dimension: 384, provider: 'ollama' },
  'snowflake-arctic-embed': { dimension: 1024, provider: 'ollama' }
};

// Model fallback order for OpenRouter (preferred)
const OPENROUTER_MODEL_ORDER = [
  'openai/text-embedding-3-small',
  'openai/text-embedding-ada-002',
  'openai/text-embedding-3-large'
];

// Model fallback order for direct OpenAI (if OpenRouter unavailable)
const OPENAI_MODEL_ORDER = [
  'text-embedding-3-small',
  'text-embedding-ada-002'
];

// Ollama fallback order
const OLLAMA_MODEL_ORDER = [
  'nomic-embed-text',
  'mxbai-embed-large',
  'all-minilm'
];

export interface VectorManagerOptions {
  /** Qdrant URL */
  url: string;
  /** Repository ID - when provided, uses isolated collections {repoId}_{collection} */
  repoId?: string;
  /** OpenRouter API key (preferred for embeddings) */
  openrouterApiKey?: string;
  /** OpenAI API key (fallback) */
  openaiApiKey?: string;
  /** Collection names (overrides repoId-based naming if provided) */
  collections?: Partial<VectorCollections>;
  /** Embedding model to use */
  embeddingModel?: string;
  /** Ollama URL for local embeddings */
  ollamaUrl?: string;
  /** Enable content-addressed embedding cache */
  enableCache?: boolean;
  /** Cache directory (default: .cv/embeddings) */
  cacheDir?: string;
  /** Vector dimension size (default: auto-detected from model, 1536 for OpenAI, 768 for Ollama nomic-embed-text) */
  vectorSize?: number;
}

export class VectorManager {
  private client: QdrantClient | null = null;
  private openai: OpenAI | null = null;
  private openrouter: OpenAI | null = null;
  private collections: VectorCollections;
  private embeddingModel: string;
  private embeddingProvider: 'openai' | 'openrouter' | 'ollama';
  private ollamaUrl: string;
  private openrouterApiKey?: string;
  private openaiApiKey?: string;
  private vectorSize: number;
  private connected: boolean = false;
  private modelValidated: boolean = false;
  private url: string;
  private cache: EmbeddingCache | null = null;
  private cacheEnabled: boolean = false;
  private cacheDir: string;
  private repoId?: string;

  constructor(options: VectorManagerOptions);
  /** @deprecated Use options object instead */
  constructor(url: string, openaiApiKey?: string, collections?: Partial<VectorCollections>, embeddingModel?: string);
  constructor(
    urlOrOptions: string | VectorManagerOptions,
    openaiApiKey?: string,
    collections?: Partial<VectorCollections>,
    embeddingModel?: string
  ) {
    // Handle both old and new constructor signatures
    let opts: VectorManagerOptions;
    if (typeof urlOrOptions === 'string') {
      // Legacy constructor
      opts = {
        url: urlOrOptions,
        openaiApiKey,
        collections,
        embeddingModel,
        openrouterApiKey: process.env.OPENROUTER_API_KEY
      };
    } else {
      opts = urlOrOptions;
    }

    this.url = opts.url;
    this.repoId = opts.repoId;
    this.ollamaUrl = opts.ollamaUrl || process.env.OLLAMA_URL || process.env.CV_OLLAMA_URL || 'http://127.0.0.1:11434';

    // If Ollama URL is explicitly provided, don't auto-detect cloud API keys from env
    // This ensures local-first operation when Ollama is configured
    const useOllama = !!opts.ollamaUrl;
    this.openaiApiKey = useOllama ? undefined : opts.openaiApiKey;
    this.openrouterApiKey = useOllama ? undefined : (opts.openrouterApiKey || process.env.OPENROUTER_API_KEY);

    // Collection naming: if repoId provided, use repo-specific names for isolation
    // Otherwise use explicit collections or defaults
    if (opts.repoId && !opts.collections) {
      // Use repo-specific collection names for isolation
      this.collections = {
        codeChunks: getVectorCollectionName(opts.repoId, 'code_chunks'),
        docstrings: getVectorCollectionName(opts.repoId, 'docstrings'),
        commits: getVectorCollectionName(opts.repoId, 'commits'),
        documentChunks: getVectorCollectionName(opts.repoId, 'document_chunks')
      };
    } else {
      // Use explicit collections or defaults (shared mode)
      this.collections = {
        codeChunks: opts.collections?.codeChunks || 'code_chunks',
        docstrings: opts.collections?.docstrings || 'docstrings',
        commits: opts.collections?.commits || 'commits',
        documentChunks: opts.collections?.documentChunks || 'document_chunks'
      };
    }

    // Cache settings
    this.cacheEnabled = opts.enableCache ?? true;  // Enabled by default
    this.cacheDir = opts.cacheDir ?? '.cv/embeddings';

    // Default model based on available provider
    // Ollama (local) > OpenRouter > OpenAI
    const defaultModel = useOllama
      ? 'nomic-embed-text'
      : this.openrouterApiKey
        ? 'openai/text-embedding-3-small'
        : 'text-embedding-3-small';

    this.embeddingModel = opts.embeddingModel || process.env.CV_EMBEDDING_MODEL || defaultModel;

    // Determine provider from model name or available keys
    const modelConfig = EMBEDDING_MODELS[this.embeddingModel];
    if (modelConfig) {
      this.embeddingProvider = modelConfig.provider;
    } else if (this.openrouterApiKey) {
      this.embeddingProvider = 'openrouter';
    } else if (this.openaiApiKey) {
      this.embeddingProvider = 'openai';
    } else {
      this.embeddingProvider = 'ollama';
    }

    this.vectorSize = opts.vectorSize || modelConfig?.dimension || 1536;
  }

  /**
   * Connect to Qdrant and initialize embedding provider
   * Provider priority: OpenRouter > OpenAI > Ollama
   */
  async connect(): Promise<void> {
    try {
      // Initialize Qdrant client
      this.client = new QdrantClient({ url: this.url });

      // Test connection
      await this.client.getCollections();

      // Initialize embedding provider based on what's available
      // Priority: OpenRouter > OpenAI > Ollama
      if (this.embeddingProvider === 'ollama') {
        // Explicit Ollama request
        await this.initOllama();
      } else if (this.openrouterApiKey) {
        // OpenRouter available - use it (preferred)
        this.openrouter = new OpenAI({
          apiKey: this.openrouterApiKey,
          baseURL: 'https://openrouter.ai/api/v1'
        });
        this.embeddingProvider = 'openrouter';
        // Use OpenRouter model naming
        if (!this.embeddingModel.includes('/')) {
          this.embeddingModel = `openai/${this.embeddingModel}`;
        }
      } else if (this.openaiApiKey) {
        // Fall back to OpenAI
        this.openai = new OpenAI({ apiKey: this.openaiApiKey });
        this.embeddingProvider = 'openai';
        // Use OpenAI model naming (strip openai/ prefix if present)
        if (this.embeddingModel.startsWith('openai/')) {
          this.embeddingModel = this.embeddingModel.replace('openai/', '');
        }
      } else {
        // No cloud API keys - try Ollama
        const ollamaAvailable = await this.isOllamaAvailable();
        if (ollamaAvailable) {
          await this.initOllama();
        } else {
          throw new VectorError(
            'No embedding API key provided.\n' +
            'Run: cv auth setup openrouter (recommended)\n' +
            'Or:  cv auth setup openai\n' +
            'Or:  Start Ollama for local embeddings'
          );
        }
      }

      this.connected = true;

      // Initialize embedding cache if enabled
      if (this.cacheEnabled) {
        this.cache = createEmbeddingCache({
          cacheDir: this.cacheDir,
          model: this.embeddingModel,
          dimensions: this.vectorSize
        });
        await this.cache.initialize();
      }

      // Ensure collections exist
      await this.ensureCollections();

    } catch (error: any) {
      throw new VectorError(`Failed to connect to Qdrant: ${error.message}`, error);
    }
  }

  /**
   * Initialize Ollama and verify model availability
   */
  private async initOllama(): Promise<void> {
    // Check if Ollama is running
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        throw new Error('Ollama not responding');
      }

      const data = await response.json() as { models?: Array<{ name: string }> };
      const availableModels = data.models?.map(m => m.name.split(':')[0]) || [];

      // Check if our model is available, try fallbacks
      let modelFound = false;
      for (const model of [this.embeddingModel, ...OLLAMA_MODEL_ORDER]) {
        if (availableModels.some(m => m === model || m.startsWith(model))) {
          if (model !== this.embeddingModel) {
            console.log(`Ollama: Using ${model} (${this.embeddingModel} not found)`);
            this.embeddingModel = model;
            const modelConfig = EMBEDDING_MODELS[model];
            if (modelConfig) {
              this.vectorSize = modelConfig.dimension;
            }
          }
          modelFound = true;
          break;
        }
      }

      if (!modelFound) {
        throw new Error(
          `No embedding model found in Ollama. Install one with: ollama pull nomic-embed-text`
        );
      }

    } catch (error: any) {
      if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
        throw new VectorError(
          'Ollama not running. Start with: ollama serve\n' +
          'Or install: curl -fsSL https://ollama.com/install.sh | sh'
        );
      }
      throw new VectorError(`Failed to initialize Ollama: ${error.message}`, error);
    }
  }

  /**
   * Generate embedding using Ollama
   */
  private async embedWithOllama(text: string): Promise<number[]> {
    // Truncate long texts to avoid "unable to fit entire input in a batch" panic
    // Ollama's nomic-embed-text has batch size of 512 tokens by default
    // Using very conservative limit: 500 chars (~125 tokens) to stay well under batch size
    // Note: Code tends to tokenize less efficiently than prose
    const maxLength = 500;
    const truncatedText = text.length > maxLength
      ? text.substring(0, maxLength) + '...'
      : text;

    if (process.env.CV_DEBUG) {
      console.log(`[VectorManager] Ollama embedding request: url=${this.ollamaUrl}, model=${this.embeddingModel}, textLen=${text.length}${text.length > maxLength ? ' (truncated)' : ''}`);
    }

    const response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.embeddingModel,
        prompt: truncatedText
      }),
      signal: AbortSignal.timeout(60000)  // Increased timeout for first request (model loading)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama embedding failed: ${error}`);
    }

    const data = await response.json() as { embedding: number[] };

    if (process.env.CV_DEBUG && data.embedding) {
      console.log(`[VectorManager] Ollama embedding success: dim=${data.embedding.length}`);
    }

    return data.embedding;
  }

  /**
   * Generate embeddings for multiple texts using Ollama (sequential with progress)
   */
  private async embedBatchWithOllama(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    const total = texts.length;
    let lastProgress = 0;

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];

      // Retry logic for transient failures
      let lastError: Error | null = null;
      for (let retry = 0; retry < 3; retry++) {
        try {
          const embedding = await this.embedWithOllama(text);
          embeddings.push(embedding);
          lastError = null;
          break;
        } catch (error: any) {
          lastError = error;
          // Wait before retry (Ollama runner might be restarting)
          if (retry < 2) {
            await new Promise(r => setTimeout(r, 1000 * (retry + 1)));
          }
        }
      }

      if (lastError) {
        throw lastError;
      }

      // Show progress every 100 embeddings
      const progress = Math.floor((i + 1) / total * 100);
      if (progress >= lastProgress + 10 || i === total - 1) {
        console.log(`  Ollama embeddings: ${i + 1}/${total} (${progress}%)`);
        lastProgress = progress;
      }
    }
    return embeddings;
  }

  /**
   * Generate embeddings using OpenRouter (OpenAI-compatible API)
   */
  private async embedWithOpenRouter(input: string | string[]): Promise<{ embeddings: number[][]; model: string }> {
    if (!this.openrouter) {
      throw new VectorError('OpenRouter client not initialized');
    }

    // Validate input
    const inputArray = Array.isArray(input) ? input : [input];
    if (inputArray.length === 0) {
      return { embeddings: [], model: this.embeddingModel };
    }

    // Filter out empty strings which can cause API errors
    const validInputs = inputArray.filter(s => s && s.trim().length > 0);
    if (validInputs.length === 0) {
      // Return zero vectors for empty inputs
      return {
        embeddings: inputArray.map(() => new Array(this.vectorSize).fill(0)),
        model: this.embeddingModel
      };
    }

    // Models to try in order of preference
    const modelsToTry = [
      this.embeddingModel,
      'openai/text-embedding-3-small',
      'openai/text-embedding-ada-002',
    ].filter((m, i, arr) => arr.indexOf(m) === i); // Remove duplicates

    let response: any;
    let lastError: Error | null = null;

    for (const model of modelsToTry) {
      try {
        response = await this.openrouter.embeddings.create({
          model,
          input: validInputs.length === 1 ? validInputs[0] : validInputs,
          encoding_format: 'float'
        });

        // If we had to fall back to a different model, update our setting
        if (model !== this.embeddingModel) {
          console.log(`Switched to embedding model: ${model}`);
          this.embeddingModel = model;
        }
        break;
      } catch (error: any) {
        lastError = error;
        // Check if it's a provider not found error - try next model
        if (error.message?.includes('No successful provider') || error.status === 404) {
          continue;
        }
        // Other errors should be thrown
        throw error;
      }
    }

    if (!response && lastError) {
      throw lastError;
    }

    try {
      // Validate response structure
      if (!response || !response.data || !Array.isArray(response.data)) {
        const responseStr = response ? JSON.stringify(response).substring(0, 500) : 'null/undefined';
        throw new VectorError(
          `OpenRouter returned invalid response (expected data array): ${responseStr}`
        );
      }

      // Validate each embedding in the response
      const embeddings = response.data.map((d: any, i: number) => {
        if (!d || !Array.isArray(d.embedding)) {
          throw new VectorError(
            `OpenRouter embedding ${i} missing or invalid: ${JSON.stringify(d).substring(0, 100)}`
          );
        }
        return d.embedding as number[];
      });

      // If we filtered out empty strings, we need to reconstruct the full array
      if (validInputs.length !== inputArray.length) {
        const fullEmbeddings: number[][] = [];
        let validIndex = 0;
        for (const inp of inputArray) {
          if (inp && inp.trim().length > 0) {
            fullEmbeddings.push(embeddings[validIndex++]);
          } else {
            fullEmbeddings.push(new Array(this.vectorSize).fill(0));
          }
        }
        return { embeddings: fullEmbeddings, model: this.embeddingModel };
      }

      return {
        embeddings,
        model: this.embeddingModel
      };
    } catch (error: any) {
      // Re-throw VectorErrors as-is
      if (error instanceof VectorError) {
        throw error;
      }
      throw new VectorError(`OpenRouter embedding failed: ${error.message}`, error);
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

    // Create document chunks collection
    await this.ensureCollection(this.collections.documentChunks, this.vectorSize);
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
   * Generate embedding for text (with content-addressed caching)
   */
  async embed(text: string): Promise<number[]> {
    // Check cache first
    if (this.cache) {
      const cached = await this.cache.get(text);
      if (cached) {
        return cached;
      }
    }

    // Generate embedding
    let embedding: number[];

    // Use the appropriate provider
    if (this.embeddingProvider === 'ollama') {
      embedding = await this.embedWithOllama(text);
    } else if (this.embeddingProvider === 'openrouter') {
      if (!this.openrouter) {
        throw new VectorError('OpenRouter client not initialized');
      }
      const result = await this.embedWithOpenRouter(text);
      embedding = result.embeddings[0];
    } else {
      // OpenAI direct
      if (!this.openai) {
        throw new VectorError('OpenAI client not initialized');
      }

      try {
        const response = await this.openai.embeddings.create({
          model: this.embeddingModel,
          input: text,
          encoding_format: 'float'
        });

        embedding = response.data[0].embedding;
      } catch (error: any) {
        throw new VectorError(`Failed to generate embedding: ${error.message}`, error);
      }
    }

    // Store in cache
    if (this.cache) {
      await this.cache.set(text, embedding);
    }

    return embedding;
  }

  /**
   * Check if Ollama is available
   */
  private async isOllamaAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Try to generate embeddings with automatic model fallback (including OpenRouter and Ollama)
   */
  private async tryEmbeddingWithFallback(input: string | string[]): Promise<{ embeddings: number[][]; model: string }> {
    // If using Ollama provider, use it directly
    if (this.embeddingProvider === 'ollama') {
      const texts = Array.isArray(input) ? input : [input];
      const embeddings = await this.embedBatchWithOllama(texts);
      return { embeddings, model: this.embeddingModel };
    }

    // If using OpenRouter provider, use it directly
    if (this.embeddingProvider === 'openrouter') {
      return this.embedWithOpenRouter(input);
    }

    if (!this.openai) {
      throw new VectorError('OpenAI client not initialized');
    }

    // If model already validated, use it directly
    if (this.modelValidated) {
      const response = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input,
        encoding_format: 'float'
      });
      return {
        embeddings: response.data.map(d => d.embedding),
        model: this.embeddingModel
      };
    }

    // Try models in fallback order
    const modelsToTry = this.embeddingModel === OPENAI_MODEL_ORDER[0]
      ? OPENAI_MODEL_ORDER
      : [this.embeddingModel, ...OPENAI_MODEL_ORDER.filter(m => m !== this.embeddingModel)];

    let lastError: Error | null = null;
    let allOpenAIFailed = true;

    for (const model of modelsToTry) {
      try {
        const response = await this.openai.embeddings.create({
          model,
          input,
          encoding_format: 'float'
        });

        // Model works! Update settings
        if (model !== this.embeddingModel) {
          console.log(`Switched to embedding model: ${model}`);
          this.embeddingModel = model;
          this.vectorSize = EMBEDDING_MODELS[model]?.dimension || 1536;
        }
        this.modelValidated = true;
        allOpenAIFailed = false;

        return {
          embeddings: response.data.map(d => d.embedding),
          model
        };
      } catch (error: any) {
        lastError = error;
        // Check if it's an access/permission error (403)
        if (error.status === 403 || error.message?.includes('403') || error.message?.includes('does not have access')) {
          console.log(`Model ${model} not accessible, trying fallback...`);
          continue;
        }
        // Other errors should be thrown immediately
        throw error;
      }
    }

    // All OpenAI models failed with 403 - try OpenRouter first if available
    if (allOpenAIFailed && this.openrouterApiKey) {
      console.log('OpenAI models not accessible. Trying OpenRouter as fallback...');
      try {
        this.openrouter = new OpenAI({
          apiKey: this.openrouterApiKey,
          baseURL: 'https://openrouter.ai/api/v1'
        });
        this.embeddingProvider = 'openrouter';
        this.embeddingModel = 'openai/text-embedding-3-small';
        this.vectorSize = 1536;
        const result = await this.embedWithOpenRouter(input);
        this.modelValidated = true;
        return result;
      } catch (openrouterError: any) {
        console.log(`OpenRouter fallback failed: ${openrouterError.message}`);
      }
    }

    // Try Ollama as last resort
    if (allOpenAIFailed && await this.isOllamaAvailable()) {
      console.log('Trying Ollama as fallback...');
      try {
        await this.initOllama();
        this.embeddingProvider = 'ollama';
        const texts = Array.isArray(input) ? input : [input];
        const embeddings = await this.embedBatchWithOllama(texts);
        this.modelValidated = true;
        return { embeddings, model: this.embeddingModel };
      } catch (ollamaError: any) {
        console.log(`Ollama fallback failed: ${ollamaError.message}`);
      }
    }

    throw new VectorError(`Failed to generate embeddings with any model: ${lastError?.message}`, lastError);
  }

  /**
   * Generate embeddings for multiple texts in batches (with content-addressed caching)
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    // Check cache for existing embeddings
    let textsToEmbed = texts;
    const cachedEmbeddings = new Map<string, number[]>();

    if (this.cache) {
      const cacheResult = await this.cache.getBatch(texts);
      for (const [text, embedding] of cacheResult.cached) {
        cachedEmbeddings.set(text, embedding);
      }
      textsToEmbed = cacheResult.missing;

      if (process.env.CV_DEBUG && cacheResult.cached.size > 0) {
        console.log(`[VectorManager] Cache hit: ${cacheResult.cached.size}/${texts.length} embeddings`);
      }
    }

    // Generate embeddings for missing texts
    let newEmbeddings: number[][] = [];

    if (textsToEmbed.length > 0) {
      // If using Ollama, use Ollama batch
      if (this.embeddingProvider === 'ollama') {
        newEmbeddings = await this.embedBatchWithOllama(textsToEmbed);
      }
      // If using OpenRouter, use OpenRouter batch with retry logic
      else if (this.embeddingProvider === 'openrouter') {
        if (!this.openrouter) {
          throw new VectorError('OpenRouter client not initialized');
        }
        const batchSize = 50; // Smaller batches to avoid rate limits
        const batches = chunkArray(textsToEmbed, batchSize);
        const maxRetries = 3;

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          let lastError: Error | null = null;

          for (let retry = 0; retry < maxRetries; retry++) {
            try {
              const result = await this.embedWithOpenRouter(batch);
              newEmbeddings.push(...result.embeddings);
              lastError = null;
              break;
            } catch (error: any) {
              lastError = error;
              const isRetryable = error.message?.includes('No successful provider') ||
                                  error.message?.includes('rate') ||
                                  error.message?.includes('429') ||
                                  error.message?.includes('503');
              if (isRetryable && retry < maxRetries - 1) {
                const delay = Math.pow(2, retry) * 1000 + Math.random() * 1000;
                console.log(`OpenRouter batch ${i + 1}/${batches.length} failed, retrying in ${Math.round(delay / 1000)}s...`);
                await new Promise(r => setTimeout(r, delay));
              } else if (!isRetryable) {
                throw error;
              }
            }
          }

          if (lastError) {
            throw lastError;
          }

          // Progress indicator for large batches
          if (batches.length > 10 && (i + 1) % 10 === 0) {
            console.log(`Embedding progress: ${i + 1}/${batches.length} batches`);
          }
        }
      }
      // Using OpenAI directly
      else {
        if (!this.openai) {
          throw new VectorError('OpenAI client not initialized');
        }

        try {
          // OpenAI allows up to 2048 inputs per request
          const batchSize = 100; // Use smaller batches to be safe
          const batches = chunkArray(textsToEmbed, batchSize);

          for (const batch of batches) {
            const result = await this.tryEmbeddingWithFallback(batch);
            newEmbeddings.push(...result.embeddings);
          }
        } catch (error: any) {
          throw new VectorError(`Failed to generate batch embeddings: ${error.message}`, error);
        }
      }

      // Store new embeddings in cache
      if (this.cache && newEmbeddings.length > 0) {
        const newCache = new Map<string, number[]>();
        for (let i = 0; i < textsToEmbed.length; i++) {
          newCache.set(textsToEmbed[i], newEmbeddings[i]);
        }
        await this.cache.setBatch(newCache);
      }
    }

    // Reconstruct embeddings in original order
    const result: number[][] = [];
    let newIndex = 0;

    for (const text of texts) {
      const cached = cachedEmbeddings.get(text);
      if (cached) {
        result.push(cached);
      } else {
        result.push(newEmbeddings[newIndex++]);
      }
    }

    return result;
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
      if (process.env.CV_DEBUG) {
        console.log(`[VectorManager] Searching collection '${collection}' for query: "${query.slice(0, 50)}..."`);
      }

      // Generate embedding for query
      const queryVector = await this.embed(query);

      if (process.env.CV_DEBUG) {
        console.log(`[VectorManager] Generated embedding of length ${queryVector.length}`);
      }

      // Search
      const results = await this.client.search(collection, {
        vector: queryVector,
        limit,
        filter,
        with_payload: true
      });

      if (process.env.CV_DEBUG) {
        console.log(`[VectorManager] Search returned ${results.length} raw results`);
        if (results.length > 0) {
          console.log(`[VectorManager] Top score: ${results[0].score.toFixed(4)}`);
        }
      }

      return results.map(result => ({
        id: result.payload?._id as string || String(result.id),
        score: result.score,
        payload: result.payload as T
      }));
    } catch (error: any) {
      if (process.env.CV_DEBUG) {
        console.error(`[VectorManager] Search error: ${error.message}`);
      }
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

  // ========== Collection Compatibility ==========

  /**
   * Check collection compatibility with current embedding model
   * @param collection - Collection name to check
   * @returns Compatibility info including whether recreation is needed
   */
  async checkCollectionCompatibility(collection: string): Promise<{
    compatible: boolean;
    existingDimensions?: number;
    requiredDimensions: number;
    needsRecreation: boolean;
    pointCount?: number;
  }> {
    if (!this.client) {
      throw new VectorError('Not connected to Qdrant');
    }

    try {
      const info = await this.client.getCollection(collection);
      const existingDimensions = info.config?.params?.vectors?.size as number;
      const pointCount = info.points_count ?? undefined;

      return {
        compatible: existingDimensions === this.vectorSize,
        existingDimensions,
        requiredDimensions: this.vectorSize,
        needsRecreation: existingDimensions !== this.vectorSize,
        pointCount
      };
    } catch (error: any) {
      // Collection doesn't exist - compatible by default (will be created)
      if (error.message?.includes('not found') || error.status === 404) {
        return {
          compatible: true,
          requiredDimensions: this.vectorSize,
          needsRecreation: false
        };
      }
      throw new VectorError(`Failed to check collection compatibility: ${error.message}`, error);
    }
  }

  /**
   * Check all collections for compatibility and report issues
   * @returns Array of compatibility issues found
   */
  async checkAllCollectionsCompatibility(): Promise<Array<{
    collection: string;
    existingDimensions: number;
    requiredDimensions: number;
    pointCount: number;
  }>> {
    const issues: Array<{
      collection: string;
      existingDimensions: number;
      requiredDimensions: number;
      pointCount: number;
    }> = [];

    for (const [, collectionName] of Object.entries(this.collections)) {
      const compat = await this.checkCollectionCompatibility(collectionName);
      if (!compat.compatible && compat.existingDimensions) {
        issues.push({
          collection: collectionName,
          existingDimensions: compat.existingDimensions,
          requiredDimensions: compat.requiredDimensions,
          pointCount: compat.pointCount || 0
        });
      }
    }

    return issues;
  }

  /**
   * Migrate collection if embedding dimensions changed
   * WARNING: This will delete all existing vectors in the collection!
   * @param collection - Collection to migrate
   * @param force - Skip confirmation (for automated migrations)
   * @returns Migration result
   */
  async migrateCollectionIfNeeded(collection: string, force: boolean = false): Promise<{
    migrated: boolean;
    action?: 'recreated' | 'skipped';
    pointsLost?: number;
    oldDimensions?: number;
    newDimensions?: number;
  }> {
    const compat = await this.checkCollectionCompatibility(collection);

    if (compat.compatible) {
      return { migrated: false };
    }

    // Warn about data loss
    if (!force && compat.pointCount && compat.pointCount > 0) {
      console.warn(
        `\nWARNING: Collection '${collection}' has incompatible dimensions:\n` +
        `  Current: ${compat.existingDimensions} dimensions\n` +
        `  Required: ${compat.requiredDimensions} dimensions (model: ${this.embeddingModel})\n` +
        `  Points to delete: ${compat.pointCount}\n\n` +
        `Run 'cv sync --force' to recreate collections with new dimensions.\n`
      );
      return {
        migrated: false,
        action: 'skipped',
        pointsLost: 0,
        oldDimensions: compat.existingDimensions,
        newDimensions: compat.requiredDimensions
      };
    }

    // Recreate the collection
    console.log(`Recreating collection '${collection}' with ${this.vectorSize} dimensions...`);

    const pointsLost = compat.pointCount || 0;

    try {
      await this.client!.deleteCollection(collection);
    } catch {
      // Collection might not exist
    }

    await this.ensureCollection(collection, this.vectorSize);

    return {
      migrated: true,
      action: 'recreated',
      pointsLost,
      oldDimensions: compat.existingDimensions,
      newDimensions: this.vectorSize
    };
  }

  /**
   * Migrate all collections if needed
   * @param force - Force migration even if data will be lost
   */
  async migrateAllCollectionsIfNeeded(force: boolean = false): Promise<{
    collections: string[];
    totalPointsLost: number;
    needsResync: boolean;
  }> {
    const migratedCollections: string[] = [];
    let totalPointsLost = 0;

    for (const [, collectionName] of Object.entries(this.collections)) {
      const result = await this.migrateCollectionIfNeeded(collectionName, force);
      if (result.migrated) {
        migratedCollections.push(collectionName);
        totalPointsLost += result.pointsLost || 0;
      }
    }

    return {
      collections: migratedCollections,
      totalPointsLost,
      needsResync: totalPointsLost > 0
    };
  }

  /**
   * Get current embedding model and dimensions
   */
  getEmbeddingInfo(): {
    model: string;
    provider: string;
    dimensions: number;
  } {
    return {
      model: this.embeddingModel,
      provider: this.embeddingProvider,
      dimensions: this.vectorSize
    };
  }

  /**
   * Scroll through all points in a collection
   * Used for exporting vectors to file storage
   */
  async scroll(
    collection: string,
    limit: number = 100,
    offset?: string
  ): Promise<{
    points: Array<{
      id: string | number;
      vector: number[];
      payload: Record<string, unknown>;
    }>;
    next_page_offset?: string;
  }> {
    if (!this.client) {
      throw new VectorError('Not connected to Qdrant');
    }

    try {
      // Qdrant scroll API: offset is a point ID (number or string)
      const scrollOptions: any = {
        limit,
        with_vector: true,
        with_payload: true
      };

      // Only set offset if provided (skip on first call)
      if (offset) {
        // Try to parse as number first, otherwise use string
        const parsedOffset = parseInt(offset, 10);
        scrollOptions.offset = isNaN(parsedOffset) ? offset : parsedOffset;
      }

      const result = await this.client.scroll(collection, scrollOptions);

      return {
        points: result.points.map(p => ({
          id: p.id,
          vector: p.vector as number[],
          payload: p.payload as Record<string, unknown>
        })),
        next_page_offset: result.next_page_offset != null ? String(result.next_page_offset) : undefined
      };
    } catch (error: any) {
      throw new VectorError(`Failed to scroll collection: ${error.message}`, error);
    }
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    // Save and close cache
    if (this.cache) {
      await this.cache.close();
      this.cache = null;
    }

    this.connected = false;
    this.client = null;
    this.openai = null;
  }

  /**
   * Get embedding cache statistics
   */
  async getCacheStats(): Promise<CacheStats | null> {
    if (!this.cache) return null;
    return this.cache.getStats();
  }

  /**
   * Export embeddings from cache for sharing
   */
  async exportEmbeddings(embeddingIds?: string[]): Promise<{
    version: string;
    model: string;
    dimensions: number;
    exportedAt: string;
    embeddings: Array<{ id: string; textHash: string; vector: number[] }>;
  } | null> {
    if (!this.cache) return null;
    return this.cache.export(embeddingIds);
  }

  /**
   * Import embeddings into cache (from another developer or branch)
   */
  async importEmbeddings(data: {
    model: string;
    embeddings: Array<{ id: string; textHash: string; vector: number[] }>;
  }): Promise<{ imported: number; skipped: number }> {
    if (!this.cache) {
      throw new VectorError('Embedding cache not enabled');
    }
    return this.cache.import(data);
  }

  /**
   * Clear the embedding cache
   */
  async clearCache(): Promise<void> {
    if (this.cache) {
      await this.cache.clear();
    }
  }

  /**
   * Check if caching is enabled
   */
  isCacheEnabled(): boolean {
    return this.cacheEnabled && this.cache !== null;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the repository ID (if using isolated mode)
   */
  getRepoId(): string | undefined {
    return this.repoId;
  }

  /**
   * Get the current collection names
   */
  getCollectionNames(): VectorCollections {
    return { ...this.collections };
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
 * @param options - VectorManagerOptions or legacy positional args
 */
export function createVectorManager(options: VectorManagerOptions): VectorManager;
/** @deprecated Use options object: createVectorManager({ url, openrouterApiKey, openaiApiKey, collections }) */
export function createVectorManager(url: string, openaiApiKey?: string, collections?: Partial<VectorCollections>): VectorManager;
export function createVectorManager(
  urlOrOptions: string | VectorManagerOptions,
  openaiApiKey?: string,
  collections?: Partial<VectorCollections>
): VectorManager {
  if (typeof urlOrOptions === 'string') {
    // Legacy signature - still works but OpenRouter will be preferred if OPENROUTER_API_KEY env var is set
    return new VectorManager(urlOrOptions, openaiApiKey, collections);
  }
  return new VectorManager(urlOrOptions);
}

// Re-export cache types for external use
export { EmbeddingCache, createEmbeddingCache, CacheStats } from './embedding-cache.js';
export type { EmbeddingMetadata, EmbeddingIndex, EmbeddingCacheConfig } from './embedding-cache.js';

/**
 * Standalone embedding generation function
 *
 * Useful for generating query embeddings without a full VectorManager.
 * Uses OpenRouter or OpenAI based on available API keys.
 */
export interface CreateEmbeddingOptions {
  openrouterApiKey?: string;
  openaiApiKey?: string;
  model?: string;
}

export async function createEmbedding(
  text: string,
  options: CreateEmbeddingOptions
): Promise<number[]> {
  const { openrouterApiKey, openaiApiKey, model } = options;

  // Prefer OpenRouter if available
  if (openrouterApiKey) {
    const embeddingModel = model || 'openai/text-embedding-3-small';
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/controlVector/cv-git',
        'X-Title': 'CV-Git',
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new VectorError(`OpenRouter embedding failed: ${response.status} ${errorText}`);
    }

    const result = await response.json() as { data: Array<{ embedding: number[] }> };
    return result.data[0].embedding;
  }

  // Fall back to OpenAI
  if (openaiApiKey) {
    const embeddingModel = model || 'text-embedding-3-small';
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new VectorError(`OpenAI embedding failed: ${response.status} ${errorText}`);
    }

    const result = await response.json() as { data: Array<{ embedding: number[] }> };
    return result.data[0].embedding;
  }

  throw new VectorError(
    'No embedding API key provided. Set openrouterApiKey or openaiApiKey.'
  );
}

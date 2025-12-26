/**
 * cvPRD API Client
 * Provides integration with cvPRD for requirements management
 */

import {
  Chunk,
  PRD,
  AIContext,
  SearchRequest,
  SearchResult,
  Status,
  RelationshipType,
  ImplementationLink,
  ChunkType,
  UnifiedContext,
  FullTraceability,
  TestCoverage,
  DocCoverage,
  GenerateTestsRequest,
  GenerateTestsResponse,
  GenerateDocsResponse,
  GenerateReleaseNotesRequest,
  ReleaseNotes,
  ChunkContext,
} from './types.js';

export interface PRDClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
}

export class PRDClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;

  constructor(config: PRDClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 30000;
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>)
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`cvPRD API error (${response.status}): ${error}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if cvPRD is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.fetch('/api/v1/health');
      return true;
    } catch {
      return false;
    }
  }

  // ========== PRD Operations ==========

  /**
   * Get a PRD by ID
   */
  async getPRD(prdId: string): Promise<PRD> {
    return this.fetch<PRD>(`/api/v1/prds/${prdId}`);
  }

  /**
   * List all PRDs
   */
  async listPRDs(options?: {
    status?: Status;
    tags?: string[];
    limit?: number;
  }): Promise<PRD[]> {
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.tags) params.set('tags', options.tags.join(','));
    if (options?.limit) params.set('limit', options.limit.toString());

    const query = params.toString();
    return this.fetch<PRD[]>(`/api/v1/prds${query ? `?${query}` : ''}`);
  }

  // ========== Chunk Operations ==========

  /**
   * Get a chunk by ID
   */
  async getChunk(chunkId: string): Promise<Chunk> {
    return this.fetch<Chunk>(`/api/v1/chunks/${chunkId}`);
  }

  /**
   * Get chunks for a PRD
   */
  async getChunksForPRD(prdId: string): Promise<Chunk[]> {
    return this.fetch<Chunk[]>(`/api/v1/prds/${prdId}/chunks`);
  }

  /**
   * Update chunk status
   */
  async updateChunkStatus(chunkId: string, status: Status): Promise<Chunk> {
    return this.fetch<Chunk>(`/api/v1/chunks/${chunkId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        metadata: { status }
      })
    });
  }

  /**
   * Update chunk metadata
   */
  async updateChunkMetadata(
    chunkId: string,
    metadata: Partial<Chunk['metadata']>
  ): Promise<Chunk> {
    return this.fetch<Chunk>(`/api/v1/chunks/${chunkId}`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata })
    });
  }

  // ========== Context Operations ==========

  /**
   * Get AI context for a chunk (includes dependencies)
   */
  async getContext(
    chunkId: string,
    options?: {
      depth?: number;
      maxTokens?: number;
      strategy?: 'direct' | 'expanded' | 'full' | 'summarized';
    }
  ): Promise<AIContext> {
    const params = new URLSearchParams();
    if (options?.depth) params.set('depth', options.depth.toString());
    if (options?.maxTokens) params.set('max_tokens', options.maxTokens.toString());
    if (options?.strategy) params.set('strategy', options.strategy);

    const query = params.toString();
    return this.fetch<AIContext>(
      `/api/v1/chunks/${chunkId}/context${query ? `?${query}` : ''}`
    );
  }

  /**
   * Get context for multiple chunks
   */
  async getContextBatch(
    chunkIds: string[],
    options?: {
      depth?: number;
      maxTokens?: number;
    }
  ): Promise<AIContext[]> {
    return this.fetch<AIContext[]>('/api/v1/context/batch', {
      method: 'POST',
      body: JSON.stringify({
        chunk_ids: chunkIds,
        ...options
      })
    });
  }

  // ========== Graph Operations ==========

  /**
   * Get dependencies of a chunk
   */
  async getDependencies(
    chunkId: string,
    depth: number = 3
  ): Promise<{ direct: Chunk[]; transitive: Chunk[]; circular: Chunk[] }> {
    return this.fetch(
      `/api/v1/graph/chunks/${chunkId}/dependencies?depth=${depth}`
    );
  }

  /**
   * Get chunks that depend on this chunk
   */
  async getDependents(chunkId: string): Promise<Chunk[]> {
    return this.fetch<Chunk[]>(`/api/v1/graph/chunks/${chunkId}/dependents`);
  }

  /**
   * Create a relationship between chunks
   */
  async createRelationship(
    sourceChunkId: string,
    targetChunkId: string,
    relationshipType: RelationshipType,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.fetch('/api/v1/graph/relationships', {
      method: 'POST',
      body: JSON.stringify({
        source_chunk_id: sourceChunkId,
        target_chunk_id: targetChunkId,
        relationship_type: relationshipType,
        metadata: metadata || {}
      })
    });
  }

  // ========== Search Operations ==========

  /**
   * Semantic search for chunks
   */
  async search(request: SearchRequest): Promise<SearchResult[]> {
    return this.fetch<SearchResult[]>('/api/v1/search/semantic', {
      method: 'POST',
      body: JSON.stringify(request)
    });
  }

  /**
   * Find chunks by tag
   */
  async findByTag(tag: string, limit: number = 20): Promise<Chunk[]> {
    return this.fetch<Chunk[]>(`/api/v1/chunks?tags=${tag}&limit=${limit}`);
  }

  // ========== Implementation Tracking ==========

  /**
   * Link code implementation to a requirement
   */
  async linkImplementation(
    chunkId: string,
    implementation: {
      commit_sha: string;
      symbols: string[];
      files: string[];
    }
  ): Promise<void> {
    await this.fetch(`/api/v1/chunks/${chunkId}/implementations`, {
      method: 'POST',
      body: JSON.stringify(implementation)
    });

    // Also update status to implemented
    await this.updateChunkStatus(chunkId, 'implemented');
  }

  /**
   * Get implementations for a chunk
   */
  async getImplementations(chunkId: string): Promise<ImplementationLink[]> {
    return this.fetch<ImplementationLink[]>(
      `/api/v1/chunks/${chunkId}/implementations`
    );
  }

  /**
   * Find requirements by commit
   */
  async findRequirementsByCommit(commitSha: string): Promise<Chunk[]> {
    return this.fetch<Chunk[]>(
      `/api/v1/implementations/by-commit/${commitSha}`
    );
  }

  // ========== Unified Context Operations (AI Traversal) ==========

  /**
   * Get unified context for AI traversal across all artifact types.
   * Returns matching chunks with related tests, documentation, designs,
   * and code implementations.
   */
  async getUnifiedContext(
    query: string,
    options?: {
      prdId?: string;
      includeTypes?: ChunkType[];
      depth?: number;
      format?: 'structured' | 'narrative';
    }
  ): Promise<UnifiedContext> {
    return this.fetch<UnifiedContext>('/api/v1/context/unified', {
      method: 'POST',
      body: JSON.stringify({
        query,
        prd_id: options?.prdId,
        include_types: options?.includeTypes,
        depth: options?.depth || 3,
        format: options?.format || 'structured'
      })
    });
  }

  /**
   * Get complete traceability for a chunk.
   * Returns dependencies, tests, documentation, designs, and implementations.
   */
  async getFullTraceability(
    chunkId: string,
    depth: number = 3
  ): Promise<FullTraceability> {
    return this.fetch<FullTraceability>(
      `/api/v1/traceability/full/${chunkId}?depth=${depth}`
    );
  }

  // ========== Test Operations ==========

  /**
   * Get test cases for a requirement
   */
  async getTestsForRequirement(chunkId: string): Promise<ChunkContext[]> {
    return this.fetch<ChunkContext[]>(`/api/v1/chunks/${chunkId}/tests`);
  }

  /**
   * Generate test cases for a requirement
   */
  async generateTests(
    chunkId: string,
    options?: GenerateTestsRequest
  ): Promise<GenerateTestsResponse> {
    return this.fetch<GenerateTestsResponse>(
      `/api/v1/chunks/${chunkId}/generate-tests`,
      {
        method: 'POST',
        body: JSON.stringify(options || {})
      }
    );
  }

  /**
   * Generate a complete test suite for a PRD
   */
  async generateTestSuite(
    prdId: string,
    framework?: 'pytest' | 'jest' | 'mocha' | 'vitest'
  ): Promise<{
    prd_id: string;
    total_requirements: number;
    total_tests_generated: number;
    test_cases: any[];
    coverage: TestCoverage;
  }> {
    return this.fetch(`/api/v1/prds/${prdId}/generate-test-suite`, {
      method: 'POST',
      body: JSON.stringify({ framework })
    });
  }

  /**
   * Get test coverage metrics for a PRD
   */
  async getTestCoverage(prdId: string): Promise<TestCoverage> {
    return this.fetch<TestCoverage>(`/api/v1/prds/${prdId}/test-coverage`);
  }

  // ========== Documentation Operations ==========

  /**
   * Get documentation for a requirement
   */
  async getDocumentationForRequirement(chunkId: string): Promise<ChunkContext[]> {
    return this.fetch<ChunkContext[]>(`/api/v1/chunks/${chunkId}/documentation`);
  }

  /**
   * Generate user manual from PRD
   */
  async generateUserManual(
    prdId: string,
    audience: string = 'end users'
  ): Promise<GenerateDocsResponse> {
    return this.fetch<GenerateDocsResponse>(
      `/api/v1/prds/${prdId}/generate-user-manual?audience=${encodeURIComponent(audience)}`,
      { method: 'POST' }
    );
  }

  /**
   * Generate API documentation from PRD
   */
  async generateApiDocs(prdId: string): Promise<GenerateDocsResponse> {
    return this.fetch<GenerateDocsResponse>(
      `/api/v1/prds/${prdId}/generate-api-docs`,
      { method: 'POST' }
    );
  }

  /**
   * Generate technical specification from PRD
   */
  async generateTechnicalSpec(prdId: string): Promise<GenerateDocsResponse> {
    return this.fetch<GenerateDocsResponse>(
      `/api/v1/prds/${prdId}/generate-technical-spec`,
      { method: 'POST' }
    );
  }

  /**
   * Generate release notes
   */
  async generateReleaseNotes(
    prdId: string,
    request: GenerateReleaseNotesRequest
  ): Promise<ReleaseNotes> {
    return this.fetch<ReleaseNotes>(
      `/api/v1/prds/${prdId}/generate-release-notes`,
      {
        method: 'POST',
        body: JSON.stringify(request)
      }
    );
  }

  /**
   * Get documentation coverage metrics for a PRD
   */
  async getDocumentationCoverage(prdId: string): Promise<DocCoverage> {
    return this.fetch<DocCoverage>(`/api/v1/prds/${prdId}/documentation-coverage`);
  }

  // ========== Utility Methods ==========

  /**
   * Extract PRD references from text (PRD-123, REQ-456, etc.)
   */
  static extractPRDReferences(text: string): string[] {
    const pattern = /(PRD|REQ|FEAT|CHUNK)-[a-zA-Z0-9-]+/gi;
    const matches = text.match(pattern) || [];
    return [...new Set(matches)]; // Deduplicate
  }

  /**
   * Format context for AI prompt
   */
  static formatContextForPrompt(context: AIContext): string {
    const parts: string[] = [];

    // Primary requirement
    parts.push(`## Primary Requirement`);
    parts.push(context.primary_chunk.text);
    parts.push(`Type: ${context.primary_chunk.chunk_type}`);
    parts.push(`Priority: ${context.primary_chunk.metadata.priority || 'N/A'}`);
    parts.push('');

    // Dependencies
    if (context.dependencies.length > 0) {
      parts.push(`## Dependencies`);
      for (const dep of context.dependencies) {
        parts.push(`- ${dep.text}`);
      }
      parts.push('');
    }

    // Constraints
    if (context.constraints.length > 0) {
      parts.push(`## Constraints`);
      for (const con of context.constraints) {
        parts.push(`- ${con.text}`);
      }
      parts.push('');
    }

    // Related
    if (context.related.length > 0) {
      parts.push(`## Related Requirements`);
      for (const rel of context.related) {
        parts.push(`- ${rel.text}`);
      }
      parts.push('');
    }

    return parts.join('\n');
  }

  /**
   * Format unified context for AI prompt with full traceability
   */
  static formatUnifiedContextForPrompt(context: UnifiedContext): string {
    const parts: string[] = [];

    parts.push(`## Query: ${context.query}`);
    parts.push(`Found ${context.count} matching chunks`);
    parts.push('');

    // Coverage summary if available
    if (context.coverage.test_coverage) {
      parts.push(`## Coverage Summary`);
      parts.push(`- Test Coverage: ${context.coverage.test_coverage.coverage_percent}%`);
      if (context.coverage.doc_coverage) {
        parts.push(`- Documentation Coverage: ${context.coverage.doc_coverage.coverage_percent}%`);
      }
      parts.push('');
    }

    // Results with traceability
    for (const result of context.results) {
      parts.push(`### ${result.chunk_type.toUpperCase()}`);
      parts.push(result.text);
      parts.push('');

      if (result.traceability) {
        const t = result.traceability;

        if (t.tests.length > 0) {
          parts.push(`**Tests (${t.tests.length}):**`);
          for (const test of t.tests.slice(0, 3)) {
            parts.push(`- ${test.text.slice(0, 100)}...`);
          }
          parts.push('');
        }

        if (t.documentation.length > 0) {
          parts.push(`**Documentation (${t.documentation.length}):**`);
          for (const doc of t.documentation.slice(0, 3)) {
            parts.push(`- ${doc.text.slice(0, 100)}...`);
          }
          parts.push('');
        }

        if (t.implementations.length > 0) {
          parts.push(`**Implementations (${t.implementations.length}):**`);
          for (const impl of t.implementations.slice(0, 3)) {
            parts.push(`- ${impl.symbols.join(', ')} in ${impl.files.join(', ')}`);
          }
          parts.push('');
        }

        if (t.dependencies.length > 0) {
          parts.push(`**Dependencies (${t.dependencies.length}):**`);
          for (const dep of t.dependencies.slice(0, 3)) {
            parts.push(`- ${dep.text.slice(0, 100)}...`);
          }
          parts.push('');
        }
      }

      parts.push('---');
      parts.push('');
    }

    return parts.join('\n');
  }
}

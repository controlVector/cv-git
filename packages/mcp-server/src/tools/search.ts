/**
 * Search Tool Handler
 * Implements cv_find - semantic code search
 *
 * Supports graceful degradation:
 * - Primary: Qdrant vector database
 * - Fallback: Local .cv/vectors/ cache search
 */

import { FindArgs, ToolResult, SearchResult } from '../types.js';
import { successResult, errorResult, formatSearchResults, getServiceUrls } from '../utils.js';
import {
  configManager,
  createVectorManager,
  hasLocalVectors,
  searchLocalVectors,
  createEmbedding,
} from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';
import { getOpenAIApiKey, getOpenRouterApiKey } from '../credentials.js';

/**
 * Handle cv_find tool call
 */
export async function handleFind(args: FindArgs): Promise<ToolResult> {
  try {
    const { query, limit = 10, minScore = 0.5, language, file } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Get API keys from credential manager
    const openaiApiKey = config.ai.apiKey || await getOpenAIApiKey();
    const openrouterApiKey = await getOpenRouterApiKey();

    if (!openaiApiKey && !openrouterApiKey) {
      return errorResult(
        'No embedding API key found. Run `cv auth setup openai` or `cv auth setup openrouter`.'
      );
    }

    // Try Qdrant first, fall back to local cache if unavailable
    let results: SearchResult[] = [];
    let usedFallback = false;

    try {
      // Get service URLs (checks services.json for dynamic ports first)
      const serviceUrls = await getServiceUrls(config);

      // Initialize vector manager with proper options
      const vector = createVectorManager({
        url: serviceUrls.qdrant,
        openrouterApiKey,
        openaiApiKey,
        collections: config.vector.collections,
      });

      await vector.connect();

      // Perform search
      const vectorResults = await vector.searchCode(query, limit, {
        language,
        file,
        minScore,
      });

      await vector.close();

      // Map VectorSearchResult<CodeChunkPayload> to SearchResult
      results = vectorResults.map(vr => ({
        file: vr.payload.file,
        startLine: vr.payload.startLine,
        endLine: vr.payload.endLine,
        symbolName: vr.payload.symbolName,
        language: vr.payload.language,
        text: vr.payload.text,
        score: vr.score,
        docstring: vr.payload.docstring,
      }));
    } catch (qdrantError: any) {
      // Qdrant unavailable - try local fallback
      const hasLocal = await hasLocalVectors(repoRoot);

      if (!hasLocal) {
        return errorResult(
          'Qdrant unavailable and no local vector cache found.\n' +
          'Start Qdrant: docker run -d -p 6333:6333 qdrant/qdrant\n' +
          'Or run `cv sync` to populate the local cache.'
        );
      }

      // Generate embedding for query
      const queryVector = await createEmbedding(query, {
        openrouterApiKey,
        openaiApiKey,
      });

      // Search local cache
      const localResults = await searchLocalVectors(repoRoot, queryVector, limit, {
        minScore,
        language,
        file,
      });

      results = localResults.map(lr => ({
        file: lr.payload.file,
        startLine: lr.payload.startLine,
        endLine: lr.payload.endLine,
        symbolName: lr.payload.symbolName,
        language: lr.payload.language,
        text: lr.text,
        score: lr.score,
      }));

      usedFallback = true;
    }

    // Format and return results
    let formattedResults = formatSearchResults(results);

    if (usedFallback) {
      formattedResults = '(Using local cache - Qdrant unavailable)\n\n' + formattedResults;
    }

    return successResult(formattedResults);
  } catch (error: any) {
    return errorResult('Code search failed', error);
  }
}

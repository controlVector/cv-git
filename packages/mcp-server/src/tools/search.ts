/**
 * Search Tool Handler
 * Implements cv_find - semantic code search
 */

import { FindArgs, ToolResult, SearchResult } from '../types.js';
import { successResult, errorResult, formatSearchResults } from '../utils.js';
import {
  configManager,
  createVectorManager,
} from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';

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

    // Check for OpenAI API key
    const openaiApiKey = config.ai.apiKey || process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return errorResult(
        'OpenAI API key not found. Set OPENAI_API_KEY environment variable or configure with `cv config set ai.apiKey <key>`'
      );
    }

    // Initialize vector manager
    const vector = createVectorManager(
      config.vector.url,
      openaiApiKey,
      config.vector.collections
    );

    await vector.connect();

    // Perform search
    const vectorResults = await vector.searchCode(query, limit, {
      language,
      file,
      minScore,
    });

    await vector.close();

    // Map VectorSearchResult<CodeChunkPayload> to SearchResult
    const results: SearchResult[] = vectorResults.map(vr => ({
      file: vr.payload.file,
      startLine: vr.payload.startLine,
      endLine: vr.payload.endLine,
      symbolName: vr.payload.symbolName,
      language: vr.payload.language,
      text: vr.payload.text,
      score: vr.score,
      docstring: vr.payload.docstring,
    }));

    // Format and return results
    const formattedResults = formatSearchResults(results);
    return successResult(formattedResults);
  } catch (error: any) {
    return errorResult('Code search failed', error);
  }
}

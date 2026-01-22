/**
 * Reason Tool Handler
 * Implements cv_reason - RLM-powered deep codebase reasoning
 */

import { ToolResult } from '../types.js';
import { successResult, errorResult, createIsolatedGraphManager } from '../utils.js';
import {
  configManager,
  createVectorManager,
  createGitManager,
  createRLMRouter,
  RLMResult
} from '@cv-git/core';
import { getAnthropicApiKey, getEmbeddingCredentials } from '../credentials.js';

/**
 * Tool arguments for cv_reason
 */
export interface ReasonArgs {
  /** The query to reason about */
  query: string;
  /** Maximum recursion depth (default: 5) */
  maxDepth?: number;
  /** Include reasoning trace in output */
  showTrace?: boolean;
}

/**
 * Format RLM result as text output
 */
function formatReasonResult(result: RLMResult, showTrace: boolean): string {
  const lines: string[] = [];

  // Header
  lines.push('# Deep Reasoning Result\n');

  // Summary
  lines.push(`**Reasoning Depth:** ${result.depth}`);
  lines.push(`**Sources Found:** ${result.sources.length}`);
  lines.push('');

  // Sources
  if (result.sources.length > 0) {
    lines.push('## Sources');
    result.sources.slice(0, 15).forEach(source => {
      lines.push(`- \`${source}\``);
    });
    if (result.sources.length > 15) {
      lines.push(`- ... and ${result.sources.length - 15} more`);
    }
    lines.push('');
  }

  // Trace (if requested)
  if (showTrace && result.trace.length > 0) {
    lines.push('## Reasoning Trace');
    lines.push('');

    result.trace.forEach((step, i) => {
      const indent = '  '.repeat(step.depth);
      const duration = step.duration ? ` *(${step.duration}ms)*` : '';

      lines.push(`${indent}${i + 1}. **${step.taskType}**${duration}`);
      lines.push(`${indent}   Query: ${step.query.substring(0, 100)}${step.query.length > 100 ? '...' : ''}`);

      // Brief result summary
      if (step.result?.error) {
        lines.push(`${indent}   Result: Error - ${step.result.error}`);
      } else if (step.result?.type === 'vector_search') {
        lines.push(`${indent}   Result: ${step.result.results?.length || 0} matches`);
      } else if (step.result?.type === 'callers' || step.result?.type === 'callees') {
        lines.push(`${indent}   Result: ${step.result.results?.length || 0} ${step.result.type}`);
      } else if (step.result?.type === 'symbol') {
        lines.push(`${indent}   Result: Found ${step.result.result?.name || 'symbol'}`);
      }

      lines.push('');
    });
  }

  // Answer
  lines.push('## Answer');
  lines.push('');
  lines.push(result.answer);

  return lines.join('\n');
}

/**
 * Handle cv_reason tool call
 */
export async function handleReason(args: ReasonArgs): Promise<ToolResult> {
  try {
    const { query, maxDepth = 5, showTrace = false } = args;

    // Initialize graph manager with repo isolation
    const { graph, repoRoot } = await createIsolatedGraphManager();
    await graph.connect();

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Get API key
    const anthropicApiKey = config.ai.apiKey || await getAnthropicApiKey();
    if (!anthropicApiKey) {
      return errorResult(
        'Anthropic API key not found. Run `cv auth setup anthropic`.'
      );
    }

    // Get embedding credentials for vector search
    const embeddingCreds = await getEmbeddingCredentials();

    // Initialize managers
    const git = createGitManager(repoRoot);

    // Initialize vector manager (optional but recommended)
    let vector = undefined;
    if ((embeddingCreds.openrouterApiKey || embeddingCreds.openaiApiKey) && config.vector) {
      try {
        vector = createVectorManager({
          url: config.vector.url,
          openrouterApiKey: embeddingCreds.openrouterApiKey,
          openaiApiKey: embeddingCreds.openaiApiKey,
          collections: config.vector.collections,
          embeddingModel: config.embedding?.model
        });
        await vector.connect();
      } catch (error) {
        // Continue without vector search - graph queries still work
        console.warn('Vector manager not available - semantic search disabled');
      }
    }

    // Create RLM Router
    const rlm = createRLMRouter(
      {
        apiKey: anthropicApiKey,
        model: config.ai.model || 'claude-sonnet-4-5-20250514',
        maxDepth: maxDepth,
        maxTokens: config.ai.maxTokens
      },
      vector,
      graph,
      git
    );

    // Execute deep reasoning
    const result = await rlm.reason(query);

    // Format output
    const formattedOutput = formatReasonResult(result, showTrace);

    // Cleanup
    await graph.close();
    if (vector) await vector.close();

    return successResult(formattedOutput);

  } catch (error: any) {
    return errorResult('Deep reasoning failed', error);
  }
}

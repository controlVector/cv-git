/**
 * Traverse Context Tool Handler
 * Implements cv_traverse_context - traversal-aware dynamic context for Claude Code
 *
 * Tracks position in the codebase and provides context at the appropriate level:
 * - Repo level: Codebase overview
 * - Module level: Directory contents and summaries
 * - File level: Symbol list, imports, file summary
 * - Symbol level: Code, callers, callees, docstring
 */

import { ToolResult } from '../types.js';
import { successResult, errorResult, createIsolatedGraphManager, getServiceUrls } from '../utils.js';
import {
  configManager,
  createVectorManager,
  createGraphService,
  createSessionService,
  createTraversalService
} from '@cv-git/core';
import {
  findRepoRoot,
  TraverseContextArgs,
  TraversalDirection,
  TraversalContextResult
} from '@cv-git/shared';
import { getOpenAIApiKey, getOpenRouterApiKey } from '../credentials.js';
import * as path from 'path';

/**
 * Tool arguments interface
 */
export interface TraverseContextToolArgs {
  /** Target file path */
  file?: string;
  /** Target symbol name */
  symbol?: string;
  /** Target module/directory */
  module?: string;
  /** Navigation direction: 'in' (drill down), 'out' (zoom out), 'lateral' (sibling), 'jump' (direct), 'stay' (refresh) */
  direction?: string;
  /** Session ID for stateful navigation (auto-generated if not provided) */
  sessionId?: string;
  /** Include callers of current symbol */
  includeCallers?: boolean;
  /** Include callees of current symbol */
  includeCallees?: boolean;
  /** Output format: 'xml' (default, optimized for Claude), 'markdown', 'json' */
  format?: 'xml' | 'markdown' | 'json';
  /** Token budget for context */
  budget?: number;
}

/**
 * Handle cv_traverse_context tool call
 */
export async function handleTraverseContext(args: TraverseContextToolArgs): Promise<ToolResult> {
  try {
    const {
      file,
      symbol,
      module,
      direction = 'jump',
      sessionId,
      includeCallers = true,
      includeCallees = true,
      format = 'xml',
      budget = 4000
    } = args;

    // Validate direction
    const validDirections: TraversalDirection[] = ['in', 'out', 'lateral', 'jump', 'stay'];
    if (!validDirections.includes(direction as TraversalDirection)) {
      return errorResult(
        `Invalid direction: ${direction}. Must be one of: ${validDirections.join(', ')}`
      );
    }

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Get API keys
    const openaiApiKey = config.ai.apiKey || await getOpenAIApiKey();
    const openrouterApiKey = await getOpenRouterApiKey();

    if (!openaiApiKey && !openrouterApiKey) {
      return errorResult(
        'No embedding API key found. Run `cv auth setup openai` or `cv auth setup openrouter`.'
      );
    }

    // Get service URLs
    const serviceUrls = await getServiceUrls(config);

    // Initialize services
    const vector = createVectorManager({
      url: serviceUrls.qdrant,
      openrouterApiKey,
      openaiApiKey,
      collections: config.vector.collections,
      repoId: path.basename(repoRoot)
    });

    let graph;
    try {
      const isolated = await createIsolatedGraphManager(repoRoot);
      graph = isolated.graph;
      await graph.connect();
    } catch (graphError: any) {
      return errorResult(
        'FalkorDB unavailable. Start with: docker run -d -p 6379:6379 falkordb/falkordb\n' +
        `Error: ${graphError.message}`
      );
    }

    try {
      await vector.connect();
    } catch (vectorError: any) {
      await graph.close();
      return errorResult(
        'Qdrant unavailable. Start with: docker run -d -p 6333:6333 qdrant/qdrant\n' +
        `Error: ${vectorError.message}`
      );
    }

    // Create services
    const graphService = createGraphService(graph);
    const sessionService = createSessionService({
      persistToDisk: true,
      persistDir: path.join(repoRoot, '.cv', 'sessions')
    });
    const traversalService = createTraversalService(graph, vector, graphService, sessionService);

    // Build traversal args
    const traverseArgs: TraverseContextArgs = {
      file,
      symbol,
      module,
      direction: direction as TraversalDirection,
      sessionId,
      includeCallers,
      includeCallees,
      format,
      budget
    };

    // Execute traversal
    const result = await traversalService.traverse(traverseArgs);

    // Format output
    let output: string;
    switch (format) {
      case 'json':
        output = formatJSON(result);
        break;
      case 'markdown':
        output = formatMarkdown(result);
        break;
      case 'xml':
      default:
        output = formatXML(result);
        break;
    }

    // Cleanup
    await vector.close();
    await graph.close();
    await sessionService.close();

    return successResult(output);

  } catch (error: any) {
    return errorResult('Failed to traverse context', error);
  }
}

/**
 * Format result as XML (optimized for Claude)
 */
function formatXML(result: TraversalContextResult): string {
  const lines: string[] = [];
  const { position, sessionId, context, hints } = result;

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<traverse_context>');

  // Session info
  lines.push('  <session>');
  lines.push(`    <id>${sessionId}</id>`);
  lines.push(`    <depth>${position.depth}</depth>`);
  if (position.module) lines.push(`    <module>${escapeXML(position.module)}</module>`);
  if (position.file) lines.push(`    <file>${escapeXML(position.file)}</file>`);
  if (position.symbol) lines.push(`    <symbol>${escapeXML(position.symbol)}</symbol>`);
  lines.push('  </session>');

  // Context
  lines.push('  <context>');

  if (context.summary) {
    lines.push(`    <summary>${escapeXML(context.summary)}</summary>`);
  }

  if (context.code) {
    lines.push('    <code><![CDATA[');
    lines.push(context.code);
    lines.push('    ]]></code>');
  }

  if (context.files && context.files.length > 0) {
    lines.push('    <files>');
    for (const file of context.files) {
      lines.push(`      <file path="${escapeXML(file.path)}"${file.summary ? ` summary="${escapeXML(file.summary)}"` : ''}/>`);
    }
    lines.push('    </files>');
  }

  if (context.symbols && context.symbols.length > 0) {
    lines.push('    <symbols>');
    for (const sym of context.symbols) {
      lines.push(`      <symbol name="${escapeXML(sym.name)}" kind="${sym.kind}"${sym.summary ? ` summary="${escapeXML(sym.summary)}"` : ''}/>`);
    }
    lines.push('    </symbols>');
  }

  if (context.callers && context.callers.length > 0) {
    lines.push('    <callers>');
    for (const caller of context.callers) {
      lines.push(`      <caller name="${escapeXML(caller.name)}" file="${escapeXML(caller.file)}"/>`);
    }
    lines.push('    </callers>');
  }

  if (context.callees && context.callees.length > 0) {
    lines.push('    <callees>');
    for (const callee of context.callees) {
      lines.push(`      <callee name="${escapeXML(callee.name)}" file="${escapeXML(callee.file)}"/>`);
    }
    lines.push('    </callees>');
  }

  if (context.imports && context.imports.length > 0) {
    lines.push('    <imports>');
    for (const imp of context.imports) {
      lines.push(`      <import>${escapeXML(imp)}</import>`);
    }
    lines.push('    </imports>');
  }

  lines.push('  </context>');

  // Navigation hints
  if (hints.length > 0) {
    lines.push('  <hints>');
    for (const hint of hints) {
      lines.push(`    <hint>${escapeXML(hint)}</hint>`);
    }
    lines.push('  </hints>');
  }

  lines.push('</traverse_context>');
  return lines.join('\n');
}

/**
 * Format result as Markdown
 */
function formatMarkdown(result: TraversalContextResult): string {
  const lines: string[] = [];
  const { position, sessionId, context, hints } = result;

  lines.push('# Traverse Context');
  lines.push('');

  // Position info
  lines.push('## Current Position');
  lines.push('');
  lines.push(`- **Session**: \`${sessionId}\``);
  lines.push(`- **Depth**: ${position.depth} (${getDepthLabel(position.depth)})`);
  if (position.module) lines.push(`- **Module**: \`${position.module}\``);
  if (position.file) lines.push(`- **File**: \`${position.file}\``);
  if (position.symbol) lines.push(`- **Symbol**: \`${position.symbol}\``);
  lines.push('');

  // Summary
  if (context.summary) {
    lines.push('## Summary');
    lines.push('');
    lines.push(context.summary);
    lines.push('');
  }

  // Code
  if (context.code) {
    lines.push('## Code');
    lines.push('');
    lines.push('```');
    lines.push(context.code);
    lines.push('```');
    lines.push('');
  }

  // Files
  if (context.files && context.files.length > 0) {
    lines.push('## Files');
    lines.push('');
    for (const file of context.files) {
      lines.push(`- \`${file.path}\`${file.summary ? ` - ${file.summary}` : ''}`);
    }
    lines.push('');
  }

  // Symbols
  if (context.symbols && context.symbols.length > 0) {
    lines.push('## Symbols');
    lines.push('');
    for (const sym of context.symbols) {
      lines.push(`- **${sym.kind}** \`${sym.name}\`${sym.summary ? ` - ${sym.summary}` : ''}`);
    }
    lines.push('');
  }

  // Callers
  if (context.callers && context.callers.length > 0) {
    lines.push('## Called By');
    lines.push('');
    for (const caller of context.callers) {
      lines.push(`- \`${caller.name}\` in \`${caller.file}\``);
    }
    lines.push('');
  }

  // Callees
  if (context.callees && context.callees.length > 0) {
    lines.push('## Calls');
    lines.push('');
    for (const callee of context.callees) {
      lines.push(`- \`${callee.name}\` in \`${callee.file}\``);
    }
    lines.push('');
  }

  // Imports
  if (context.imports && context.imports.length > 0) {
    lines.push('## Imports');
    lines.push('');
    for (const imp of context.imports) {
      lines.push(`- \`${imp}\``);
    }
    lines.push('');
  }

  // Hints
  if (hints.length > 0) {
    lines.push('## Navigation Hints');
    lines.push('');
    for (const hint of hints) {
      lines.push(`> ${hint}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format result as JSON
 */
function formatJSON(result: TraversalContextResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Get human-readable label for depth
 */
function getDepthLabel(depth: number): string {
  switch (depth) {
    case 0: return 'Repository';
    case 1: return 'Module';
    case 2: return 'File';
    case 3: return 'Symbol';
    default: return 'Unknown';
  }
}

/**
 * Escape XML special characters
 */
function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

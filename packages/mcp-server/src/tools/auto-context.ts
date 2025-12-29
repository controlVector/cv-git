/**
 * Auto Context Tool Handler
 * Implements cv_auto_context - proactive context retrieval for AI assistants
 *
 * This tool is designed to be called FIRST before any coding task to
 * automatically inject relevant knowledge graph context into the AI's context.
 */

import { ToolResult } from '../types.js';
import { successResult, errorResult } from '../utils.js';
import {
  configManager,
  createVectorManager,
  createGraphManager,
} from '@cv-git/core';
import { findRepoRoot, VectorSearchResult, CodeChunkPayload, SymbolNode } from '@cv-git/shared';
import { promises as fs } from 'fs';
import * as path from 'path';
import { getOpenAIApiKey, getOpenRouterApiKey } from '../credentials.js';

export interface AutoContextArgs {
  query: string;
  currentFile?: string;
  format?: 'xml' | 'markdown' | 'json';
  budget?: number;
  includeRequirements?: boolean;
  includeDocs?: boolean;
}

interface ContextBudget {
  semantic: number;
  graph: number;
  files: number;
  docs: number;
}

/**
 * Handle cv_auto_context tool call
 *
 * This is optimized for proactive context injection:
 * - Returns structured output suitable for system prompts
 * - Respects token budgets
 * - Multi-signal relevance ranking
 */
export async function handleAutoContext(args: AutoContextArgs): Promise<ToolResult> {
  try {
    const {
      query,
      currentFile,
      format = 'xml',
      budget = 20000,
      includeRequirements = true,
      includeDocs = true,
    } = args;

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

    // Calculate budget allocation
    const budgetAllocation = calculateBudget(budget, {
      hasCurrentFile: !!currentFile,
      includeRequirements,
      includeDocs,
    });

    // Initialize managers
    const vector = createVectorManager({
      url: config.vector.url,
      openrouterApiKey,
      openaiApiKey,
      collections: config.vector.collections,
    });
    await vector.connect();

    let graph = null;
    try {
      graph = createGraphManager(config.graph.url, config.graph.database);
      await graph.connect();
    } catch {
      // Graph is optional
    }

    // 1. Get semantic matches for the query
    const semanticChunks = await vector.searchCode(query, 10, { minScore: 0.5 });

    // 2. If currentFile provided, get its context
    let currentFileContext: { content: string; symbols: string[] } | null = null;
    if (currentFile) {
      try {
        const fullPath = path.isAbsolute(currentFile)
          ? currentFile
          : path.join(repoRoot, currentFile);
        const content = await fs.readFile(fullPath, 'utf-8');

        // Get symbols from this file via graph
        let symbols: string[] = [];
        if (graph) {
          try {
            const symbolQuery = `
              MATCH (f:File {path: '${currentFile}'})-[:DEFINES]->(s:Symbol)
              RETURN s.name as name
              LIMIT 20
            `;
            const results = await graph.query(symbolQuery);
            symbols = results.map((r: any) => r.name);
          } catch {
            // Skip on error
          }
        }

        currentFileContext = { content: truncateToTokens(content, budgetAllocation.files), symbols };
      } catch {
        // File not readable
      }
    }

    // 3. Get graph relationships for top symbols
    const relationships: Map<string, { callers: string[]; callees: string[] }> = new Map();
    if (graph && semanticChunks.length > 0) {
      const symbolNames = semanticChunks
        .slice(0, 5)
        .map(c => c.payload.symbolName)
        .filter((name): name is string => !!name);

      for (const symbolName of symbolNames) {
        try {
          const callers = await graph.getCallers(symbolName);
          const callees = await graph.getCallees(symbolName);
          relationships.set(symbolName, {
            callers: callers.slice(0, 3).map(s => s.name),
            callees: callees.slice(0, 3).map(s => s.name),
          });
        } catch {
          // Skip on error
        }
      }
    }

    // 4. Get relevant documentation if enabled
    let docSnippets: Array<{ title: string; content: string }> = [];
    if (includeDocs) {
      try {
        const docResults = await vector.search('doc_chunks', query, 3, { minScore: 0.5 });
        docSnippets = docResults.map(r => ({
          title: (r.payload as any).title || (r.payload as any).file || 'Documentation',
          content: truncateToTokens((r.payload as any).text || '', Math.floor(budgetAllocation.docs / 3)),
        }));
      } catch {
        // Docs collection might not exist
      }
    }

    // 5. Generate output in requested format
    let output: string;
    switch (format) {
      case 'xml':
        output = generateXMLAutoContext({
          query,
          currentFile,
          currentFileContext,
          chunks: semanticChunks.slice(0, 8),
          relationships,
          docSnippets,
        });
        break;
      case 'json':
        output = generateJSONAutoContext({
          query,
          currentFile,
          currentFileContext,
          chunks: semanticChunks.slice(0, 8),
          relationships,
          docSnippets,
        });
        break;
      case 'markdown':
      default:
        output = generateMarkdownAutoContext({
          query,
          currentFile,
          currentFileContext,
          chunks: semanticChunks.slice(0, 8),
          relationships,
          docSnippets,
        });
        break;
    }

    // Cleanup
    await vector.close();
    if (graph) await graph.close();

    return successResult(output);
  } catch (error: any) {
    return errorResult('Failed to generate auto context', error);
  }
}

/**
 * Calculate budget allocation based on options
 */
function calculateBudget(
  totalBudget: number,
  options: { hasCurrentFile: boolean; includeRequirements: boolean; includeDocs: boolean }
): ContextBudget {
  const { hasCurrentFile, includeDocs } = options;

  // Base allocation
  let semantic = 0.4;
  let graph = 0.2;
  let files = hasCurrentFile ? 0.25 : 0;
  let docs = includeDocs ? 0.15 : 0;

  // Normalize
  const total = semantic + graph + files + docs;
  semantic /= total;
  graph /= total;
  files /= total;
  docs /= total;

  return {
    semantic: Math.floor(totalBudget * semantic),
    graph: Math.floor(totalBudget * graph),
    files: Math.floor(totalBudget * files),
    docs: Math.floor(totalBudget * docs),
  };
}

/**
 * Rough token estimation and truncation
 */
function truncateToTokens(text: string, maxTokens: number): string {
  // Rough estimate: 4 chars per token
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n... (truncated)';
}

interface AutoContextData {
  query: string;
  currentFile?: string;
  currentFileContext: { content: string; symbols: string[] } | null;
  chunks: VectorSearchResult<CodeChunkPayload>[];
  relationships: Map<string, { callers: string[]; callees: string[] }>;
  docSnippets: Array<{ title: string; content: string }>;
}

/**
 * Generate XML output optimized for system prompt injection
 */
function generateXMLAutoContext(data: AutoContextData): string {
  const { query, currentFile, currentFileContext, chunks, relationships, docSnippets } = data;
  const lines: string[] = [];

  lines.push('<knowledge_graph_context>');
  lines.push(`  <query>${escapeXML(query)}</query>`);
  lines.push(`  <generated>${new Date().toISOString()}</generated>`);
  lines.push('');

  // Current file context
  if (currentFileContext && currentFile) {
    lines.push('  <current_file>');
    lines.push(`    <path>${escapeXML(currentFile)}</path>`);
    if (currentFileContext.symbols.length > 0) {
      lines.push(`    <symbols>${currentFileContext.symbols.map(escapeXML).join(', ')}</symbols>`);
    }
    lines.push('    <content><![CDATA[');
    lines.push(currentFileContext.content);
    lines.push('    ]]></content>');
    lines.push('  </current_file>');
    lines.push('');
  }

  // Relevant code
  if (chunks.length > 0) {
    lines.push('  <relevant_code>');
    for (const chunk of chunks) {
      const { payload, score } = chunk;
      lines.push(`    <chunk file="${escapeXML(payload.file)}" lines="${payload.startLine}-${payload.endLine}" score="${(score * 100).toFixed(0)}%">`);
      if (payload.symbolName) {
        lines.push(`      <symbol>${escapeXML(payload.symbolName)}</symbol>`);
      }
      if (payload.docstring) {
        lines.push(`      <description>${escapeXML(payload.docstring.split('\n')[0])}</description>`);
      }
      lines.push(`      <code><![CDATA[${payload.text}]]></code>`);
      lines.push('    </chunk>');
    }
    lines.push('  </relevant_code>');
    lines.push('');
  }

  // Relationships
  if (relationships.size > 0) {
    lines.push('  <code_relationships>');
    for (const [symbol, rels] of relationships) {
      lines.push(`    <symbol name="${escapeXML(symbol)}">`);
      if (rels.callers.length > 0) {
        lines.push(`      <called_by>${rels.callers.map(escapeXML).join(', ')}</called_by>`);
      }
      if (rels.callees.length > 0) {
        lines.push(`      <calls>${rels.callees.map(escapeXML).join(', ')}</calls>`);
      }
      lines.push('    </symbol>');
    }
    lines.push('  </code_relationships>');
    lines.push('');
  }

  // Documentation
  if (docSnippets.length > 0) {
    lines.push('  <documentation>');
    for (const doc of docSnippets) {
      lines.push(`    <doc title="${escapeXML(doc.title)}">`);
      lines.push(`      <![CDATA[${doc.content}]]>`);
      lines.push('    </doc>');
    }
    lines.push('  </documentation>');
  }

  lines.push('</knowledge_graph_context>');
  return lines.join('\n');
}

/**
 * Generate markdown output
 */
function generateMarkdownAutoContext(data: AutoContextData): string {
  const { query, currentFile, currentFileContext, chunks, relationships, docSnippets } = data;
  const lines: string[] = [];

  lines.push('# Knowledge Graph Context');
  lines.push('');
  lines.push(`**Query**: ${query}`);
  lines.push(`**Generated**: ${new Date().toISOString()}`);
  lines.push('');

  // Current file
  if (currentFileContext && currentFile) {
    lines.push(`## Current File: ${currentFile}`);
    lines.push('');
    if (currentFileContext.symbols.length > 0) {
      lines.push(`**Symbols**: ${currentFileContext.symbols.join(', ')}`);
      lines.push('');
    }
    const ext = path.extname(currentFile).slice(1) || '';
    lines.push('```' + ext);
    lines.push(currentFileContext.content);
    lines.push('```');
    lines.push('');
  }

  // Relevant code
  if (chunks.length > 0) {
    lines.push('## Relevant Code');
    lines.push('');
    for (const chunk of chunks) {
      const { payload, score } = chunk;
      lines.push(`### ${payload.symbolName || 'Code'} (${(score * 100).toFixed(0)}% match)`);
      lines.push(`*${payload.file}:${payload.startLine}-${payload.endLine}*`);
      if (payload.docstring) {
        lines.push(`> ${payload.docstring.split('\n')[0]}`);
      }
      lines.push('');
      lines.push('```' + (payload.language || ''));
      lines.push(payload.text);
      lines.push('```');
      lines.push('');
    }
  }

  // Relationships
  if (relationships.size > 0) {
    lines.push('## Code Relationships');
    lines.push('');
    for (const [symbol, rels] of relationships) {
      lines.push(`**${symbol}**`);
      if (rels.callers.length > 0) lines.push(`- Called by: ${rels.callers.join(', ')}`);
      if (rels.callees.length > 0) lines.push(`- Calls: ${rels.callees.join(', ')}`);
      lines.push('');
    }
  }

  // Docs
  if (docSnippets.length > 0) {
    lines.push('## Related Documentation');
    lines.push('');
    for (const doc of docSnippets) {
      lines.push(`### ${doc.title}`);
      lines.push(doc.content);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Generate JSON output
 */
function generateJSONAutoContext(data: AutoContextData): string {
  const { query, currentFile, currentFileContext, chunks, relationships, docSnippets } = data;

  const context = {
    query,
    generated: new Date().toISOString(),
    generator: 'cv-git-auto-context',
    currentFile: currentFile && currentFileContext ? {
      path: currentFile,
      symbols: currentFileContext.symbols,
      content: currentFileContext.content,
    } : null,
    relevantCode: chunks.map(c => ({
      file: c.payload.file,
      lines: `${c.payload.startLine}-${c.payload.endLine}`,
      symbol: c.payload.symbolName,
      score: c.score,
      docstring: c.payload.docstring,
      code: c.payload.text,
    })),
    relationships: Object.fromEntries(relationships),
    documentation: docSnippets,
  };

  return JSON.stringify(context, null, 2);
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

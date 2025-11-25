/**
 * Context Tool Handler
 * Implements cv_context - generate rich context for AI coding assistants
 */

import { ToolResult } from '../types.js';
import { successResult, errorResult } from '../utils.js';
import {
  configManager,
  createVectorManager,
  createGraphManager,
} from '@cv-git/core';
import { findRepoRoot, VectorSearchResult, CodeChunkPayload, SymbolNode } from '@cv-git/shared';
import { CredentialManager } from '@cv-git/credentials';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface ContextArgs {
  query: string;
  limit?: number;
  depth?: number;
  includeGraph?: boolean;
  includeFiles?: boolean;
  minScore?: number;
  format?: 'markdown' | 'xml' | 'json';
}

/**
 * Handle cv_context tool call
 */
export async function handleContext(args: ContextArgs): Promise<ToolResult> {
  try {
    const {
      query,
      limit = 10,
      depth = 2,
      includeGraph = true,
      includeFiles = true,
      minScore = 0.5,
      format = 'markdown'
    } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Get API key from credentials or env
    let openaiApiKey = config.ai.apiKey || process.env.OPENAI_API_KEY;
    let openrouterApiKey = process.env.OPENROUTER_API_KEY;

    // Try credential manager
    try {
      const credentials = new CredentialManager();
      await credentials.init();

      if (!openaiApiKey) {
        openaiApiKey = await credentials.getOpenAIKey() || undefined;
      }
      if (!openrouterApiKey) {
        openrouterApiKey = await credentials.getOpenRouterKey() || undefined;
      }
    } catch {
      // Credential manager not available
    }

    // Set OpenRouter in env for VectorManager
    if (openrouterApiKey && !process.env.OPENROUTER_API_KEY) {
      process.env.OPENROUTER_API_KEY = openrouterApiKey;
    }

    const apiKey = openaiApiKey || openrouterApiKey;
    if (!apiKey) {
      return errorResult(
        'No embedding API key found. Set OPENAI_API_KEY or OPENROUTER_API_KEY, or run `cv auth setup openai`'
      );
    }

    // Initialize vector manager
    const vector = createVectorManager(
      config.vector.url,
      openaiApiKey,
      config.vector.collections
    );
    await vector.connect();

    // Initialize graph manager (optional)
    let graph = null;
    if (includeGraph) {
      try {
        graph = createGraphManager(config.graph.url, config.graph.database);
        await graph.connect();
      } catch {
        // Graph is optional
      }
    }

    // Search for relevant code
    const chunks = await vector.searchCode(query, limit, { minScore });

    // Get related symbols from graph
    let symbols: SymbolNode[] = [];
    let relationships: Map<string, { callers: string[]; callees: string[] }> = new Map();

    if (graph && chunks.length > 0) {
      const symbolNames = chunks
        .map(c => c.payload.symbolName)
        .filter((name): name is string => !!name);

      for (const symbolName of symbolNames.slice(0, 5)) {
        try {
          // Get symbol details
          const symbolQuery = `
            MATCH (s:Symbol)
            WHERE s.name = '${symbolName}'
            RETURN s
            LIMIT 1
          `;
          const results = await graph.query(symbolQuery);
          if (results.length > 0) {
            symbols.push(results[0].s as SymbolNode);
          }

          // Get relationships
          const callers = await graph.getCallers(symbolName);
          const callees = await graph.getCallees(symbolName);

          relationships.set(symbolName, {
            callers: callers.slice(0, depth).map(s => s.name),
            callees: callees.slice(0, depth).map(s => s.name)
          });
        } catch {
          // Skip on error
        }
      }
    }

    // Read full file contents if requested
    let fileContents: Map<string, string> = new Map();
    if (includeFiles && chunks.length > 0) {
      const uniqueFiles = [...new Set(chunks.map(c => c.payload.file))];

      for (const filePath of uniqueFiles.slice(0, 5)) {
        try {
          const fullPath = path.join(repoRoot, filePath);
          const content = await fs.readFile(fullPath, 'utf-8');
          fileContents.set(filePath, content);
        } catch {
          // Skip files that can't be read
        }
      }
    }

    // Generate output
    let contextOutput: string;
    switch (format) {
      case 'xml':
        contextOutput = generateXMLContext(query, chunks, symbols, relationships, fileContents);
        break;
      case 'json':
        contextOutput = generateJSONContext(query, chunks, symbols, relationships, fileContents);
        break;
      case 'markdown':
      default:
        contextOutput = generateMarkdownContext(query, chunks, symbols, relationships, fileContents);
        break;
    }

    // Cleanup
    await vector.close();
    if (graph) await graph.close();

    return successResult(contextOutput);
  } catch (error: any) {
    return errorResult('Failed to generate context', error);
  }
}

/**
 * Generate markdown context output
 */
function generateMarkdownContext(
  query: string,
  chunks: VectorSearchResult<CodeChunkPayload>[],
  symbols: SymbolNode[],
  relationships: Map<string, { callers: string[]; callees: string[] }>,
  fileContents: Map<string, string>
): string {
  const lines: string[] = [];

  lines.push(`# Code Context: ${query}`);
  lines.push('');
  lines.push(`> Generated by cv-git for AI assistant context`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Query**: ${query}`);
  lines.push(`- **Relevant chunks**: ${chunks.length}`);
  lines.push(`- **Related symbols**: ${symbols.length}`);
  lines.push(`- **Files**: ${fileContents.size}`);
  lines.push('');

  // Relevant code chunks
  if (chunks.length > 0) {
    lines.push('## Relevant Code');
    lines.push('');

    for (const chunk of chunks) {
      const { payload, score } = chunk;
      lines.push(`### ${payload.symbolName || 'Code'} (${(score * 100).toFixed(0)}% match)`);
      lines.push('');
      lines.push(`**File**: \`${payload.file}:${payload.startLine}-${payload.endLine}\``);

      if (payload.docstring) {
        lines.push('');
        lines.push(`**Description**: ${payload.docstring.split('\n')[0]}`);
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
      lines.push(`### ${symbol}`);
      lines.push('');

      if (rels.callers.length > 0) {
        lines.push(`**Called by**: ${rels.callers.join(', ')}`);
      }
      if (rels.callees.length > 0) {
        lines.push(`**Calls**: ${rels.callees.join(', ')}`);
      }
      lines.push('');
    }
  }

  // Full file contents
  if (fileContents.size > 0) {
    lines.push('## Full File Contents');
    lines.push('');

    for (const [filePath, content] of fileContents) {
      const ext = path.extname(filePath).slice(1) || '';
      lines.push(`### ${filePath}`);
      lines.push('');
      lines.push('```' + ext);
      lines.push(content);
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Generate XML context output (for Claude-style context)
 */
function generateXMLContext(
  query: string,
  chunks: VectorSearchResult<CodeChunkPayload>[],
  symbols: SymbolNode[],
  relationships: Map<string, { callers: string[]; callees: string[] }>,
  fileContents: Map<string, string>
): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<context>');
  lines.push(`  <query>${escapeXML(query)}</query>`);
  lines.push('');

  // Code chunks
  lines.push('  <relevant_code>');
  for (const chunk of chunks) {
    const { payload, score } = chunk;
    lines.push('    <chunk>');
    lines.push(`      <file>${escapeXML(payload.file)}</file>`);
    lines.push(`      <lines>${payload.startLine}-${payload.endLine}</lines>`);
    lines.push(`      <symbol>${escapeXML(payload.symbolName || '')}</symbol>`);
    lines.push(`      <match_score>${(score * 100).toFixed(0)}%</match_score>`);
    if (payload.docstring) {
      lines.push(`      <docstring>${escapeXML(payload.docstring)}</docstring>`);
    }
    lines.push(`      <code><![CDATA[${payload.text}]]></code>`);
    lines.push('    </chunk>');
  }
  lines.push('  </relevant_code>');
  lines.push('');

  // Relationships
  if (relationships.size > 0) {
    lines.push('  <relationships>');
    for (const [symbol, rels] of relationships) {
      lines.push(`    <symbol name="${escapeXML(symbol)}">`);
      if (rels.callers.length > 0) {
        lines.push(`      <callers>${rels.callers.map(escapeXML).join(', ')}</callers>`);
      }
      if (rels.callees.length > 0) {
        lines.push(`      <callees>${rels.callees.map(escapeXML).join(', ')}</callees>`);
      }
      lines.push('    </symbol>');
    }
    lines.push('  </relationships>');
    lines.push('');
  }

  // Full files
  if (fileContents.size > 0) {
    lines.push('  <files>');
    for (const [filePath, content] of fileContents) {
      lines.push(`    <file path="${escapeXML(filePath)}">`);
      lines.push(`      <![CDATA[${content}]]>`);
      lines.push('    </file>');
    }
    lines.push('  </files>');
  }

  lines.push('</context>');
  return lines.join('\n');
}

/**
 * Generate JSON context output
 */
function generateJSONContext(
  query: string,
  chunks: VectorSearchResult<CodeChunkPayload>[],
  symbols: SymbolNode[],
  relationships: Map<string, { callers: string[]; callees: string[] }>,
  fileContents: Map<string, string>
): string {
  const context = {
    query,
    generated: new Date().toISOString(),
    generator: 'cv-git',
    chunks: chunks.map(chunk => ({
      file: chunk.payload.file,
      lines: `${chunk.payload.startLine}-${chunk.payload.endLine}`,
      symbol: chunk.payload.symbolName,
      language: chunk.payload.language,
      matchScore: chunk.score,
      docstring: chunk.payload.docstring,
      code: chunk.payload.text
    })),
    relationships: Object.fromEntries(relationships),
    files: Object.fromEntries(fileContents)
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

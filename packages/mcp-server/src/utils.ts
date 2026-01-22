/**
 * MCP Server Utilities
 * Helper functions for formatting and error handling
 */

import { ToolResult, SearchResult, GraphResult } from './types.js';
import { configManager, createGraphManager, readManifest, generateRepoId, GraphManager } from '@cv-git/core';
import { findRepoRoot, getCVDir } from '@cv-git/shared';

/**
 * Create a graph manager with proper repo isolation.
 * Uses the manifest's repoId to ensure each repository has its own database.
 *
 * @param repoRoot - Optional repo root path (will be detected if not provided)
 * @returns Object with graph manager and repoRoot
 */
export async function createIsolatedGraphManager(repoRoot?: string): Promise<{
  graph: GraphManager;
  repoRoot: string;
  repoId: string;
  databaseName: string;
}> {
  // Find repository root if not provided
  const root = repoRoot || await findRepoRoot();
  if (!root) {
    throw new Error('Not in a CV-Git repository. Run `cv init` first.');
  }

  // Load configuration for URL
  const config = await configManager.load(root);

  // Get repoId from manifest (like the CLI does)
  const cvDir = getCVDir(root);
  const manifest = await readManifest(cvDir);
  const repoId = manifest?.repository?.id || generateRepoId(root);

  // Create graph manager with repo-specific database
  const graph = createGraphManager({ url: config.graph.url, repoId });

  return {
    graph,
    repoRoot: root,
    repoId,
    databaseName: graph.getDatabaseName(),
  };
}

/**
 * Format search results as text
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No results found.';
  }

  const lines: string[] = [];
  lines.push(`Found ${results.length} result(s):\n`);

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const score = (result.score * 100).toFixed(1);

    lines.push(`${i + 1}. ${result.symbolName || 'Code chunk'} (${score}% match)`);
    lines.push(`   Location: ${result.file}:${result.startLine}-${result.endLine}`);

    if (result.language) {
      lines.push(`   Language: ${result.language}`);
    }

    if (result.docstring) {
      lines.push(`   Description: ${result.docstring.split('\n')[0]}`);
    }

    // Show first few lines of code
    const codeLines = result.text.split('\n').slice(0, 5);
    lines.push('   Code:');
    codeLines.forEach(line => {
      lines.push(`     ${line}`);
    });

    if (result.text.split('\n').length > 5) {
      lines.push('     ...');
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format graph query results
 */
export function formatGraphResults(results: GraphResult): string {
  const lines: string[] = [];

  if (results.nodes.length === 0) {
    return 'No results found.';
  }

  lines.push(`Found ${results.nodes.length} node(s) and ${results.edges.length} edge(s):\n`);

  // Format nodes
  lines.push('Nodes:');
  results.nodes.forEach((node, i) => {
    lines.push(`  ${i + 1}. ${node.name} (${node.type})`);
    if (node.file) {
      lines.push(`     ${node.file}${node.line ? `:${node.line}` : ''}`);
    }
  });

  // Format edges if any
  if (results.edges.length > 0) {
    lines.push('\nRelationships:');
    results.edges.forEach(edge => {
      const fromNode = results.nodes.find(n => n.id === edge.from);
      const toNode = results.nodes.find(n => n.id === edge.to);
      if (fromNode && toNode) {
        lines.push(`  ${fromNode.name} --${edge.type}--> ${toNode.name}`);
      }
    });
  }

  return lines.join('\n');
}

/**
 * Format task execution result
 */
export function formatTaskResult(result: any): string {
  const lines: string[] = [];

  if (result.plan) {
    lines.push('Execution Plan:');
    if (Array.isArray(result.plan.steps)) {
      result.plan.steps.forEach((step: string, i: number) => {
        lines.push(`  ${i + 1}. ${step}`);
      });
    }
    lines.push('');
  }

  if (result.changes) {
    lines.push('Changes Made:');
    if (Array.isArray(result.changes)) {
      result.changes.forEach((change: any) => {
        lines.push(`  - ${change.file}: ${change.description}`);
      });
    }
    lines.push('');
  }

  if (result.summary) {
    lines.push(result.summary);
  }

  return lines.join('\n');
}

/**
 * Format code review result
 */
export function formatReview(review: any): string {
  const lines: string[] = [];

  lines.push('Code Review Results:\n');

  if (review.summary) {
    lines.push('Summary:');
    lines.push(review.summary);
    lines.push('');
  }

  if (review.issues && Array.isArray(review.issues)) {
    lines.push('Issues Found:');
    review.issues.forEach((issue: any, i: number) => {
      const severity = issue.severity || 'info';
      const icon = severity === 'error' ? '🐛' : severity === 'warning' ? '⚠️' : '💡';
      lines.push(`  ${i + 1}. ${icon} [${severity}] ${issue.message}`);
      if (issue.file && issue.line) {
        lines.push(`     ${issue.file}:${issue.line}`);
      }
      if (issue.suggestion) {
        lines.push(`     Suggestion: ${issue.suggestion}`);
      }
    });
    lines.push('');
  }

  if (review.stats) {
    lines.push('Statistics:');
    lines.push(`  Files Changed: ${review.stats.filesChanged || 0}`);
    lines.push(`  Lines Added: ${review.stats.linesAdded || 0}`);
    lines.push(`  Lines Removed: ${review.stats.linesRemoved || 0}`);
  }

  return lines.join('\n');
}

/**
 * Format sync result
 */
export function formatSyncResult(result: any): string {
  const lines: string[] = [];

  lines.push('Sync Complete!\n');

  if (result.fileCount !== undefined) {
    lines.push(`Files Synced: ${result.fileCount}`);
  }
  if (result.symbolCount !== undefined) {
    lines.push(`Symbols Extracted: ${result.symbolCount}`);
  }
  if (result.edgeCount !== undefined) {
    lines.push(`Relationships: ${result.edgeCount}`);
  }
  if (result.vectorCount !== undefined && result.vectorCount > 0) {
    lines.push(`Vectors Stored: ${result.vectorCount}`);
  }
  if (result.syncDuration !== undefined) {
    lines.push(`Duration: ${result.syncDuration.toFixed(1)}s`);
  }

  if (result.languages) {
    lines.push('\nLanguages:');
    for (const [lang, count] of Object.entries(result.languages)) {
      lines.push(`  - ${lang}: ${count} files`);
    }
  }

  return lines.join('\n');
}

/**
 * Create a success tool result
 */
export function successResult(text: string): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

/**
 * Create an error tool result
 */
export function errorResult(message: string, error?: any): ToolResult {
  let text = `Error: ${message}`;

  if (error) {
    if (error.message) {
      text += `\n${error.message}`;
    }
    if (error.stack && process.env.DEBUG) {
      text += `\n\nStack trace:\n${error.stack}`;
    }
  }

  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
    isError: true,
  };
}

/**
 * Validate required arguments
 */
export function validateArgs(args: any, required: string[]): void {
  for (const field of required) {
    if (args[field] === undefined || args[field] === null) {
      throw new Error(`Missing required argument: ${field}`);
    }
  }
}

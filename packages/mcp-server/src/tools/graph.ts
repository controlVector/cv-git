/**
 * Graph Tool Handlers
 * Implements cv_graph_query, cv_graph_stats, cv_graph_inspect
 */

import { GraphQueryArgs, ToolResult, GraphResult } from '../types.js';
import { successResult, errorResult, formatGraphResults } from '../utils.js';
import { configManager, createGraphManager } from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';

/**
 * Handle cv_graph_query tool call
 */
export async function handleGraphQuery(args: GraphQueryArgs): Promise<ToolResult> {
  try {
    const { queryType, target, language, file } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize graph manager
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    let result: GraphResult;

    switch (queryType) {
      case 'calls':
        if (!target) {
          return errorResult('Target required for "calls" query');
        }
        const callees = await graph.getCallees(target);
        result = {
          nodes: callees.map((c: any, i: number) => ({
            id: `node-${i}`,
            type: c.kind || 'function',
            name: c.name,
            file: c.file,
            line: c.startLine,
          })),
          edges: callees.map((c: any, i: number) => ({
            from: target,
            to: c.name,
            type: 'calls',
          })),
        };
        break;

      case 'called-by':
        if (!target) {
          return errorResult('Target required for "called-by" query');
        }
        const callers = await graph.getCallers(target);
        result = {
          nodes: callers.map((c: any, i: number) => ({
            id: `node-${i}`,
            type: c.kind || 'function',
            name: c.name,
            file: c.file,
            line: c.startLine,
          })),
          edges: callers.map((c: any, i: number) => ({
            from: c.name,
            to: target,
            type: 'calls',
          })),
        };
        break;

      case 'imports':
        if (!target) {
          return errorResult('Target required for "imports" query');
        }
        const dependencies = await graph.getFileDependencies(target);
        result = {
          nodes: dependencies.map((dep: string, idx: number) => ({
            id: `node-${idx}`,
            type: 'file',
            name: dep,
            file: dep,
          })),
          edges: dependencies.map((dep: string, idx: number) => ({
            from: target,
            to: dep,
            type: 'imports',
          })),
        };
        break;

      case 'exports':
        if (!target) {
          return errorResult('Target required for "exports" query');
        }
        const exports = await graph.getFileSymbols(target);
        result = {
          nodes: exports.map((e: any, i: number) => ({
            id: `node-${i}`,
            type: e.kind || 'symbol',
            name: e.name,
            file: target,
            line: e.startLine,
          })),
          edges: [],
        };
        break;

      case 'functions':
        let functionQuery = 'MATCH (s:Symbol {kind: "function"})';
        if (language) functionQuery += ` MATCH (f:File {language: $language})-[:DEFINES]->(s)`;
        if (file) functionQuery += ` WHERE s.file = $file`;
        functionQuery += ' RETURN s';
        const functions = await graph.query(functionQuery, { language, file });
        result = {
          nodes: functions.map((row: any, i: number) => ({
            id: `node-${i}`,
            type: 'function',
            name: row.s.name,
            file: row.s.file,
            line: row.s.startLine,
          })),
          edges: [],
        };
        break;

      case 'classes':
        let classQuery = 'MATCH (s:Symbol {kind: "class"})';
        if (language) classQuery += ` MATCH (f:File {language: $language})-[:DEFINES]->(s)`;
        if (file) classQuery += ` WHERE s.file = $file`;
        classQuery += ' RETURN s';
        const classes = await graph.query(classQuery, { language, file });
        result = {
          nodes: classes.map((row: any, i: number) => ({
            id: `node-${i}`,
            type: 'class',
            name: row.s.name,
            file: row.s.file,
            line: row.s.startLine,
          })),
          edges: [],
        };
        break;

      case 'files':
        let fileQuery = 'MATCH (f:File)';
        if (language) fileQuery += ' WHERE f.language = $language';
        fileQuery += ' RETURN f';
        const files = await graph.query(fileQuery, { language });
        result = {
          nodes: files.map((row: any, i: number) => ({
            id: `node-${i}`,
            type: 'file',
            name: row.f.path,
            file: row.f.path,
          })),
          edges: [],
        };
        break;

      default:
        await graph.close();
        return errorResult(`Unknown query type: ${queryType}`);
    }

    await graph.close();

    const formattedResult = formatGraphResults(result);
    return successResult(formattedResult);
  } catch (error: any) {
    return errorResult('Graph query failed', error);
  }
}

/**
 * Handle cv_graph_stats tool call
 */
export async function handleGraphStats(): Promise<ToolResult> {
  try {
    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize graph manager
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    // Get statistics
    const stats = await graph.getStats();

    await graph.close();

    const text = `Knowledge Graph Statistics:

Files: ${stats.fileCount || 0}
Symbols: ${stats.symbolCount || 0}
Commits: ${stats.commitCount || 0}
Modules: ${stats.moduleCount || 0}
Relationships: ${stats.relationshipCount || 0}`;

    return successResult(text);
  } catch (error: any) {
    return errorResult('Failed to get graph statistics', error);
  }
}

/**
 * Handle cv_graph_inspect tool call
 */
export async function handleGraphInspect(args: { target: string }): Promise<ToolResult> {
  try {
    const { target } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize graph manager
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    // Try to find as a symbol first
    let symbol = await graph.getSymbolNode(target);

    if (!symbol) {
      // Try as a file
      const fileNode = await graph.getFileNode(target);
      if (!fileNode) {
        await graph.close();
        return errorResult(`Symbol or file not found: ${target}`);
      }

      // For files, show file symbols
      const fileSymbols = await graph.getFileSymbols(target);
      const dependencies = await graph.getFileDependencies(target);
      const dependents = await graph.getFileDependents(target);

      await graph.close();

      const text = `File: ${fileNode.path}
Language: ${fileNode.language}
Lines of Code: ${fileNode.linesOfCode || 0}

Symbols: ${fileSymbols.length}
${fileSymbols.slice(0, 10).map((s: any) => `  - ${s.kind}: ${s.name}`).join('\n')}
${fileSymbols.length > 10 ? `  ... and ${fileSymbols.length - 10} more` : ''}

Dependencies: ${dependencies.length}
${dependencies.slice(0, 10).map((d: string) => `  - ${d}`).join('\n')}
${dependencies.length > 10 ? `  ... and ${dependencies.length - 10} more` : ''}

Dependents: ${dependents.length}
${dependents.slice(0, 10).map((d: string) => `  - ${d}`).join('\n')}
${dependents.length > 10 ? `  ... and ${dependents.length - 10} more` : ''}`;

      return successResult(text);
    }

    // Get detailed information for symbol
    const callees = await graph.getCallees(symbol.qualifiedName);
    const callers = await graph.getCallers(symbol.qualifiedName);

    await graph.close();

    const text = `Symbol: ${symbol.name}
Type: ${symbol.kind}
Location: ${symbol.file}:${symbol.startLine}

${symbol.docstring ? `Description:\n${symbol.docstring}\n` : ''}
Calls: ${callees.length} symbols
${callees.slice(0, 10).map((c: any) => `  - ${c.name}`).join('\n')}
${callees.length > 10 ? `  ... and ${callees.length - 10} more` : ''}

Called By: ${callers.length} symbols
${callers.slice(0, 10).map((c: any) => `  - ${c.name}`).join('\n')}
${callers.length > 10 ? `  ... and ${callers.length - 10} more` : ''}`;

    return successResult(text);
  } catch (error: any) {
    return errorResult('Symbol inspection failed', error);
  }
}

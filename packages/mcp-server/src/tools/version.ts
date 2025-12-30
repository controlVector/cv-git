/**
 * Version-Aware Tool Handlers
 * Implements cv_commits, cv_file_history, cv_blame for tracking code evolution
 */

import { CommitsArgs, FileHistoryArgs, BlameArgs, ToolResult } from '../types.js';
import { successResult, errorResult } from '../utils.js';
import { configManager, createGraphManager, createGitManager } from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';

/**
 * Handle cv_commits tool call
 * Lists recent commits from the knowledge graph
 */
export async function handleCommits(args: CommitsArgs): Promise<ToolResult> {
  try {
    const { limit = 20, file, author } = args;

    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    const config = await configManager.load(repoRoot);
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    // Build query based on filters - use explicit property extraction
    let query = 'MATCH (c:Commit)';
    const params: Record<string, any> = { limit };

    if (file) {
      query += ' MATCH (c)-[:MODIFIES]->(f:File {path: $file})';
      params.file = file;
    }

    if (author) {
      query += ' WHERE c.author CONTAINS $author';
      params.author = author;
    }

    query += ' RETURN c.sha AS sha, c.message AS message, c.author AS author, c.timestamp AS timestamp ORDER BY c.timestamp DESC LIMIT $limit';

    const results = await graph.query(query, params);
    await graph.close();

    if (results.length === 0) {
      let msg = 'No commits found';
      if (file) msg += ` for file "${file}"`;
      if (author) msg += ` by "${author}"`;
      return successResult(msg + '. Run `cv sync` to populate commit history.');
    }

    const commits = results.map((row: any) => {
      const date = row.timestamp ? new Date(parseInt(row.timestamp)).toISOString().split('T')[0] : 'unknown';
      return `${row.sha?.substring(0, 8) || '?'} ${date} ${row.author || 'unknown'}\n  ${row.message || 'No message'}`;
    });

    let text = `Recent Commits (${results.length}):\n\n${commits.join('\n\n')}`;

    if (file) {
      text = `Commits modifying ${file}:\n\n${commits.join('\n\n')}`;
    }

    return successResult(text);
  } catch (error: any) {
    return errorResult('Failed to get commits', error);
  }
}

/**
 * Handle cv_file_history tool call
 * Shows the complete history of changes to a file
 */
export async function handleFileHistory(args: FileHistoryArgs): Promise<ToolResult> {
  try {
    const { file, limit = 10, showDiff = false } = args;

    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    const config = await configManager.load(repoRoot);
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    // Query commits that modified this file with modification details
    const query = `
      MATCH (c:Commit)-[m:MODIFIES]->(f:File {path: $file})
      RETURN c.sha AS sha, c.message AS message, c.author AS author, c.timestamp AS timestamp,
             m.insertions AS insertions, m.deletions AS deletions
      ORDER BY c.timestamp DESC
      LIMIT $limit
    `;

    const results = await graph.query(query, { file, limit });
    await graph.close();

    if (results.length === 0) {
      return successResult(`No history found for "${file}". File may not exist or hasn't been synced.`);
    }

    const history = results.map((row: any) => {
      const date = row.timestamp ? new Date(parseInt(row.timestamp)).toISOString().split('T')[0] : 'unknown';
      const changes = row.insertions !== undefined
        ? `+${row.insertions || 0}/-${row.deletions || 0}`
        : '';
      return `${row.sha?.substring(0, 8) || '?'} ${date} ${row.author || 'unknown'} ${changes}\n  ${row.message || 'No message'}`;
    });

    const text = `File History: ${file}\n\n${history.join('\n\n')}`;

    return successResult(text);
  } catch (error: any) {
    return errorResult('Failed to get file history', error);
  }
}

/**
 * Handle cv_blame tool call
 * Shows which commits last modified symbols in a file or specific symbol
 */
export async function handleBlame(args: BlameArgs): Promise<ToolResult> {
  try {
    const { target } = args;

    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    const config = await configManager.load(repoRoot);
    const graph = createGraphManager(config.graph.url, config.graph.database);
    await graph.connect();

    // Check if target is a file or symbol
    const isFile = target.includes('/') || target.includes('.');

    if (isFile) {
      // Get all symbols in the file with their commit info from the file level
      // First get symbols, then get the most recent commit for the file
      const symbolQuery = `
        MATCH (f:File {path: $target})-[:DEFINES]->(s:Symbol)
        RETURN s.name AS symbol, s.kind AS kind, s.startLine AS line
        ORDER BY s.startLine
      `;

      const commitQuery = `
        MATCH (c:Commit)-[:MODIFIES]->(f:File {path: $target})
        RETURN c.sha AS sha, c.author AS author, c.timestamp AS timestamp
        ORDER BY c.timestamp DESC
        LIMIT 1
      `;

      const symbolResults = await graph.query(symbolQuery, { target });
      const commitResults = await graph.query(commitQuery, { target });
      await graph.close();

      if (symbolResults.length === 0) {
        return successResult(`No symbols found in "${target}". File may not be synced or has no parseable symbols.`);
      }

      const lastCommit = commitResults.length > 0 ? commitResults[0] : null;
      const sha = lastCommit?.sha ? lastCommit.sha.substring(0, 8) : '????????';
      const author = lastCommit?.author || 'unknown';
      const date = lastCommit?.timestamp ? new Date(parseInt(lastCommit.timestamp)).toISOString().split('T')[0] : '????-??-??';

      const blameLines = symbolResults.map((row: any) => {
        return `${sha} ${date.substring(5)} ${author.padEnd(15).substring(0, 15)} L${row.line || '?'} ${row.kind}: ${row.symbol}`;
      });

      return successResult(`Blame for ${target}:\n\n${blameLines.join('\n')}`);
    } else {
      // Target is a symbol name - first find the symbol, then get its commits
      const symbolQuery = `
        MATCH (s:Symbol)
        WHERE s.name = $target OR s.qualifiedName = $target
        RETURN s.name AS symbol, s.kind AS kind, s.file AS file, s.startLine AS line
      `;

      const symbolResults = await graph.query(symbolQuery, { target });

      if (symbolResults.length === 0) {
        await graph.close();
        return successResult(`Symbol "${target}" not found. Try using the full qualified name or check the file path.`);
      }

      // For each symbol, get commits that modified its file
      const symbolInfo: string[] = [];
      for (const symbol of symbolResults) {
        const commitQuery = `
          MATCH (c:Commit)-[m:MODIFIES]->(f:File {path: $file})
          RETURN c.sha AS sha, c.author AS author, c.message AS message, c.timestamp AS timestamp,
                 m.insertions AS insertions, m.deletions AS deletions
          ORDER BY c.timestamp DESC
          LIMIT 5
        `;

        const commits = await graph.query(commitQuery, { file: symbol.file });

        const header = `${symbol.kind} ${symbol.symbol} in ${symbol.file}:${symbol.line || '?'}`;
        const commitLines = commits.map((c: any) => {
          const sha = c.sha?.substring(0, 8) || '????????';
          const date = c.timestamp ? new Date(parseInt(c.timestamp)).toISOString().split('T')[0] : 'unknown';
          const changes = c.insertions !== undefined ? ` (+${c.insertions || 0}/-${c.deletions || 0})` : '';
          return `  ${sha} ${date} ${c.author || 'unknown'}${changes}\n    ${c.message || 'No message'}`;
        });

        symbolInfo.push(`${header}\n\nRecent changes:\n${commitLines.join('\n\n') || '  No commit history'}`);
      }

      await graph.close();
      return successResult(`Blame for symbol "${target}":\n\n${symbolInfo.join('\n\n---\n\n')}`);
    }
  } catch (error: any) {
    return errorResult('Failed to get blame information', error);
  }
}

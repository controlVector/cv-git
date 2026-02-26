/**
 * Session Knowledge Tool Handlers
 * Implements cv_session_knowledge (query) and cv_session_egress (write)
 *
 * Moved from CV-Hub's context-engine-adapter and egress service.
 * CV-Git owns the knowledge graph — these tools operate directly on it.
 */

import { SessionKnowledgeArgs, SessionEgressArgs, ToolResult } from '../types.js';
import { successResult, errorResult, createIsolatedGraphManager } from '../utils.js';

/**
 * Clean FalkorDB list fields — compact format returns [[type, value], ...] pairs
 */
function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 0 && Array.isArray(value[0])) {
    return value.map((pair: any) => String(pair[1] || pair)).filter(Boolean);
  }
  return value.map(String).filter(Boolean);
}

/**
 * Handle cv_session_knowledge tool call
 * Query session knowledge nodes by file paths or symbol names
 */
export async function handleSessionKnowledge(args: SessionKnowledgeArgs): Promise<ToolResult> {
  try {
    const { files, symbols, excludeSessionId, limit = 10 } = args;

    if (!files?.length && !symbols?.length) {
      return errorResult('At least one of "files" or "symbols" must be provided');
    }

    const { graph } = await createIsolatedGraphManager();
    await graph.connect();

    const results: any[] = [];

    if (files?.length) {
      const byFiles = await graph.getSessionKnowledgeByFiles(files, excludeSessionId, limit);
      results.push(...byFiles);
    }

    if (symbols?.length) {
      const bySymbols = await graph.getSessionKnowledgeBySymbols(symbols, excludeSessionId, limit);
      // Deduplicate by sessionId + turnNumber
      const seen = new Set(results.map(r => `${r.sessionId}:${r.turnNumber}`));
      for (const sk of bySymbols) {
        const key = `${sk.sessionId}:${sk.turnNumber}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(sk);
        }
      }
    }

    // Sort by timestamp descending, cap at limit
    results.sort((a, b) => b.timestamp - a.timestamp);
    const capped = results.slice(0, limit);

    if (capped.length === 0) {
      return successResult('No session knowledge found matching the given files/symbols.');
    }

    const lines = capped.map((sk, i) => {
      const date = sk.timestamp ? new Date(sk.timestamp).toISOString() : 'unknown';
      return [
        `--- Session Knowledge #${i + 1} ---`,
        `Session: ${sk.sessionId} / Turn ${sk.turnNumber}`,
        `Time: ${date}`,
        `Concern: ${sk.concern}`,
        `Summary: ${sk.summary}`,
        `Files: ${cleanList(sk.filesTouched).join(', ') || 'none'}`,
        `Symbols: ${cleanList(sk.symbolsReferenced).join(', ') || 'none'}`,
      ].join('\n');
    });

    await graph.close();
    return successResult(`Found ${capped.length} session knowledge node(s):\n\n${lines.join('\n\n')}`);
  } catch (error: any) {
    return errorResult(`Failed to query session knowledge: ${error.message}`, error);
  }
}

/**
 * Handle cv_session_egress tool call
 * Write session knowledge to the graph: SK node + ABOUT edges + FOLLOWS edge
 *
 * This is the core egress logic moved from CV-Hub's context-engine-egress.service.ts.
 * Simplified: no LLM calls, no Qdrant embedding (that stays in CV-Hub).
 */
export async function handleSessionEgress(args: SessionEgressArgs): Promise<ToolResult> {
  try {
    const {
      sessionId,
      turnNumber,
      transcript_segment,
      files_touched = [],
      symbols_referenced = [],
      concern = 'codebase',
    } = args;

    if (!sessionId || !turnNumber || !transcript_segment) {
      return errorResult('sessionId, turnNumber, and transcript_segment are required');
    }

    const { graph } = await createIsolatedGraphManager();
    await graph.connect();

    let edgesCreated = 0;

    // Step 1: Build summary (truncate transcript — no LLM)
    const summary = transcript_segment.slice(0, 500).trim();

    // Step 2: Create SessionKnowledge node
    await graph.upsertSessionKnowledgeNode({
      sessionId,
      turnNumber,
      timestamp: Date.now(),
      summary,
      concern,
      source: 'cv_git',
      filesTouched: files_touched,
      symbolsReferenced: symbols_referenced,
    });

    // Step 3: Create ABOUT edges to files
    const touchedSet = new Set(files_touched);
    for (const filePath of files_touched) {
      try {
        await graph.createAboutFileEdge(sessionId, turnNumber, filePath, {
          role: touchedSet.has(filePath) ? 'touched' : 'referenced',
        });
        edgesCreated++;
      } catch {
        // File node doesn't exist in graph — skip
      }
    }

    // Step 4: Create ABOUT edges to symbols
    for (const qn of symbols_referenced) {
      try {
        await graph.createAboutSymbolEdge(sessionId, turnNumber, qn, { role: 'referenced' });
        edgesCreated++;
      } catch {
        // Symbol node doesn't exist in graph — skip
      }
    }

    // Step 5: Create FOLLOWS edge to previous turn
    if (turnNumber > 1) {
      const prev = await graph.getSessionKnowledgeNode(sessionId, turnNumber - 1);
      if (prev) {
        try {
          await graph.createFollowsEdge(sessionId, turnNumber, turnNumber - 1);
          edgesCreated++;
        } catch {
          // Non-fatal
        }
      }
    }

    await graph.close();

    return successResult(
      `Session knowledge stored: ${sessionId} turn ${turnNumber}\n` +
      `Summary: ${summary.slice(0, 100)}${summary.length > 100 ? '...' : ''}\n` +
      `Edges created: ${edgesCreated}\n` +
      `Files: ${files_touched.length}, Symbols: ${symbols_referenced.length}`,
    );
  } catch (error: any) {
    return errorResult(`Failed to store session knowledge: ${error.message}`, error);
  }
}

/**
 * Manifold Status Tool Handler
 * Implements cv_manifold_status - diagnostics for the context manifold
 */

import { ToolResult } from '../types.js';
import { successResult, errorResult, createIsolatedGraphManager, getServiceUrls } from '../utils.js';
import {
  configManager,
  createVectorManager,
  createManifoldService,
} from '@cv-git/core';
import { findRepoRoot, ManifoldHealth, DimensionKind } from '@cv-git/shared';
import { getOpenAIApiKey, getOpenRouterApiKey } from '../credentials.js';
import { readManifest, generateRepoId } from '@cv-git/core';
import { getCVDir } from '@cv-git/shared';

export interface ManifoldStatusArgs {
  /** Refresh manifold state before reporting */
  refresh?: boolean;
}

export async function handleManifoldStatus(args: ManifoldStatusArgs): Promise<ToolResult> {
  try {
    const { refresh = false } = args;

    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    const cvDir = getCVDir(repoRoot);
    let repoId: string;
    try {
      const manifest = await readManifest(cvDir);
      repoId = manifest?.repository?.id || generateRepoId(repoRoot);
    } catch {
      repoId = generateRepoId(repoRoot);
    }

    // Create manifold service
    let graph = null;
    try {
      const isolated = await createIsolatedGraphManager();
      graph = isolated.graph;
      await graph.connect();
    } catch {
      // Graph optional
    }

    let vector = null;
    try {
      const config = await configManager.load(repoRoot);
      const serviceUrls = await getServiceUrls(config);
      const openaiApiKey = config.ai.apiKey || await getOpenAIApiKey();
      const openrouterApiKey = await getOpenRouterApiKey();

      if (openaiApiKey || openrouterApiKey) {
        vector = createVectorManager({
          url: serviceUrls.qdrant,
          openrouterApiKey,
          openaiApiKey,
          repoId,
        });
        await vector.connect();
      }
    } catch {
      // Vector optional
    }

    const manifold = createManifoldService({
      repoRoot,
      repoId,
      graph,
      vector,
    });

    await manifold.initialize();

    if (refresh) {
      await manifold.refreshAll();
      await manifold.save();
    }

    const health = await manifold.getHealth();
    const state = manifold.getState();

    // Format output
    const lines: string[] = [];
    lines.push('# Context Manifold Status');
    lines.push('');
    lines.push(`**Overall Health**: ${health.overall}`);
    lines.push(`**State File**: ${health.stateFile.exists ? `${health.stateFile.sizeBytes} bytes` : 'not found'}`);

    if (state) {
      lines.push(`**Last Refreshed**: ${state.lastRefreshed ? new Date(state.lastRefreshed).toISOString() : 'never'}`);
    }

    lines.push('');
    lines.push('## Dimensions');
    lines.push('');
    lines.push('| # | Dimension | Status | Last Updated |');
    lines.push('|---|-----------|--------|--------------|');

    const dimNumbers: Record<DimensionKind, number> = {
      structural: 1, semantic: 2, temporal: 3, requirements: 4, summary: 5,
      navigational: 6, session: 7, intent: 8, impact: 9,
    };

    const statusEmoji: Record<string, string> = {
      active: 'OK',
      stale: 'STALE',
      missing: 'MISSING',
      unavailable: 'N/A',
    };

    for (const [dim, info] of Object.entries(health.dimensions)) {
      const num = dimNumbers[dim as DimensionKind];
      const updated = info.lastUpdated
        ? new Date(info.lastUpdated).toISOString().replace('T', ' ').slice(0, 19)
        : 'never';
      lines.push(`| ${num} | ${dim} | ${statusEmoji[info.status]} | ${updated} |`);
    }

    // Add dimension details if state exists
    if (state) {
      lines.push('');
      lines.push('## Details');

      const s = state.dimensions;
      if (s.structural.fileCount > 0) {
        lines.push(`- **Structural**: ${s.structural.fileCount} files, ${s.structural.symbolCount} symbols, ${s.structural.edgeCount} edges`);
      }
      if (s.semantic.collectionSize > 0) {
        lines.push(`- **Semantic**: ${s.semantic.collectionSize} vectors (${s.semantic.embeddingModel})`);
      }
      if (s.temporal.hotFiles.length > 0) {
        lines.push(`- **Temporal**: ${s.temporal.recentCommits.length} recent commits, ${s.temporal.hotFiles.length} hot files`);
      }
      if (s.requirements.prdCount > 0) {
        lines.push(`- **Requirements**: ${s.requirements.prdCount} PRDs, ${s.requirements.chunkCount} chunks`);
      }
      if (s.summary.summaryCount > 0 || s.summary.hasCachedSummaries) {
        lines.push(`- **Summary**: ${s.summary.summaryCount} cached summaries`);
      }
      if (s.session.modifiedFiles.length > 0) {
        lines.push(`- **Session**: ${s.session.modifiedFiles.length} modified files on ${s.session.currentBranch}`);
      }
      if (s.intent.branchIntent) {
        lines.push(`- **Intent**: ${s.intent.branchIntent.type} — ${s.intent.branchIntent.description}`);
      }
      if (s.impact.changedSymbols.length > 0) {
        lines.push(`- **Impact**: ${s.impact.changedSymbols.length} changed symbols, risk: ${s.impact.riskLevel}`);
      }
    }

    // Cleanup
    await manifold.close();
    if (vector) await vector.close();
    if (graph) await graph.close();

    return successResult(lines.join('\n'));
  } catch (error: any) {
    return errorResult('Failed to get manifold status', error);
  }
}

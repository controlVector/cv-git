/**
 * Sync Tool Handler
 * Implements cv_sync - knowledge graph synchronization
 */

import { SyncArgs, ToolResult } from '../types.js';
import { successResult, errorResult, formatSyncResult } from '../utils.js';
import {
  configManager,
  createGitManager,
  createParser,
  createGraphManager,
  createVectorManager,
  createSyncEngine,
} from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';

/**
 * Handle cv_sync tool call
 */
export async function handleSync(args: SyncArgs): Promise<ToolResult> {
  try {
    const { incremental = false, force = false } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize components
    const git = createGitManager(repoRoot);

    if (!(await git.isGitRepo())) {
      return errorResult('Not a git repository');
    }

    const parser = createParser();
    const graph = createGraphManager(config.graph.url, config.graph.database);

    await graph.connect();

    // Vector manager (optional)
    let vector = undefined;
    const openaiApiKey = config.ai.apiKey || process.env.OPENAI_API_KEY;

    if (openaiApiKey && config.vector) {
      try {
        vector = createVectorManager(
          config.vector.url,
          openaiApiKey,
          config.vector.collections
        );
        await vector.connect();
      } catch (error: any) {
        // Continue without vector search if it fails
        console.error('Could not connect to Qdrant:', error.message);
      }
    }

    // Create sync engine
    const syncEngine = createSyncEngine(repoRoot, git, parser, graph, vector);

    let syncState: any;

    if (incremental && !force) {
      // Incremental sync
      const lastState = await syncEngine.loadSyncState();

      if (!lastState || !lastState.lastCommitSynced) {
        // No previous sync, do full sync instead
        syncState = await syncEngine.fullSync({
          excludePatterns: config.sync.excludePatterns,
          includeLanguages: config.sync.includeLanguages,
        });
      } else {
        const changedFiles = await git.getChangedFilesSince(lastState.lastCommitSynced);

        if (changedFiles.length === 0) {
          await graph.close();
          if (vector) await vector.close();
          return successResult('No changes to sync.');
        }

        syncState = await syncEngine.incrementalSync(changedFiles, {
          excludePatterns: config.sync.excludePatterns,
          includeLanguages: config.sync.includeLanguages,
        });
      }
    } else {
      // Full sync
      if (force) {
        await graph.clear();
      }

      syncState = await syncEngine.fullSync({
        excludePatterns: config.sync.excludePatterns,
        includeLanguages: config.sync.includeLanguages,
      });
    }

    // Close connections
    await graph.close();
    if (vector) await vector.close();

    const formattedResult = formatSyncResult(syncState);
    return successResult(formattedResult);
  } catch (error: any) {
    return errorResult('Sync failed', error);
  }
}

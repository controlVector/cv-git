/**
 * Sync Tool Handler
 * Implements cv_sync - knowledge graph synchronization
 */

import { SyncArgs, ToolResult } from '../types.js';
import { successResult, errorResult, formatSyncResult, createIsolatedGraphManager, getServiceUrls } from '../utils.js';
import {
  configManager,
  createGitManager,
  createParser,
  createVectorManager,
  createSyncEngine,
} from '@cv-git/core';
import { getOpenAIApiKey, getOpenRouterApiKey } from '../credentials.js';

/**
 * Handle cv_sync tool call
 */
export async function handleSync(args: SyncArgs): Promise<ToolResult> {
  try {
    const { incremental = false, force = false } = args;

    // Initialize graph manager with repo isolation
    const { graph, repoRoot } = await createIsolatedGraphManager();
    await graph.connect();

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Initialize components
    const git = createGitManager(repoRoot);

    if (!(await git.isGitRepo())) {
      return errorResult('Not a git repository');
    }

    const parser = createParser();

    // Vector manager (optional)
    let vector = undefined;
    const openaiApiKey = config.ai.apiKey || await getOpenAIApiKey();
    const openrouterApiKey = await getOpenRouterApiKey();
    const apiKey = openaiApiKey || openrouterApiKey;

    if (apiKey && config.vector) {
      try {
        // Get service URLs (checks services.json for dynamic ports first)
        const serviceUrls = await getServiceUrls(config);

        vector = createVectorManager({
          url: serviceUrls.qdrant,
          openaiApiKey,
          openrouterApiKey,
          collections: config.vector.collections,
        });
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

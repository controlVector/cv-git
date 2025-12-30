/**
 * cv sync command
 * Synchronize the knowledge graph with the repository or workspace
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { Ora } from 'ora';
import { execSync, spawn } from 'child_process';
import {
  configManager,
  createGitManager,
  createParser,
  createGraphManager,
  createVectorManager,
  createSyncEngine,
  exportToStorage
} from '@cv-git/core';
import {
  findRepoRoot,
  loadWorkspace,
  saveWorkspace,
  isWorkspace,
  CVWorkspace,
  WorkspaceRepo,
  getCVDir,
} from '@cv-git/shared';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CredentialManager } from '@cv-git/credentials';
import { addGlobalOptions, createOutput } from '../utils/output.js';
import { checkCredentials, displayCompactStatus } from '../utils/config-check.js';
import { ensureFalkorDB, ensureQdrant, isDockerAvailable } from '../utils/infrastructure.js';

export function syncCommand(): Command {
  const cmd = new Command('sync');

  cmd
    .description('Synchronize the knowledge graph with the repository')
    .option('--delta', 'Smart delta sync - only process changed files (default)')
    .option('--incremental', 'Only sync changed files (legacy)')
    .option('--full', 'Force full sync of all files')
    .option('--force', 'Force full rebuild (clears graph first)')
    .option('--reset-delta', 'Reset delta tracking (forces full sync next time)');

  addGlobalOptions(cmd);

  cmd.action(async (options) => {
      const output = createOutput(options);
      let spinner: any;

      try {
        // Find repository root
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          console.error(chalk.red('Not in a CV-Git repository. Run `cv init` first.'));
          process.exit(1);
        }

        // Check if this is a workspace
        const workspace = await loadWorkspace(repoRoot);

        // Load configuration
        spinner = output.spinner('Loading configuration...').start();
        const config = await configManager.load(repoRoot);
        const credStatus = await checkCredentials();
        spinner.succeed('Configuration loaded');
        displayCompactStatus(credStatus);

        if (workspace) {
          // Workspace mode - sync all repos
          console.log(chalk.cyan(`\nWorkspace: ${workspace.name}`));
          console.log(chalk.gray(`Repos: ${workspace.repos.map(r => r.name).join(', ')}\n`));
          await syncWorkspace(workspace, config, options, output);
          return;
        }

        // Single repo mode
        // Initialize components
        spinner = output.spinner('Initializing components...').start();

        // Git manager
        const git = createGitManager(repoRoot);
        if (!(await git.isGitRepo())) {
          spinner.fail(chalk.red('Not a git repository'));
          process.exit(1);
        }

        // Parser
        const parser = createParser();

        // Graph manager - auto-start FalkorDB if configured for embedded mode
        spinner.text = 'Setting up FalkorDB...';

        const falkorInfo = await ensureFalkorDB({ silent: true });
        if (!falkorInfo) {
          spinner.fail('FalkorDB not available (Docker required)');
          process.exit(1);
        }

        const graphUrl = falkorInfo.url;
        if (falkorInfo.started) {
          spinner.succeed(`FalkorDB started on ${graphUrl}`);
        } else {
          spinner.succeed(`Using FalkorDB at ${graphUrl}`);
        }

        // Update config with the actual URL we're using
        if (graphUrl !== config.graph.url) {
          await configManager.update({ graph: { ...config.graph, url: graphUrl } });
        }

        const graph = createGraphManager(graphUrl, config.graph.database);
        spinner.text = 'Connecting to FalkorDB...';
        await graph.connect();
        spinner.succeed('Connected to FalkorDB');

        // Vector manager (optional - requires OpenAI or OpenRouter API key)
        let vector = undefined;
        let openaiApiKey = config.ai.apiKey || process.env.OPENAI_API_KEY;
        let openrouterApiKey = process.env.OPENROUTER_API_KEY;

        // Try to get from credential manager if not in config/env
        try {
          const credentials = new CredentialManager();
          await credentials.init();

          if (!openaiApiKey) {
            const credKey = await credentials.getOpenAIKey();
            output.debug(`OpenAI credential lookup: ${credKey ? 'found' : 'not found'}`);
            openaiApiKey = credKey || undefined;
          }

          if (!openrouterApiKey) {
            const routerKey = await credentials.getOpenRouterKey();
            output.debug(`OpenRouter credential lookup: ${routerKey ? 'found' : 'not found'}`);
            openrouterApiKey = routerKey || undefined;
          }
        } catch (credError: any) {
          output.debug(`Credential manager error: ${credError.message}`);
        }

        // Configure embedding provider for VectorManager
        // OpenRouter is preferred due to better model availability
        if (openrouterApiKey) {
          // Use OpenRouter for embeddings (preferred)
          if (!process.env.OPENROUTER_API_KEY) {
            process.env.OPENROUTER_API_KEY = openrouterApiKey;
          }
          if (!process.env.CV_EMBEDDING_MODEL) {
            process.env.CV_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
          }
        }

        if ((openaiApiKey || openrouterApiKey) && config.vector) {
          spinner = output.spinner('Setting up Qdrant...').start();

          const qdrantInfo = await ensureQdrant({ silent: true });
          let qdrantUrl = '';

          if (qdrantInfo) {
            qdrantUrl = qdrantInfo.url;
            if (qdrantInfo.started) {
              spinner.succeed(`Qdrant started on ${qdrantUrl}`);
            } else {
              spinner.succeed(`Using Qdrant at ${qdrantUrl}`);
            }

            // Update config with the actual URL we're using
            if (qdrantUrl !== config.vector.url) {
              await configManager.update({ vector: { ...config.vector, url: qdrantUrl } });
            }
          } else {
            spinner.warn('Qdrant not available (Docker required)');
            output.info('Continuing without vector search...');
          }

          if (qdrantUrl) {
            try {
              spinner = output.spinner('Connecting to Qdrant...').start();
              vector = createVectorManager({
                url: qdrantUrl,
                openrouterApiKey,
                openaiApiKey,
                collections: config.vector.collections,
                cacheDir: path.join(repoRoot, '.cv', 'embeddings')  // Content-addressed cache
              });
              await vector.connect();

              // Log cache status
              if (vector.isCacheEnabled()) {
                const cacheStats = await vector.getCacheStats();
                if (cacheStats && cacheStats.totalEntries > 0) {
                  output.debug(`Embedding cache: ${cacheStats.totalEntries} entries, ${cacheStats.hitRate.toFixed(1)}% hit rate`);
                }
              }

              spinner.succeed('Connected to Qdrant');
            } catch (error: any) {
              spinner.warn(`Could not connect to Qdrant: ${error.message}`);
              output.info('Continuing without vector search...');
              vector = undefined;
            }
          }
        } else if (!openaiApiKey && !openrouterApiKey) {
          output.info('No embedding API key found - skipping vector embeddings');
          output.debug('Run "cv auth setup openai" or "cv auth setup openrouter" to enable semantic search');
        }

        // Sync engine
        const syncEngine = createSyncEngine(repoRoot, git, parser, graph, vector);

        // Handle delta reset
        if (options.resetDelta) {
          spinner = output.spinner('Resetting delta tracking...').start();
          await syncEngine.resetDelta();
          spinner.succeed('Delta tracking reset. Next sync will be a full sync.');
          await graph.close();
          if (vector) await vector.close();
          return;
        }

        // Determine sync type
        // Delta is default unless --full, --force, or --incremental specified
        const forceFullSync = options.force;
        const useFullSync = options.full || forceFullSync;
        const useLegacyIncremental = options.incremental && !useFullSync;
        const useDeltaSync = !useFullSync && !useLegacyIncremental;

        if (useLegacyIncremental) {
          // Legacy incremental sync (requires caller to track changed files)
          spinner = output.spinner('Getting changed files...').start();

          const lastState = await syncEngine.loadSyncState();
          if (!lastState || !lastState.lastCommitSynced) {
            spinner.warn('No previous sync found, performing full sync instead');
          } else {
            // Use deltaSync which handles commit history and smart change detection
            spinner.text = 'Analyzing changes...';
            spinner.stop();

            const syncState = await syncEngine.deltaSync({
              excludePatterns: config.sync.excludePatterns,
              includeLanguages: config.sync.includeLanguages
            });

            console.log();
            spinner.succeed(
              chalk.green(
                `Incremental sync completed in ${syncState.syncDuration?.toFixed(1)}s`
              )
            );

            displaySyncResults(syncState);
            await graph.close();
            if (vector) await vector.close();
            return;
          }
        }

        if (useDeltaSync) {
          // Smart delta sync (default) - automatically detects changes
          spinner = output.spinner('Analyzing changes...').start();
          spinner.stop();

          const syncState = await syncEngine.deltaSync({
            excludePatterns: config.sync?.excludePatterns?.length ? config.sync.excludePatterns : undefined,
            includeLanguages: config.sync?.includeLanguages?.length ? config.sync.includeLanguages : undefined
          });

          console.log();

          if (syncState.delta.added.length === 0 &&
              syncState.delta.modified.length === 0 &&
              syncState.delta.deleted.length === 0) {
            console.log(chalk.green('✔ No changes detected'));
          } else {
            console.log(chalk.green('✔ Delta sync completed'));
          }

          displayDeltaSyncResults(syncState);

          // Export to .cv/ if anything changed
          if (syncState.delta.added.length > 0 ||
              syncState.delta.modified.length > 0 ||
              syncState.delta.deleted.length > 0) {
            spinner = output.spinner('Exporting to .cv/ storage...').start();
            try {
              const embeddingConfig = config.embedding ? {
                provider: config.embedding.provider || 'openrouter',
                model: config.embedding.model || 'openai/text-embedding-3-small',
                dimensions: 1536
              } : undefined;

              const exportResult = await exportToStorage(repoRoot, graph, vector, embeddingConfig);
              spinner.succeed(
                `Exported to .cv/: ${exportResult.stats.files} files, ${exportResult.stats.symbols} symbols`
              );
            } catch (exportError: any) {
              spinner.warn(`Export to .cv/ failed: ${exportError.message}`);
              output.debug(exportError.stack);
            }
          }

          await graph.close();
          if (vector) await vector.close();
          return;
        }

        // Full sync (--full or --force)
        spinner = output.spinner('Starting full sync...').start();

        // Clear graph if forcing full rebuild
        if (forceFullSync) {
          spinner.text = 'Clearing existing graph...';
          await graph.clear();
        }

        spinner.stop(); // Stop spinner so sync engine can log progress

        // Pass config patterns if defined, otherwise let sync engine use defaults
        // undefined means "use defaults", empty array means "exclude nothing"
        const syncState = await syncEngine.fullSync({
          excludePatterns: config.sync?.excludePatterns?.length ? config.sync.excludePatterns : undefined,
          includeLanguages: config.sync?.includeLanguages?.length ? config.sync.includeLanguages : undefined
        });

        console.log(); // Newline after sync logs
        console.log(chalk.green('✔ Full sync completed'));

        displaySyncResults(syncState);

        // Export to .cv/ files for portability
        console.log();
        spinner = output.spinner('Exporting to .cv/ storage...').start();
        try {
          const embeddingConfig = config.embedding ? {
            provider: config.embedding.provider || 'openrouter',
            model: config.embedding.model || 'openai/text-embedding-3-small',
            dimensions: 1536
          } : undefined;

          const exportResult = await exportToStorage(repoRoot, graph, vector, embeddingConfig);
          spinner.succeed(
            `Exported to .cv/: ${exportResult.stats.files} files, ${exportResult.stats.symbols} symbols, ${exportResult.stats.vectors} vectors`
          );
        } catch (exportError: any) {
          spinner.warn(`Export to .cv/ failed: ${exportError.message}`);
          output.debug(exportError.stack);
        }

        // Auto-import cv-prd exports if found
        spinner = output.spinner('Checking for PRD exports...').start();
        try {
          const importedCount = await autoImportPRDExports(repoRoot, graph, vector, output);
          if (importedCount > 0) {
            spinner.succeed(`Auto-imported ${importedCount} PRD export(s)`);
          } else {
            spinner.stop();
          }
        } catch (importError: any) {
          spinner.warn(`PRD auto-import failed: ${importError.message}`);
          output.debug(importError.stack);
        }

        // Close connections
        await graph.close();
        if (vector) {
          await vector.close();
        }

      } catch (error: any) {
        if (spinner) {
          spinner.fail(chalk.red('Sync failed'));
        } else {
          console.error(chalk.red('✖ Sync failed'));
        }

        console.error(chalk.red(`Error: ${error.message}`));

        if (error.stack && process.env.CV_DEBUG) {
          console.error(chalk.gray(error.stack));
        }

        // Specific error hints
        if (error.message.includes('ECONNREFUSED') || error.message.includes('connect')) {
          console.error();
          console.error(chalk.yellow('Hint: Make sure FalkorDB is running:'));
          console.error(chalk.gray('  docker run -d --name falkordb -p 6379:6379 falkordb/falkordb'));
        }

        if (error.message.includes('parser') || error.message.includes('tree-sitter')) {
          console.error();
          console.error(chalk.yellow('Hint: Make sure dependencies are installed:'));
          console.error(chalk.gray('  pnpm install'));
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Sync all repos in a workspace
 */
async function syncWorkspace(
  workspace: CVWorkspace,
  config: any,
  options: any,
  output: any
): Promise<void> {
  let spinner = output.spinner('Setting up infrastructure...').start();

  // Set up infrastructure (shared across all repos)
  const falkorInfo = await ensureFalkorDB({ silent: true });
  if (!falkorInfo) {
    spinner.fail('FalkorDB not available (Docker required)');
    process.exit(1);
  }
  spinner.succeed(`Using FalkorDB at ${falkorInfo.url}`);

  // Set up Qdrant if we have API keys
  let openaiApiKey = config.ai?.apiKey || process.env.OPENAI_API_KEY;
  let openrouterApiKey = process.env.OPENROUTER_API_KEY;

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

  let qdrantUrl: string | null = null;
  if (openaiApiKey || openrouterApiKey) {
    const qdrantInfo = await ensureQdrant({ silent: true });
    if (qdrantInfo) {
      qdrantUrl = qdrantInfo.url;
      spinner = output.spinner(`Using Qdrant at ${qdrantUrl}`).start();
      spinner.succeed(`Using Qdrant at ${qdrantUrl}`);
    }
  }

  // Connect to graph with workspace database name
  spinner = output.spinner('Connecting to graph database...').start();
  const graph = createGraphManager(falkorInfo.url, workspace.graphDatabase);
  await graph.connect();
  spinner.succeed(`Connected to graph: ${workspace.graphDatabase}`);

  // Set up vector if available
  let vector: any = null;
  if (qdrantUrl && (openaiApiKey || openrouterApiKey)) {
    try {
      vector = createVectorManager({
        url: qdrantUrl,
        openrouterApiKey,
        openaiApiKey,
        collections: config.vector?.collections || { codeChunks: 'code_chunks', docstrings: 'docstrings', commits: 'commits' },
        cacheDir: path.join(workspace.root, '.cv', 'embeddings')  // Content-addressed cache
      });
      await vector.connect();
    } catch {
      output.warn('Vector DB not available, continuing without embeddings');
    }
  }

  // Track overall stats
  const overallStats = {
    reposProcessed: 0,
    totalFiles: 0,
    totalSymbols: 0,
    totalEdges: 0,
    totalVectors: 0,
    errors: [] as string[],
  };

  console.log();

  // Sync each repo
  for (const repo of workspace.repos) {
    console.log(chalk.bold(`\n📁 Syncing ${repo.name}...`));

    try {
      const repoStats = await syncSingleRepoInWorkspace(
        repo,
        workspace,
        graph,
        vector,
        config,
        options,
        output
      );

      overallStats.reposProcessed++;
      overallStats.totalFiles += repoStats.fileCount || 0;
      overallStats.totalSymbols += repoStats.symbolCount || 0;
      overallStats.totalEdges += repoStats.edgeCount || 0;
      overallStats.totalVectors += repoStats.vectorCount || 0;

      // Update workspace.json with sync status
      repo.synced = true;
      repo.lastSyncedCommit = repoStats.lastCommit;

      console.log(chalk.green(`   ✓ ${repo.name}: ${repoStats.fileCount} files, ${repoStats.symbolCount} symbols`));
    } catch (error: any) {
      console.log(chalk.red(`   ✗ ${repo.name}: ${error.message}`));
      overallStats.errors.push(`${repo.name}: ${error.message}`);
    }
  }

  // Save updated workspace
  workspace.lastSyncedAt = new Date().toISOString();
  await saveWorkspace(workspace);

  // Close connections
  await graph.close();
  if (vector) {
    await vector.close();
  }

  // Display results
  console.log();
  console.log(chalk.bold('Workspace Sync Complete'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.cyan('  Repos synced:      '), `${overallStats.reposProcessed}/${workspace.repos.length}`);
  console.log(chalk.cyan('  Total files:       '), overallStats.totalFiles);
  console.log(chalk.cyan('  Total symbols:     '), overallStats.totalSymbols);
  console.log(chalk.cyan('  Relationships:     '), overallStats.totalEdges);
  if (overallStats.totalVectors > 0) {
    console.log(chalk.cyan('  Vectors stored:    '), overallStats.totalVectors);
  }
  console.log(chalk.gray('─'.repeat(50)));

  if (overallStats.errors.length > 0) {
    console.log(chalk.yellow(`\n⚠ ${overallStats.errors.length} repo(s) had errors`));
  }

  console.log();
  console.log(chalk.bold('Next steps:'));
  console.log(chalk.gray('  • Use AI code assistant:'), chalk.cyan('cv code'));
  console.log(chalk.gray('  • Search across repos:  '), chalk.cyan('cv find "authentication"'));
  console.log();
}

/**
 * Sync a single repo within a workspace context
 */
async function syncSingleRepoInWorkspace(
  repo: WorkspaceRepo,
  workspace: CVWorkspace,
  graph: any,
  vector: any,
  config: any,
  options: any,
  output: any
): Promise<{
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  vectorCount: number;
  lastCommit?: string;
}> {
  const repoPath = repo.absolutePath;

  // Create git manager for this repo
  const git = createGitManager(repoPath);
  if (!(await git.isGitRepo())) {
    throw new Error('Not a git repository');
  }

  // Get current commit
  const commits = await git.getRecentCommits(1);
  const lastCommit = commits.length > 0 ? commits[0].sha : undefined;

  // Create parser
  const parser = createParser();

  // Create sync engine with repo prefix for file paths
  const syncEngine = createSyncEngine(repoPath, git, parser, graph, vector);

  // Run sync with repo name prefix
  const syncState = await syncEngine.fullSync({
    excludePatterns: config.sync?.excludePatterns || [],
    includeLanguages: config.sync?.includeLanguages || [],
    // The sync engine will need to prefix paths with repo name
    // For now, we'll use the standard sync
  });

  return {
    fileCount: syncState.fileCount,
    symbolCount: syncState.symbolCount,
    edgeCount: syncState.edgeCount,
    vectorCount: syncState.vectorCount || 0,
    lastCommit,
  };
}

function displaySyncResults(syncState: any): void {
  console.log();
  console.log(chalk.bold('Sync Results:'));
  console.log(chalk.gray('─'.repeat(50)));

  console.log(chalk.cyan('  Files synced:      '), syncState.fileCount);
  console.log(chalk.cyan('  Symbols extracted: '), syncState.symbolCount);
  console.log(chalk.cyan('  Relationships:     '), syncState.edgeCount);
  if (syncState.vectorCount > 0) {
    console.log(chalk.cyan('  Vectors stored:    '), syncState.vectorCount);
  }
  console.log(chalk.cyan('  Duration:          '), `${syncState.syncDuration?.toFixed(1)}s`);

  if (syncState.languages && Object.keys(syncState.languages).length > 0) {
    console.log(chalk.cyan('  Languages:         '));
    for (const [lang, count] of Object.entries(syncState.languages)) {
      console.log(chalk.gray(`    - ${lang}: ${count} files`));
    }
  }

  if (syncState.errors && syncState.errors.length > 0) {
    console.log();
    console.log(chalk.yellow(`  Warnings: ${syncState.errors.length} files failed to parse`));
    if (process.env.CV_DEBUG) {
      syncState.errors.forEach((err: string) => {
        console.log(chalk.gray(`    - ${err}`));
      });
    }
  }

  console.log(chalk.gray('─'.repeat(50)));
  console.log();

  // Next steps
  console.log(chalk.bold('Next steps:'));
  console.log(chalk.gray('  • Query the graph:'), chalk.cyan('cv graph calls'));
  console.log(chalk.gray('  • Search code:    '), chalk.cyan('cv find "authentication"'));
  console.log(chalk.gray('  • Get help:       '), chalk.cyan('cv explain AuthService'));
  console.log();
}

function displayDeltaSyncResults(syncState: any): void {
  console.log();
  console.log(chalk.bold('Delta Sync Results:'));
  console.log(chalk.gray('─'.repeat(50)));

  const delta = syncState.delta;
  if (delta) {
    if (delta.added.length > 0) {
      console.log(chalk.green('  Added:      '), delta.added.length);
    }
    if (delta.modified.length > 0) {
      console.log(chalk.yellow('  Modified:   '), delta.modified.length);
    }
    if (delta.deleted.length > 0) {
      console.log(chalk.red('  Deleted:    '), delta.deleted.length);
    }
    if (delta.unchanged.length > 0) {
      console.log(chalk.gray('  Unchanged:  '), delta.unchanged.length);
    }
  }

  console.log(chalk.cyan('  Total files:       '), syncState.fileCount);
  console.log(chalk.cyan('  Total symbols:     '), syncState.symbolCount);
  console.log(chalk.cyan('  Relationships:     '), syncState.edgeCount);
  if (syncState.vectorCount > 0) {
    console.log(chalk.cyan('  Vectors:           '), syncState.vectorCount);
  }
  console.log(chalk.cyan('  Duration:          '), `${syncState.syncDuration?.toFixed(1)}s`);

  if (syncState.errors && syncState.errors.length > 0) {
    console.log();
    console.log(chalk.yellow(`  Warnings: ${syncState.errors.length} files failed to process`));
    if (process.env.CV_DEBUG) {
      syncState.errors.forEach((err: string) => {
        console.log(chalk.gray(`    - ${err}`));
      });
    }
  }

  console.log(chalk.gray('─'.repeat(50)));
  console.log();
}

/**
 * Find cv-prd exports in the repository root
 * Looks for directories ending in .cv/ or .cv.zip files with cv-prd-export format
 */
async function findPRDExports(repoRoot: string): Promise<{ path: string; manifest: any }[]> {
  const exports: { path: string; manifest: any }[] = [];

  try {
    const entries = await fs.readdir(repoRoot, { withFileTypes: true });

    for (const entry of entries) {
      // Skip .cv directory (that's cv-git's storage)
      if (entry.name === '.cv') continue;

      const fullPath = path.join(repoRoot, entry.name);

      // Check for .cv directories (export-*.cv/)
      if (entry.isDirectory() && entry.name.endsWith('.cv')) {
        const manifestPath = path.join(fullPath, 'manifest.json');
        try {
          const content = await fs.readFile(manifestPath, 'utf-8');
          const manifest = JSON.parse(content);
          if (manifest.format === 'cv-prd-export') {
            exports.push({ path: fullPath, manifest });
          }
        } catch {
          // Not a valid export directory
        }
      }

      // Check for .cv.zip files
      if (entry.isFile() && entry.name.endsWith('.cv.zip')) {
        // We'll just note the zip file exists - extraction happens during import
        exports.push({ path: fullPath, manifest: { isZip: true } });
      }
    }
  } catch {
    // Error reading directory
  }

  return exports;
}

/**
 * Auto-import PRD exports found in the repository
 */
async function autoImportPRDExports(
  repoRoot: string,
  graph: any,
  vector: any,
  output: any
): Promise<number> {
  const exports = await findPRDExports(repoRoot);
  if (exports.length === 0) return 0;

  let imported = 0;
  const cvDir = getCVDir(repoRoot);
  const importsDir = path.join(cvDir, 'imports');
  await fs.mkdir(importsDir, { recursive: true });

  // Check what's already been imported
  let importedProjects: Set<string> = new Set();
  try {
    const importFiles = await fs.readdir(importsDir);
    for (const file of importFiles) {
      if (file.endsWith('.json')) {
        const content = await fs.readFile(path.join(importsDir, file), 'utf-8');
        const record = JSON.parse(content);
        if (record.source?.project) {
          importedProjects.add(record.source.project);
        }
      }
    }
  } catch {
    // imports dir doesn't exist yet
  }

  for (const exp of exports) {
    // Skip zip files in auto-import (user should run cv import manually)
    if (exp.manifest.isZip) {
      console.log(chalk.yellow(`  Found cv-prd export: ${path.basename(exp.path)}`));
      console.log(chalk.gray(`    Run: cv import "${exp.path}"`));
      continue;
    }

    // Check if already imported
    const projectName = exp.manifest.source?.project;
    if (projectName && importedProjects.has(projectName)) {
      output.debug(`Skipping already imported: ${projectName}`);
      continue;
    }

    console.log(chalk.cyan(`  Auto-importing: ${path.basename(exp.path)}`));

    try {
      // Import PRD nodes
      const prdsPath = path.join(exp.path, 'prds', 'nodes.jsonl');
      const prdNodes = await readJsonl(prdsPath);

      for (const prd of prdNodes) {
        await graph.query(`
          MERGE (p:PRD {id: $id})
          SET p.name = $name,
              p.description = $description,
              p.priority = $priority,
              p.status = $status,
              p.imported_at = timestamp()
        `, {
          id: (prd.id || '').replace('prd:', ''),
          name: prd.name || '',
          description: prd.description || '',
          priority: prd.priority || 'medium',
          status: prd.status || 'draft'
        });
      }

      // Import chunks
      const chunksPath = path.join(exp.path, 'prds', 'chunks.jsonl');
      const chunkNodes = await readJsonl(chunksPath);

      for (const chunk of chunkNodes) {
        await graph.query(`
          MERGE (c:Chunk {id: $id})
          SET c.prd_id = $prd_id,
              c.chunk_type = $chunk_type,
              c.text = $text,
              c.priority = $priority,
              c.imported_at = timestamp()
          WITH c
          MATCH (p:PRD {id: $prd_id})
          MERGE (p)-[:HAS_CHUNK]->(c)
        `, {
          id: (chunk.id || '').replace('chunk:', ''),
          prd_id: chunk.prd_id || '',
          chunk_type: chunk.chunk_type || '',
          text: chunk.text || '',
          priority: chunk.priority || 'medium'
        });
      }

      // Import implementation links
      const linksPath = path.join(exp.path, 'prds', 'links.jsonl');
      const linkEdges = await readJsonl(linksPath);

      for (const link of linkEdges) {
        await graph.query(`
          MATCH (c:Chunk {id: $chunk_id})
          MERGE (s:Symbol {qualified_name: $symbol_id})
          MERGE (s)-[r:IMPLEMENTS]->(c)
        `, {
          chunk_id: (link.target || '').replace('chunk:', ''),
          symbol_id: link.source || ''
        });
      }

      // Record the import
      const importRecord = {
        source: exp.manifest.source,
        imported_at: new Date().toISOString(),
        stats: exp.manifest.stats,
        auto_imported: true
      };

      await fs.writeFile(
        path.join(importsDir, `${projectName}-${Date.now()}.json`),
        JSON.stringify(importRecord, null, 2)
      );

      console.log(chalk.green(`    ✓ Imported ${prdNodes.length} PRDs, ${chunkNodes.length} chunks`));
      imported++;

    } catch (error: any) {
      console.log(chalk.red(`    ✗ Failed: ${error.message}`));
    }
  }

  return imported;
}

/**
 * Read JSONL file
 */
async function readJsonl(filepath: string): Promise<any[]> {
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);
    return lines.map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

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
  createSyncEngine
} from '@cv-git/core';
import {
  findRepoRoot,
  loadWorkspace,
  saveWorkspace,
  isWorkspace,
  CVWorkspace,
  WorkspaceRepo,
} from '@cv-git/shared';
import { CredentialManager } from '@cv-git/credentials';
import { addGlobalOptions, createOutput } from '../utils/output.js';
import { checkCredentials, displayCompactStatus } from '../utils/config-check.js';
import { ensureFalkorDB, ensureQdrant, isDockerAvailable } from '../utils/infrastructure.js';

export function syncCommand(): Command {
  const cmd = new Command('sync');

  cmd
    .description('Synchronize the knowledge graph with the repository')
    .option('--incremental', 'Only sync changed files')
    .option('--force', 'Force full rebuild');

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
              vector = createVectorManager(
                qdrantUrl,
                openaiApiKey,
                config.vector.collections
              );
              await vector.connect();
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

        // Determine sync type
        const forceFullSync = options.force;
        let useIncremental = options.incremental && !forceFullSync;

        if (useIncremental) {
          // Incremental sync
          spinner = output.spinner('Getting changed files...').start();

          const lastState = await syncEngine.loadSyncState();
          if (!lastState || !lastState.lastCommitSynced) {
            spinner.warn('No previous sync found, performing full sync instead');
            useIncremental = false;
          } else {
            const changedFiles = await git.getChangedFilesSince(lastState.lastCommitSynced);

            if (changedFiles.length === 0) {
              spinner.succeed('No changes to sync');
              await graph.close();
              return;
            }

            spinner.text = `Syncing ${changedFiles.length} changed files...`;

            const syncState = await syncEngine.incrementalSync(changedFiles, {
              excludePatterns: config.sync.excludePatterns,
              includeLanguages: config.sync.includeLanguages
            });

            spinner.succeed(
              chalk.green(
                `Incremental sync completed in ${syncState.syncDuration?.toFixed(1)}s`
              )
            );

            displaySyncResults(syncState);
          }
        }

        if (!useIncremental) {
          // Full sync
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
    // Configure embedding provider - OpenRouter preferred
    if (openrouterApiKey) {
      // Use OpenRouter for embeddings (preferred)
      if (!process.env.OPENROUTER_API_KEY) {
        process.env.OPENROUTER_API_KEY = openrouterApiKey;
      }
      if (!process.env.CV_EMBEDDING_MODEL) {
        process.env.CV_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
      }
    }
    try {
      vector = createVectorManager(
        qdrantUrl,
        openaiApiKey,
        config.vector?.collections || { codeChunks: 'code_chunks', docstrings: 'docstrings', commits: 'commits' }
      );
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

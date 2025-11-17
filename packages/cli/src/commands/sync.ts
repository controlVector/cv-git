/**
 * cv sync command
 * Synchronize the knowledge graph with the repository
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { Ora } from 'ora';
import {
  configManager,
  createGitManager,
  createParser,
  createGraphManager,
  createVectorManager,
  createSyncEngine
} from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';
import { addGlobalOptions, createOutput } from '../utils/output.js';

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

        // Load configuration
        spinner = output.spinner('Loading configuration...').start();
        const config = await configManager.load(repoRoot);
        spinner.succeed('Configuration loaded');

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

        // Graph manager
        const graph = createGraphManager(config.graph.url, config.graph.database);

        spinner.text = 'Connecting to FalkorDB...';
        await graph.connect();
        spinner.succeed('Connected to FalkorDB');

        // Vector manager (optional - requires OpenAI API key)
        let vector = undefined;
        const openaiApiKey = config.ai.apiKey || process.env.OPENAI_API_KEY;

        if (openaiApiKey && config.vector) {
          try {
            spinner = output.spinner('Connecting to Qdrant...').start();
            vector = createVectorManager(
              config.vector.url,
              openaiApiKey,
              config.vector.collections
            );
            await vector.connect();
            spinner.succeed('Connected to Qdrant');
          } catch (error: any) {
            spinner.warn(`Could not connect to Qdrant: ${error.message}`);
            spinner = output.spinner('Continuing without vector search...').start();
            vector = undefined;
          }
        } else if (!openaiApiKey) {
          output.info('OpenAI API key not found - skipping vector embeddings');
          output.debug('Set OPENAI_API_KEY to enable semantic search');
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

          const syncState = await syncEngine.fullSync({
            excludePatterns: config.sync.excludePatterns,
            includeLanguages: config.sync.includeLanguages
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

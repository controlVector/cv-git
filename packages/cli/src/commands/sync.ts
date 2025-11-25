/**
 * cv sync command
 * Synchronize the knowledge graph with the repository
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
import { findRepoRoot } from '@cv-git/shared';
import { CredentialManager } from '@cv-git/credentials';
import { addGlobalOptions, createOutput } from '../utils/output.js';
import { checkCredentials, displayCompactStatus } from '../utils/config-check.js';

/**
 * Check if Docker is available
 */
function isDockerAvailable(): boolean {
  try {
    execSync('docker --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a port is available
 */
function isPortAvailable(port: number): boolean {
  try {
    // Try to connect - if connection refused, port is available
    execSync(`nc -z 127.0.0.1 ${port}`, { stdio: 'ignore', timeout: 1000 });
    return false; // Something is listening
  } catch {
    return true; // Port is available
  }
}

/**
 * Find an available port starting from the given port
 */
function findAvailablePort(startPort: number = 6379, maxAttempts: number = 100): number {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`Could not find available port starting from ${startPort}`);
}

/**
 * Check if cv-git's FalkorDB container is running and get its port
 */
function getCVFalkorDBInfo(): { running: boolean; port?: number; stopped?: boolean } {
  try {
    // Check if our container exists and is running
    const result = execSync('docker ps -a --filter name=cv-falkordb --format "{{.Status}}|{{.Ports}}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    if (!result) {
      return { running: false };
    }

    const isRunning = result.toLowerCase().startsWith('up');

    // Extract port from "0.0.0.0:6380->6379/tcp" format
    const portMatch = result.match(/:(\d+)->6379/);
    const port = portMatch ? parseInt(portMatch[1], 10) : undefined;

    return {
      running: isRunning,
      port,
      stopped: !isRunning
    };
  } catch {
    return { running: false };
  }
}

/**
 * Check if a Redis instance at the given URL is actually FalkorDB (has GRAPH module)
 */
async function isFalkorDBInstance(url: string): Promise<boolean> {
  try {
    // Extract host and port from redis://host:port
    const match = url.match(/redis:\/\/([^:]+):(\d+)/);
    if (!match) return false;

    const [, host, port] = match;

    // Check if GRAPH module is loaded
    const result = execSync(`redis-cli -h ${host} -p ${port} MODULE LIST`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 2000
    });

    return result.toLowerCase().includes('graph');
  } catch {
    return false;
  }
}

/**
 * Start or create cv-git's FalkorDB container
 */
async function ensureFalkorDB(spinner: any): Promise<{ url: string; started: boolean }> {
  if (!isDockerAvailable()) {
    throw new Error('Docker not available - FalkorDB requires Docker');
  }

  const containerInfo = getCVFalkorDBInfo();

  // If our container is running, return its URL
  if (containerInfo.running && containerInfo.port) {
    const url = `redis://localhost:${containerInfo.port}`;
    // Verify it's actually FalkorDB
    if (await isFalkorDBInstance(url)) {
      return { url, started: false };
    }
  }

  // If our container exists but is stopped, start it
  if (containerInfo.stopped && containerInfo.port) {
    spinner.text = 'Starting cv-git FalkorDB container...';
    execSync('docker start cv-falkordb', { stdio: 'ignore' });

    // Wait for it to be ready
    await waitForFalkorDB(containerInfo.port, spinner);
    return { url: `redis://localhost:${containerInfo.port}`, started: true };
  }

  // Need to create a new container - find available port
  spinner.text = 'Finding available port for FalkorDB...';
  const port = findAvailablePort(6379);

  spinner.text = `Creating FalkorDB container on port ${port}...`;
  try {
    execSync(`docker run -d --name cv-falkordb -p ${port}:6379 falkordb/falkordb:latest`, {
      stdio: 'ignore'
    });
  } catch (error: any) {
    // Container might already exist with wrong state - remove and retry
    if (error.message?.includes('already in use')) {
      execSync('docker rm -f cv-falkordb', { stdio: 'ignore' });
      execSync(`docker run -d --name cv-falkordb -p ${port}:6379 falkordb/falkordb:latest`, {
        stdio: 'ignore'
      });
    } else {
      throw error;
    }
  }

  await waitForFalkorDB(port, spinner);
  return { url: `redis://localhost:${port}`, started: true };
}

/**
 * Wait for FalkorDB to be ready
 */
async function waitForFalkorDB(port: number, spinner: any): Promise<void> {
  spinner.text = 'Waiting for FalkorDB to start...';

  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const result = execSync(`redis-cli -p ${port} MODULE LIST`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 1000
      });

      if (result.toLowerCase().includes('graph')) {
        return; // FalkorDB is ready
      }
    } catch {
      // Not ready yet
    }
  }

  throw new Error('FalkorDB did not start in time');
}

/**
 * Check if cv-git's Qdrant container is running and get its port
 */
function getCVQdrantInfo(): { running: boolean; port?: number; stopped?: boolean } {
  try {
    // Check if our container exists and is running
    const result = execSync('docker ps -a --filter name=cv-qdrant --format "{{.Status}}|{{.Ports}}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    if (!result) {
      return { running: false };
    }

    const isRunning = result.toLowerCase().startsWith('up');

    // Extract port from "0.0.0.0:6333->6333/tcp" format
    const portMatch = result.match(/:(\d+)->6333/);
    const port = portMatch ? parseInt(portMatch[1], 10) : undefined;

    return {
      running: isRunning,
      port,
      stopped: !isRunning
    };
  } catch {
    return { running: false };
  }
}

/**
 * Check if a Qdrant instance is available at the given URL
 */
async function isQdrantInstance(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/collections`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(2000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start or create cv-git's Qdrant container
 */
async function ensureQdrant(spinner: any): Promise<{ url: string; started: boolean }> {
  if (!isDockerAvailable()) {
    throw new Error('Docker not available - Qdrant requires Docker');
  }

  const containerInfo = getCVQdrantInfo();

  // If our container is running, return its URL
  if (containerInfo.running && containerInfo.port) {
    const url = `http://localhost:${containerInfo.port}`;
    // Verify it's actually Qdrant
    if (await isQdrantInstance(url)) {
      return { url, started: false };
    }
  }

  // If our container exists but is stopped, start it
  if (containerInfo.stopped && containerInfo.port) {
    spinner.text = 'Starting cv-git Qdrant container...';
    execSync('docker start cv-qdrant', { stdio: 'ignore' });

    // Wait for it to be ready
    await waitForQdrant(containerInfo.port, spinner);
    return { url: `http://localhost:${containerInfo.port}`, started: true };
  }

  // Need to create a new container - find available port
  spinner.text = 'Finding available port for Qdrant...';
  const port = findAvailablePort(6333);

  spinner.text = `Creating Qdrant container on port ${port}...`;
  try {
    execSync(`docker run -d --name cv-qdrant -p ${port}:6333 qdrant/qdrant:latest`, {
      stdio: 'ignore'
    });
  } catch (error: any) {
    // Container might already exist with wrong state - remove and retry
    if (error.message?.includes('already in use')) {
      execSync('docker rm -f cv-qdrant', { stdio: 'ignore' });
      execSync(`docker run -d --name cv-qdrant -p ${port}:6333 qdrant/qdrant:latest`, {
        stdio: 'ignore'
      });
    } else {
      throw error;
    }
  }

  await waitForQdrant(port, spinner);
  return { url: `http://localhost:${port}`, started: true };
}

/**
 * Wait for Qdrant to be ready
 */
async function waitForQdrant(port: number, spinner: any): Promise<void> {
  spinner.text = 'Waiting for Qdrant to start...';

  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const response = await fetch(`http://localhost:${port}/collections`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(1000)
      });

      if (response.ok) {
        return; // Qdrant is ready
      }
    } catch {
      // Not ready yet
    }
  }

  throw new Error('Qdrant did not start in time');
}

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
        const credStatus = await checkCredentials();
        spinner.succeed('Configuration loaded');
        displayCompactStatus(credStatus);

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
        let graphUrl = config.graph.url;

        spinner.text = 'Checking FalkorDB...';

        // Check if configured URL is actually FalkorDB
        const isConfiguredFalkor = await isFalkorDBInstance(graphUrl);

        if (!isConfiguredFalkor && config.graph.embedded !== false) {
          // Need to start our own FalkorDB instance
          spinner.text = 'FalkorDB not found, setting up...';
          const falkorInfo = await ensureFalkorDB(spinner);
          graphUrl = falkorInfo.url;

          if (falkorInfo.started) {
            spinner.succeed(`FalkorDB started on ${graphUrl}`);
          } else {
            spinner.succeed(`Using existing FalkorDB at ${graphUrl}`);
          }

          // Update config with the actual URL we're using
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

        // Set OpenRouter key in env for VectorManager to pick up
        if (openrouterApiKey && !process.env.OPENROUTER_API_KEY) {
          process.env.OPENROUTER_API_KEY = openrouterApiKey;
        }

        if ((openaiApiKey || openrouterApiKey) && config.vector) {
          spinner = output.spinner('Checking Qdrant...').start();
          let qdrantUrl = config.vector.url;

          // Check if configured URL is actually Qdrant
          const isConfiguredQdrant = await isQdrantInstance(qdrantUrl);

          if (!isConfiguredQdrant && config.vector.embedded !== false) {
            // Need to start our own Qdrant instance
            spinner.text = 'Qdrant not found, setting up...';
            try {
              const qdrantInfo = await ensureQdrant(spinner);
              qdrantUrl = qdrantInfo.url;

              if (qdrantInfo.started) {
                spinner.succeed(`Qdrant started on ${qdrantUrl}`);
              } else {
                spinner.succeed(`Using existing Qdrant at ${qdrantUrl}`);
              }

              // Update config with the actual URL we're using
              await configManager.update({ vector: { ...config.vector, url: qdrantUrl } });
            } catch (qdrantError: any) {
              spinner.warn(`Could not start Qdrant: ${qdrantError.message}`);
              output.info('Continuing without vector search...');
              qdrantUrl = '';
            }
          } else if (isConfiguredQdrant) {
            spinner.succeed(`Using Qdrant at ${qdrantUrl}`);
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

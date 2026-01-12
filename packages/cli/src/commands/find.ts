/**
 * cv find command
 * Semantic search over codebase
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  configManager,
  createVectorManager,
  getStorageInfo,
  loadVectorsOnly
} from '@cv-git/core';
import { findRepoRoot, getCVDir } from '@cv-git/shared';
import { VectorSearchResult, CodeChunkPayload } from '@cv-git/shared';
import { addGlobalOptions, createOutput } from '../utils/output.js';
import { getEmbeddingCredentials } from '../utils/credentials.js';
import { getPreferences } from '../config.js';
import { ensureOllama } from '../utils/infrastructure.js';

export function findCommand(): Command {
  const cmd = new Command('find');

  cmd
    .description('Search for code using natural language')
    .argument('<query>', 'Search query in natural language')
    .option('-l, --limit <number>', 'Maximum number of results', '10')
    .option('--language <lang>', 'Filter by programming language')
    .option('--file <path>', 'Filter by file path (partial match)')
    .option('--min-score <score>', 'Minimum similarity score (0-1)', '0.5');

  addGlobalOptions(cmd);

  cmd.action(async (query: string, options) => {
      const output = createOutput(options);
      const spinner = output.spinner('Initializing semantic search...').start();

      try {
        // Find repository root
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          spinner.fail(chalk.red('Not in a CV-Git repository'));
          console.error(chalk.gray('Run `cv init` first'));
          process.exit(1);
        }

        // Load configuration
        const config = await configManager.load(repoRoot);

        // Load user preferences to determine embedding provider
        const prefsManager = getPreferences();
        const prefs = await prefsManager.load();
        const embeddingProvider = config.embedding?.provider || prefs.embeddingProvider || 'ollama';

        // Get embedding credentials
        let ollamaUrl: string | undefined;
        let openrouterApiKey: string | undefined;
        let openaiApiKey: string | undefined;

        if (embeddingProvider === 'ollama') {
          spinner.text = 'Checking Ollama...';
          // Try to ensure Ollama is available
          const ollamaInfo = await ensureOllama({ silent: true });
          if (ollamaInfo) {
            ollamaUrl = ollamaInfo.url;
            spinner.text = `Using Ollama at ${ollamaUrl}...`;
          } else {
            // Fall back to cloud providers
            spinner.text = 'Ollama not available, checking cloud providers...';
            const embeddingCreds = await getEmbeddingCredentials({
              openRouterKey: config.embedding?.apiKey,
              openaiKey: config.ai?.apiKey
            });
            openrouterApiKey = embeddingCreds.openrouterApiKey;
            openaiApiKey = embeddingCreds.openaiApiKey;
            if (openrouterApiKey) {
              spinner.text = 'Using OpenRouter for embeddings (Ollama fallback)...';
            } else if (openaiApiKey) {
              spinner.text = 'Using OpenAI for embeddings (Ollama fallback)...';
            }
          }
        } else {
          // Use cloud provider as configured
          const embeddingCreds = await getEmbeddingCredentials({
            openRouterKey: config.embedding?.apiKey,
            openaiKey: config.ai?.apiKey
          });
          openrouterApiKey = embeddingCreds.openrouterApiKey;
          openaiApiKey = embeddingCreds.openaiApiKey;
          spinner.text = `Using ${embeddingCreds.provider} for embeddings...`;
        }

        // Initialize vector manager with proper credentials
        spinner.text = 'Connecting to Qdrant...';
        const vector = createVectorManager({
          url: config.vector.url,
          ollamaUrl,
          openrouterApiKey: ollamaUrl ? undefined : openrouterApiKey,
          openaiApiKey: ollamaUrl ? undefined : openaiApiKey,
          collections: config.vector.collections,
          vectorSize: embeddingProvider === 'ollama' ? 768 : 1536
        });

        await vector.connect();
        spinner.succeed('Connected to vector database');

        // Check if vectors are available in database
        let hasVectors = false;
        try {
          const collectionInfo = await vector.getCollectionInfo('code_chunks');
          hasVectors = (collectionInfo?.points_count || 0) > 0;
        } catch {
          // Collection might not exist
        }

        // Auto-load from .cv/ storage if needed
        if (!hasVectors) {
          const storageInfo = await getStorageInfo(repoRoot);
          if (storageInfo && storageInfo.stats.vectors > 0) {
            spinner.start(`Loading ${storageInfo.stats.vectors} vectors from .cv/ storage...`);
            try {
              const loadedCount = await loadVectorsOnly(repoRoot, vector);
              spinner.succeed(`Loaded ${loadedCount} vectors from local storage`);
            } catch (loadError: any) {
              spinner.warn(`Could not load vectors: ${loadError.message}`);
            }
          } else if (storageInfo && storageInfo.stats.vectors === 0) {
            spinner.warn('No vectors in storage. Run "cv sync --force" with embedding API key first.');
          } else {
            spinner.warn('No local storage found. Run "cv sync" first.');
          }
        }

        // Perform search
        spinner.start('Searching...');

        const limit = parseInt(options.limit, 10);
        const minScore = parseFloat(options.minScore);

        const results = await vector.searchCode(query, limit, {
          language: options.language,
          file: options.file,
          minScore
        });

        spinner.stop();

        // Display results
        if (results.length === 0) {
          console.log();
          console.log(chalk.yellow('No results found'));
          console.log(chalk.gray('Try:'));
          console.log(chalk.gray('  • Using different keywords'));
          console.log(chalk.gray('  • Lowering --min-score'));
          console.log(chalk.gray('  • Removing filters'));
          console.log();
        } else {
          displaySearchResults(query, results);
        }

        await vector.close();

      } catch (error: any) {
        spinner.fail(chalk.red('Search failed'));
        console.error(chalk.red(`Error: ${error.message}`));

        if (error.message.includes('ECONNREFUSED')) {
          console.error();
          console.error(chalk.yellow('Make sure Qdrant is running:'));
          console.error(chalk.gray('  docker run -d --name qdrant -p 6333:6333 qdrant/qdrant'));
        }

        if (error.message.includes('sync')) {
          console.error();
          console.error(chalk.yellow('Run sync first:'));
          console.error(chalk.gray('  cv sync'));
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Display search results
 */
function displaySearchResults(
  query: string,
  results: VectorSearchResult<CodeChunkPayload>[]
): void {
  console.log();
  console.log(chalk.bold.cyan(`Search results for: "${query}"`));
  console.log(chalk.gray('─'.repeat(80)));
  console.log();

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const payload = result.payload;
    const score = result.score;

    // Result header
    console.log(
      chalk.bold(`${i + 1}. ${payload.symbolName || 'Code chunk'} `) +
      chalk.gray(`(${(score * 100).toFixed(1)}% match)`)
    );

    // File and location
    console.log(
      chalk.cyan(`   ${payload.file}:${payload.startLine}-${payload.endLine}`) +
      (payload.language ? chalk.gray(` • ${payload.language}`) : '')
    );

    // Docstring if available
    if (payload.docstring) {
      console.log(chalk.gray(`   ${payload.docstring.split('\n')[0]}`));
    }

    // Code preview (first 5 lines)
    console.log();
    const codeLines = payload.text.split('\n').slice(0, 5);
    codeLines.forEach(line => {
      console.log(chalk.gray('   │ ') + line);
    });

    if (payload.text.split('\n').length > 5) {
      console.log(chalk.gray('   │ ...'));
    }

    console.log();
  }

  console.log(chalk.gray('─'.repeat(80)));
  console.log(chalk.gray(`Found ${results.length} results`));
  console.log();
}

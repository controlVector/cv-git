/**
 * cv find command
 * Semantic search over codebase
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  configManager,
  createVectorManager
} from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';
import { VectorSearchResult, CodeChunkPayload } from '@cv-git/shared';

export function findCommand(): Command {
  const cmd = new Command('find');

  cmd
    .description('Search for code using natural language')
    .argument('<query>', 'Search query in natural language')
    .option('-l, --limit <number>', 'Maximum number of results', '10')
    .option('--language <lang>', 'Filter by programming language')
    .option('--file <path>', 'Filter by file path (partial match)')
    .option('--min-score <score>', 'Minimum similarity score (0-1)', '0.5')
    .action(async (query: string, options) => {
      const spinner = ora('Initializing semantic search...').start();

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

        // Check for OpenAI API key
        const openaiApiKey = config.ai.apiKey || process.env.OPENAI_API_KEY;
        if (!openaiApiKey) {
          spinner.fail(chalk.red('OpenAI API key not found'));
          console.error();
          console.error(chalk.yellow('Set your OpenAI API key:'));
          console.error(chalk.gray('  export OPENAI_API_KEY=sk-...'));
          console.error(chalk.gray('Or add it to .cv/config.json'));
          process.exit(1);
        }

        // Initialize vector manager
        spinner.text = 'Connecting to Qdrant...';
        const vector = createVectorManager(
          config.vector.url,
          openaiApiKey,
          config.vector.collections
        );

        await vector.connect();
        spinner.succeed('Connected to vector database');

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

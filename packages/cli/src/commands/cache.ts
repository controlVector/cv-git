/**
 * CV Cache Command
 * Manage the content-addressed embedding cache
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { promises as fs } from 'fs';
import path from 'path';
import {
  configManager,
  createVectorManager
} from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';
import { getEmbeddingCredentials } from '../utils/credentials.js';

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format percentage
 */
function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Create the cache command with subcommands
 */
export function createCacheCommand(): Command {
  const cache = new Command('cache')
    .description('Manage content-addressed embedding cache');

  // ═══════════════════════════════════════════════════════════════════════════
  // cv cache stats - Show cache statistics
  // ═══════════════════════════════════════════════════════════════════════════
  cache
    .command('stats')
    .description('Show embedding cache statistics')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          console.error(chalk.red('Not in a CV-Git repository. Run `cv init` first.'));
          process.exit(1);
        }

        const config = await configManager.load(repoRoot);
        const embeddingCreds = await getEmbeddingCredentials({
          openRouterKey: config.embedding?.apiKey,
          openaiKey: config.ai?.apiKey
        });

        const vector = createVectorManager({
          url: config.vector.url,
          openrouterApiKey: embeddingCreds.openrouterApiKey,
          openaiApiKey: embeddingCreds.openaiApiKey,
          collections: config.vector.collections,
          cacheDir: path.join(repoRoot, '.cv', 'embeddings')
        });

        await vector.connect();
        const stats = await vector.getCacheStats();
        await vector.close();

        if (!stats) {
          console.log(chalk.yellow('Embedding cache is not enabled.'));
          process.exit(0);
        }

        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log(chalk.bold.cyan('\nEmbedding Cache Statistics\n'));
          console.log(chalk.gray('─'.repeat(50)));

          const table = new Table({
            chars: { 'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': '' }
          });

          table.push(
            [chalk.bold('Model'), stats.model],
            [chalk.bold('Dimensions'), stats.dimensions.toString()],
            [chalk.bold('Total Entries'), stats.totalEntries.toLocaleString()],
            [chalk.bold('Storage Size'), formatBytes(stats.totalSizeBytes)],
            [chalk.bold('Cache Hits'), stats.cacheHits.toLocaleString()],
            [chalk.bold('Cache Misses'), stats.cacheMisses.toLocaleString()],
            [chalk.bold('Hit Rate'), formatPercent(stats.hitRate)]
          );

          console.log(table.toString());

          // Cost savings estimate
          const tokensSaved = stats.cacheHits * 500;  // Assume ~500 tokens per chunk
          const costPerToken = 0.00002 / 1000;  // text-embedding-3-small rate
          const costSaved = tokensSaved * costPerToken;

          if (stats.cacheHits > 0) {
            console.log(chalk.gray('\nEstimated savings:'));
            console.log(`  API calls avoided: ${stats.cacheHits.toLocaleString()}`);
            console.log(`  Est. tokens saved: ~${tokensSaved.toLocaleString()}`);
            console.log(`  Est. cost saved:   ~$${costSaved.toFixed(4)}`);
          }

          console.log('');
        }

      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // cv cache clear - Clear the cache
  // ═══════════════════════════════════════════════════════════════════════════
  cache
    .command('clear')
    .description('Clear the embedding cache')
    .option('-f, --force', 'Skip confirmation')
    .action(async (options) => {
      try {
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          console.error(chalk.red('Not in a CV-Git repository'));
          process.exit(1);
        }

        if (!options.force) {
          const readline = await import('readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          });

          const answer = await new Promise<string>(resolve => {
            rl.question(chalk.yellow('Are you sure you want to clear the embedding cache? (y/N) '), resolve);
          });
          rl.close();

          if (answer.toLowerCase() !== 'y') {
            console.log('Cancelled.');
            process.exit(0);
          }
        }

        const spinner = ora('Clearing embedding cache...').start();

        const config = await configManager.load(repoRoot);
        const embeddingCreds = await getEmbeddingCredentials({
          openRouterKey: config.embedding?.apiKey,
          openaiKey: config.ai?.apiKey
        });

        const vector = createVectorManager({
          url: config.vector.url,
          openrouterApiKey: embeddingCreds.openrouterApiKey,
          openaiApiKey: embeddingCreds.openaiApiKey,
          collections: config.vector.collections,
          cacheDir: path.join(repoRoot, '.cv', 'embeddings')
        });

        await vector.connect();
        await vector.clearCache();
        await vector.close();

        spinner.succeed(chalk.green('Embedding cache cleared'));

      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // cv cache export - Export cache for sharing
  // ═══════════════════════════════════════════════════════════════════════════
  cache
    .command('export')
    .description('Export embedding cache for sharing')
    .option('-o, --output <file>', 'Output file (default: embeddings-export.json)')
    .action(async (options) => {
      const spinner = ora('Exporting embedding cache...').start();

      try {
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          spinner.fail(chalk.red('Not in a CV-Git repository'));
          process.exit(1);
        }

        const config = await configManager.load(repoRoot);
        const embeddingCreds = await getEmbeddingCredentials({
          openRouterKey: config.embedding?.apiKey,
          openaiKey: config.ai?.apiKey
        });

        const vector = createVectorManager({
          url: config.vector.url,
          openrouterApiKey: embeddingCreds.openrouterApiKey,
          openaiApiKey: embeddingCreds.openaiApiKey,
          collections: config.vector.collections,
          cacheDir: path.join(repoRoot, '.cv', 'embeddings')
        });

        await vector.connect();
        const exported = await vector.exportEmbeddings();
        await vector.close();

        if (!exported || exported.embeddings.length === 0) {
          spinner.warn('No embeddings to export');
          process.exit(0);
        }

        const outputFile = options.output || 'embeddings-export.json';
        await fs.writeFile(outputFile, JSON.stringify(exported, null, 2));

        spinner.succeed(
          chalk.green(`Exported ${exported.embeddings.length} embeddings to ${outputFile}`) +
          chalk.gray(` (${formatBytes(JSON.stringify(exported).length)})`)
        );

      } catch (error: any) {
        spinner.fail(chalk.red(`Export failed: ${error.message}`));
        process.exit(1);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // cv cache import - Import cache from file
  // ═══════════════════════════════════════════════════════════════════════════
  cache
    .command('import <file>')
    .description('Import embedding cache from file')
    .action(async (file: string) => {
      const spinner = ora('Importing embedding cache...').start();

      try {
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          spinner.fail(chalk.red('Not in a CV-Git repository'));
          process.exit(1);
        }

        // Read import file
        const data = JSON.parse(await fs.readFile(file, 'utf-8'));

        if (!data.embeddings || !Array.isArray(data.embeddings)) {
          spinner.fail(chalk.red('Invalid export file format'));
          process.exit(1);
        }

        const config = await configManager.load(repoRoot);
        const embeddingCreds = await getEmbeddingCredentials({
          openRouterKey: config.embedding?.apiKey,
          openaiKey: config.ai?.apiKey
        });

        const vector = createVectorManager({
          url: config.vector.url,
          openrouterApiKey: embeddingCreds.openrouterApiKey,
          openaiApiKey: embeddingCreds.openaiApiKey,
          collections: config.vector.collections,
          cacheDir: path.join(repoRoot, '.cv', 'embeddings')
        });

        await vector.connect();
        const result = await vector.importEmbeddings(data);
        await vector.close();

        spinner.succeed(
          chalk.green(`Imported ${result.imported} embeddings`) +
          (result.skipped > 0 ? chalk.gray(` (${result.skipped} already existed)`) : '')
        );

      } catch (error: any) {
        spinner.fail(chalk.red(`Import failed: ${error.message}`));
        process.exit(1);
      }
    });

  // ═══════════════════════════════════════════════════════════════════════════
  // cv cache path - Show cache location
  // ═══════════════════════════════════════════════════════════════════════════
  cache
    .command('path')
    .description('Show embedding cache location')
    .action(async () => {
      try {
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          console.error(chalk.red('Not in a CV-Git repository'));
          process.exit(1);
        }

        const cachePath = path.join(repoRoot, '.cv', 'embeddings');
        console.log(cachePath);

        // Check if exists and show size
        try {
          const indexPath = path.join(cachePath, 'index.json');
          const index = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
          console.log(chalk.gray(`  ${index.stats.totalEntries} embeddings, ${formatBytes(index.stats.totalSizeBytes)}`));
        } catch {
          console.log(chalk.gray('  (not initialized)'));
        }

      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
    });

  return cache;
}

// Export for index.ts
export { createCacheCommand as cacheCommand };

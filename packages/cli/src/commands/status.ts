/**
 * Status Command
 * Show CV-Git status, repository state, and service health
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { simpleGit } from 'simple-git';
import { promises as fs } from 'fs';
import * as path from 'path';
import { getConfig } from '../config.js';

export function statusCommand(): Command {
  const cmd = new Command('status');
  cmd.description('Show CV-Git status');
  cmd.option('--json', 'Output as JSON');

  cmd.action(async (options) => {
    try {
      const git = simpleGit();
      const config = getConfig();
      const cvConfig = await config.load();

      // Check if we're in a git repository
      const isGitRepo = await git.checkIsRepo();
      if (!isGitRepo) {
        console.error(chalk.red('✗ Not a git repository'));
        process.exit(1);
      }

      // Get git status
      const gitStatus = await git.status();
      const branch = await git.revparse(['--abbrev-ref', 'HEAD']);

      // Get CV-Git status
      const cvGitInitialized = await isCVGitInitialized();
      const lastSync = await getLastSyncTime();
      const stats = await getGraphStats();

      // Check service health
      const services = await checkServices(cvConfig);

      if (options.json) {
        console.log(JSON.stringify({
          git: {
            branch,
            ahead: gitStatus.ahead,
            behind: gitStatus.behind,
            modified: gitStatus.modified.length,
            created: gitStatus.created.length,
            deleted: gitStatus.deleted.length,
            conflicted: gitStatus.conflicted.length,
          },
          cvGit: {
            initialized: cvGitInitialized,
            lastSync,
            stats,
          },
          services,
        }, null, 2));
      } else {
        // Git status
        console.log(chalk.bold('\n📊 CV-Git Status\n'));

        console.log(chalk.bold.cyan('Git Repository:'));
        console.log(`  Branch: ${chalk.green(branch)}`);
        if (gitStatus.ahead > 0) {
          console.log(`  ${chalk.yellow('↑')} ${gitStatus.ahead} commit(s) ahead of remote`);
        }
        if (gitStatus.behind > 0) {
          console.log(`  ${chalk.yellow('↓')} ${gitStatus.behind} commit(s) behind remote`);
        }
        if (gitStatus.modified.length > 0) {
          console.log(`  ${chalk.yellow('M')} ${gitStatus.modified.length} file(s) modified`);
        }
        if (gitStatus.created.length > 0) {
          console.log(`  ${chalk.green('A')} ${gitStatus.created.length} file(s) added`);
        }
        if (gitStatus.deleted.length > 0) {
          console.log(`  ${chalk.red('D')} ${gitStatus.deleted.length} file(s) deleted`);
        }
        if (gitStatus.conflicted.length > 0) {
          console.log(`  ${chalk.red('C')} ${gitStatus.conflicted.length} file(s) conflicted`);
        }

        // CV-Git status
        console.log(chalk.bold.cyan('\nCV-Git:'));
        if (cvGitInitialized) {
          console.log(`  Status: ${chalk.green('✓ Initialized')}`);
          if (lastSync) {
            console.log(`  Last Sync: ${chalk.gray(formatTime(lastSync))}`);
            const age = Date.now() - lastSync.getTime();
            if (age > 3600000) { // > 1 hour
              console.log(`  ${chalk.yellow('⚠️  Sync is outdated (run cv sync)')}`);
            }
          } else {
            console.log(`  Last Sync: ${chalk.yellow('Never (run cv sync)')}`);
          }

          if (stats) {
            console.log(`  Files: ${chalk.white(stats.files.toString())}`);
            console.log(`  Symbols: ${chalk.white(stats.symbols.toString())}`);
            if (stats.embeddings) {
              console.log(`  Embeddings: ${chalk.white(stats.embeddings.toString())}`);
            }
          }
        } else {
          console.log(`  Status: ${chalk.yellow('Not initialized (run cv init)')}`);
        }

        // Services
        console.log(chalk.bold.cyan('\nServices:'));
        for (const [name, service] of Object.entries(services)) {
          const svc = service as { healthy: boolean; error?: string };
          const icon = svc.healthy ? chalk.green('✓') : chalk.red('✗');
          const status = svc.healthy ? chalk.green('Running') : chalk.red('Not available');
          console.log(`  ${icon} ${name}: ${status}`);
          if (svc.error) {
            console.log(`    ${chalk.gray(svc.error)}`);
          }
        }

        console.log();
      }
    } catch (error: any) {
      console.error(chalk.red('✗ Error getting status:'), error.message);
      process.exit(1);
    }
  });

  return cmd;
}

/**
 * Check if CV-Git is initialized in current repo
 */
async function isCVGitInitialized(): Promise<boolean> {
  try {
    await fs.access('.cv');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get last sync time
 */
async function getLastSyncTime(): Promise<Date | null> {
  try {
    const syncStatePath = path.join('.cv', 'sync-state.json');
    const data = await fs.readFile(syncStatePath, 'utf8');
    const state = JSON.parse(data);
    return state.lastSync ? new Date(state.lastSync) : null;
  } catch {
    return null;
  }
}

/**
 * Get graph statistics
 */
async function getGraphStats(): Promise<any> {
  try {
    const syncStatePath = path.join('.cv', 'sync-state.json');
    const data = await fs.readFile(syncStatePath, 'utf8');
    const state = JSON.parse(data);
    return {
      files: state.fileCount || 0,
      symbols: state.symbolCount || 0,
      embeddings: state.embeddingCount || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Check service health
 */
async function checkServices(config: any): Promise<any> {
  const services: any = {};

  // Check FalkorDB
  services.FalkorDB = await checkRedis(config.graph.url);

  // Check Qdrant
  services.Qdrant = await checkQdrant(config.vector.url);

  return services;
}

/**
 * Check Redis/FalkorDB connection
 */
async function checkRedis(url: string): Promise<{ healthy: boolean; error?: string }> {
  try {
    const { createClient } = await import('redis');
    const client = createClient({ url });

    await client.connect();
    await client.ping();
    await client.disconnect();

    return { healthy: true };
  } catch (error: any) {
    return {
      healthy: false,
      error: error.message || 'Connection failed',
    };
  }
}

/**
 * Check Qdrant connection
 */
async function checkQdrant(url: string): Promise<{ healthy: boolean; error?: string }> {
  try {
    const response = await fetch(`${url}/collections`);
    if (response.ok) {
      return { healthy: true };
    }
    return {
      healthy: false,
      error: `HTTP ${response.status}`,
    };
  } catch (error: any) {
    return {
      healthy: false,
      error: error.message || 'Connection failed',
    };
  }
}

/**
 * Format timestamp
 */
function formatTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day(s) ago`;
  if (hours > 0) return `${hours} hour(s) ago`;
  if (minutes > 0) return `${minutes} minute(s) ago`;
  return 'just now';
}

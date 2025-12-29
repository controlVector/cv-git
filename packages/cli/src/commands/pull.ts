/**
 * cv pull command
 * Git pull with automatic knowledge graph sync
 *
 * Syncs the knowledge graph after pulling to keep it current
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { addGlobalOptions } from '../utils/output.js';

/**
 * Find git repository root (works with any git repo, not just CV-initialized)
 */
function findGitRoot(startDir: string = process.cwd()): string | null {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const gitDir = path.join(currentDir, '.git');
    if (fs.existsSync(gitDir)) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

/**
 * Check if CV is initialized in a git repo
 */
function isCVInitialized(repoRoot: string): boolean {
  const cvConfigPath = path.join(repoRoot, '.cv', 'config.json');
  return fs.existsSync(cvConfigPath);
}

interface PullOptions {
  skipSync?: boolean;
  syncOnly?: boolean;
  rebase?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

export function pullCommand(): Command {
  const cmd = new Command('pull');

  cmd
    .description('Git pull with automatic knowledge graph sync')
    .argument('[remote]', 'Remote name (default: origin)')
    .argument('[branch]', 'Branch name (default: current tracking branch)')
    .option('--skip-sync', 'Skip knowledge graph sync after pull')
    .option('--sync-only', 'Only sync, do not pull')
    .option('-r, --rebase', 'Rebase instead of merge')
    .allowUnknownOption(true)
    .passThroughOptions(true);

  addGlobalOptions(cmd);

  cmd.action(async (remote: string | undefined, branch: string | undefined, options: PullOptions, command: Command) => {
    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(128);
      }

      // Check if CV is initialized
      const cvInitialized = isCVInitialized(repoRoot);

      // Step 1: Git pull (unless sync-only)
      if (!options.syncOnly) {
        const pullSpinner = ora('Pulling from remote...').start();

        try {
          const exitCode = await gitPull(remote, branch, options, command.args);
          if (exitCode !== 0) {
            pullSpinner.fail(chalk.red('Pull failed'));
            process.exit(exitCode);
          }
          pullSpinner.succeed(chalk.green('Pulled successfully'));
        } catch (error: any) {
          pullSpinner.fail(chalk.red('Pull failed'));
          console.error(chalk.red(error.message));
          process.exit(1);
        }
      }

      // Step 2: Sync knowledge graph (unless skip-sync or CV not initialized)
      if (!options.skipSync && cvInitialized) {
        const syncSpinner = ora('Syncing knowledge graph...').start();

        try {
          // Run cv sync --incremental via subprocess
          const result = spawnSync('cv', ['sync', '--incremental'], {
            cwd: repoRoot,
            stdio: ['inherit', 'pipe', 'pipe'],
            encoding: 'utf-8',
          });

          if (result.status === 0) {
            syncSpinner.succeed(chalk.green('Knowledge graph synced'));
          } else {
            throw new Error(result.stderr || 'Sync failed');
          }
        } catch (error: any) {
          syncSpinner.warn(chalk.yellow(`Sync warning: ${error.message}`));
          // Don't fail the pull if sync fails
          if (options.verbose) {
            console.error(chalk.gray(error.stack));
          }
        }
      } else if (!cvInitialized && !options.quiet) {
        console.log(chalk.gray('  Tip: Run `cv init` to enable knowledge graph sync'));
      }

      console.log(chalk.green('\n✓ Done'));

    } catch (error: any) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

  return cmd;
}

/**
 * Run git pull with passthrough arguments
 */
async function gitPull(
  remote: string | undefined,
  branch: string | undefined,
  options: PullOptions,
  extraArgs: string[]
): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = ['pull'];

    // Add rebase flag
    if (options.rebase) {
      args.push('--rebase');
    }

    // Add remote and branch if specified
    if (remote) {
      args.push(remote);
      if (branch) {
        args.push(branch);
      }
    }

    // Add any extra passthrough arguments (filter out cv-specific options)
    const filteredArgs = extraArgs.filter(arg =>
      !arg.startsWith('--skip-sync') &&
      !arg.startsWith('--sync-only') &&
      !arg.startsWith('--cv-')
    );
    args.push(...filteredArgs);

    // Use stdio: 'inherit' for native git feel
    const git = spawn('git', args, {
      stdio: 'inherit',
      env: process.env
    });

    git.on('error', (error) => {
      reject(error);
    });

    git.on('close', (code) => {
      resolve(code ?? 0);
    });
  });
}

/**
 * cv checkout / cv switch command
 * Git checkout with automatic knowledge graph sync
 *
 * Switch branches or restore working tree files
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { spawn, spawnSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { addGlobalOptions, createOutput } from '../utils/output.js';

/**
 * Find git repository root
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
 * Check if CV is initialized
 */
function isCVInitialized(repoRoot: string): boolean {
  return fs.existsSync(path.join(repoRoot, '.cv', 'config.json'));
}

interface CheckoutOptions {
  branch?: boolean;
  create?: boolean;
  force?: boolean;
  merge?: boolean;
  track?: boolean;
  skipSync?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export function checkoutCommand(): Command {
  const cmd = new Command('checkout');

  cmd
    .description('Switch branches or restore files (git checkout wrapper with auto-sync)')
    .argument('[branch-or-file]', 'Branch to switch to or file to restore')
    .argument('[files...]', 'Additional files to restore')
    .option('-b, --branch', 'Create a new branch')
    .option('-B, --create', 'Create or reset a branch')
    .option('-f, --force', 'Force checkout (discard local changes)')
    .option('-m, --merge', 'Merge local changes when switching')
    .option('-t, --track', 'Set up tracking mode')
    .option('--skip-sync', 'Skip knowledge graph sync after switching')
    .allowUnknownOption(true);

  addGlobalOptions(cmd);

  cmd.action(async (branchOrFile: string | undefined, files: string[], options: CheckoutOptions, command: Command) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      if (!branchOrFile && files.length === 0) {
        console.log(chalk.yellow('Usage: cv checkout <branch> or cv checkout <file>'));
        console.log();
        console.log(chalk.gray('Examples:'));
        console.log(chalk.gray('  cv checkout main           # Switch to main branch'));
        console.log(chalk.gray('  cv checkout -b feature     # Create and switch to new branch'));
        console.log(chalk.gray('  cv checkout -- file.ts     # Restore file from HEAD'));
        return;
      }

      // Get current branch for comparison
      const currentBranch = getCurrentBranch(repoRoot);
      const cvInitialized = isCVInitialized(repoRoot);

      // Build git checkout arguments
      const args = ['checkout'];

      if (options.branch) args.push('-b');
      if (options.create) args.push('-B');
      if (options.force) args.push('-f');
      if (options.merge) args.push('-m');
      if (options.track) args.push('-t');

      // Add target
      if (branchOrFile) {
        args.push(branchOrFile);
      }

      // Add files
      if (files.length > 0) {
        args.push('--', ...files);
      }

      // Add extra passthrough arguments
      const knownOpts = ['-b', '--branch', '-B', '--create', '-f', '--force',
        '-m', '--merge', '-t', '--track', '--skip-sync',
        '--verbose', '--quiet', '--json', '--options'];
      const extraArgs = command.args.filter(arg => !knownOpts.includes(arg));
      args.push(...extraArgs);

      // Run git checkout
      const checkoutSpinner = options.quiet ? null : ora('Checking out...').start();

      try {
        await runGitCheckout(args, repoRoot);
        checkoutSpinner?.succeed(chalk.green(`Checked out ${branchOrFile}`));
      } catch (error: any) {
        checkoutSpinner?.fail(chalk.red('Checkout failed'));
        throw error;
      }

      // Get new branch
      const newBranch = getCurrentBranch(repoRoot);

      // Sync knowledge graph if branch changed and CV is initialized
      if (cvInitialized && !options.skipSync && currentBranch !== newBranch && newBranch) {
        const syncSpinner = options.quiet ? null : ora('Syncing knowledge graph...').start();

        try {
          const result = spawnSync('cv', ['sync', '--incremental'], {
            cwd: repoRoot,
            stdio: ['inherit', 'pipe', 'pipe'],
            encoding: 'utf-8',
          });

          if (result.status === 0) {
            syncSpinner?.succeed(chalk.green('Knowledge graph synced'));
          } else {
            syncSpinner?.warn(chalk.yellow('Sync warning: ' + (result.stderr || 'unknown error')));
          }
        } catch (error: any) {
          syncSpinner?.warn(chalk.yellow(`Sync warning: ${error.message}`));
        }
      }

      if (options.json) {
        output.json({
          success: true,
          previousBranch: currentBranch,
          currentBranch: newBranch,
          synced: cvInitialized && !options.skipSync && currentBranch !== newBranch,
        });
      } else if (!options.quiet) {
        console.log(chalk.green('\n✓ Done'));
      }

    } catch (error: any) {
      if (options.json) {
        output.json({ success: false, error: error.message });
      } else {
        console.error(chalk.red(`Error: ${error.message}`));
      }
      process.exit(1);
    }
  });

  return cmd;
}

/**
 * Also create 'switch' as an alias for checkout (modern git style)
 */
export function switchCommand(): Command {
  const cmd = new Command('switch');

  cmd
    .description('Switch branches (alias for cv checkout, git switch style)')
    .argument('[branch]', 'Branch to switch to')
    .option('-c, --create <branch>', 'Create a new branch and switch to it')
    .option('-C, --force-create <branch>', 'Create or reset a branch and switch to it')
    .option('-d, --detach', 'Detach HEAD at the commit')
    .option('--skip-sync', 'Skip knowledge graph sync after switching')
    .allowUnknownOption(true);

  addGlobalOptions(cmd);

  cmd.action(async (branch: string | undefined, options: any, command: Command) => {
    const output = createOutput(options);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      if (!branch && !options.create && !options.forceCreate) {
        // List branches
        console.log(chalk.bold('\nAvailable branches:\n'));
        await runGitCommand(['branch', '-a'], repoRoot);
        return;
      }

      // Get current branch
      const currentBranch = getCurrentBranch(repoRoot);
      const cvInitialized = isCVInitialized(repoRoot);

      // Build git switch arguments
      const args = ['switch'];

      if (options.create) {
        args.push('-c', options.create);
      } else if (options.forceCreate) {
        args.push('-C', options.forceCreate);
      }
      if (options.detach) args.push('-d');

      if (branch) {
        args.push(branch);
      }

      // Run git switch
      const spinner = options.quiet ? null : ora('Switching branch...').start();

      try {
        await runGitCommand(args, repoRoot);
        spinner?.succeed(chalk.green(`Switched to ${options.create || options.forceCreate || branch}`));
      } catch (error: any) {
        spinner?.fail(chalk.red('Switch failed'));
        throw error;
      }

      // Get new branch
      const newBranch = getCurrentBranch(repoRoot);

      // Sync if branch changed
      if (cvInitialized && !options.skipSync && currentBranch !== newBranch && newBranch) {
        const syncSpinner = options.quiet ? null : ora('Syncing knowledge graph...').start();

        try {
          const result = spawnSync('cv', ['sync', '--incremental'], {
            cwd: repoRoot,
            stdio: ['inherit', 'pipe', 'pipe'],
            encoding: 'utf-8',
          });

          if (result.status === 0) {
            syncSpinner?.succeed(chalk.green('Knowledge graph synced'));
          } else {
            syncSpinner?.warn(chalk.yellow('Sync warning'));
          }
        } catch {
          syncSpinner?.warn(chalk.yellow('Sync warning'));
        }
      }

      if (!options.quiet) {
        console.log(chalk.green('\n✓ Done'));
      }

    } catch (error: any) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

  return cmd;
}

/**
 * Run git checkout
 */
async function runGitCheckout(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let stderr = '';

    git.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `git checkout failed with code ${code}`));
      }
    });

    git.on('error', reject);
  });
}

/**
 * Run any git command
 */
async function runGitCommand(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: 'inherit',
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git ${args[0]} failed with code ${code}`));
      }
    });

    git.on('error', reject);
  });
}

/**
 * Get current branch name
 */
function getCurrentBranch(cwd: string): string | null {
  try {
    return execSync('git branch --show-current', {
      cwd,
      encoding: 'utf-8',
    }).trim() || null;
  } catch {
    return null;
  }
}


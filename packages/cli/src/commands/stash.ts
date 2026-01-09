/**
 * cv stash command
 * Git stash wrapper
 *
 * Stash changes for later
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { spawn, execSync } from 'child_process';
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

interface StashOptions {
  message?: string;
  keepIndex?: boolean;
  includeUntracked?: boolean;
  all?: boolean;
  patch?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export function stashCommand(): Command {
  const cmd = new Command('stash');

  cmd
    .description('Stash changes (git stash wrapper)')
    .argument('[subcommand]', 'Subcommand: push, pop, apply, list, show, drop, clear')
    .argument('[args...]', 'Additional arguments')
    .option('-m, --message <message>', 'Stash message')
    .option('-k, --keep-index', 'Keep staged changes in the index')
    .option('-u, --include-untracked', 'Include untracked files')
    .option('-a, --all', 'Include ignored files too')
    .option('-p, --patch', 'Interactive patch mode')
    .allowUnknownOption(true);

  addGlobalOptions(cmd);

  cmd.action(async (subcommand: string | undefined, args: string[], options: StashOptions, command: Command) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      // Build git stash arguments
      const gitArgs = ['stash'];

      // Handle subcommands
      const validSubcommands = ['push', 'pop', 'apply', 'list', 'show', 'drop', 'clear', 'branch', 'create', 'store'];

      if (subcommand && validSubcommands.includes(subcommand)) {
        gitArgs.push(subcommand);

        // Handle subcommand-specific options
        if (subcommand === 'push' || !subcommand) {
          if (options.message) gitArgs.push('-m', options.message);
          if (options.keepIndex) gitArgs.push('--keep-index');
          if (options.includeUntracked) gitArgs.push('--include-untracked');
          if (options.all) gitArgs.push('--all');
          if (options.patch) gitArgs.push('--patch');
        }

        // Add extra arguments
        gitArgs.push(...args);
      } else if (subcommand) {
        // Not a subcommand, treat as push with path
        gitArgs.push('push');
        if (options.message) gitArgs.push('-m', options.message);
        if (options.keepIndex) gitArgs.push('--keep-index');
        if (options.includeUntracked) gitArgs.push('--include-untracked');
        gitArgs.push('--', subcommand, ...args);
      } else {
        // Default: stash push
        if (options.message) gitArgs.push('-m', options.message);
        if (options.keepIndex) gitArgs.push('--keep-index');
        if (options.includeUntracked) gitArgs.push('--include-untracked');
        if (options.all) gitArgs.push('--all');
        if (options.patch) gitArgs.push('--patch');
      }

      if (options.json && (subcommand === 'list' || !subcommand)) {
        // JSON output for list
        const stashes = getStashList(repoRoot);
        output.json({ stashes });
      } else {
        // Normal execution
        await runGitStash(gitArgs, repoRoot);

        if (!options.quiet) {
          // Show helpful message after stash operations
          if (!subcommand || subcommand === 'push') {
            const count = getStashCount(repoRoot);
            console.log(chalk.green(`\n✓ Changes stashed (${count} stash${count !== 1 ? 'es' : ''} total)`));
            console.log(chalk.gray('  Restore with: cv stash pop'));
          } else if (subcommand === 'pop' || subcommand === 'apply') {
            console.log(chalk.green('\n✓ Stash applied'));
          } else if (subcommand === 'drop') {
            console.log(chalk.green('\n✓ Stash dropped'));
          } else if (subcommand === 'clear') {
            console.log(chalk.green('\n✓ All stashes cleared'));
          }
        }
      }

    } catch (error: any) {
      if (options.json) {
        output.json({ error: error.message });
      } else {
        console.error(chalk.red(`Error: ${error.message}`));
      }
      process.exit(1);
    }
  });

  return cmd;
}

/**
 * Run git stash command
 */
async function runGitStash(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: 'inherit',
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git stash failed with code ${code}`));
      }
    });

    git.on('error', reject);
  });
}

/**
 * Get stash count
 */
function getStashCount(cwd: string): number {
  try {
    const output = execSync('git stash list', {
      cwd,
      encoding: 'utf-8',
    });
    return output.trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * Get stash list as JSON
 */
function getStashList(cwd: string): any[] {
  try {
    const output = execSync('git stash list --format="%gd|%s|%ci"', {
      cwd,
      encoding: 'utf-8',
    });

    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [ref, message, date] = line.split('|');
        return {
          ref: ref.trim(),
          message: message.trim(),
          date: date.trim(),
        };
      });
  } catch {
    return [];
  }
}

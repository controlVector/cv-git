/**
 * cv revert command
 * Git revert wrapper
 *
 * Revert commits by creating new commits
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { spawn } from 'child_process';
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

interface RevertOptions {
  noCommit?: boolean;
  noEdit?: boolean;
  mainline?: string;
  abort?: boolean;
  continue?: boolean;
  skip?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export function revertCommand(): Command {
  const cmd = new Command('revert');

  cmd
    .description('Revert commits (git revert wrapper)')
    .argument('[commits...]', 'Commits to revert')
    .option('-n, --no-commit', 'Don\'t auto-commit the revert')
    .option('--no-edit', 'Don\'t open editor for commit message')
    .option('-m, --mainline <parent>', 'Select mainline parent for merge commits')
    .option('--abort', 'Abort current revert operation')
    .option('--continue', 'Continue after resolving conflicts')
    .option('--skip', 'Skip current commit and continue')
    .allowUnknownOption(true);

  addGlobalOptions(cmd);

  cmd.action(async (commits: string[], options: RevertOptions, command: Command) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      // Handle operations
      if (options.abort) {
        await runGitRevert(['revert', '--abort'], repoRoot);
        if (!options.quiet) {
          console.log(chalk.yellow('Revert aborted'));
        }
        return;
      }

      if (options.continue) {
        await runGitRevert(['revert', '--continue'], repoRoot);
        if (!options.quiet) {
          console.log(chalk.green('Revert continued'));
        }
        return;
      }

      if (options.skip) {
        await runGitRevert(['revert', '--skip'], repoRoot);
        if (!options.quiet) {
          console.log(chalk.yellow('Skipped commit'));
        }
        return;
      }

      if (commits.length === 0) {
        console.log(chalk.yellow('Usage: cv revert <commit> [commit...]'));
        console.log();
        console.log(chalk.gray('Examples:'));
        console.log(chalk.gray('  cv revert HEAD           # Revert last commit'));
        console.log(chalk.gray('  cv revert abc123         # Revert specific commit'));
        console.log(chalk.gray('  cv revert HEAD~3..HEAD   # Revert last 3 commits'));
        console.log(chalk.gray('  cv revert --abort        # Abort in-progress revert'));
        return;
      }

      // Build revert arguments
      const args = ['revert'];

      if (options.noCommit) args.push('--no-commit');
      if (options.noEdit) args.push('--no-edit');
      if (options.mainline) args.push('-m', options.mainline);

      args.push(...commits);

      await runGitRevert(args, repoRoot);

      if (!options.quiet) {
        console.log(chalk.green(`\n✓ Reverted ${commits.length} commit(s)`));
      }

      if (options.json) {
        output.json({ success: true, reverted: commits });
      }

    } catch (error: any) {
      // Check for conflicts
      if (error.message.includes('CONFLICT')) {
        console.log(chalk.yellow('\nRevert has conflicts'));
        console.log(chalk.gray('Resolve conflicts, then run:'));
        console.log(chalk.cyan('  cv revert --continue'));
        console.log();
        console.log(chalk.gray('Or abort the revert:'));
        console.log(chalk.cyan('  cv revert --abort'));
        return;
      }

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
 * Run git revert command
 */
async function runGitRevert(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: 'inherit',
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git revert failed with code ${code}`));
      }
    });

    git.on('error', reject);
  });
}

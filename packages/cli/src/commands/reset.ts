/**
 * cv reset command
 * Git reset wrapper
 *
 * Reset current HEAD to specified state
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

interface ResetOptions {
  soft?: boolean;
  mixed?: boolean;
  hard?: boolean;
  merge?: boolean;
  keep?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export function resetCommand(): Command {
  const cmd = new Command('reset');

  cmd
    .description('Reset current HEAD (git reset wrapper)')
    .argument('[commit]', 'Target commit (default: HEAD)')
    .argument('[files...]', 'Files to reset')
    .option('--soft', 'Reset HEAD only, keep staged changes')
    .option('--mixed', 'Reset HEAD and index, keep working tree (default)')
    .option('--hard', 'Reset HEAD, index, and working tree (DESTRUCTIVE)')
    .option('--merge', 'Reset but keep local changes that are different')
    .option('--keep', 'Reset but keep local changes if safe')
    .allowUnknownOption(true);

  addGlobalOptions(cmd);

  cmd.action(async (commit: string | undefined, files: string[], options: ResetOptions, command: Command) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      // Warn about hard reset
      if (options.hard && !options.quiet) {
        console.log(chalk.yellow('⚠ Warning: --hard reset will discard uncommitted changes!'));
      }

      // Build reset arguments
      const args = ['reset'];

      if (options.soft) args.push('--soft');
      else if (options.hard) args.push('--hard');
      else if (options.merge) args.push('--merge');
      else if (options.keep) args.push('--keep');
      // --mixed is default

      // Add commit target
      if (commit) {
        args.push(commit);
      }

      // Add files
      if (files.length > 0) {
        args.push('--', ...files);
      }

      await runGitReset(args, repoRoot);

      if (!options.quiet) {
        const currentHead = execSync('git rev-parse --short HEAD', {
          cwd: repoRoot,
          encoding: 'utf-8',
        }).trim();
        console.log(chalk.green(`\n✓ HEAD is now at ${currentHead}`));
      }

      if (options.json) {
        output.json({ success: true });
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
 * Run git reset command
 */
async function runGitReset(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: 'inherit',
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git reset failed with code ${code}`));
      }
    });

    git.on('error', reject);
  });
}

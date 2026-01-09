/**
 * cv remote command
 * Git remote wrapper
 *
 * Manage remote repositories
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

interface RemoteOptions {
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export function remoteCommand(): Command {
  const cmd = new Command('remote');

  cmd
    .description('Manage remote repositories (git remote wrapper)')
    .argument('[subcommand]', 'Subcommand: add, remove, rename, set-url, show, prune')
    .argument('[args...]', 'Arguments for subcommand')
    .option('-v, --verbose', 'Show remote URLs')
    .allowUnknownOption(true);

  addGlobalOptions(cmd);

  cmd.action(async (subcommand: string | undefined, args: string[], options: RemoteOptions, command: Command) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      // Build git remote arguments
      const gitArgs = ['remote'];

      if (!subcommand) {
        // List remotes
        if (options.verbose) gitArgs.push('-v');

        if (options.json) {
          const remotes = getRemotesJson(repoRoot);
          output.json({ remotes });
        } else {
          await runGitRemote(gitArgs, repoRoot);
        }
        return;
      }

      // Handle subcommands
      const validSubcommands = ['add', 'remove', 'rm', 'rename', 'set-url', 'show', 'prune', 'get-url', 'set-head', 'set-branches', 'update'];

      if (validSubcommands.includes(subcommand)) {
        gitArgs.push(subcommand);
        gitArgs.push(...args);

        await runGitRemote(gitArgs, repoRoot);

        // Helpful messages
        if (!options.quiet) {
          if (subcommand === 'add') {
            console.log(chalk.green(`\n✓ Added remote ${args[0]}`));
          } else if (subcommand === 'remove' || subcommand === 'rm') {
            console.log(chalk.green(`\n✓ Removed remote ${args[0]}`));
          } else if (subcommand === 'rename') {
            console.log(chalk.green(`\n✓ Renamed remote ${args[0]} to ${args[1]}`));
          }
        }
      } else {
        console.error(chalk.red(`Unknown subcommand: ${subcommand}`));
        console.log(chalk.gray('\nAvailable subcommands:'));
        console.log(chalk.gray('  add <name> <url>       Add a remote'));
        console.log(chalk.gray('  remove <name>          Remove a remote'));
        console.log(chalk.gray('  rename <old> <new>     Rename a remote'));
        console.log(chalk.gray('  set-url <name> <url>   Change remote URL'));
        console.log(chalk.gray('  show <name>            Show remote info'));
        console.log(chalk.gray('  prune <name>           Remove stale refs'));
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
 * Run git remote command
 */
async function runGitRemote(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: 'inherit',
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git remote failed with code ${code}`));
      }
    });

    git.on('error', reject);
  });
}

/**
 * Get remotes as JSON
 */
function getRemotesJson(cwd: string): any[] {
  try {
    const output = execSync('git remote -v', {
      cwd,
      encoding: 'utf-8',
    });

    const remotes: Record<string, any> = {};

    output.trim().split('\n').filter(Boolean).forEach(line => {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
      if (match) {
        const [, name, url, type] = match;
        if (!remotes[name]) {
          remotes[name] = { name, fetchUrl: null, pushUrl: null };
        }
        if (type === 'fetch') {
          remotes[name].fetchUrl = url;
        } else {
          remotes[name].pushUrl = url;
        }
      }
    });

    return Object.values(remotes);
  } catch {
    return [];
  }
}

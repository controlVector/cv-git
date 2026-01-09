/**
 * cv fetch command
 * Git fetch wrapper
 *
 * Download objects and refs from remote
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
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

interface FetchOptions {
  all?: boolean;
  prune?: boolean;
  tags?: boolean;
  depth?: string;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export function fetchCommand(): Command {
  const cmd = new Command('fetch');

  cmd
    .description('Download objects and refs from remote (git fetch wrapper)')
    .argument('[remote]', 'Remote to fetch from (default: origin)')
    .argument('[refspec...]', 'Refspecs to fetch')
    .option('--all', 'Fetch from all remotes')
    .option('-p, --prune', 'Remove remote-tracking refs that no longer exist')
    .option('-t, --tags', 'Fetch all tags')
    .option('--depth <depth>', 'Limit fetch depth')
    .allowUnknownOption(true);

  addGlobalOptions(cmd);

  cmd.action(async (remote: string | undefined, refspecs: string[], options: FetchOptions, command: Command) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      // Build fetch arguments
      const args = ['fetch'];

      if (options.all) args.push('--all');
      if (options.prune) args.push('--prune');
      if (options.tags) args.push('--tags');
      if (options.depth) args.push(`--depth=${options.depth}`);
      if (options.verbose) args.push('--verbose');

      // Add remote and refspecs
      if (remote && !options.all) {
        args.push(remote);
        if (refspecs.length > 0) {
          args.push(...refspecs);
        }
      }

      // Run fetch
      const spinner = options.quiet ? null : ora('Fetching from remote...').start();

      try {
        await runGitFetch(args, repoRoot);
        spinner?.succeed(chalk.green('Fetch complete'));
      } catch (error: any) {
        spinner?.fail(chalk.red('Fetch failed'));
        throw error;
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
 * Run git fetch command
 */
async function runGitFetch(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: 'inherit',
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git fetch failed with code ${code}`));
      }
    });

    git.on('error', reject);
  });
}

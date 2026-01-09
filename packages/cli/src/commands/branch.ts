/**
 * cv branch command
 * Git branch management
 *
 * List, create, delete, and manage branches
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

interface BranchOptions {
  all?: boolean;
  remotes?: boolean;
  list?: boolean;
  delete?: boolean;
  force?: boolean;
  move?: boolean;
  copy?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export function branchCommand(): Command {
  const cmd = new Command('branch');

  cmd
    .description('List, create, or delete branches (git branch wrapper)')
    .argument('[branch-name]', 'Branch name to create or target')
    .argument('[start-point]', 'Starting point for new branch')
    .option('-a, --all', 'List both local and remote branches')
    .option('-r, --remotes', 'List only remote branches')
    .option('-l, --list', 'List branches (default when no branch specified)')
    .option('-d, --delete', 'Delete a branch')
    .option('-D, --force-delete', 'Force delete a branch')
    .option('-m, --move', 'Rename a branch')
    .option('-c, --copy', 'Copy a branch')
    .allowUnknownOption(true);

  addGlobalOptions(cmd);

  cmd.action(async (branchName: string | undefined, startPoint: string | undefined, options: BranchOptions, command: Command) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      // Build git branch arguments
      const args = ['branch'];

      // List mode (default if no branch specified)
      if (!branchName || options.list) {
        if (options.all) args.push('-a');
        if (options.remotes) args.push('-r');
        if (options.verbose) args.push('-v');

        if (options.json) {
          const branches = await getBranchesJson(repoRoot, options);
          output.json({ branches, current: getCurrentBranch(repoRoot) });
        } else {
          await runGitBranch(args, repoRoot);
        }
        return;
      }

      // Delete mode
      if (options.delete || (options as any).forceDelete) {
        args.push((options as any).forceDelete ? '-D' : '-d');
        args.push(branchName);

        if (!options.quiet) {
          console.log(chalk.yellow(`Deleting branch: ${branchName}`));
        }

        await runGitBranch(args, repoRoot);

        if (!options.quiet) {
          console.log(chalk.green(`✓ Deleted branch ${branchName}`));
        }
        return;
      }

      // Move/rename mode
      if (options.move) {
        args.push('-m');
        args.push(branchName);
        if (startPoint) args.push(startPoint);

        await runGitBranch(args, repoRoot);

        if (!options.quiet) {
          console.log(chalk.green(`✓ Renamed branch to ${startPoint || branchName}`));
        }
        return;
      }

      // Copy mode
      if (options.copy) {
        args.push('-c');
        args.push(branchName);
        if (startPoint) args.push(startPoint);

        await runGitBranch(args, repoRoot);

        if (!options.quiet) {
          console.log(chalk.green(`✓ Copied branch to ${startPoint || branchName}`));
        }
        return;
      }

      // Create new branch
      args.push(branchName);
      if (startPoint) {
        args.push(startPoint);
      }

      await runGitBranch(args, repoRoot);

      if (!options.quiet) {
        console.log(chalk.green(`✓ Created branch ${branchName}`));
        console.log(chalk.gray(`  Switch to it with: cv checkout ${branchName}`));
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
 * Run git branch with output to terminal
 */
async function runGitBranch(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: 'inherit',
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git branch failed with code ${code}`));
      }
    });

    git.on('error', (error) => {
      reject(error);
    });
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

/**
 * Get branches as JSON
 */
async function getBranchesJson(cwd: string, options: BranchOptions): Promise<any[]> {
  try {
    const args = ['branch', '--format=%(refname:short)|%(objectname:short)|%(upstream:short)|%(HEAD)'];
    if (options.all) args.push('-a');
    if (options.remotes) args.push('-r');

    const output = execSync(args.join(' '), {
      cwd,
      encoding: 'utf-8',
    });

    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, sha, upstream, head] = line.split('|');
        return {
          name: name.trim(),
          sha: sha.trim(),
          upstream: upstream.trim() || null,
          current: head.trim() === '*',
          remote: name.includes('remotes/') || (options.remotes && !name.includes('remotes/')),
        };
      });
  } catch {
    return [];
  }
}

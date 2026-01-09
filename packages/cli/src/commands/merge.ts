/**
 * cv merge command
 * Git merge with automatic knowledge graph sync
 *
 * Merge branches with optional AI conflict assistance
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

interface MergeOptions {
  noCommit?: boolean;
  noFf?: boolean;
  ffOnly?: boolean;
  squash?: boolean;
  message?: string;
  abort?: boolean;
  continue?: boolean;
  skipSync?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export function mergeCommand(): Command {
  const cmd = new Command('merge');

  cmd
    .description('Merge branches (git merge wrapper with auto-sync)')
    .argument('[branch]', 'Branch to merge')
    .option('--no-commit', 'Perform merge but don\'t commit')
    .option('--no-ff', 'Create a merge commit even for fast-forward')
    .option('--ff-only', 'Only fast-forward, fail if not possible')
    .option('--squash', 'Squash commits into single commit')
    .option('-m, --message <message>', 'Merge commit message')
    .option('--abort', 'Abort current merge')
    .option('--continue', 'Continue after resolving conflicts')
    .option('--skip-sync', 'Skip knowledge graph sync after merge')
    .allowUnknownOption(true);

  addGlobalOptions(cmd);

  cmd.action(async (branch: string | undefined, options: MergeOptions, command: Command) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      const cvInitialized = isCVInitialized(repoRoot);

      // Handle abort/continue
      if (options.abort) {
        await runGitMerge(['merge', '--abort'], repoRoot);
        if (!options.quiet) {
          console.log(chalk.yellow('Merge aborted'));
        }
        return;
      }

      if (options.continue) {
        await runGitMerge(['merge', '--continue'], repoRoot);
        if (!options.quiet) {
          console.log(chalk.green('Merge continued'));
        }
        // Sync after successful continue
        if (cvInitialized && !options.skipSync) {
          await syncKnowledgeGraph(repoRoot, options.quiet);
        }
        return;
      }

      if (!branch) {
        console.log(chalk.yellow('Usage: cv merge <branch>'));
        console.log();
        console.log(chalk.gray('Examples:'));
        console.log(chalk.gray('  cv merge feature-branch    # Merge feature-branch into current'));
        console.log(chalk.gray('  cv merge --no-ff develop   # Merge with merge commit'));
        console.log(chalk.gray('  cv merge --squash feature  # Squash merge'));
        console.log(chalk.gray('  cv merge --abort           # Abort current merge'));
        return;
      }

      // Build merge arguments
      const args = ['merge'];

      if (options.noCommit) args.push('--no-commit');
      if (options.noFf) args.push('--no-ff');
      if (options.ffOnly) args.push('--ff-only');
      if (options.squash) args.push('--squash');
      if (options.message) args.push('-m', options.message);

      args.push(branch);

      // Run merge
      const spinner = options.quiet ? null : ora(`Merging ${branch}...`).start();

      try {
        await runGitMerge(args, repoRoot);
        spinner?.succeed(chalk.green(`Merged ${branch}`));
      } catch (error: any) {
        // Check for merge conflicts
        if (error.message.includes('CONFLICT') || error.message.includes('Automatic merge failed')) {
          spinner?.warn(chalk.yellow('Merge has conflicts'));

          // Show conflicted files
          const conflicts = getConflictedFiles(repoRoot);
          if (conflicts.length > 0) {
            console.log(chalk.yellow('\nConflicted files:'));
            conflicts.forEach(f => console.log(chalk.red(`  ✗ ${f}`)));
            console.log();
            console.log(chalk.gray('Resolve conflicts, then run:'));
            console.log(chalk.cyan('  cv add <files>'));
            console.log(chalk.cyan('  cv merge --continue'));
            console.log();
            console.log(chalk.gray('Or abort the merge:'));
            console.log(chalk.cyan('  cv merge --abort'));
          }
          return;
        }
        spinner?.fail(chalk.red('Merge failed'));
        throw error;
      }

      // Sync knowledge graph after successful merge
      if (cvInitialized && !options.skipSync) {
        await syncKnowledgeGraph(repoRoot, options.quiet);
      }

      if (!options.quiet) {
        console.log(chalk.green('\n✓ Done'));
      }

      if (options.json) {
        output.json({
          success: true,
          merged: branch,
          synced: cvInitialized && !options.skipSync,
        });
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
 * Run git merge command
 */
async function runGitMerge(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    git.stdout?.on('data', (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    git.stderr?.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || stdout || `git merge failed with code ${code}`));
      }
    });

    git.on('error', reject);
  });
}

/**
 * Get list of conflicted files
 */
function getConflictedFiles(cwd: string): string[] {
  try {
    const output = execSync('git diff --name-only --diff-filter=U', {
      cwd,
      encoding: 'utf-8',
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Sync knowledge graph
 */
async function syncKnowledgeGraph(repoRoot: string, quiet?: boolean): Promise<void> {
  const spinner = quiet ? null : ora('Syncing knowledge graph...').start();

  try {
    const result = spawnSync('cv', ['sync', '--incremental'], {
      cwd: repoRoot,
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });

    if (result.status === 0) {
      spinner?.succeed(chalk.green('Knowledge graph synced'));
    } else {
      spinner?.warn(chalk.yellow('Sync warning'));
    }
  } catch {
    spinner?.warn(chalk.yellow('Sync warning'));
  }
}

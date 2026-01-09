/**
 * cv undo command
 * Undo git operations with operation log tracking
 *
 * Inspired by Jujutsu's operation log
 * Provides easy recovery from mistakes by tracking operations
 * and providing simple undo functionality.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
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

interface UndoOptions {
  hard?: boolean;
  steps?: string;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

interface Operation {
  id: string;
  timestamp: string;
  type: string;
  description: string;
  head: string;
  refs?: Record<string, string>;
}

export function undoCommand(): Command {
  const cmd = new Command('undo');

  cmd
    .description('Undo the last operation (uses git reflog)')
    .argument('[target]', 'Reflog entry to restore (e.g., HEAD@{1}, HEAD@{5})')
    .option('--hard', 'Discard uncommitted changes (use with caution)')
    .option('-n, --steps <n>', 'Number of operations to undo (default: 1)')
    .option('-v, --verbose', 'Show detailed information');

  addGlobalOptions(cmd);

  cmd.action(async (target: string | undefined, options: UndoOptions) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      // If no target specified, show recent operations and suggest undo
      if (!target) {
        const steps = parseInt(options.steps || '1', 10);
        target = `HEAD@{${steps}}`;
      }

      // Get current state before undo
      const currentHead = execSync('git rev-parse --short HEAD', {
        cwd: repoRoot,
        encoding: 'utf-8',
      }).trim();

      const currentBranch = getCurrentBranch(repoRoot);

      // Check for uncommitted changes
      const status = execSync('git status --porcelain', {
        cwd: repoRoot,
        encoding: 'utf-8',
      }).trim();

      if (status && !options.hard) {
        console.log(chalk.yellow('You have uncommitted changes.'));
        console.log(chalk.gray('Options:'));
        console.log(chalk.gray('  cv stash        # Save changes for later'));
        console.log(chalk.gray('  cv undo --hard  # Discard changes and undo'));
        console.log();
        process.exit(1);
      }

      // Parse the target to get the actual commit
      let targetCommit: string;
      try {
        targetCommit = execSync(`git rev-parse ${target}`, {
          cwd: repoRoot,
          encoding: 'utf-8',
        }).trim();
      } catch {
        console.error(chalk.red(`Invalid target: ${target}`));
        console.log(chalk.gray('\nUse "cv reflog" to see available restore points'));
        process.exit(1);
      }

      const targetShort = targetCommit.substring(0, 7);

      // Get info about what we're restoring to
      const targetInfo = execSync(`git log -1 --format="%s" ${targetCommit}`, {
        cwd: repoRoot,
        encoding: 'utf-8',
      }).trim();

      if (!options.quiet) {
        console.log(chalk.cyan('Undo operation:\n'));
        console.log(chalk.gray(`  Current: ${currentHead} (${currentBranch || 'detached'})`));
        console.log(chalk.gray(`  Target:  ${targetShort} "${targetInfo}"`));
        console.log();
      }

      // Perform the undo
      const resetType = options.hard ? '--hard' : '--soft';

      try {
        execSync(`git reset ${resetType} ${targetCommit}`, {
          cwd: repoRoot,
          stdio: options.verbose ? 'inherit' : 'pipe',
        });

        const newHead = execSync('git rev-parse --short HEAD', {
          cwd: repoRoot,
          encoding: 'utf-8',
        }).trim();

        if (!options.quiet) {
          console.log(chalk.green(`✓ Restored to ${newHead}`));

          if (!options.hard) {
            // Check if we have changes in staging
            const newStatus = execSync('git status --porcelain', {
              cwd: repoRoot,
              encoding: 'utf-8',
            }).trim();

            if (newStatus) {
              console.log(chalk.gray('\nChanges are preserved in your working directory.'));
              console.log(chalk.gray('Use "cv status" to see them.'));
            }
          }

          console.log(chalk.gray('\nTo redo (go back), use:'));
          console.log(chalk.cyan(`  cv undo ${currentHead}`));
        }

        if (options.json) {
          output.json({
            success: true,
            from: currentHead,
            to: newHead,
            target: targetShort,
          });
        }

      } catch (error: any) {
        console.error(chalk.red(`Undo failed: ${error.message}`));
        process.exit(1);
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
 * cv reflog command - show operation history
 */
export function reflogCommand(): Command {
  const cmd = new Command('reflog');

  cmd
    .description('Show operation history (for use with cv undo)')
    .option('-n, --count <n>', 'Number of entries to show (default: 20)')
    .option('--all', 'Show all refs, not just HEAD');

  addGlobalOptions(cmd);

  cmd.action(async (options: { count?: string; all?: boolean; json?: boolean; quiet?: boolean }) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      const count = parseInt(options.count || '20', 10);

      if (options.json) {
        const entries = getReflogEntries(repoRoot, count);
        output.json({ entries });
        return;
      }

      console.log(chalk.cyan('Recent operations:\n'));
      console.log(chalk.gray('  Use "cv undo HEAD@{N}" to restore to that point\n'));

      // Get and display reflog
      const reflog = execSync(
        `git reflog --format="%C(yellow)%gd%C(reset) %C(green)%h%C(reset) %gs %C(dim)(%cr)%C(reset)" -n ${count}`,
        {
          cwd: repoRoot,
          encoding: 'utf-8',
        }
      );

      console.log(reflog);

      console.log(chalk.gray('\nTip: Use "cv undo" to undo the last operation'));
      console.log(chalk.gray('     Use "cv undo HEAD@{2}" to go back 2 operations'));

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
 * Get reflog entries as structured data
 */
function getReflogEntries(cwd: string, count: number): Operation[] {
  try {
    const reflog = execSync(
      `git reflog --format="%H|%gd|%gs|%cr" -n ${count}`,
      {
        cwd,
        encoding: 'utf-8',
      }
    ).trim();

    if (!reflog) return [];

    return reflog.split('\n').filter(Boolean).map(line => {
      const [hash, ref, description, time] = line.split('|');
      return {
        id: hash,
        timestamp: time,
        type: parseOperationType(description),
        description,
        head: hash.substring(0, 7),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Parse operation type from reflog description
 */
function parseOperationType(description: string): string {
  if (description.includes('commit')) return 'commit';
  if (description.includes('checkout')) return 'checkout';
  if (description.includes('merge')) return 'merge';
  if (description.includes('rebase')) return 'rebase';
  if (description.includes('reset')) return 'reset';
  if (description.includes('pull')) return 'pull';
  if (description.includes('cherry-pick')) return 'cherry-pick';
  if (description.includes('revert')) return 'revert';
  return 'other';
}

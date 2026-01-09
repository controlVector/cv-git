/**
 * cv absorb command
 * Automatically create fixup commits for staged changes
 *
 * Inspired by git-absorb and hg absorb
 * Analyzes staged changes and determines which previous commits
 * they should be absorbed into, then creates fixup! commits.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { execSync, spawnSync } from 'child_process';
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

interface AbsorbOptions {
  andRebase?: boolean;
  base?: string;
  dryRun?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

interface HunkInfo {
  file: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  content: string;
}

interface BlameInfo {
  commit: string;
  file: string;
  line: number;
}

interface FixupTarget {
  commit: string;
  subject: string;
  files: Set<string>;
  hunks: HunkInfo[];
}

export function absorbCommand(): Command {
  const cmd = new Command('absorb');

  cmd
    .description('Automatically absorb staged changes into appropriate commits')
    .option('--and-rebase', 'Automatically rebase with --autosquash after creating fixups')
    .option('--base <commit>', 'Base commit to consider (default: merge-base with main/master)')
    .option('-n, --dry-run', 'Show what would be done without making changes')
    .option('-v, --verbose', 'Show detailed information about each absorption');

  addGlobalOptions(cmd);

  cmd.action(async (options: AbsorbOptions) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      // Check for staged changes
      const stagedDiff = execSync('git diff --cached --name-only', {
        cwd: repoRoot,
        encoding: 'utf-8',
      }).trim();

      if (!stagedDiff) {
        console.log(chalk.yellow('No staged changes to absorb'));
        console.log(chalk.gray('Stage changes with: cv add <files>'));
        return;
      }

      const stagedFiles = stagedDiff.split('\n').filter(Boolean);

      if (!options.quiet) {
        console.log(chalk.cyan('Analyzing staged changes...\n'));
      }

      // Get the base commit
      const base = options.base || getBaseCommit(repoRoot);
      if (!base) {
        console.error(chalk.red('Could not determine base commit'));
        console.log(chalk.gray('Specify with: cv absorb --base <commit>'));
        process.exit(1);
      }

      if (options.verbose) {
        console.log(chalk.gray(`Base commit: ${base}\n`));
      }

      // Get commits between base and HEAD
      const commits = getCommitsBetween(repoRoot, base);
      if (commits.length === 0) {
        console.log(chalk.yellow('No commits to absorb into'));
        console.log(chalk.gray('Make some commits first, then stage changes to absorb'));
        return;
      }

      if (options.verbose) {
        console.log(chalk.gray(`Found ${commits.length} commits to consider\n`));
      }

      // Parse the staged diff to get hunks
      const hunks = parseStagedDiff(repoRoot);
      if (hunks.length === 0) {
        console.log(chalk.yellow('No absorbable hunks found'));
        return;
      }

      // For each hunk, find the target commit using blame
      const fixupTargets = new Map<string, FixupTarget>();
      const unabsorbable: HunkInfo[] = [];

      for (const hunk of hunks) {
        const target = findTargetCommit(repoRoot, hunk, commits, base);

        if (target) {
          if (!fixupTargets.has(target.commit)) {
            fixupTargets.set(target.commit, {
              commit: target.commit,
              subject: target.subject,
              files: new Set(),
              hunks: [],
            });
          }
          const entry = fixupTargets.get(target.commit)!;
          entry.files.add(hunk.file);
          entry.hunks.push(hunk);
        } else {
          unabsorbable.push(hunk);
        }
      }

      if (fixupTargets.size === 0) {
        console.log(chalk.yellow('Could not determine target commits for any changes'));
        console.log(chalk.gray('This can happen when:'));
        console.log(chalk.gray('  - Changes are to new lines not in any recent commit'));
        console.log(chalk.gray('  - Changes span multiple commits ambiguously'));
        return;
      }

      // Show what will be done
      console.log(chalk.green(`Found ${fixupTargets.size} commit(s) to absorb into:\n`));

      for (const [commit, target] of fixupTargets) {
        const shortCommit = commit.substring(0, 7);
        console.log(chalk.cyan(`  ${shortCommit} ${target.subject}`));
        for (const file of target.files) {
          console.log(chalk.gray(`    - ${file}`));
        }
      }

      if (unabsorbable.length > 0 && options.verbose) {
        console.log(chalk.yellow(`\n  ${unabsorbable.length} hunk(s) could not be absorbed`));
      }

      console.log();

      if (options.dryRun) {
        console.log(chalk.yellow('Dry run - no changes made'));

        if (options.json) {
          output.json({
            dryRun: true,
            targets: Array.from(fixupTargets.values()).map(t => ({
              commit: t.commit,
              subject: t.subject,
              files: Array.from(t.files),
            })),
            unabsorbable: unabsorbable.length,
          });
        }
        return;
      }

      // Create fixup commits
      const createdFixups: string[] = [];

      // We need to unstage everything first, then selectively stage and commit
      // This is complex, so we'll use a simpler approach: create fixup commits
      // by file grouping

      for (const [commit, target] of fixupTargets) {
        const shortCommit = commit.substring(0, 7);

        // Create the fixup commit
        try {
          // Get the original commit's subject for the fixup message
          const fixupMessage = `fixup! ${target.subject}`;

          // For simplicity, we'll commit the staged changes that belong to this target
          // In a more sophisticated implementation, we'd selectively stage hunks

          // Create fixup commit with only the files for this target
          const filesArray = Array.from(target.files);

          // Reset the staging area
          execSync('git reset HEAD', { cwd: repoRoot, stdio: 'pipe' });

          // Stage only the files for this fixup
          for (const file of filesArray) {
            try {
              execSync(`git add "${file}"`, { cwd: repoRoot, stdio: 'pipe' });
            } catch {
              // File might have been deleted or renamed
            }
          }

          // Check if we have anything staged
          const staged = execSync('git diff --cached --name-only', {
            cwd: repoRoot,
            encoding: 'utf-8',
          }).trim();

          if (staged) {
            execSync(`git commit -m "${fixupMessage}"`, {
              cwd: repoRoot,
              stdio: 'pipe',
            });

            createdFixups.push(shortCommit);

            if (!options.quiet) {
              console.log(chalk.green(`✓ Created fixup for ${shortCommit}`));
            }
          }
        } catch (error: any) {
          console.error(chalk.red(`Failed to create fixup for ${shortCommit}: ${error.message}`));
        }
      }

      // Re-stage any remaining changes
      try {
        execSync('git add -u', { cwd: repoRoot, stdio: 'pipe' });
      } catch {
        // Ignore errors
      }

      if (createdFixups.length === 0) {
        console.log(chalk.yellow('\nNo fixup commits created'));
        return;
      }

      console.log(chalk.green(`\n✓ Created ${createdFixups.length} fixup commit(s)`));

      // Optionally rebase
      if (options.andRebase) {
        console.log(chalk.cyan('\nRunning rebase with --autosquash...\n'));

        try {
          const rebaseResult = spawnSync('git', ['rebase', '-i', '--autosquash', base], {
            cwd: repoRoot,
            stdio: 'inherit',
            env: { ...process.env, GIT_SEQUENCE_EDITOR: 'true' }, // Auto-accept the rebase todo
          });

          if (rebaseResult.status === 0) {
            console.log(chalk.green('✓ Rebase complete - fixups absorbed'));
          } else {
            console.log(chalk.yellow('Rebase may need manual intervention'));
            console.log(chalk.gray('Run: git rebase --continue (after resolving conflicts)'));
            console.log(chalk.gray('Or:  git rebase --abort'));
          }
        } catch (error: any) {
          console.error(chalk.red(`Rebase failed: ${error.message}`));
        }
      } else {
        console.log(chalk.gray('\nTo apply fixups, run:'));
        console.log(chalk.cyan(`  git rebase -i --autosquash ${base}`));
        console.log(chalk.gray('\nOr use: cv absorb --and-rebase'));
      }

      if (options.json) {
        output.json({
          success: true,
          fixups: createdFixups,
          base,
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
 * Get the base commit (merge-base with main/master)
 */
function getBaseCommit(cwd: string): string | null {
  // Try to find merge-base with main or master
  const branches = ['main', 'master', 'origin/main', 'origin/master'];

  for (const branch of branches) {
    try {
      const base = execSync(`git merge-base ${branch} HEAD`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      if (base) return base;
    } catch {
      // Branch doesn't exist, try next
    }
  }

  // Fallback: use first commit or HEAD~10
  try {
    const count = execSync('git rev-list --count HEAD', {
      cwd,
      encoding: 'utf-8',
    }).trim();

    const n = Math.min(parseInt(count, 10) - 1, 10);
    if (n > 0) {
      return execSync(`git rev-parse HEAD~${n}`, {
        cwd,
        encoding: 'utf-8',
      }).trim();
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Get commits between base and HEAD
 */
function getCommitsBetween(cwd: string, base: string): Array<{ commit: string; subject: string }> {
  try {
    const log = execSync(`git log --format="%H|%s" ${base}..HEAD`, {
      cwd,
      encoding: 'utf-8',
    }).trim();

    if (!log) return [];

    return log.split('\n').filter(Boolean).map(line => {
      const [commit, ...subjectParts] = line.split('|');
      return {
        commit: commit.trim(),
        subject: subjectParts.join('|').trim(),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Parse staged diff to get hunks
 */
function parseStagedDiff(cwd: string): HunkInfo[] {
  const hunks: HunkInfo[] = [];

  try {
    const diff = execSync('git diff --cached -U0', {
      cwd,
      encoding: 'utf-8',
    });

    let currentFile = '';
    const lines = diff.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // File header
      if (line.startsWith('diff --git')) {
        const match = line.match(/diff --git a\/(.*) b\/(.*)/);
        if (match) {
          currentFile = match[2];
        }
      }

      // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (match && currentFile) {
          const oldStart = parseInt(match[1], 10);
          const oldCount = parseInt(match[2] || '1', 10);
          const newStart = parseInt(match[3], 10);
          const newCount = parseInt(match[4] || '1', 10);

          // Collect hunk content
          let content = '';
          let j = i + 1;
          while (j < lines.length && !lines[j].startsWith('@@') && !lines[j].startsWith('diff --git')) {
            content += lines[j] + '\n';
            j++;
          }

          hunks.push({
            file: currentFile,
            oldStart,
            oldCount,
            newStart,
            newCount,
            content,
          });
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return hunks;
}

/**
 * Find the target commit for a hunk using git blame
 */
function findTargetCommit(
  cwd: string,
  hunk: HunkInfo,
  commits: Array<{ commit: string; subject: string }>,
  base: string
): { commit: string; subject: string } | null {
  // For deletions or modifications, we can use blame to find the original commit
  if (hunk.oldCount > 0) {
    try {
      // Get blame for the lines being modified
      // We need to blame the version before staging
      const blameRange = `${hunk.oldStart},${hunk.oldStart + Math.max(hunk.oldCount - 1, 0)}`;

      const blame = execSync(
        `git blame -l -L ${blameRange} HEAD -- "${hunk.file}" 2>/dev/null || true`,
        {
          cwd,
          encoding: 'utf-8',
        }
      ).trim();

      if (!blame) return null;

      // Parse blame output to get commit hashes
      const blameCommits = new Set<string>();
      const lines = blame.split('\n');

      for (const line of lines) {
        const match = line.match(/^([a-f0-9]{40})/);
        if (match) {
          blameCommits.add(match[1]);
        }
      }

      // Find a commit that's in our range (between base and HEAD)
      const commitSet = new Set(commits.map(c => c.commit));

      for (const blameCommit of blameCommits) {
        if (commitSet.has(blameCommit)) {
          const target = commits.find(c => c.commit === blameCommit);
          if (target) return target;
        }
      }

      // If blamed commits are older than base, the change might belong to the oldest commit in range
      // This is a heuristic - changes to old code often belong to the commit that touched that file
      for (const commit of commits) {
        try {
          const filesInCommit = execSync(`git diff-tree --no-commit-id --name-only -r ${commit.commit}`, {
            cwd,
            encoding: 'utf-8',
          }).trim().split('\n');

          if (filesInCommit.includes(hunk.file)) {
            return commit;
          }
        } catch {
          // Ignore
        }
      }
    } catch {
      // Ignore blame errors
    }
  }

  // For pure additions, try to find a commit that touched the same file
  for (const commit of commits) {
    try {
      const filesInCommit = execSync(`git diff-tree --no-commit-id --name-only -r ${commit.commit}`, {
        cwd,
        encoding: 'utf-8',
      }).trim().split('\n');

      if (filesInCommit.includes(hunk.file)) {
        return commit;
      }
    } catch {
      // Ignore
    }
  }

  return null;
}

/**
 * cv stack command
 * Stacked diffs workflow management
 *
 * Inspired by Sapling, ghstack, and git-pile
 * Manages a stack of dependent commits/branches for
 * incremental PR reviews.
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

interface StackOptions {
  base?: string;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

interface StackEntry {
  commit: string;
  branch?: string;
  subject: string;
  pr?: number;
  status: 'local' | 'pushed' | 'merged';
}

interface Stack {
  name: string;
  base: string;
  entries: StackEntry[];
}

export function stackCommand(): Command {
  const cmd = new Command('stack');

  cmd
    .description('Manage stacked diffs workflow')
    .argument('[subcommand]', 'Subcommand: status, create, push, rebase, submit, log')
    .argument('[args...]', 'Arguments for subcommand');

  addGlobalOptions(cmd);

  // Subcommands
  cmd
    .command('status')
    .description('Show current stack status')
    .option('--base <commit>', 'Base commit/branch (default: main)')
    .action(stackStatus);

  cmd
    .command('log')
    .alias('smartlog')
    .description('Show stack as visual graph')
    .option('--base <commit>', 'Base commit/branch')
    .option('-a, --all', 'Show all branches')
    .action(stackLog);

  cmd
    .command('create <name>')
    .description('Create a new stack from current commits')
    .option('--base <commit>', 'Base commit/branch')
    .action(stackCreate);

  cmd
    .command('push')
    .description('Push all commits in stack as separate branches')
    .option('--base <commit>', 'Base commit/branch')
    .option('-f, --force', 'Force push')
    .action(stackPush);

  cmd
    .command('rebase')
    .description('Rebase entire stack on updated base')
    .option('--base <commit>', 'Base commit/branch')
    .action(stackRebase);

  cmd
    .command('submit')
    .description('Create/update PRs for each commit in stack')
    .option('--base <commit>', 'Base commit/branch')
    .option('--draft', 'Create as draft PRs')
    .action(stackSubmit);

  cmd
    .command('sync')
    .description('Sync stack with remote (fetch + rebase)')
    .option('--base <commit>', 'Base commit/branch')
    .action(stackSync);

  // Default action shows status
  cmd.action(async (subcommand: string | undefined, args: string[], options: StackOptions) => {
    if (!subcommand || subcommand === 'status') {
      await stackStatus(options);
    } else {
      console.log(chalk.yellow(`Unknown subcommand: ${subcommand}`));
      console.log(chalk.gray('\nAvailable subcommands:'));
      console.log(chalk.gray('  status   Show current stack status'));
      console.log(chalk.gray('  log      Show stack as visual graph'));
      console.log(chalk.gray('  create   Create a new stack'));
      console.log(chalk.gray('  push     Push stack branches'));
      console.log(chalk.gray('  rebase   Rebase entire stack'));
      console.log(chalk.gray('  submit   Create PRs for stack'));
      console.log(chalk.gray('  sync     Sync stack with remote'));
    }
  });

  return cmd;
}

/**
 * Show stack status
 */
async function stackStatus(options: StackOptions) {
  const output = createOutput(options as any);

  try {
    const repoRoot = findGitRoot();
    if (!repoRoot) {
      console.error(chalk.red('Not in a git repository'));
      process.exit(1);
    }

    const base = options.base || getDefaultBase(repoRoot);
    const stack = getStackInfo(repoRoot, base);

    if (options.json) {
      output.json({ stack });
      return;
    }

    if (stack.entries.length === 0) {
      console.log(chalk.yellow('No commits in stack'));
      console.log(chalk.gray(`\nBase: ${base}`));
      console.log(chalk.gray('Make commits to build your stack, then use "cv stack push"'));
      return;
    }

    console.log(chalk.cyan('Stack Status\n'));
    console.log(chalk.gray(`Base: ${base}\n`));

    // Show stack from bottom (oldest) to top (newest)
    const entries = [...stack.entries].reverse();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isTop = i === entries.length - 1;
      const prefix = isTop ? '◉' : '│';
      const connector = isTop ? '' : '│';

      const statusIcon = entry.status === 'merged' ? chalk.green('✓')
        : entry.status === 'pushed' ? chalk.yellow('↑')
          : chalk.gray('○');

      console.log(`${chalk.cyan(prefix)} ${statusIcon} ${chalk.yellow(entry.commit.substring(0, 7))} ${entry.subject}`);

      if (entry.branch) {
        console.log(`${chalk.cyan(connector)}   ${chalk.gray('branch:')} ${chalk.green(entry.branch)}`);
      }

      if (entry.pr) {
        console.log(`${chalk.cyan(connector)}   ${chalk.gray('PR:')} ${chalk.blue(`#${entry.pr}`)}`);
      }

      if (i < entries.length - 1) {
        console.log(chalk.cyan('│'));
      }
    }

    console.log(chalk.cyan('│'));
    console.log(chalk.gray(`◯ ${base}`));

    console.log(chalk.gray('\nCommands:'));
    console.log(chalk.gray('  cv stack push    - Push branches for each commit'));
    console.log(chalk.gray('  cv stack submit  - Create PRs for the stack'));
    console.log(chalk.gray('  cv stack rebase  - Rebase stack on updated base'));

  } catch (error: any) {
    if (options.json) {
      output.json({ error: error.message });
    } else {
      console.error(chalk.red(`Error: ${error.message}`));
    }
    process.exit(1);
  }
}

/**
 * Show stack as visual graph (smartlog style)
 */
async function stackLog(options: StackOptions & { all?: boolean }) {
  const output = createOutput(options as any);

  try {
    const repoRoot = findGitRoot();
    if (!repoRoot) {
      console.error(chalk.red('Not in a git repository'));
      process.exit(1);
    }

    const base = options.base || getDefaultBase(repoRoot);

    if (options.json) {
      const stack = getStackInfo(repoRoot, base);
      output.json({ stack });
      return;
    }

    console.log(chalk.cyan('Stack Log (smartlog)\n'));

    // Use git log with graph
    const logFormat = '%C(yellow)%h%C(reset) %C(green)(%cr)%C(reset) %s%C(auto)%d';
    const range = options.all ? '' : `${base}..HEAD`;

    const result = spawnSync('git', [
      'log',
      '--graph',
      '--oneline',
      '--decorate',
      `--format=${logFormat}`,
      range,
    ].filter(Boolean), {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.stdout) {
      console.log(result.stdout);
    } else {
      console.log(chalk.gray('No commits in range'));
    }

    console.log(chalk.gray(`\n◯ base: ${base}`));

  } catch (error: any) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Create a named stack
 */
async function stackCreate(name: string, options: StackOptions) {
  try {
    const repoRoot = findGitRoot();
    if (!repoRoot) {
      console.error(chalk.red('Not in a git repository'));
      process.exit(1);
    }

    const base = options.base || getDefaultBase(repoRoot);
    const stack = getStackInfo(repoRoot, base);

    if (stack.entries.length === 0) {
      console.log(chalk.yellow('No commits to create stack from'));
      console.log(chalk.gray('Make commits first, then run "cv stack create <name>"'));
      return;
    }

    // Save stack metadata
    const cvDir = path.join(repoRoot, '.cv');
    if (!fs.existsSync(cvDir)) {
      fs.mkdirSync(cvDir, { recursive: true });
    }

    const stacksFile = path.join(cvDir, 'stacks.json');
    let stacks: Record<string, any> = {};

    if (fs.existsSync(stacksFile)) {
      stacks = JSON.parse(fs.readFileSync(stacksFile, 'utf-8'));
    }

    stacks[name] = {
      base,
      created: new Date().toISOString(),
      commits: stack.entries.map(e => e.commit),
    };

    fs.writeFileSync(stacksFile, JSON.stringify(stacks, null, 2));

    console.log(chalk.green(`✓ Created stack "${name}" with ${stack.entries.length} commits`));
    console.log(chalk.gray(`\nBase: ${base}`));
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.gray('  cv stack push   - Push branches'));
    console.log(chalk.gray('  cv stack submit - Create PRs'));

  } catch (error: any) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Push stack as separate branches
 */
async function stackPush(options: StackOptions & { force?: boolean }) {
  try {
    const repoRoot = findGitRoot();
    if (!repoRoot) {
      console.error(chalk.red('Not in a git repository'));
      process.exit(1);
    }

    const base = options.base || getDefaultBase(repoRoot);
    const stack = getStackInfo(repoRoot, base);

    if (stack.entries.length === 0) {
      console.log(chalk.yellow('No commits in stack to push'));
      return;
    }

    console.log(chalk.cyan('Pushing stack branches...\n'));

    const currentBranch = execSync('git branch --show-current', {
      cwd: repoRoot,
      encoding: 'utf-8',
    }).trim();

    // Create/update branches for each commit
    const entries = [...stack.entries].reverse(); // Bottom to top
    let prevBranch = base;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const branchName = `stack/${currentBranch || 'main'}/${i + 1}`;

      try {
        // Create or update branch at this commit
        execSync(`git branch -f ${branchName} ${entry.commit}`, {
          cwd: repoRoot,
          stdio: 'pipe',
        });

        // Push the branch
        const forceFlag = options.force ? '-f' : '';
        execSync(`git push ${forceFlag} -u origin ${branchName}`, {
          cwd: repoRoot,
          stdio: 'pipe',
        });

        console.log(chalk.green(`✓ Pushed ${branchName}`));
        console.log(chalk.gray(`  ${entry.commit.substring(0, 7)} ${entry.subject}`));

        prevBranch = branchName;
      } catch (error: any) {
        console.error(chalk.red(`✗ Failed to push ${branchName}: ${error.message}`));
      }
    }

    console.log(chalk.green('\n✓ Stack pushed'));
    console.log(chalk.gray('\nNext: cv stack submit - Create PRs for each branch'));

  } catch (error: any) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Rebase entire stack
 */
async function stackRebase(options: StackOptions) {
  try {
    const repoRoot = findGitRoot();
    if (!repoRoot) {
      console.error(chalk.red('Not in a git repository'));
      process.exit(1);
    }

    const base = options.base || getDefaultBase(repoRoot);

    console.log(chalk.cyan(`Rebasing stack onto ${base}...\n`));

    // First, fetch to get latest
    try {
      execSync('git fetch origin', { cwd: repoRoot, stdio: 'pipe' });
    } catch {
      // Ignore fetch errors
    }

    // Rebase onto base
    const result = spawnSync('git', ['rebase', base], {
      cwd: repoRoot,
      stdio: 'inherit',
    });

    if (result.status === 0) {
      console.log(chalk.green('\n✓ Stack rebased successfully'));
      console.log(chalk.gray('\nUse "cv stack push -f" to update remote branches'));
    } else {
      console.log(chalk.yellow('\nRebase needs manual intervention'));
      console.log(chalk.gray('Resolve conflicts, then:'));
      console.log(chalk.gray('  git rebase --continue'));
      console.log(chalk.gray('Or abort with:'));
      console.log(chalk.gray('  git rebase --abort'));
    }

  } catch (error: any) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Submit PRs for stack
 */
async function stackSubmit(options: StackOptions & { draft?: boolean }) {
  try {
    const repoRoot = findGitRoot();
    if (!repoRoot) {
      console.error(chalk.red('Not in a git repository'));
      process.exit(1);
    }

    // Check for gh CLI
    try {
      execSync('gh --version', { stdio: 'pipe' });
    } catch {
      console.error(chalk.red('GitHub CLI (gh) is required for stack submit'));
      console.log(chalk.gray('Install from: https://cli.github.com/'));
      process.exit(1);
    }

    const base = options.base || getDefaultBase(repoRoot);
    const stack = getStackInfo(repoRoot, base);

    if (stack.entries.length === 0) {
      console.log(chalk.yellow('No commits in stack'));
      return;
    }

    console.log(chalk.cyan('Creating PRs for stack...\n'));

    const currentBranch = execSync('git branch --show-current', {
      cwd: repoRoot,
      encoding: 'utf-8',
    }).trim();

    const entries = [...stack.entries].reverse();
    let prevBase = base;
    const createdPRs: Array<{ branch: string; pr: string; url: string }> = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const branchName = `stack/${currentBranch || 'main'}/${i + 1}`;
      const isLast = i === entries.length - 1;

      try {
        // Ensure branch exists and is pushed
        execSync(`git branch -f ${branchName} ${entry.commit}`, {
          cwd: repoRoot,
          stdio: 'pipe',
        });

        execSync(`git push -u origin ${branchName} -f`, {
          cwd: repoRoot,
          stdio: 'pipe',
        });

        // Check if PR exists
        let prUrl: string;
        try {
          const existingPR = execSync(`gh pr view ${branchName} --json url -q .url`, {
            cwd: repoRoot,
            encoding: 'utf-8',
          }).trim();

          if (existingPR) {
            prUrl = existingPR;
            console.log(chalk.yellow(`↻ PR exists for ${branchName}`));
          } else {
            throw new Error('No PR');
          }
        } catch {
          // Create new PR
          const title = entry.subject;
          const stackInfo = `Part ${i + 1}/${entries.length} of stack`;
          const body = `${stackInfo}\n\n---\n\nBase: ${prevBase}`;

          const draftFlag = options.draft ? '--draft' : '';

          const prOutput = execSync(
            `gh pr create --head ${branchName} --base ${prevBase} --title "${title}" --body "${body}" ${draftFlag}`,
            {
              cwd: repoRoot,
              encoding: 'utf-8',
            }
          ).trim();

          prUrl = prOutput;
          console.log(chalk.green(`✓ Created PR for ${branchName}`));
        }

        createdPRs.push({
          branch: branchName,
          pr: prUrl.split('/').pop() || '',
          url: prUrl,
        });

        console.log(chalk.gray(`  ${prUrl}`));

        prevBase = branchName;

      } catch (error: any) {
        console.error(chalk.red(`✗ Failed for ${branchName}: ${error.message}`));
      }
    }

    console.log(chalk.green(`\n✓ Stack submitted with ${createdPRs.length} PRs`));

  } catch (error: any) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Sync stack with remote
 */
async function stackSync(options: StackOptions) {
  try {
    const repoRoot = findGitRoot();
    if (!repoRoot) {
      console.error(chalk.red('Not in a git repository'));
      process.exit(1);
    }

    const base = options.base || getDefaultBase(repoRoot);

    console.log(chalk.cyan('Syncing stack...\n'));

    // Fetch
    console.log(chalk.gray('Fetching from remote...'));
    execSync('git fetch origin', { cwd: repoRoot, stdio: 'pipe' });

    // Rebase onto origin/base
    const originBase = `origin/${base.replace('origin/', '')}`;

    console.log(chalk.gray(`Rebasing onto ${originBase}...`));

    const result = spawnSync('git', ['rebase', originBase], {
      cwd: repoRoot,
      stdio: 'inherit',
    });

    if (result.status === 0) {
      console.log(chalk.green('\n✓ Stack synced'));
    } else {
      console.log(chalk.yellow('\nSync needs manual intervention'));
    }

  } catch (error: any) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Get default base branch
 */
function getDefaultBase(cwd: string): string {
  // Try main, then master
  for (const branch of ['main', 'master']) {
    try {
      execSync(`git rev-parse --verify ${branch}`, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return branch;
    } catch {
      // Try next
    }
  }

  // Fallback to origin/main or origin/master
  for (const branch of ['origin/main', 'origin/master']) {
    try {
      execSync(`git rev-parse --verify ${branch}`, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return branch;
    } catch {
      // Try next
    }
  }

  return 'main';
}

/**
 * Get stack information
 */
function getStackInfo(cwd: string, base: string): Stack {
  const entries: StackEntry[] = [];

  try {
    // Get commits between base and HEAD
    const log = execSync(`git log --format="%H|%s" ${base}..HEAD`, {
      cwd,
      encoding: 'utf-8',
    }).trim();

    if (!log) return { name: '', base, entries };

    const lines = log.split('\n').filter(Boolean);

    for (const line of lines) {
      const [commit, ...subjectParts] = line.split('|');
      const subject = subjectParts.join('|');

      // Check if there's a branch pointing to this commit
      let branch: string | undefined;
      try {
        const branches = execSync(`git branch --points-at ${commit}`, {
          cwd,
          encoding: 'utf-8',
        }).trim();

        const stackBranch = branches.split('\n')
          .map(b => b.replace(/^\*?\s*/, ''))
          .find(b => b.startsWith('stack/'));

        if (stackBranch) branch = stackBranch;
      } catch {
        // Ignore
      }

      entries.push({
        commit,
        branch,
        subject,
        status: branch ? 'pushed' : 'local',
      });
    }

  } catch {
    // Ignore errors
  }

  return { name: '', base, entries };
}

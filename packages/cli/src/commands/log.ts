/**
 * cv log command
 * Git log with knowledge graph integration
 *
 * Shows commit history with optional symbol/function change tracking
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

interface LogOptions {
  oneline?: boolean;
  graph?: boolean;
  all?: boolean;
  stat?: boolean;
  patch?: boolean;
  number?: string;
  author?: string;
  since?: string;
  until?: string;
  grep?: string;
  file?: string;
  symbol?: string;
  smart?: boolean;
  mine?: boolean;
  stack?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export function logCommand(): Command {
  const cmd = new Command('log');

  cmd
    .description('Show commit history (git log wrapper with knowledge graph features)')
    .argument('[revision-range]', 'Revision range to show')
    .option('--oneline', 'One line per commit')
    .option('--graph', 'Draw ASCII graph')
    .option('--all', 'Show all branches')
    .option('--stat', 'Show diffstat')
    .option('-p, --patch', 'Show patches')
    .option('-n, --number <n>', 'Limit to n commits')
    .option('--author <pattern>', 'Filter by author')
    .option('--since <date>', 'Show commits after date')
    .option('--until <date>', 'Show commits before date')
    .option('--grep <pattern>', 'Filter by commit message')
    .option('-f, --file <path>', 'Show commits affecting file')
    .option('-S, --symbol <name>', 'Show commits affecting symbol (function/class)')
    .option('--smart', 'Smart log: visual branch tree with relationship context')
    .option('--mine', 'Show only my commits')
    .option('--stack', 'Show current stack context (commits since base)')
    .allowUnknownOption(true);

  addGlobalOptions(cmd);

  cmd.action(async (revisionRange: string | undefined, options: LogOptions, command: Command) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      // If --symbol is specified, find commits affecting that symbol
      if (options.symbol) {
        await logBySymbol(options.symbol, options, repoRoot, output);
        return;
      }

      // Smart log - visual branch tree
      if (options.smart) {
        await smartLog(options, repoRoot, output);
        return;
      }

      // Stack log - show current stack
      if (options.stack) {
        await stackLog(options, repoRoot, output);
        return;
      }

      // Mine flag - filter by current user
      if (options.mine) {
        const userEmail = execSync('git config user.email', {
          cwd: repoRoot,
          encoding: 'utf-8',
        }).trim();
        options.author = userEmail;
      }

      // Build git log arguments
      const args = ['log'];

      if (options.oneline) args.push('--oneline');
      if (options.graph) args.push('--graph');
      if (options.all) args.push('--all');
      if (options.stat) args.push('--stat');
      if (options.patch) args.push('-p');
      if (options.number) args.push(`-n${options.number}`);
      if (options.author) args.push(`--author=${options.author}`);
      if (options.since) args.push(`--since=${options.since}`);
      if (options.until) args.push(`--until=${options.until}`);
      if (options.grep) args.push(`--grep=${options.grep}`);

      // Add revision range
      if (revisionRange) {
        args.push(revisionRange);
      }

      // Add file filter
      if (options.file) {
        args.push('--', options.file);
      }

      // Add extra passthrough arguments
      const knownOpts = ['--oneline', '--graph', '--all', '--stat', '-p', '--patch',
        '--verbose', '--quiet', '--json', '--options'];
      const extraArgs = command.args.filter(arg =>
        !knownOpts.includes(arg) &&
        !arg.startsWith('-n') && !arg.startsWith('--number') &&
        !arg.startsWith('--author') && !arg.startsWith('--since') &&
        !arg.startsWith('--until') && !arg.startsWith('--grep') &&
        !arg.startsWith('-f') && !arg.startsWith('--file') &&
        !arg.startsWith('-S') && !arg.startsWith('--symbol')
      );
      args.push(...extraArgs);

      if (options.json) {
        // JSON output - parse git log
        const commits = await getCommitsJson(repoRoot, args.slice(1));
        output.json({ commits });
      } else {
        // Normal output - passthrough to git
        await runGitLog(args, repoRoot);
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
 * Run git log with output to terminal
 */
async function runGitLog(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: 'inherit',
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git log failed with code ${code}`));
      }
    });

    git.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Get commits as JSON
 */
async function getCommitsJson(cwd: string, logArgs: string[]): Promise<any[]> {
  try {
    // Use a custom format for JSON parsing
    const format = '--format={"sha": "%H", "shortSha": "%h", "author": "%an", "email": "%ae", "date": "%aI", "subject": "%s"}';
    const output = execSync(`git log ${format} ${logArgs.join(' ')}`, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large repos
    });

    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Find commits affecting a specific symbol (function/class)
 * Uses git log -S or knowledge graph if available
 */
async function logBySymbol(
  symbolName: string,
  options: LogOptions,
  repoRoot: string,
  output: any
): Promise<void> {
  console.log(chalk.bold(`\n📊 Commits affecting symbol: ${chalk.cyan(symbolName)}\n`));

  // Try to use knowledge graph first
  const cvInitialized = fs.existsSync(path.join(repoRoot, '.cv', 'config.json'));

  if (cvInitialized) {
    // Try knowledge graph query (if available)
    try {
      const result = execSync(`cv blame ${symbolName} 2>/dev/null`, {
        cwd: repoRoot,
        encoding: 'utf-8',
      });
      if (result.trim()) {
        console.log(result);
        return;
      }
    } catch {
      // Fall back to git pickaxe
    }
  }

  // Fall back to git pickaxe search
  const args = ['log', '-S', symbolName, '--oneline'];

  if (options.number) args.push(`-n${options.number}`);
  if (options.author) args.push(`--author=${options.author}`);
  if (options.since) args.push(`--since=${options.since}`);
  if (options.until) args.push(`--until=${options.until}`);

  try {
    const result = execSync(`git ${args.join(' ')}`, {
      cwd: repoRoot,
      encoding: 'utf-8',
    });

    if (result.trim()) {
      const lines = result.trim().split('\n');
      console.log(chalk.gray(`Found ${lines.length} commit(s) that added or removed "${symbolName}":\n`));

      lines.forEach(line => {
        const [sha, ...messageParts] = line.split(' ');
        const message = messageParts.join(' ');
        console.log(`  ${chalk.yellow(sha)} ${message}`);
      });

      console.log();
      console.log(chalk.gray(`Tip: Run 'cv log -p -S "${symbolName}"' to see the actual changes`));
    } else {
      console.log(chalk.yellow(`No commits found that add or remove "${symbolName}"`));
      console.log(chalk.gray('\nTry:'));
      console.log(chalk.gray(`  cv log --grep "${symbolName}"  # Search commit messages`));
      console.log(chalk.gray(`  cv find "${symbolName}"        # Semantic code search`));
    }
  } catch (error: any) {
    console.error(chalk.red(`Error: ${error.message}`));
  }
}

/**
 * Smart log - visual branch tree with relationship context
 * Inspired by Jujutsu and Sapling smartlog
 */
async function smartLog(
  options: LogOptions,
  repoRoot: string,
  output: any
): Promise<void> {
  console.log(chalk.bold('\n📊 Smart Log\n'));

  // Get current branch
  const currentBranch = execSync('git branch --show-current', {
    cwd: repoRoot,
    encoding: 'utf-8',
  }).trim() || 'HEAD';

  // Custom format for smart log
  const format = '%C(auto)%h%C(reset) %C(cyan)%an%C(reset) %C(dim)%ar%C(reset)%C(auto)%d%C(reset)%n  %s';

  const args = [
    'log',
    '--graph',
    '--all',
    '--decorate',
    `--format=${format}`,
  ];

  if (options.number) args.push(`-n${options.number}`);
  if (options.author) args.push(`--author=${options.author}`);
  if (options.since) args.push(`--since=${options.since}`);

  // Add visual markers for HEAD and current work
  console.log(chalk.gray(`Current: ${currentBranch}\n`));

  try {
    const result = execSync(`git ${args.join(' ')}`, {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    console.log(result);

    // Show working state
    const status = execSync('git status --porcelain', {
      cwd: repoRoot,
      encoding: 'utf-8',
    }).trim();

    if (status) {
      const changes = status.split('\n').length;
      console.log(chalk.yellow(`\n◉ Working copy (${changes} uncommitted change${changes > 1 ? 's' : ''})`));
    }

    console.log(chalk.gray('\nTip: cv log --mine  # Show only your commits'));
    console.log(chalk.gray('     cv log --stack # Show current stack'));

  } catch (error: any) {
    console.error(chalk.red(`Error: ${error.message}`));
  }
}

/**
 * Stack log - show commits in current stack
 */
async function stackLog(
  options: LogOptions,
  repoRoot: string,
  output: any
): Promise<void> {
  console.log(chalk.bold('\n📚 Stack Log\n'));

  // Find base (main or master)
  let base = 'main';
  try {
    execSync('git rev-parse --verify main', { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    try {
      execSync('git rev-parse --verify master', { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] });
      base = 'master';
    } catch {
      base = 'origin/main';
    }
  }

  // Get merge-base
  let mergeBase: string;
  try {
    mergeBase = execSync(`git merge-base ${base} HEAD`, {
      cwd: repoRoot,
      encoding: 'utf-8',
    }).trim();
  } catch {
    console.log(chalk.yellow('Could not determine stack base'));
    return;
  }

  // Count commits in stack
  const countOutput = execSync(`git rev-list --count ${mergeBase}..HEAD`, {
    cwd: repoRoot,
    encoding: 'utf-8',
  }).trim();

  const count = parseInt(countOutput, 10);

  if (count === 0) {
    console.log(chalk.gray(`Base: ${base}`));
    console.log(chalk.yellow('\nNo commits in stack (you are at the base)'));
    return;
  }

  console.log(chalk.gray(`Base: ${base}`));
  console.log(chalk.gray(`Commits in stack: ${count}\n`));

  // Show stack commits
  const format = '%C(yellow)%h%C(reset) %s %C(dim)(%ar)%C(reset)%C(auto)%d%C(reset)';

  const args = [
    'log',
    '--reverse',
    `--format=${format}`,
    `${mergeBase}..HEAD`,
  ];

  try {
    const result = execSync(`git ${args.join(' ')}`, {
      cwd: repoRoot,
      encoding: 'utf-8',
    });

    // Number the commits
    const lines = result.trim().split('\n');
    lines.forEach((line, i) => {
      const marker = i === lines.length - 1 ? '◉' : '│';
      console.log(`${chalk.cyan(marker)} ${i + 1}. ${line}`);
      if (i < lines.length - 1) {
        console.log(chalk.cyan('│'));
      }
    });

    console.log(chalk.cyan('│'));
    console.log(chalk.gray(`◯ ${base}`));

    console.log(chalk.gray('\nCommands:'));
    console.log(chalk.gray('  cv stack status  # Full stack status'));
    console.log(chalk.gray('  cv stack push    # Push stack branches'));

  } catch (error: any) {
    console.error(chalk.red(`Error: ${error.message}`));
  }
}

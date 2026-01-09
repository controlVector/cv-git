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

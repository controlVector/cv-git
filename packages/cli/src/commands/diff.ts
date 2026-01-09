/**
 * cv diff command
 * Git diff with optional AI-powered analysis
 *
 * Shows differences with optional AI summary of changes
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

interface DiffOptions {
  staged?: boolean;
  cached?: boolean;
  stat?: boolean;
  shortstat?: boolean;
  summary?: boolean;
  nameOnly?: boolean;
  nameStatus?: boolean;
  analyze?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export function diffCommand(): Command {
  const cmd = new Command('diff');

  cmd
    .description('Show changes (git diff wrapper with optional AI analysis)')
    .argument('[commit...]', 'Commits or refs to compare')
    .option('--staged', 'Show staged changes (same as --cached)')
    .option('--cached', 'Show staged changes')
    .option('--stat', 'Show diffstat')
    .option('--shortstat', 'Show only summary line')
    .option('--summary', 'Show condensed summary')
    .option('--name-only', 'Show only file names')
    .option('--name-status', 'Show file names with status')
    .option('--analyze', 'AI-powered analysis of changes (requires AI credentials)')
    .allowUnknownOption(true);

  addGlobalOptions(cmd);

  cmd.action(async (commits: string[], options: DiffOptions, command: Command) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      // Build git diff arguments
      const args = ['diff'];

      if (options.staged || options.cached) args.push('--cached');
      if (options.stat) args.push('--stat');
      if (options.shortstat) args.push('--shortstat');
      if (options.summary) args.push('--summary');
      if (options.nameOnly) args.push('--name-only');
      if (options.nameStatus) args.push('--name-status');

      // Add commits/refs
      if (commits.length > 0) {
        args.push(...commits);
      }

      // Add extra passthrough arguments
      const extraArgs = command.args.filter(arg =>
        !['--staged', '--cached', '--stat', '--shortstat', '--summary',
         '--name-only', '--name-status', '--analyze',
         '--verbose', '--quiet', '--json', '--options'].includes(arg)
      );
      args.push(...extraArgs);

      if (options.json) {
        // JSON output mode
        const diffOutput = execSync(`git ${args.slice(1).join(' ')}`, {
          cwd: repoRoot,
          encoding: 'utf-8',
        });

        const stats = getDiffStats(repoRoot, options.staged || options.cached);

        const result: any = {
          diff: diffOutput,
          stats,
        };

        if (options.analyze) {
          result.analysis = await analyzeDiff(diffOutput, repoRoot);
        }

        output.json(result);
      } else {
        // Normal output - passthrough to git
        if (options.analyze) {
          // Get diff for analysis
          const diffOutput = execSync(`git ${args.slice(1).join(' ')}`, {
            cwd: repoRoot,
            encoding: 'utf-8',
          });

          // Show the diff
          if (diffOutput.trim()) {
            console.log(diffOutput);
          }

          // Show AI analysis
          console.log(chalk.bold('\n📊 AI Analysis:\n'));
          const analysis = await analyzeDiff(diffOutput, repoRoot);
          console.log(analysis);
        } else {
          // Direct passthrough
          await runGitDiff(args, repoRoot);
        }
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
 * Run git diff with output to terminal
 */
async function runGitDiff(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd,
      stdio: 'inherit',
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git diff failed with code ${code}`));
      }
    });

    git.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Get diff statistics
 */
function getDiffStats(cwd: string, staged: boolean = false): { files: number; insertions: number; deletions: number } {
  try {
    const args = staged ? '--cached --shortstat' : '--shortstat';
    const output = execSync(`git diff ${args}`, {
      cwd,
      encoding: 'utf-8',
    });

    // Parse "X files changed, Y insertions(+), Z deletions(-)"
    const match = output.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
    if (match) {
      return {
        files: parseInt(match[1]) || 0,
        insertions: parseInt(match[2]) || 0,
        deletions: parseInt(match[3]) || 0,
      };
    }
    return { files: 0, insertions: 0, deletions: 0 };
  } catch {
    return { files: 0, insertions: 0, deletions: 0 };
  }
}

/**
 * Analyze diff using AI (stub - requires AI integration)
 */
async function analyzeDiff(diff: string, repoRoot: string): Promise<string> {
  if (!diff.trim()) {
    return chalk.gray('No changes to analyze.');
  }

  // Count changes
  const lines = diff.split('\n');
  const additions = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
  const deletions = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;
  const files = lines.filter(l => l.startsWith('diff --git')).length;

  // Extract file names
  const fileNames = lines
    .filter(l => l.startsWith('diff --git'))
    .map(l => {
      const match = l.match(/diff --git a\/(.*) b\/(.*)/);
      return match ? match[2] : null;
    })
    .filter(Boolean);

  // Basic analysis (AI integration would enhance this)
  const analysis: string[] = [];

  analysis.push(chalk.cyan(`Files changed: ${files}`));
  analysis.push(chalk.green(`Additions: +${additions} lines`));
  analysis.push(chalk.red(`Deletions: -${deletions} lines`));

  if (fileNames.length > 0) {
    analysis.push('');
    analysis.push(chalk.bold('Modified files:'));
    fileNames.forEach(f => analysis.push(chalk.gray(`  • ${f}`)));
  }

  // Detect change types
  const changeTypes: string[] = [];
  if (fileNames.some(f => f?.includes('test') || f?.includes('spec'))) {
    changeTypes.push('Tests');
  }
  if (fileNames.some(f => f?.endsWith('.md') || f?.endsWith('.txt'))) {
    changeTypes.push('Documentation');
  }
  if (fileNames.some(f => f?.includes('package.json') || f?.includes('pnpm-lock'))) {
    changeTypes.push('Dependencies');
  }
  if (fileNames.some(f => f?.includes('config') || f?.endsWith('.json') || f?.endsWith('.yaml'))) {
    changeTypes.push('Configuration');
  }

  if (changeTypes.length > 0) {
    analysis.push('');
    analysis.push(chalk.bold('Change categories: ') + changeTypes.join(', '));
  }

  // Suggest commit type
  analysis.push('');
  let suggestedType = 'chore';
  if (additions > deletions * 2 && additions > 50) {
    suggestedType = 'feat';
  } else if (deletions > additions * 2) {
    suggestedType = 'refactor';
  } else if (fileNames.some(f => f?.includes('fix') || f?.includes('bug'))) {
    suggestedType = 'fix';
  } else if (changeTypes.includes('Tests')) {
    suggestedType = 'test';
  } else if (changeTypes.includes('Documentation')) {
    suggestedType = 'docs';
  }

  analysis.push(chalk.bold('Suggested commit type: ') + chalk.yellow(suggestedType));
  analysis.push('');
  analysis.push(chalk.gray('Tip: Run `cv commit --generate` for AI-generated commit message'));

  return analysis.join('\n');
}

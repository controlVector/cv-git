/**
 * cv diff command
 * Git diff with optional AI-powered analysis
 *
 * Shows differences with optional AI summary of changes
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  configManager,
  createAIManager,
  createGraphManager,
  createGraphService,
  createGitManager
} from '@cv-git/core';
import { findRepoRoot as findCVRepoRoot } from '@cv-git/shared';
import { addGlobalOptions, createOutput } from '../utils/output.js';
import { getAnthropicApiKey } from '../utils/credentials.js';

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
  explain?: boolean;
  review?: boolean;
  conventional?: boolean;
  impact?: boolean;
  strict?: boolean;
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
    .option('--analyze', 'Basic analysis of changes (no AI required)')
    .option('--explain', 'AI-powered explanation of what the changes do')
    .option('--review', 'AI-powered code review of the changes')
    .option('--conventional', 'Generate a conventional commit message for the changes')
    .option('--impact', 'Include impact analysis of changed symbols')
    .option('--strict', 'Use stricter review criteria (with --review)')
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

      // Check if any AI feature is requested
      const needsAI = options.explain || options.review || options.conventional;

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
         '--name-only', '--name-status', '--analyze', '--explain', '--review',
         '--conventional', '--impact', '--strict',
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

        if (needsAI) {
          const aiResult = await runAIAnalysis(diffOutput, repoRoot, options);
          if (aiResult) {
            result.aiAnalysis = aiResult;
          }
        }

        output.json(result);
      } else {
        // Normal output - passthrough to git
        if (options.analyze || needsAI) {
          // Get diff for analysis
          const diffOutput = execSync(`git ${args.slice(1).join(' ')}`, {
            cwd: repoRoot,
            encoding: 'utf-8',
          });

          // Show the diff (unless only requesting conventional commit message)
          if (!options.conventional && diffOutput.trim()) {
            console.log(diffOutput);
          }

          // Show basic analysis
          if (options.analyze) {
            console.log(chalk.bold('\n📊 Analysis:\n'));
            const analysis = await analyzeDiff(diffOutput, repoRoot);
            console.log(analysis);
          }

          // Run AI analysis if requested
          if (needsAI) {
            await runAIAnalysis(diffOutput, repoRoot, options);
          }
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
  analysis.push(chalk.gray('Tip: Run `cv diff --explain` for AI-powered explanation'));
  analysis.push(chalk.gray('     Run `cv diff --review` for AI-powered code review'));
  analysis.push(chalk.gray('     Run `cv diff --conventional` for commit message generation'));

  return analysis.join('\n');
}

/**
 * Run AI-powered analysis of diff
 */
async function runAIAnalysis(
  diff: string,
  repoRoot: string,
  options: DiffOptions
): Promise<any> {
  if (!diff.trim()) {
    console.log(chalk.yellow('\nNo changes to analyze.'));
    return null;
  }

  // Check for CV-Git repository
  const cvRepoRoot = await findCVRepoRoot();
  if (!cvRepoRoot) {
    console.error(chalk.red('\nNot in a CV-Git repository. Run `cv init` first.'));
    return null;
  }

  // Load configuration
  const config = await configManager.load(cvRepoRoot);

  // Get API key
  const anthropicApiKey = await getAnthropicApiKey(config.ai?.apiKey);
  if (!anthropicApiKey) {
    console.error(chalk.red('\nAnthropic API key not found.'));
    console.error(chalk.gray('Run `cv auth setup anthropic` to configure.'));
    return null;
  }

  const results: any = {};
  const spinner = ora();

  // Initialize AI manager
  const git = createGitManager(repoRoot);
  const ai = createAIManager(
    {
      provider: 'anthropic',
      model: config.ai?.model || 'claude-sonnet-4-5-20250514',
      apiKey: anthropicApiKey
    },
    undefined,
    undefined,
    git
  );

  // Extract changed symbols for impact analysis
  let impactInfo = '';
  if (options.impact) {
    try {
      spinner.start('Analyzing impact...');
      const graph = createGraphManager(config.graph.url, config.graph.database);
      await graph.connect();
      const graphService = createGraphService(graph);

      // Extract function names from diff
      const functionMatches = diff.match(/^[\+\-]\s*(async\s+)?(function|const|let|var|export\s+(?:async\s+)?function)\s+(\w+)/gm);
      const changedSymbols = new Set<string>();
      if (functionMatches) {
        for (const match of functionMatches) {
          const nameMatch = match.match(/(\w+)\s*[=\(]/);
          if (nameMatch) {
            changedSymbols.add(nameMatch[1]);
          }
        }
      }

      // Get impact for each changed symbol
      const impactLines: string[] = [];
      for (const symbol of Array.from(changedSymbols).slice(0, 5)) {
        const impact = await graphService.getImpactAnalysis(symbol, { maxDepth: 2 });
        if (impact.totalImpact > 0) {
          impactLines.push(`  - ${symbol}: ${impact.riskLevel} risk, ${impact.directCallers.length} direct callers`);
        }
      }

      await graph.close();

      if (impactLines.length > 0) {
        impactInfo = '\n\nImpact of changed symbols:\n' + impactLines.join('\n');
      }
      spinner.stop();
    } catch {
      spinner.stop();
      // Continue without impact analysis
    }
  }

  // Handle --explain
  if (options.explain) {
    spinner.start('Generating AI explanation...');
    try {
      const explanation = await ai.explain(`Explain what these code changes do. Be concise:\n\n${diff}${impactInfo}`);
      spinner.succeed('Explanation generated');
      console.log(chalk.bold.cyan('\n📖 AI Explanation:\n'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(explanation);
      console.log('');
      results.explanation = explanation;
    } catch (error: any) {
      spinner.fail('Explanation failed');
      console.error(chalk.red(`Error: ${error.message}`));
    }
  }

  // Handle --review
  if (options.review) {
    spinner.start('Generating AI code review...');
    try {
      const strictness = options.strict
        ? 'Be very thorough and strict. Look for potential bugs, security issues, performance problems, and code style issues.'
        : 'Focus on important issues like bugs, security vulnerabilities, and significant code quality concerns.';

      const reviewPrompt = `Review these code changes. ${strictness}\n\n${diff}${impactInfo}`;
      const review = await ai.reviewCode(reviewPrompt);
      spinner.succeed('Code review generated');
      console.log(chalk.bold.cyan('\n🔍 AI Code Review:\n'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(review);
      console.log('');
      results.review = review;
    } catch (error: any) {
      spinner.fail('Review failed');
      console.error(chalk.red(`Error: ${error.message}`));
    }
  }

  // Handle --conventional
  if (options.conventional) {
    spinner.start('Generating conventional commit message...');
    try {
      const commitPrompt = `Generate a conventional commit message for these changes.
Use the format: type(scope): description

Types: feat, fix, refactor, docs, test, chore, style, perf, build, ci
Keep the description under 72 characters.
Add a body if needed to explain WHY the change was made.
Only output the commit message, nothing else.

Changes:
${diff}`;

      const commitMessage = await ai.explain(commitPrompt);
      spinner.succeed('Commit message generated');
      console.log(chalk.bold.cyan('\n📝 Suggested Commit Message:\n'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.yellow(commitMessage.trim()));
      console.log(chalk.gray('─'.repeat(60)));
      console.log('');
      console.log(chalk.gray('To use this message:'));
      console.log(chalk.gray('  git commit -m "$(cv diff --conventional --staged 2>/dev/null | tail -n +4)"'));
      console.log('');
      results.commitMessage = commitMessage.trim();
    } catch (error: any) {
      spinner.fail('Commit message generation failed');
      console.error(chalk.red(`Error: ${error.message}`));
    }
  }

  return Object.keys(results).length > 0 ? results : null;
}

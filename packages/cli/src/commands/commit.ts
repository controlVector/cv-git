/**
 * cv commit command
 * Git commit with identity from stored credentials and AI message generation
 *
 * Uses stored GitHub/GitLab credentials to set author identity
 * Optionally generates commit messages using AI + knowledge graph analysis
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { addGlobalOptions } from '../utils/output.js';
import { CredentialManager, CredentialType, GitPlatform } from '@cv-git/credentials';
import {
  createCommitAnalyzer,
  CommitAnalysis,
  GeneratedCommitMessage
} from '@cv-git/core';

/**
 * Find git repository root (works with any git repo, not just CV-initialized)
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
 * Check if CV is initialized in a git repo
 */
function isCVInitialized(repoRoot: string): boolean {
  const cvConfigPath = path.join(repoRoot, '.cv', 'config.json');
  return fs.existsSync(cvConfigPath);
}

/**
 * Prompt user for input
 */
async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

interface CommitOptions {
  message?: string;
  all?: boolean;
  amend?: boolean;
  generate?: boolean;
  dryRun?: boolean;
  type?: string;
  scope?: string;
  verbose?: boolean;
  quiet?: boolean;
}

export function commitCommand(): Command {
  const cmd = new Command('commit');

  cmd
    .description('Git commit with identity from stored credentials and optional AI message generation')
    .option('-m, --message <message>', 'Commit message')
    .option('-a, --all', 'Automatically stage modified and deleted files')
    .option('--amend', 'Amend the previous commit')
    .option('-g, --generate', 'Generate commit message using AI + knowledge graph')
    .option('--dry-run', 'Show generated message without committing')
    .option('--type <type>', 'Override commit type (feat, fix, refactor, etc.)')
    .option('--scope <scope>', 'Override commit scope')
    .option('-q, --quiet', 'Output only the generated message (for use in hooks/scripts)')
    .allowUnknownOption(true); // Allow git passthrough options

  addGlobalOptions(cmd);

  cmd.action(async (options: CommitOptions, command: Command) => {
    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      // Check if CV is initialized - warn if not but continue
      const cvInitialized = isCVInitialized(repoRoot);

      // If --generate flag is used, run AI generation
      if (options.generate) {
        if (!cvInitialized) {
          console.log(chalk.yellow('Note: CV not initialized. Run `cv init` for enhanced analysis with knowledge graph.'));
        }

        await handleGenerateCommit(repoRoot, options, command.args, cvInitialized);
        return;
      }

      // Standard commit flow
      if (!cvInitialized) {
        console.log(chalk.yellow('⚠ CV not initialized in this repo'));
        console.log(chalk.gray('  Run `cv init` for knowledge graph sync, semantic search, and more'));
        console.log();
      }

      // Get identity from stored credentials
      const identity = await getIdentityFromCredentials();

      if (identity) {
        console.log(chalk.gray(`Using identity: ${identity.name} <${identity.email}>`));
      }

      const spinner = ora('Committing...').start();

      try {
        await gitCommit(options, command.args, identity);
        spinner.succeed(chalk.green('Committed successfully'));

        // Show commit info
        const commitInfo = execSync('git log -1 --oneline', { encoding: 'utf-8' }).trim();
        console.log(chalk.cyan(`  ${commitInfo}`));
      } catch (error: any) {
        spinner.fail(chalk.red('Commit failed'));
        console.error(chalk.red(error.message));
        process.exit(1);
      }

    } catch (error: any) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

  return cmd;
}

/**
 * Handle AI commit message generation
 */
async function handleGenerateCommit(
  repoRoot: string,
  options: CommitOptions,
  extraArgs: string[],
  cvInitialized: boolean
): Promise<void> {
  // Check for API keys
  const credentials = new CredentialManager();
  await credentials.init();

  // Try to get API keys (Anthropic first, then OpenRouter)
  let anthropicKey: string | undefined;
  let openRouterKey: string | undefined;

  try {
    anthropicKey = await credentials.getAnthropicKey() || undefined;
  } catch {
    // Not found
  }

  try {
    openRouterKey = await credentials.getOpenRouterKey() || undefined;
  } catch {
    // Not found
  }

  // Fall back to environment variables
  if (!anthropicKey) {
    anthropicKey = process.env.ANTHROPIC_API_KEY;
  }
  if (!openRouterKey) {
    openRouterKey = process.env.OPENROUTER_API_KEY;
  }

  // Determine provider and API key to use
  let provider: 'anthropic' | 'openrouter';
  let apiKey: string;

  if (anthropicKey) {
    provider = 'anthropic';
    apiKey = anthropicKey;
  } else if (openRouterKey) {
    provider = 'openrouter';
    apiKey = openRouterKey;
  } else {
    if (!options.quiet) {
      console.error(chalk.red('No AI API key found.'));
      console.error(chalk.gray('Set up credentials with: cv auth setup'));
      console.error(chalk.gray('Or set ANTHROPIC_API_KEY or OPENROUTER_API_KEY environment variable.'));
    }
    process.exit(1);
  }

  // In quiet mode, skip spinner and only output raw message
  const spinner = options.quiet ? null : ora('Analyzing staged changes...').start();

  try {
    // Create analyzer with the available provider
    const analyzer = createCommitAnalyzer({
      repoRoot,
      provider,
      apiKey
    });

    // Import GitManager dynamically
    const { createGitManager, createGraphManager, configManager } = await import('@cv-git/core');
    const git = createGitManager(repoRoot);

    // Try to connect to graph if CV is initialized
    let graph: any = undefined;
    if (cvInitialized) {
      try {
        const config = await configManager.load(repoRoot);
        graph = createGraphManager(config.graph.url, config.graph.database);
        await graph.connect();
        if (spinner) spinner.text = 'Analyzing with knowledge graph context...';
      } catch {
        // Graph not available, continue without it
      }
    }

    // Analyze staged changes
    const analysis = await analyzer.analyzeStaged(git, graph);

    if (spinner) spinner.text = 'Generating commit message...';

    // Apply overrides
    if (options.type) {
      analysis.suggestedType = options.type as any;
    }
    if (options.scope) {
      analysis.suggestedScope = options.scope;
    }

    // Generate message
    const generated = await analyzer.generateMessage(analysis);

    if (spinner) spinner.stop();

    // Close graph connection if open
    if (graph) {
      await graph.close();
    }

    // Quiet mode: output only the message and exit
    if (options.quiet) {
      console.log(generated.fullMessage);
      return;
    }

    // Display analysis summary
    console.log();
    console.log(chalk.bold('Analysis Summary:'));
    console.log(chalk.gray(`  Files changed: ${analysis.filesChanged.length}`));
    console.log(chalk.gray(`  Lines: +${analysis.linesAdded} / -${analysis.linesRemoved}`));

    if (analysis.symbolsAdded.length > 0) {
      console.log(chalk.green(`  Symbols added: ${analysis.symbolsAdded.length}`));
    }
    if (analysis.symbolsModified.length > 0) {
      console.log(chalk.yellow(`  Symbols modified: ${analysis.symbolsModified.length}`));
    }
    if (analysis.symbolsDeleted.length > 0) {
      console.log(chalk.red(`  Symbols deleted: ${analysis.symbolsDeleted.length}`));
    }

    if (analysis.isBreakingChange) {
      console.log(chalk.red.bold('  ⚠ BREAKING CHANGES DETECTED'));
      for (const bc of analysis.breakingChanges) {
        console.log(chalk.red(`    - ${bc.reason}`));
      }
    }

    console.log();
    console.log(chalk.bold('Generated Message:'));
    console.log(chalk.cyan('─'.repeat(60)));
    console.log(generated.fullMessage);
    console.log(chalk.cyan('─'.repeat(60)));
    console.log();

    // If dry-run, just exit
    if (options.dryRun) {
      console.log(chalk.gray('(dry-run mode - no commit created)'));
      return;
    }

    // Interactive prompt
    const action = await prompt(
      chalk.yellow('[A]ccept / [E]dit / [R]egenerate / [C]ancel? ')
    );

    const choice = action.toLowerCase();

    if (choice === 'a' || choice === 'accept' || choice === '') {
      // Accept and commit
      await commitWithMessage(repoRoot, generated.fullMessage, options, extraArgs);
    } else if (choice === 'e' || choice === 'edit') {
      // Let user edit with default editor
      const editedMessage = await editMessage(generated.fullMessage);
      if (editedMessage) {
        await commitWithMessage(repoRoot, editedMessage, options, extraArgs);
      } else {
        console.log(chalk.yellow('Commit cancelled.'));
      }
    } else if (choice === 'r' || choice === 'regenerate') {
      // Regenerate
      console.log(chalk.gray('Regenerating...'));
      const newGenerated = await analyzer.generateMessage(analysis);
      console.log();
      console.log(chalk.bold('New Message:'));
      console.log(chalk.cyan('─'.repeat(60)));
      console.log(newGenerated.fullMessage);
      console.log(chalk.cyan('─'.repeat(60)));
      console.log();

      const action2 = await prompt(chalk.yellow('[A]ccept / [C]ancel? '));
      if (action2.toLowerCase() === 'a' || action2.toLowerCase() === 'accept' || action2 === '') {
        await commitWithMessage(repoRoot, newGenerated.fullMessage, options, extraArgs);
      } else {
        console.log(chalk.yellow('Commit cancelled.'));
      }
    } else {
      console.log(chalk.yellow('Commit cancelled.'));
    }

  } catch (error: any) {
    if (spinner) spinner.fail(chalk.red('Failed to generate commit message'));
    if (!options.quiet) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

/**
 * Edit message with system editor
 */
async function editMessage(message: string): Promise<string | null> {
  const tmpFile = path.join(process.cwd(), '.cv-commit-msg.tmp');

  try {
    // Write message to temp file
    fs.writeFileSync(tmpFile, message);

    // Get editor
    const editor = process.env.EDITOR || process.env.VISUAL || 'vi';

    // Open editor
    const result = execSync(`${editor} "${tmpFile}"`, {
      stdio: 'inherit'
    });

    // Read edited message
    const edited = fs.readFileSync(tmpFile, 'utf-8').trim();

    // Clean up
    fs.unlinkSync(tmpFile);

    if (edited.length === 0) {
      return null;
    }

    return edited;
  } catch (error) {
    // Clean up on error
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
    return null;
  }
}

/**
 * Commit with a specific message
 */
async function commitWithMessage(
  repoRoot: string,
  message: string,
  options: CommitOptions,
  extraArgs: string[]
): Promise<void> {
  const identity = await getIdentityFromCredentials();

  if (identity) {
    console.log(chalk.gray(`Using identity: ${identity.name} <${identity.email}>`));
  }

  const spinner = ora('Committing...').start();

  try {
    // Use the provided message instead of options.message
    const commitOptions = { ...options, message };
    await gitCommit(commitOptions, extraArgs, identity);
    spinner.succeed(chalk.green('Committed successfully'));

    // Show commit info
    const commitInfo = execSync('git log -1 --oneline', { encoding: 'utf-8' }).trim();
    console.log(chalk.cyan(`  ${commitInfo}`));
  } catch (error: any) {
    spinner.fail(chalk.red('Commit failed'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

/**
 * Get git identity from stored credentials
 */
async function getIdentityFromCredentials(): Promise<{ name: string; email: string } | null> {
  const credentials = new CredentialManager();
  await credentials.init();

  // List all credentials and find a git platform token
  const all = await credentials.list();
  const gitCred = all.find(c => c.type === CredentialType.GIT_PLATFORM_TOKEN);

  if (!gitCred) return null;

  // Retrieve the full credential to get username
  const full = await credentials.retrieve(gitCred.type, gitCred.name);
  if (!full || !('username' in full)) return null;

  const username = (full as any).username;
  const platform = (full as any).platform || gitCred.metadata?.platform;

  // Construct email based on platform
  let email: string;
  if (platform === GitPlatform.GITHUB) {
    // GitHub noreply email format
    email = `${username}@users.noreply.github.com`;
  } else if (platform === GitPlatform.GITLAB) {
    email = `${username}@users.noreply.gitlab.com`;
  } else {
    // Generic fallback
    email = `${username}@users.noreply.${platform || 'git'}.com`;
  }

  return { name: username, email };
}

/**
 * Run git commit with identity and options
 */
async function gitCommit(
  options: CommitOptions,
  extraArgs: string[],
  identity: { name: string; email: string } | null
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['commit'];

    // Add identity if available (overrides local/global config for this commit)
    if (identity) {
      args.push('--author', `${identity.name} <${identity.email}>`);
    }

    // Add options
    if (options.all) {
      args.push('-a');
    }

    if (options.amend) {
      args.push('--amend');
    }

    if (options.message) {
      args.push('-m', options.message);
    }

    // Add any extra passthrough arguments (filter out our custom options)
    const filteredArgs = extraArgs.filter(arg =>
      !arg.startsWith('--message') &&
      !arg.startsWith('-m') &&
      !arg.startsWith('--all') &&
      !arg.startsWith('-a') &&
      !arg.startsWith('--amend') &&
      !arg.startsWith('--generate') &&
      !arg.startsWith('-g') &&
      !arg.startsWith('--dry-run') &&
      !arg.startsWith('--type') &&
      !arg.startsWith('--scope')
    );
    args.push(...filteredArgs);

    const git = spawn('git', args, {
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    git.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    git.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || stdout || `git commit failed with code ${code}`));
      }
    });

    git.on('error', (error) => {
      reject(error);
    });
  });
}

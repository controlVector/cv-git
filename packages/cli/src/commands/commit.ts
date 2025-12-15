/**
 * cv commit command
 * Git commit with identity from stored credentials
 *
 * Uses stored GitHub/GitLab credentials to set author identity
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { addGlobalOptions } from '../utils/output.js';
import { CredentialManager, CredentialType, GitPlatform } from '@cv-git/credentials';

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

interface CommitOptions {
  message?: string;
  all?: boolean;
  amend?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

export function commitCommand(): Command {
  const cmd = new Command('commit');

  cmd
    .description('Git commit with identity from stored credentials')
    .option('-m, --message <message>', 'Commit message')
    .option('-a, --all', 'Automatically stage modified and deleted files')
    .option('--amend', 'Amend the previous commit')
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
      !arg.startsWith('--amend')
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

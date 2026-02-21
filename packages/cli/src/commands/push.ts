/**
 * cv push command
 * Git push with automatic knowledge graph sync
 *
 * Uses stored GitHub/GitLab credentials for authentication
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { spawn, spawnSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { addGlobalOptions, createOutput } from '../utils/output.js';
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

interface PushOptions {
  skipSync?: boolean;
  syncOnly?: boolean;
  force?: boolean;
  tags?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

export function pushCommand(): Command {
  const cmd = new Command('push');

  cmd
    .description('Git push with automatic knowledge graph sync')
    .argument('[remote]', 'Remote name (default: origin)')
    .argument('[branch]', 'Branch name (default: current branch)')
    .option('--skip-sync', 'Skip knowledge graph sync after push')
    .option('--sync-only', 'Only sync, do not push')
    .option('-f, --force', 'Force push (use with caution)')
    .option('--tags', 'Push all tags')
    .allowUnknownOption(true); // Allow git passthrough options

  addGlobalOptions(cmd);

  cmd.action(async (remote: string | undefined, branch: string | undefined, options: PushOptions, command: Command) => {
    const output = createOutput(options as any);

    try {
      const repoRoot = findGitRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      // Check if CV is initialized
      const cvInitialized = isCVInitialized(repoRoot);

      // Step 1: Git push (unless sync-only)
      if (!options.syncOnly) {
        const pushSpinner = ora('Pushing to remote...').start();

        try {
          await gitPush(remote, branch, options, command.args);
          pushSpinner.succeed(chalk.green('Pushed successfully'));
        } catch (error: any) {
          pushSpinner.fail(chalk.red('Push failed'));
          console.error(chalk.red(error.message));
          process.exit(1);
        }
      }

      // Step 2: Sync knowledge graph (unless skip-sync or CV not initialized)
      if (!options.skipSync && cvInitialized) {
        const syncSpinner = ora('Syncing knowledge graph...').start();

        try {
          // Run cv sync --incremental via subprocess
          const result = spawnSync('cv', ['sync', '--incremental'], {
            cwd: repoRoot,
            stdio: ['inherit', 'pipe', 'pipe'],
            encoding: 'utf-8',
          });

          if (result.status === 0) {
            syncSpinner.succeed(chalk.green('Knowledge graph synced'));
          } else {
            throw new Error(result.stderr || 'Sync failed');
          }
        } catch (error: any) {
          syncSpinner.warn(chalk.yellow(`Sync warning: ${error.message}`));
          // Don't fail the push if sync fails
          if (options.verbose) {
            console.error(chalk.gray(error.stack));
          }
        }
      }

      console.log(chalk.green('\n✓ Done'));

    } catch (error: any) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

  return cmd;
}

/**
 * Detect git platform from remote URL
 */
function detectPlatform(remoteUrl: string): GitPlatform | null {
  if (remoteUrl.includes('github.com')) return GitPlatform.GITHUB;
  if (remoteUrl.includes('gitlab.com')) return GitPlatform.GITLAB;
  if (remoteUrl.includes('bitbucket.org')) return GitPlatform.BITBUCKET;
  if (remoteUrl.includes('controlvector.io')) return GitPlatform.CV_HUB;
  if (remoteUrl.includes('controlfab.ai')) return GitPlatform.CONTROLFAB;
  return null;
}

/**
 * Get remote URL for a given remote name
 */
function getRemoteUrl(remote: string = 'origin'): string | null {
  try {
    return execSync(`git remote get-url ${remote}`, { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Get stored credential for a platform
 */
async function getCredentialForPlatform(platform: GitPlatform): Promise<{ username: string; token: string } | null> {
  const credentials = new CredentialManager();
  await credentials.init();

  // List all credentials and find one for this platform
  const all = await credentials.list();
  const gitCred = all.find(c =>
    c.type === CredentialType.GIT_PLATFORM_TOKEN &&
    c.metadata?.platform === platform
  );

  if (!gitCred) return null;

  // Retrieve the full credential
  const full = await credentials.retrieve(gitCred.type, gitCred.name);
  if (!full || !('token' in full) || !('username' in full)) return null;

  return {
    username: (full as any).username,
    token: (full as any).token
  };
}

/**
 * Create a GIT_ASKPASS helper script that provides credentials
 */
function createAskPassScript(username: string, token: string): string {
  const tmpDir = os.tmpdir();
  const scriptPath = path.join(tmpDir, `cv-git-askpass-${process.pid}.sh`);

  // Script that returns token for password prompts, username for username prompts
  const script = `#!/bin/bash
if [[ "$1" == *"Username"* ]]; then
  echo "${username}"
elif [[ "$1" == *"Password"* ]] || [[ "$1" == *"token"* ]]; then
  echo "${token}"
fi
`;

  fs.writeFileSync(scriptPath, script, { mode: 0o700 });
  return scriptPath;
}

/**
 * Clean up the askpass script
 */
function cleanupAskPassScript(scriptPath: string): void {
  try {
    fs.unlinkSync(scriptPath);
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Run git push with passthrough arguments
 */
async function gitPush(
  remote: string | undefined,
  branch: string | undefined,
  options: PushOptions,
  extraArgs: string[]
): Promise<void> {
  const remoteName = remote || 'origin';

  // Get remote URL and detect platform
  const remoteUrl = getRemoteUrl(remoteName);
  let askPassScript: string | null = null;
  let env = { ...process.env };

  if (remoteUrl && remoteUrl.startsWith('https://')) {
    const platform = detectPlatform(remoteUrl);
    if (platform) {
      const cred = await getCredentialForPlatform(platform);
      if (cred) {
        // Create askpass script for authentication
        askPassScript = createAskPassScript(cred.username, cred.token);
        env = {
          ...env,
          GIT_ASKPASS: askPassScript,
          GIT_TERMINAL_PROMPT: '0'  // Disable interactive prompts
        };
      }
    }
  }

  return new Promise((resolve, reject) => {
    const args = ['push'];

    // Add force flag
    if (options.force) {
      args.push('--force');
    }

    // Add tags flag
    if (options.tags) {
      args.push('--tags');
    }

    // Add remote and branch if specified
    if (remote) {
      // Auto-set upstream if no tracking branch is configured
      if (branch) {
        try {
          execSync(`git rev-parse --abbrev-ref @{upstream}`, { encoding: 'utf-8', stdio: 'pipe' });
        } catch {
          // No upstream configured — add -u to set it
          args.push('-u');
        }
      }
      args.push(remote);
      if (branch) {
        args.push(branch);
      }
    }

    // Add any extra passthrough arguments (exclude already-parsed positional args)
    const parsedPositionals = new Set([remote, branch].filter(Boolean));
    args.push(...extraArgs.filter(arg =>
      !arg.startsWith('--skip') && !arg.startsWith('--sync') && !parsedPositionals.has(arg)
    ));

    const git = spawn('git', args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      env
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
      // Clean up askpass script
      if (askPassScript) {
        cleanupAskPassScript(askPassScript);
      }

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || stdout || `git push failed with code ${code}`));
      }
    });

    git.on('error', (error) => {
      // Clean up askpass script
      if (askPassScript) {
        cleanupAskPassScript(askPassScript);
      }
      reject(error);
    });
  });
}

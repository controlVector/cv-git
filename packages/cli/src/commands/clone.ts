/**
 * cv clone command
 * Clone a repository and initialize CV-Git
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { configManager } from '@cv-git/core';
import { ensureDir, getCVDir } from '@cv-git/shared';
import { detectPlatformFromRemote, getDefaultWebUrl } from '@cv-git/platform';
import { CredentialManager, GitPlatform } from '@cv-git/credentials';
import { addGlobalOptions, createOutput } from '../utils/output.js';

/**
 * Parse repository URL to extract useful information
 */
function parseRepoUrl(url: string): {
  platform: GitPlatform;
  owner: string;
  repo: string;
  fullPath: string;
  cloneUrl: string;
  host: string;
} {
  const platform = detectPlatformFromRemote(url);
  let cloneUrl = url;

  // Normalize URL - ensure it ends with .git for cloning
  if (!cloneUrl.endsWith('.git')) {
    cloneUrl = cloneUrl + '.git';
  }

  // Convert SSH to HTTPS if needed for display purposes
  let httpsUrl = url;
  if (url.startsWith('git@')) {
    // git@gitlab.com:owner/repo.git -> https://gitlab.com/owner/repo
    httpsUrl = url
      .replace('git@', 'https://')
      .replace(':', '/')
      .replace('.git', '');
  }

  // Extract host from URL
  let host = 'github.com';
  if (httpsUrl.includes('gitlab.com')) {
    host = 'gitlab.com';
  } else if (httpsUrl.includes('bitbucket.org')) {
    host = 'bitbucket.org';
  } else if (httpsUrl.includes('github.com')) {
    host = 'github.com';
  }

  // Extract owner and repo from URL
  // Handles:
  //   https://github.com/owner/repo.git
  //   https://gitlab.com/group/subgroup/repo.git
  //   git@github.com:owner/repo.git
  let pathPart = '';

  if (httpsUrl.includes('github.com')) {
    const match = httpsUrl.match(/github\.com\/(.+?)(?:\.git)?$/);
    pathPart = match?.[1] || '';
  } else if (httpsUrl.includes('gitlab.com')) {
    const match = httpsUrl.match(/gitlab\.com\/(.+?)(?:\.git)?$/);
    pathPart = match?.[1] || '';
  } else if (httpsUrl.includes('bitbucket.org')) {
    const match = httpsUrl.match(/bitbucket\.org\/(.+?)(?:\.git)?$/);
    pathPart = match?.[1] || '';
  }

  // Remove .git suffix if present
  pathPart = pathPart.replace(/\.git$/, '');

  const parts = pathPart.split('/');
  const repo = parts.pop() || '';
  const owner = parts.join('/');

  return {
    platform,
    owner,
    repo,
    fullPath: pathPart,
    cloneUrl,
    host,
  };
}

/**
 * Build authenticated clone URL using stored credentials
 */
async function buildAuthenticatedUrl(
  repoInfo: ReturnType<typeof parseRepoUrl>,
  credentialManager: CredentialManager,
  verbose: boolean = false
): Promise<{ url: string; hasToken: boolean }> {
  // Only modify HTTPS URLs
  if (repoInfo.cloneUrl.startsWith('git@')) {
    return { url: repoInfo.cloneUrl, hasToken: false }; // SSH URLs use key-based auth
  }

  try {
    // Get stored token for this platform
    const token = await credentialManager.getGitPlatformToken(repoInfo.platform);

    if (verbose && token) {
      console.log(chalk.gray(`  Token found: ${token.substring(0, 8)}...`));
    }

    if (token) {
      // Inject token into URL: https://gitlab.com/... -> https://oauth2:TOKEN@gitlab.com/...
      const urlWithAuth = repoInfo.cloneUrl.replace(
        `https://${repoInfo.host}/`,
        `https://oauth2:${token}@${repoInfo.host}/`
      );
      if (verbose) {
        // Show URL with masked token
        const maskedUrl = urlWithAuth.replace(token, '****');
        console.log(chalk.gray(`  Auth URL: ${maskedUrl}`));
      }
      return { url: urlWithAuth, hasToken: true };
    }
  } catch (error: any) {
    if (verbose) {
      console.log(chalk.gray(`  Credential error: ${error.message}`));
    }
  }

  return { url: repoInfo.cloneUrl, hasToken: false };
}

/**
 * Clone repository with progress output using native git command
 */
function cloneWithProgress(
  cloneUrl: string,
  targetPath: string,
  options: { branch?: string; depth?: number },
  onProgress: (message: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['clone', '--progress'];

    if (options.branch) {
      args.push('--branch', options.branch);
    }

    if (options.depth) {
      args.push('--depth', String(options.depth));
    }

    args.push(cloneUrl, targetPath);

    const git = spawn('git', args, {
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let lastProgress = '';
    let stderrOutput = '';

    // Git outputs progress to stderr
    git.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderrOutput += text;

      // Parse progress messages
      const lines = text.split(/\r|\n/).filter(l => l.trim());
      for (const line of lines) {
        // Extract meaningful progress info
        if (line.includes('Cloning into')) {
          onProgress('Starting clone...');
        } else if (line.includes('remote: Counting objects')) {
          const match = line.match(/(\d+)%/);
          if (match) {
            onProgress(`Counting objects: ${match[1]}%`);
          } else {
            onProgress('Counting objects...');
          }
        } else if (line.includes('remote: Compressing objects')) {
          const match = line.match(/(\d+)%/);
          if (match) {
            onProgress(`Compressing: ${match[1]}%`);
          }
        } else if (line.includes('Receiving objects')) {
          const match = line.match(/(\d+)%/);
          if (match && match[1] !== lastProgress) {
            lastProgress = match[1];
            onProgress(`Receiving objects: ${match[1]}%`);
          }
        } else if (line.includes('Resolving deltas')) {
          const match = line.match(/(\d+)%/);
          if (match) {
            onProgress(`Resolving deltas: ${match[1]}%`);
          }
        } else if (line.includes('Updating files')) {
          const match = line.match(/(\d+)%/);
          if (match) {
            onProgress(`Updating files: ${match[1]}%`);
          }
        }
      }
    });

    git.stdout?.on('data', (data: Buffer) => {
      // Capture any stdout output
      const text = data.toString().trim();
      if (text) {
        onProgress(text);
      }
    });

    git.on('error', (error) => {
      reject(new Error(`Failed to start git: ${error.message}`));
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Include stderr output in error message for debugging
        const errorLines = stderrOutput.split('\n').filter(l =>
          l.includes('fatal:') || l.includes('error:') || l.includes('remote:')
        );
        const errorDetail = errorLines.length > 0
          ? errorLines.join('\n')
          : stderrOutput.trim().slice(-500);
        reject(new Error(`Git clone failed with exit code ${code}\n${errorDetail}`));
      }
    });
  });
}

export function cloneCommand(): Command {
  const cmd = new Command('clone');

  cmd
    .description('Clone a repository and initialize CV-Git')
    .argument('<url>', 'Repository URL (HTTPS or SSH)')
    .argument('[directory]', 'Target directory (defaults to repo name)')
    .option('--no-init', 'Skip CV-Git initialization after cloning')
    .option('--sync', 'Run cv sync after initialization')
    .option('--branch <branch>', 'Clone specific branch')
    .option('--depth <depth>', 'Create a shallow clone with specified depth', parseInt);

  addGlobalOptions(cmd);

  cmd.action(async (url: string, directory: string | undefined, options) => {
    const output = createOutput(options);
    const spinner = output.spinner('Parsing repository URL...').start();

    try {
      // Parse the URL
      const repoInfo = parseRepoUrl(url);
      const targetDir = directory || repoInfo.repo;
      const targetPath = path.resolve(process.cwd(), targetDir);

      spinner.text = `Detected platform: ${repoInfo.platform}`;

      // Check if target directory already exists
      if (fs.existsSync(targetPath)) {
        spinner.fail(`Directory already exists: ${targetDir}`);
        process.exit(1);
      }

      // Display clone info
      if (!output.isJson) {
        spinner.info(chalk.cyan('Repository Information:'));
        console.log(chalk.gray(`  Platform: ${repoInfo.platform}`));
        console.log(chalk.gray(`  Owner: ${repoInfo.owner}`));
        console.log(chalk.gray(`  Repository: ${repoInfo.repo}`));
        console.log(chalk.gray(`  Target: ${targetPath}`));
        console.log();
      }

      // Try to get authenticated URL using stored credentials
      spinner.start('Checking credentials...');
      const credentialManager = new CredentialManager();
      let cloneUrl = repoInfo.cloneUrl;
      let usingStoredCredentials = false;

      try {
        const authResult = await buildAuthenticatedUrl(repoInfo, credentialManager, options.verbose);
        if (authResult.hasToken) {
          cloneUrl = authResult.url;
          usingStoredCredentials = true;
          spinner.succeed(`Using stored ${repoInfo.platform} credentials`);
        } else {
          spinner.info('No stored credentials found, using default authentication');
        }
      } catch (error) {
        spinner.info('Credential check skipped, using default authentication');
      }

      // Clone the repository with progress
      spinner.start(`Cloning ${repoInfo.fullPath}...`);

      await cloneWithProgress(
        cloneUrl,
        targetPath,
        { branch: options.branch, depth: options.depth },
        (progressMessage) => {
          spinner.text = `Cloning ${repoInfo.fullPath}... ${chalk.gray(progressMessage)}`;
        }
      );

      spinner.succeed(`Cloned repository to ${targetDir}`);

      // Initialize CV-Git if not disabled
      if (options.init !== false) {
        console.log();
        spinner.start('Initializing CV-Git...');

        // Change to the cloned directory
        process.chdir(targetPath);

        // Create .cv directory
        const cvDir = getCVDir(targetPath);
        await ensureDir(cvDir);

        // Initialize configuration with platform info
        const config = await configManager.init(targetPath, repoInfo.repo);

        // Update config with platform settings
        await configManager.update({
          platform: {
            type: repoInfo.platform,
            url: getDefaultWebUrl(repoInfo.platform)
          }
        } as any);

        // Create subdirectories
        await ensureDir(path.join(cvDir, 'cache'));
        await ensureDir(path.join(cvDir, 'sessions'));

        spinner.succeed('CV-Git initialized');

        // Show platform configuration
        if (!output.isJson) {
          console.log();
          console.log(chalk.green('✓') + ' Platform configured: ' + chalk.cyan(repoInfo.platform));
        }
      }

      // Run sync if requested
      if (options.sync) {
        console.log();
        spinner.start('Syncing knowledge graph...');

        try {
          const { execSync } = await import('child_process');
          execSync('cv sync', { stdio: 'inherit', cwd: targetPath });
        } catch (syncError) {
          spinner.warn('Sync completed with warnings (some services may not be available)');
        }
      }

      // Output results
      if (output.isJson) {
        output.json({
          success: true,
          repository: {
            url: repoInfo.cloneUrl,
            platform: repoInfo.platform,
            owner: repoInfo.owner,
            name: repoInfo.repo,
            fullPath: repoInfo.fullPath,
          },
          directory: targetPath,
          initialized: options.init !== false,
          synced: options.sync || false,
          usedStoredCredentials: usingStoredCredentials,
        });
      } else {
        console.log();
        console.log(chalk.green.bold('✓ Repository ready!'));
        console.log();
        console.log(chalk.bold('Next steps:'));
        console.log(chalk.gray(`  cd ${targetDir}`));

        if (options.init === false) {
          console.log(chalk.cyan('  cv init'));
        }

        if (!options.sync) {
          console.log(chalk.cyan('  cv sync'));
        }

        console.log();
        console.log(chalk.gray('Then start exploring:'));
        console.log(chalk.cyan('  cv find "main functionality"'));
        console.log(chalk.cyan('  cv graph stats'));
        console.log(chalk.cyan('  cv explain <file>'));
        console.log();
      }

    } catch (error: any) {
      spinner.fail('Clone failed');

      if (error.message?.includes('already exists')) {
        output.error('Target directory already exists', error);
      } else if (error.message?.includes('Authentication failed') || error.message?.includes('403')) {
        output.error('Authentication failed. Make sure you have access to this repository.', error);
        console.log();
        console.log(chalk.yellow('If this is a private repository, you may need to:'));
        console.log(chalk.gray('  1. Use SSH URL: git@gitlab.com:owner/repo.git'));
        console.log(chalk.gray('  2. Or configure credentials: cv auth setup <platform>'));
      } else if (error.message?.includes('not found') || error.message?.includes('404')) {
        output.error('Repository not found. Check the URL and try again.', error);
      } else {
        output.error('Failed to clone repository', error);
      }

      process.exit(1);
    }
  });

  return cmd;
}

/**
 * cv clone-group command
 * Clone all repositories in a GitLab/GitHub group/organization
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { configManager } from '@cv-git/core';
import { ensureDir, getCVDir } from '@cv-git/shared';
import { detectPlatformFromRemote, getDefaultApiUrl, getDefaultWebUrl } from '@cv-git/platform';
import { CredentialManager, GitPlatform } from '@cv-git/credentials';
import { addGlobalOptions, createOutput } from '../utils/output.js';

interface ProjectInfo {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  http_url_to_repo: string;
  ssh_url_to_repo: string;
  description: string | null;
}

interface GroupInfo {
  id: number;
  name: string;
  path: string;
  full_path: string;
  description: string | null;
}

/**
 * Parse group URL to extract information
 */
function parseGroupUrl(url: string): {
  platform: GitPlatform;
  host: string;
  groupPath: string;
  groupName: string;
} {
  const platform = detectPlatformFromRemote(url);

  let host = 'gitlab.com';
  let groupPath = '';

  // Remove trailing slashes and .git
  url = url.replace(/\/+$/, '').replace(/\.git$/, '');

  if (url.includes('gitlab.com')) {
    host = 'gitlab.com';
    const match = url.match(/gitlab\.com\/(.+)$/);
    groupPath = match?.[1] || '';
  } else if (url.includes('github.com')) {
    host = 'github.com';
    const match = url.match(/github\.com\/(.+)$/);
    groupPath = match?.[1] || '';
  }

  const parts = groupPath.split('/');
  const groupName = parts[parts.length - 1] || groupPath;

  return {
    platform,
    host,
    groupPath,
    groupName,
  };
}

/**
 * Fetch projects from GitLab group
 * Falls back to project search if group projects API fails
 */
async function fetchGitLabProjects(
  groupPath: string,
  token: string,
  apiUrl: string = 'https://gitlab.com/api/v4',
  verbose: boolean = false
): Promise<ProjectInfo[]> {
  const encodedPath = encodeURIComponent(groupPath);

  // Try group projects API first
  let url = `${apiUrl}/groups/${encodedPath}/projects?include_subgroups=false&per_page=100`;

  if (verbose) {
    console.log(chalk.gray(`  Trying: ${url}`));
  }

  let response = await fetch(url, {
    headers: {
      'PRIVATE-TOKEN': token,
      'Accept': 'application/json',
    },
  });

  if (response.ok) {
    return response.json() as Promise<ProjectInfo[]>;
  }

  // Store error info before trying fallback
  const groupApiStatus = response.status;
  const groupApiError = await response.text();

  // Fallback: search for projects in this namespace
  if (groupApiStatus === 404) {
    if (verbose) {
      console.log(chalk.gray('  Group API failed, trying project search...'));
    }

    // Search for projects that start with the group path
    url = `${apiUrl}/projects?search=${encodeURIComponent(groupPath.split('/').pop() || '')}&membership=true&per_page=100`;

    if (verbose) {
      console.log(chalk.gray(`  Trying: ${url}`));
    }

    const searchResponse = await fetch(url, {
      headers: {
        'PRIVATE-TOKEN': token,
        'Accept': 'application/json',
      },
    });

    if (searchResponse.ok) {
      const allProjects = await searchResponse.json() as ProjectInfo[];

      if (verbose) {
        console.log(chalk.gray(`  Found ${allProjects.length} projects in search results`));
        if (allProjects.length > 0) {
          console.log(chalk.gray(`  Sample paths:`));
          allProjects.slice(0, 5).forEach(p => {
            console.log(chalk.gray(`    - ${p.path_with_namespace}`));
          });
        }
      }

      // Filter to only projects under our group path
      const filtered = allProjects.filter(p =>
        p.path_with_namespace.startsWith(groupPath + '/')
      );

      if (verbose && filtered.length !== allProjects.length) {
        console.log(chalk.gray(`  After filtering for "${groupPath}/": ${filtered.length} projects`));
      }

      if (filtered.length > 0) {
        return filtered;
      }

      // No projects found under this path - maybe the path is wrong?
      if (allProjects.length > 0) {
        throw new Error(`Found ${allProjects.length} projects but none under "${groupPath}/". Check the group path.`);
      }

      throw new Error(`No projects found. Token may need "read_api" scope.`);
    }

    const searchError = await searchResponse.text();
    throw new Error(`GitLab API error (${searchResponse.status}): ${searchError}`);
  }

  throw new Error(`GitLab API error (${groupApiStatus}): ${groupApiError}`);
}

/**
 * Fetch group info from GitLab
 * Falls back to namespace API if group API fails
 */
async function fetchGitLabGroup(
  groupPath: string,
  token: string,
  apiUrl: string = 'https://gitlab.com/api/v4'
): Promise<GroupInfo> {
  const encodedPath = encodeURIComponent(groupPath);

  // Try groups API first
  let url = `${apiUrl}/groups/${encodedPath}`;
  let response = await fetch(url, {
    headers: {
      'PRIVATE-TOKEN': token,
      'Accept': 'application/json',
    },
  });

  if (response.ok) {
    return response.json() as Promise<GroupInfo>;
  }

  // Store error before trying fallback
  const groupApiStatus = response.status;
  const groupApiError = await response.text();

  // If 404, try namespaces API (works for both groups and subgroups)
  if (groupApiStatus === 404) {
    url = `${apiUrl}/namespaces?search=${encodeURIComponent(groupPath.split('/').pop() || groupPath)}`;
    const nsResponse = await fetch(url, {
      headers: {
        'PRIVATE-TOKEN': token,
        'Accept': 'application/json',
      },
    });

    if (nsResponse.ok) {
      const namespaces = await nsResponse.json() as any[];
      const match = namespaces.find((ns: any) => ns.full_path === groupPath);
      if (match) {
        return {
          id: match.id,
          name: match.name,
          path: match.path,
          full_path: match.full_path,
          description: match.description,
        };
      }
    }
  }

  throw new Error(`GitLab API error (${groupApiStatus}): ${groupApiError}`);
}

/**
 * Clone a single repository with progress
 */
function cloneRepo(
  cloneUrl: string,
  targetPath: string,
  onProgress: (message: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['clone', '--progress', cloneUrl, targetPath];

    const git = spawn('git', args, {
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let stderrOutput = '';
    let lastProgress = '';

    git.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderrOutput += text;

      const lines = text.split(/\r|\n/).filter(l => l.trim());
      for (const line of lines) {
        if (line.includes('Receiving objects')) {
          const match = line.match(/(\d+)%/);
          if (match && match[1] !== lastProgress) {
            lastProgress = match[1];
            onProgress(`Receiving: ${match[1]}%`);
          }
        } else if (line.includes('Resolving deltas')) {
          const match = line.match(/(\d+)%/);
          if (match) {
            onProgress(`Resolving: ${match[1]}%`);
          }
        }
      }
    });

    git.on('error', (error) => {
      reject(new Error(`Failed to start git: ${error.message}`));
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const errorLines = stderrOutput.split('\n').filter(l =>
          l.includes('fatal:') || l.includes('error:')
        );
        reject(new Error(errorLines.join('\n') || `Git clone failed with code ${code}`));
      }
    });
  });
}

export function cloneGroupCommand(): Command {
  const cmd = new Command('clone-group');

  cmd
    .description('Clone all repositories in a GitLab group/subgroup')
    .argument('<url>', 'Group URL (e.g., https://gitlab.com/org/subgroup)')
    .argument('[directory]', 'Target directory (defaults to group name)')
    .option('--no-init', 'Skip CV-Git initialization after cloning')
    .option('--parallel <n>', 'Number of parallel clones (default: 1)', parseInt, 1)
    .option('--dry-run', 'Show what would be cloned without actually cloning')
    .option('--repos <names>', 'Comma-separated list of repo names to clone (bypasses API)');

  addGlobalOptions(cmd);

  cmd.action(async (url: string, directory: string | undefined, options) => {
    const output = createOutput(options);
    const spinner = output.spinner('Parsing group URL...').start();

    try {
      // Parse the URL
      const groupInfo = parseGroupUrl(url);
      const targetDir = directory || groupInfo.groupName;
      const targetPath = path.resolve(process.cwd(), targetDir);

      if (groupInfo.platform !== GitPlatform.GITLAB) {
        spinner.fail('Currently only GitLab groups are supported');
        console.log(chalk.yellow('GitHub organization support coming soon!'));
        process.exit(1);
      }

      spinner.text = `Detected: ${groupInfo.platform} group "${groupInfo.groupPath}"`;

      // Get credentials
      spinner.start('Retrieving credentials...');
      const credentialManager = new CredentialManager();
      const token = await credentialManager.getGitPlatformToken(groupInfo.platform);

      if (!token) {
        spinner.fail('No GitLab credentials found');
        console.log(chalk.yellow('Run: cv auth setup gitlab'));
        process.exit(1);
      }

      spinner.succeed('Credentials loaded');

      // Fetch group info and projects
      spinner.start('Fetching group information...');
      const apiUrl = getDefaultApiUrl(groupInfo.platform);

      if (options.verbose) {
        console.log(chalk.gray(`  API URL: ${apiUrl}`));
        console.log(chalk.gray(`  Group path: ${groupInfo.groupPath}`));
      }

      let group: GroupInfo | null = null;
      let projects: ProjectInfo[] = [];

      // If --repos is specified, build project list manually (bypass API)
      if (options.repos) {
        const repoNames = options.repos.split(',').map((r: string) => r.trim());
        spinner.succeed(`Using manually specified repos: ${repoNames.join(', ')}`);

        projects = repoNames.map((name: string) => ({
          id: 0,
          name,
          path: name,
          path_with_namespace: `${groupInfo.groupPath}/${name}`,
          http_url_to_repo: `https://${groupInfo.host}/${groupInfo.groupPath}/${name}.git`,
          ssh_url_to_repo: `git@${groupInfo.host}:${groupInfo.groupPath}/${name}.git`,
          description: null,
        }));
      } else {
        // Try to get group info first
        try {
          group = await fetchGitLabGroup(groupInfo.groupPath, token, apiUrl);
          spinner.succeed(`Found group: ${group.name}`);
        } catch (error: any) {
          if (options.verbose) {
            console.log(chalk.gray(`  Group lookup failed: ${error.message}`));
            console.log(chalk.gray(`  Trying to find projects directly...`));
          }
          spinner.text = 'Group not accessible, searching for projects...';
        }

        // Fetch projects - this might work even if group lookup failed
        spinner.start('Fetching projects...');
        try {
          projects = await fetchGitLabProjects(groupInfo.groupPath, token, apiUrl, options.verbose);
        } catch (error: any) {
          spinner.fail(`Failed to fetch projects: ${error.message}`);
          console.log();
          console.log(chalk.yellow('Possible causes:'));
          console.log(chalk.gray('  1. Token needs "read_api" scope'));
          console.log(chalk.gray('  2. You don\'t have access to this group'));
          console.log(chalk.gray('  3. The group path is incorrect'));
          console.log();
          console.log(chalk.yellow('Workaround: Specify repos manually:'));
          console.log(chalk.cyan(`  cv clone-group ${url} --repos repo1,repo2,repo3`));
          console.log();
          process.exit(1);
        }
      }

      if (projects.length === 0) {
        spinner.warn('No projects found in this group');
        process.exit(0);
      }

      spinner.succeed(`Found ${projects.length} project(s)`);

      // Display projects
      console.log();
      console.log(chalk.cyan('Projects to clone:'));
      for (const project of projects) {
        console.log(chalk.gray(`  • ${project.name} - ${project.description || 'No description'}`));
      }
      console.log();

      if (options.dryRun) {
        console.log(chalk.yellow('Dry run - no repositories were cloned'));
        console.log(chalk.gray(`Would clone to: ${targetPath}/`));
        process.exit(0);
      }

      // Create target directory
      await ensureDir(targetPath);

      // Clone each project
      console.log(chalk.bold(`Cloning ${projects.length} repositories to ${targetPath}/`));
      console.log();

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < projects.length; i++) {
        const project = projects[i];
        const projectPath = path.join(targetPath, project.path);
        const progress = `[${i + 1}/${projects.length}]`;

        // Check if already exists
        if (fs.existsSync(projectPath)) {
          console.log(chalk.yellow(`${progress} ${project.name} - already exists, skipping`));
          continue;
        }

        spinner.start(`${progress} Cloning ${project.name}...`);

        // Build authenticated URL
        const authUrl = project.http_url_to_repo.replace(
          `https://${groupInfo.host}/`,
          `https://oauth2:${token}@${groupInfo.host}/`
        );

        try {
          await cloneRepo(authUrl, projectPath, (msg) => {
            spinner.text = `${progress} Cloning ${project.name}... ${chalk.gray(msg)}`;
          });

          spinner.succeed(`${progress} ${project.name}`);
          successCount++;

          // Initialize CV-Git if not disabled
          if (options.init !== false) {
            try {
              const cvDir = getCVDir(projectPath);
              await ensureDir(cvDir);
              await configManager.init(projectPath, project.name);
              await configManager.update({
                platform: {
                  type: groupInfo.platform,
                  url: getDefaultWebUrl(groupInfo.platform)
                }
              } as any);
              await ensureDir(path.join(cvDir, 'cache'));
              await ensureDir(path.join(cvDir, 'sessions'));
            } catch (initError) {
              // Silent fail on init - clone succeeded
            }
          }

        } catch (error: any) {
          spinner.fail(`${progress} ${project.name} - ${error.message}`);
          failCount++;
        }
      }

      // Summary
      console.log();
      console.log(chalk.bold('Summary:'));
      console.log(chalk.green(`  ✓ ${successCount} cloned successfully`));
      if (failCount > 0) {
        console.log(chalk.red(`  ✗ ${failCount} failed`));
      }
      console.log();
      console.log(chalk.bold('Next steps:'));
      console.log(chalk.gray(`  cd ${targetDir}`));
      console.log(chalk.cyan('  cv sync  # in each project directory'));
      console.log();

      // Output JSON if requested
      if (output.isJson) {
        output.json({
          success: true,
          group: group ? {
            name: group.name,
            path: group.full_path,
          } : {
            name: groupInfo.groupName,
            path: groupInfo.groupPath,
          },
          directory: targetPath,
          projects: projects.map(p => ({
            name: p.name,
            path: p.path,
            cloned: fs.existsSync(path.join(targetPath, p.path)),
          })),
          successCount,
          failCount,
        });
      }

    } catch (error: any) {
      spinner.fail('Clone group failed');
      output.error('Failed to clone group', error);
      process.exit(1);
    }
  });

  return cmd;
}

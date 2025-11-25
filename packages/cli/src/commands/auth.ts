/**
 * cv auth - Credential Management Command
 *
 * Manages credentials for git platforms and AI services.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import Table from 'cli-table3';
import {
  CredentialManager,
  CredentialType,
  GitPlatform,
  GitPlatformTokenCredential,
  AnthropicAPICredential,
  OpenAIAPICredential,
  OpenRouterAPICredential,
} from '@cv-git/credentials';
import { GitHubAdapter, GitLabAdapter, BitbucketAdapter } from '@cv-git/platform';
import { randomBytes } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Open URL in default browser
 */
async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let command: string;

  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else {
    // Check for WSL
    try {
      const { stdout } = await execAsync('cat /proc/version');
      if (stdout.toLowerCase().includes('microsoft') || stdout.toLowerCase().includes('wsl')) {
        // WSL detected - use cmd.exe to open in Windows browser
        command = `cmd.exe /c start "" "${url.replace(/&/g, '^&')}"`;
      } else {
        command = `xdg-open "${url}"`;
      }
    } catch {
      command = `xdg-open "${url}"`;
    }
  }

  try {
    await execAsync(command);
  } catch (error) {
    // Browser open failed, user will need to open manually
  }
}

export function authCommand(): Command {
  const cmd = new Command('auth').description(
    'Manage credentials and authentication'
  );

  // cv auth setup
  cmd
    .command('setup [service]')
    .description(
      'Set up authentication (services: github, gitlab, bitbucket, anthropic, openai, openrouter, all)'
    )
    .option('--no-browser', 'Do not open browser automatically')
    .action(async (service?: string, cmdOptions?: { browser?: boolean }) => {
      const autoBrowser = cmdOptions?.browser !== false;
      console.log(chalk.bold.blue('\n🔐 CV-Git Authentication Setup\n'));

      const credentials = new CredentialManager();
      await credentials.init();

      // Migrate from environment variables first
      console.log('Checking for environment variables to migrate...');
      const { migrated, skipped } = await credentials.migrateFromEnv();

      if (migrated.length > 0) {
        console.log(chalk.green('\n✓ Migrated from environment variables:'));
        migrated.forEach((env) => console.log(chalk.green(`  - ${env}`)));
      }

      if (skipped.length > 0 && migrated.length > 0) {
        console.log(chalk.gray('\nSkipped (already exists or not set):'));
        skipped.forEach((env) => console.log(chalk.gray(`  - ${env}`)));
      }

      console.log();

      // Setup services
      const setupAll = !service || service === 'all';

      if (setupAll || service === 'github') {
        await setupGitHub(credentials, autoBrowser);
      }

      if (setupAll || service === 'gitlab') {
        await setupGitLab(credentials, autoBrowser);
      }

      if (setupAll || service === 'bitbucket') {
        await setupBitbucket(credentials, autoBrowser);
      }

      if (setupAll || service === 'anthropic') {
        await setupAnthropic(credentials, autoBrowser);
      }

      if (setupAll || service === 'openai') {
        await setupOpenAI(credentials, autoBrowser);
      }

      if (setupAll || service === 'openrouter') {
        await setupOpenRouter(credentials, autoBrowser);
      }

      console.log(chalk.bold.green('\n✅ Authentication setup complete!\n'));
      console.log(
        chalk.gray('Run ') +
          chalk.cyan('cv auth list') +
          chalk.gray(' to verify stored credentials.')
      );
    });

  // cv auth list
  cmd
    .command('list')
    .description('List all stored credentials')
    .action(async () => {
      const credentials = new CredentialManager();
      await credentials.init();

      const list = await credentials.list();

      if (list.length === 0) {
        console.log(chalk.yellow('\nNo credentials stored.'));
        console.log(chalk.gray('Run: ') + chalk.cyan('cv auth setup'));
        return;
      }

      console.log(chalk.bold('\n🔑 Stored Credentials:\n'));

      const table = new Table({
        head: [
          chalk.cyan('Type'),
          chalk.cyan('Name'),
          chalk.cyan('Created'),
          chalk.cyan('Last Used'),
        ],
        colWidths: [25, 25, 20, 20],
      });

      for (const cred of list) {
        const createdDate = new Date(cred.createdAt).toLocaleDateString();
        const lastUsedDate = cred.lastUsed
          ? new Date(cred.lastUsed).toLocaleDateString()
          : chalk.gray('never');

        table.push([cred.type, cred.name, createdDate, lastUsedDate]);
      }

      console.log(table.toString());
      console.log();
    });

  // cv auth test
  cmd
    .command('test <service>')
    .description('Test authentication for a service (github, gitlab, bitbucket, anthropic, openai)')
    .action(async (service: string) => {
      const credentials = new CredentialManager();
      await credentials.init();

      const spinner = ora('Testing authentication...').start();

      try {
        if (service === 'github') {
          const token = await credentials.getGitPlatformToken(GitPlatform.GITHUB);
          if (!token) {
            spinner.fail(chalk.red('GitHub token not found'));
            console.log(chalk.gray('Run: ') + chalk.cyan('cv auth setup github'));
            return;
          }

          const adapter = new GitHubAdapter(credentials);
          const user = await adapter.validateToken(token);

          spinner.succeed(chalk.green('GitHub authentication valid'));
          console.log(
            chalk.gray('  Authenticated as: ') +
              chalk.white(`${user.username} (${user.name || 'no name'})`)
          );
        } else if (service === 'gitlab') {
          const token = await credentials.getGitPlatformToken(GitPlatform.GITLAB);
          if (!token) {
            spinner.fail(chalk.red('GitLab token not found'));
            console.log(chalk.gray('Run: ') + chalk.cyan('cv auth setup gitlab'));
            return;
          }

          const adapter = new GitLabAdapter(credentials);
          const user = await adapter.validateToken(token);

          spinner.succeed(chalk.green('GitLab authentication valid'));
          console.log(
            chalk.gray('  Authenticated as: ') +
              chalk.white(`${user.username} (${user.name || 'no name'})`)
          );
        } else if (service === 'bitbucket') {
          const token = await credentials.getGitPlatformToken(GitPlatform.BITBUCKET);
          if (!token) {
            spinner.fail(chalk.red('Bitbucket app password not found'));
            console.log(chalk.gray('Run: ') + chalk.cyan('cv auth setup bitbucket'));
            return;
          }

          const adapter = new BitbucketAdapter(credentials);
          const user = await adapter.validateToken(token);

          spinner.succeed(chalk.green('Bitbucket authentication valid'));
          console.log(
            chalk.gray('  Authenticated as: ') +
              chalk.white(`${user.username} (${user.name || 'no name'})`)
          );
        } else if (service === 'anthropic') {
          const key = await credentials.getAnthropicKey();
          if (!key) {
            spinner.fail(chalk.red('Anthropic API key not found'));
            console.log(
              chalk.gray('Run: ') + chalk.cyan('cv auth setup anthropic')
            );
            return;
          }

          // Simple validation (just check format)
          if (key.startsWith('sk-ant-')) {
            spinner.succeed(chalk.green('Anthropic API key found'));
            console.log(
              chalk.gray('  Key: ') + chalk.white(key.substring(0, 20) + '...')
            );
          } else {
            spinner.fail(chalk.red('Anthropic API key invalid format'));
          }
        } else if (service === 'openai') {
          const key = await credentials.getOpenAIKey();
          if (!key) {
            spinner.fail(chalk.red('OpenAI API key not found'));
            console.log(
              chalk.gray('Run: ') + chalk.cyan('cv auth setup openai')
            );
            return;
          }

          if (key.startsWith('sk-')) {
            spinner.succeed(chalk.green('OpenAI API key found'));
            console.log(
              chalk.gray('  Key: ') + chalk.white(key.substring(0, 20) + '...')
            );
          } else {
            spinner.fail(chalk.red('OpenAI API key invalid format'));
          }
        } else {
          spinner.fail(chalk.red(`Unknown service: ${service}`));
        }
      } catch (error: any) {
        spinner.fail(chalk.red(`Authentication test failed: ${error.message}`));
      }
    });

  // cv auth remove
  cmd
    .command('remove <type> <name>')
    .description('Remove a credential')
    .action(async (type: string, name: string) => {
      const credentials = new CredentialManager();
      await credentials.init();

      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Are you sure you want to remove ${type}:${name}?`,
          default: false,
        },
      ]);

      if (!confirm) {
        console.log(chalk.gray('Cancelled.'));
        return;
      }

      const spinner = ora('Removing credential...').start();

      try {
        await credentials.delete(type as CredentialType, name);
        spinner.succeed(chalk.green(`Removed ${type}:${name}`));
      } catch (error: any) {
        spinner.fail(chalk.red(`Failed to remove: ${error.message}`));
      }
    });

  return cmd;
}

// ============================================================================
// Setup Functions
// ============================================================================

async function setupGitHub(credentials: CredentialManager, autoBrowser: boolean = true): Promise<void> {
  console.log(chalk.bold('──────────────────────────────────────────'));
  console.log(chalk.bold.cyan('GitHub Authentication'));
  console.log(chalk.bold('──────────────────────────────────────────\n'));

  const url = 'https://github.com/settings/tokens/new?scopes=repo,workflow,write:packages';

  if (autoBrowser) {
    console.log(chalk.cyan('Opening browser to create token...'));
    await openBrowser(url);
    console.log();
  }

  console.log(chalk.gray('URL: ') + chalk.blue(url));
  console.log(chalk.gray('1. Generate a Personal Access Token'));
  console.log(chalk.gray('2. Copy the token (it starts with ') + chalk.white('ghp_') + chalk.gray(')'));
  console.log();

  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: 'Enter your GitHub token:',
      validate: (input: string) => {
        if (!input || !input.trim()) {
          return 'Token is required';
        }
        if (!input.startsWith('ghp_')) {
          return 'Invalid GitHub token format (should start with ghp_)';
        }
        return true;
      },
    },
  ]);

  const spinner = ora('Validating token...').start();

  try {
    const adapter = new GitHubAdapter(credentials);
    const user = await adapter.validateToken(token);
    const scopes = await adapter.getTokenScopes(token);

    spinner.succeed(chalk.green(`Token validated for user: ${user.username}`));
    console.log(chalk.gray('  Token scopes: ') + chalk.white(scopes.join(', ')));

    // Store token
    await credentials.store<GitPlatformTokenCredential>({
      type: CredentialType.GIT_PLATFORM_TOKEN,
      name: `github-${user.username}`,
      platform: GitPlatform.GITHUB,
      token,
      scopes,
      username: user.username,
    });

    console.log(chalk.green('✅ GitHub authentication configured!\n'));
  } catch (error: any) {
    spinner.fail(chalk.red(`Token validation failed: ${error.message}`));
    console.log(chalk.yellow('\nPlease try again with a valid token.\n'));
  }
}

async function setupAnthropic(credentials: CredentialManager, autoBrowser: boolean = true): Promise<void> {
  console.log(chalk.bold('──────────────────────────────────────────'));
  console.log(chalk.bold.cyan('Anthropic Authentication'));
  console.log(chalk.bold('──────────────────────────────────────────\n'));

  const url = 'https://console.anthropic.com/settings/keys';

  if (autoBrowser) {
    console.log(chalk.cyan('Opening browser to get API key...'));
    await openBrowser(url);
    console.log();
  }

  console.log(chalk.gray('URL: ') + chalk.blue(url));
  console.log(chalk.gray('Copy your API key (starts with ') + chalk.white('sk-ant-') + chalk.gray(')'));
  console.log();

  const { apiKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: 'Enter your Anthropic API key:',
      validate: (input: string) => {
        if (!input || !input.trim()) {
          return 'API key is required';
        }
        if (!input.startsWith('sk-ant-')) {
          return 'Invalid Anthropic API key format (should start with sk-ant-)';
        }
        return true;
      },
    },
  ]);

  await credentials.store<AnthropicAPICredential>({
    type: CredentialType.ANTHROPIC_API,
    name: 'default',
    apiKey,
  });

  console.log(chalk.green('✅ Anthropic authentication configured!\n'));
}

async function setupOpenAI(credentials: CredentialManager, autoBrowser: boolean = true): Promise<void> {
  console.log(chalk.bold('──────────────────────────────────────────'));
  console.log(chalk.bold.cyan('OpenAI Authentication'));
  console.log(chalk.bold('──────────────────────────────────────────\n'));

  const url = 'https://platform.openai.com/api-keys';

  if (autoBrowser) {
    console.log(chalk.cyan('Opening browser to get API key...'));
    await openBrowser(url);
    console.log();
  }

  console.log(chalk.gray('URL: ') + chalk.blue(url));
  console.log(chalk.gray('Copy your API key (starts with ') + chalk.white('sk-') + chalk.gray(')'));
  console.log();

  const { apiKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: 'Enter your OpenAI API key:',
      validate: (input: string) => {
        if (!input || !input.trim()) {
          return 'API key is required';
        }
        if (!input.startsWith('sk-')) {
          return 'Invalid OpenAI API key format (should start with sk-)';
        }
        return true;
      },
    },
  ]);

  await credentials.store<OpenAIAPICredential>({
    type: CredentialType.OPENAI_API,
    name: 'default',
    apiKey,
  });

  console.log(chalk.green('✅ OpenAI authentication configured!\n'));
}

async function setupOpenRouter(credentials: CredentialManager, autoBrowser: boolean = true): Promise<void> {
  console.log(chalk.bold('──────────────────────────────────────────'));
  console.log(chalk.bold.cyan('OpenRouter Authentication'));
  console.log(chalk.bold('──────────────────────────────────────────\n'));

  const url = 'https://openrouter.ai/keys';

  if (autoBrowser) {
    console.log(chalk.cyan('Opening browser to get API key...'));
    await openBrowser(url);
    console.log();
  }

  console.log(chalk.gray('URL: ') + chalk.blue(url));
  console.log(chalk.gray('Copy your API key (starts with ') + chalk.white('sk-or-') + chalk.gray(')'));
  console.log();

  const { apiKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: 'Enter your OpenRouter API key:',
      validate: (input: string) => {
        if (!input || !input.trim()) {
          return 'API key is required';
        }
        if (!input.startsWith('sk-or-')) {
          return 'Invalid OpenRouter API key format (should start with sk-or-)';
        }
        return true;
      },
    },
  ]);

  await credentials.store<OpenRouterAPICredential>({
    type: CredentialType.OPENROUTER_API,
    name: 'default',
    apiKey,
  });

  console.log(chalk.green('✅ OpenRouter authentication configured!\n'));
}

/**
 * Detect GitLab token type by testing various API endpoints
 */
async function detectGitLabTokenType(token: string): Promise<{
  type: 'personal' | 'group' | 'project' | 'unknown';
  username?: string;
  groupPath?: string;
  projectPath?: string;
  scopes: string[];
}> {
  const headers = {
    'PRIVATE-TOKEN': token,
    'Accept': 'application/json',
  };

  // Try /user endpoint - only works with Personal Access Tokens
  try {
    const userResponse = await fetch('https://gitlab.com/api/v4/user', { headers });
    if (userResponse.ok) {
      const user = await userResponse.json() as { username: string };

      // Get scopes from personal access token info
      let scopes: string[] = [];
      try {
        const tokenResponse = await fetch('https://gitlab.com/api/v4/personal_access_tokens/self', { headers });
        if (tokenResponse.ok) {
          const tokenInfo = await tokenResponse.json() as { scopes: string[] };
          scopes = tokenInfo.scopes || [];
        }
      } catch {}

      return {
        type: 'personal',
        username: user.username,
        scopes,
      };
    }
  } catch {}

  // If /user fails, try to detect group/project token by checking accessible groups
  try {
    const groupsResponse = await fetch('https://gitlab.com/api/v4/groups?min_access_level=10&per_page=1', { headers });
    if (groupsResponse.ok) {
      const groups = await groupsResponse.json() as Array<{ full_path: string }>;
      if (groups.length > 0) {
        return {
          type: 'group',
          groupPath: groups[0].full_path,
          scopes: ['api', 'read_api'], // Group tokens typically have these
        };
      }
    }
  } catch {}

  // Try to detect project token
  try {
    const projectsResponse = await fetch('https://gitlab.com/api/v4/projects?membership=true&per_page=1', { headers });
    if (projectsResponse.ok) {
      const projects = await projectsResponse.json() as Array<{ path_with_namespace: string }>;
      if (projects.length > 0) {
        return {
          type: 'project',
          projectPath: projects[0].path_with_namespace,
          scopes: [],
        };
      }
    }
  } catch {}

  return { type: 'unknown', scopes: [] };
}

async function setupGitLab(credentials: CredentialManager, autoBrowser: boolean = true): Promise<void> {
  console.log(chalk.bold('──────────────────────────────────────────'));
  console.log(chalk.bold.cyan('GitLab Authentication'));
  console.log(chalk.bold('──────────────────────────────────────────\n'));

  // Explain token types
  console.log(chalk.yellow('GitLab Token Types:\n'));
  console.log(chalk.green('  Personal Access Token (Recommended)'));
  console.log(chalk.gray('    - Full access to all your projects and groups'));
  console.log(chalk.gray('    - Can list projects, clone, push, and use APIs'));
  console.log(chalk.gray('    - Created at: gitlab.com/-/user_settings/personal_access_tokens'));
  console.log();
  console.log(chalk.cyan('  Group Access Token'));
  console.log(chalk.gray('    - Limited to a specific group and its projects'));
  console.log(chalk.gray('    - Cannot use /user API (cv auth test will fail)'));
  console.log(chalk.gray('    - Created at: Group → Settings → Access Tokens'));
  console.log();
  console.log(chalk.cyan('  Project Access Token'));
  console.log(chalk.gray('    - Limited to a single project'));
  console.log(chalk.gray('    - Most restrictive - only for single repo access'));
  console.log(chalk.gray('    - Created at: Project → Settings → Access Tokens'));
  console.log();

  const url = 'https://gitlab.com/-/user_settings/personal_access_tokens?scopes=api,read_user,read_repository,write_repository';

  if (autoBrowser) {
    console.log(chalk.cyan('Opening browser to create Personal Access Token...'));
    await openBrowser(url);
    console.log();
  }

  console.log(chalk.gray('URL: ') + chalk.blue(url));
  console.log(chalk.gray('Required scopes: ') + chalk.white('api, read_user, read_repository, write_repository'));
  console.log();

  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: 'Enter your GitLab token:',
      validate: (input: string) => {
        if (!input || !input.trim()) {
          return 'Token is required';
        }
        if (!input.startsWith('glpat-')) {
          return 'Invalid GitLab token format (should start with glpat-)';
        }
        return true;
      },
    },
  ]);

  const spinner = ora('Detecting token type...').start();

  try {
    const tokenInfo = await detectGitLabTokenType(token);

    if (tokenInfo.type === 'personal') {
      spinner.succeed(chalk.green(`Personal Access Token detected`));
      console.log(chalk.gray('  User: ') + chalk.white(tokenInfo.username));
      if (tokenInfo.scopes.length > 0) {
        console.log(chalk.gray('  Scopes: ') + chalk.white(tokenInfo.scopes.join(', ')));
      }

      // Check for required scopes
      const requiredScopes = ['api', 'read_api'];
      const hasRequiredScopes = requiredScopes.some(s => tokenInfo.scopes.includes(s));
      if (!hasRequiredScopes && tokenInfo.scopes.length > 0) {
        console.log();
        console.log(chalk.yellow('⚠ Warning: Token may be missing "api" or "read_api" scope'));
        console.log(chalk.gray('  Some features like "cv clone-group" require API access'));
      }

      // Store token
      await credentials.store<GitPlatformTokenCredential>({
        type: CredentialType.GIT_PLATFORM_TOKEN,
        name: `gitlab-${tokenInfo.username}`,
        platform: GitPlatform.GITLAB,
        token,
        scopes: tokenInfo.scopes,
        username: tokenInfo.username,
      });

      console.log(chalk.green('\n✅ GitLab authentication configured!\n'));

    } else if (tokenInfo.type === 'group') {
      spinner.warn(chalk.yellow(`Group Access Token detected`));
      console.log(chalk.gray('  Group: ') + chalk.white(tokenInfo.groupPath));
      console.log();
      console.log(chalk.yellow('⚠ Limitations of Group Access Tokens:'));
      console.log(chalk.gray('  - "cv auth test gitlab" will fail (no /user access)'));
      console.log(chalk.gray('  - "cv clone-group" may have limited functionality'));
      console.log(chalk.gray('  - Can only access projects within this group'));
      console.log();

      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Continue with Group Access Token? (Personal Access Token is recommended)',
          default: true,
        },
      ]);

      if (proceed) {
        await credentials.store<GitPlatformTokenCredential>({
          type: CredentialType.GIT_PLATFORM_TOKEN,
          name: `gitlab-group-${tokenInfo.groupPath?.replace(/\//g, '-') || 'unknown'}`,
          platform: GitPlatform.GITLAB,
          token,
          scopes: tokenInfo.scopes,
        });
        console.log(chalk.green('\n✅ GitLab Group Token configured!\n'));
      } else {
        console.log(chalk.gray('\nPlease create a Personal Access Token at:'));
        console.log(chalk.blue(url));
        console.log();
      }

    } else if (tokenInfo.type === 'project') {
      spinner.warn(chalk.yellow(`Project Access Token detected`));
      console.log(chalk.gray('  Project: ') + chalk.white(tokenInfo.projectPath));
      console.log();
      console.log(chalk.yellow('⚠ Limitations of Project Access Tokens:'));
      console.log(chalk.gray('  - Can only access a single project'));
      console.log(chalk.gray('  - "cv clone-group" will not work'));
      console.log(chalk.gray('  - Limited API functionality'));
      console.log();

      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Continue with Project Access Token? (Personal Access Token is recommended)',
          default: false,
        },
      ]);

      if (proceed) {
        await credentials.store<GitPlatformTokenCredential>({
          type: CredentialType.GIT_PLATFORM_TOKEN,
          name: `gitlab-project-${tokenInfo.projectPath?.replace(/\//g, '-') || 'unknown'}`,
          platform: GitPlatform.GITLAB,
          token,
          scopes: [],
        });
        console.log(chalk.green('\n✅ GitLab Project Token configured!\n'));
      } else {
        console.log(chalk.gray('\nPlease create a Personal Access Token at:'));
        console.log(chalk.blue(url));
        console.log();
      }

    } else {
      spinner.fail(chalk.red('Could not validate token'));
      console.log(chalk.yellow('\nThe token could not be validated. Possible reasons:'));
      console.log(chalk.gray('  - Token is invalid or expired'));
      console.log(chalk.gray('  - Token has insufficient permissions'));
      console.log(chalk.gray('  - Network connectivity issue'));
      console.log();
      console.log(chalk.gray('Please create a new Personal Access Token at:'));
      console.log(chalk.blue(url));
      console.log();
    }
  } catch (error: any) {
    spinner.fail(chalk.red(`Token validation failed: ${error.message}`));
    console.log(chalk.yellow('\nPlease try again with a valid token.\n'));
  }
}

async function setupBitbucket(credentials: CredentialManager, autoBrowser: boolean = true): Promise<void> {
  console.log(chalk.bold('──────────────────────────────────────────'));
  console.log(chalk.bold.cyan('Bitbucket Authentication'));
  console.log(chalk.bold('──────────────────────────────────────────\n'));

  const url = 'https://bitbucket.org/account/settings/app-passwords/new';

  if (autoBrowser) {
    console.log(chalk.cyan('Opening browser to create app password...'));
    await openBrowser(url);
    console.log();
  }

  console.log(chalk.gray('URL: ') + chalk.blue(url));
  console.log(chalk.gray('1. Create an App Password with permissions: Repositories (Read, Write), Pull requests (Read, Write)'));
  console.log(chalk.gray('2. Copy the generated app password'));
  console.log();

  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: 'Enter your Bitbucket app password:',
      validate: (input: string) => {
        if (!input || !input.trim()) {
          return 'App password is required';
        }
        return true;
      },
    },
  ]);

  const spinner = ora('Validating app password...').start();

  try {
    const adapter = new BitbucketAdapter(credentials);
    const user = await adapter.validateToken(token);

    spinner.succeed(chalk.green(`App password validated for user: ${user.username}`));

    // Store token
    await credentials.store<GitPlatformTokenCredential>({
      type: CredentialType.GIT_PLATFORM_TOKEN,
      name: `bitbucket-${user.username}`,
      platform: GitPlatform.BITBUCKET,
      token,
      scopes: ['repository', 'pullrequest'],
      username: user.username,
    });

    console.log(chalk.green('✅ Bitbucket authentication configured!\n'));
  } catch (error: any) {
    spinner.fail(chalk.red(`App password validation failed: ${error.message}`));
    console.log(chalk.yellow('\nPlease try again with a valid app password.\n'));
  }
}

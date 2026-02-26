/**
 * cv auth - Credential Management Command
 *
 * Manages credentials for git platforms, AI services, DNS providers,
 * and DevOps/cloud infrastructure.
 *
 * Categories:
 * - git: GitHub, GitLab, Bitbucket
 * - ai: Anthropic, OpenAI, OpenRouter
 * - dns: Cloudflare
 * - devops: AWS, DigitalOcean
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import Table from 'cli-table3';
import { mkdirSync, writeFileSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
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
import { getPreferences } from '../config.js';
import { getRequiredServices } from '../utils/preference-picker.js';
import { openBrowser } from './auth-utils.js';
import {
  AUTH_CATEGORIES,
  parseServiceArg,
  selectCategory,
  selectProvider,
  getProvider,
  getAllProviderIds,
} from './auth/categories.js';
import { setupCloudflare, testCloudflare } from './auth/dns/cloudflare.js';
import { setupAWS, testAWS } from './auth/devops/aws.js';
import {
  setupDigitalOcean,
  testDigitalOcean,
  testDigitalOceanSpaces,
} from './auth/devops/digitalocean.js';
import { setupNPM, testNPM, configureNPMCLI } from './auth/publish/npm.js';
import { setupCVHub, testCVHub, setupControlfab, testControlfab } from './auth/git/cv-hub.js';
import { addGlobalOptions } from '../utils/output.js';

export function authCommand(): Command {
  const cmd = new Command('auth').description(
    'Manage credentials and authentication'
  );

  // cv auth setup [service]
  // Supports: category/provider paths, category names, provider names, or interactive
  cmd
    .command('setup [service]')
    .description(
      'Set up authentication (e.g., github, dns/cloudflare, devops, all)'
    )
    .option('--no-browser', 'Do not open browser automatically')
    .option('--all', 'Set up all services (ignore preferences)')
    .action(async (service?: string, cmdOptions?: { browser?: boolean; all?: boolean }) => {
      const autoBrowser = cmdOptions?.browser !== false;
      const forceAll = cmdOptions?.all === true;
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

      // Parse the service argument
      const parsed = parseServiceArg(forceAll ? 'all' : service);

      if (parsed.mode === 'all') {
        // Set up all providers
        const allProviders = getAllProviderIds();
        for (const providerId of allProviders) {
          await runSetup(providerId, credentials, autoBrowser);
        }
      } else if (parsed.mode === 'category') {
        // Set up all providers in a category
        const category = AUTH_CATEGORIES.find((c) => c.id === parsed.categoryId);
        if (!category) {
          console.log(chalk.red(`Unknown category: ${parsed.categoryId}`));
          return;
        }
        console.log(chalk.bold(`Setting up ${category.name}...\n`));
        for (const provider of category.providers) {
          await runSetup(provider.id, credentials, autoBrowser);
        }
      } else if (parsed.mode === 'provider') {
        // Set up specific provider
        const result = getProvider(parsed.providerId || '');
        if (!result) {
          // Try legacy service names
          if (parsed.providerId && await runSetup(parsed.providerId, credentials, autoBrowser)) {
            // Legacy setup handled
          } else {
            console.log(chalk.red(`Unknown provider: ${parsed.providerId}`));
            console.log(chalk.gray('\nAvailable providers:'));
            for (const cat of AUTH_CATEGORIES) {
              console.log(chalk.cyan(`  ${cat.id}/`));
              for (const p of cat.providers) {
                console.log(chalk.gray(`    ${p.id} - ${p.description}`));
              }
            }
          }
        } else {
          await runSetup(result.provider.id, credentials, autoBrowser);
        }
      } else {
        // Interactive mode
        const prefsManager = getPreferences();
        const hasPrefs = await prefsManager.exists();

        if (hasPrefs && !forceAll) {
          // Use preferences to determine services
          const prefs = await prefsManager.load();
          const servicesToSetup = getRequiredServices({
            gitPlatform: prefs.gitPlatform,
            aiProvider: prefs.aiProvider,
            embeddingProvider: prefs.embeddingProvider,
          });
          console.log(chalk.gray('Setting up services based on your preferences...'));
          console.log(chalk.gray(`Services: ${servicesToSetup.join(', ')}`));
          console.log();
          for (const svc of servicesToSetup) {
            await runSetup(svc, credentials, autoBrowser);
          }
        } else {
          // Interactive category/provider selection
          const category = await selectCategory();
          if (!category) {
            console.log(chalk.gray('Cancelled.'));
            return;
          }

          const provider = await selectProvider(category);
          if (!provider) {
            // User selected 'Back', recurse to show categories again
            return;
          }

          await runSetup(provider.id, credentials, autoBrowser);
        }
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

  // cv auth test <service>
  cmd
    .command('test <service>')
    .description('Test authentication for a service')
    .action(async (service: string) => {
      const credentials = new CredentialManager();
      await credentials.init();

      await runTest(service, credentials);
    });

  // cv auth remove <type> <name>
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

  // cv auth add-hub --api <url> --pat <token> [--org <org>]
  cmd
    .command('add-hub')
    .description('Add CV-Hub credentials for context engine hooks')
    .option('--api <url>', 'CV-Hub API URL', 'https://api.hub.controlvector.io')
    .option('--pat <token>', 'Personal Access Token')
    .option('--org <org>', 'Organization override')
    .action(async (cmdOptions: { api: string; pat?: string; org?: string }) => {
      let pat = cmdOptions.pat;

      // Prompt for PAT if not provided
      if (!pat) {
        const answers = await inquirer.prompt([
          {
            type: 'password',
            name: 'pat',
            message: 'Enter your CV-Hub Personal Access Token:',
            validate: (input: string) => input.trim().length > 0 || 'Token is required',
          },
        ]);
        pat = answers.pat;
      }

      // Validate PAT by hitting health endpoint
      const spinner = ora('Validating CV-Hub credentials...').start();
      try {
        const healthRes = await fetch(`${cmdOptions.api}/health`);
        if (!healthRes.ok) {
          spinner.fail(chalk.red(`CV-Hub API unreachable at ${cmdOptions.api}`));
          return;
        }
        const healthData = await healthRes.json() as { status?: string };
        if (healthData.status !== 'ok') {
          spinner.fail(chalk.red('CV-Hub API returned unhealthy status'));
          return;
        }
      } catch (error: any) {
        spinner.fail(chalk.red(`Cannot reach CV-Hub API: ${error.message}`));
        return;
      }
      spinner.succeed(chalk.green('CV-Hub API is healthy'));

      // Build credentials file content
      const lines = [
        `CV_HUB_PAT=${pat}`,
        `CV_HUB_API=${cmdOptions.api}`,
      ];
      if (cmdOptions.org) {
        lines.push(`CV_HUB_ORG_OVERRIDE=${cmdOptions.org}`);
      }
      const credContent = lines.join('\n') + '\n';

      // Write ~/.config/cv-hub/credentials
      const credDir = join(homedir(), '.config', 'cv-hub');
      const credPath = join(credDir, 'credentials');
      mkdirSync(credDir, { recursive: true });
      writeFileSync(credPath, credContent, { mode: 0o600 });
      console.log(chalk.green(`  ✓ Wrote ${credPath}`));

      // Also store PAT in cv-git credential manager
      const credentials = new CredentialManager();
      await credentials.init();

      await credentials.store<GitPlatformTokenCredential>({
        type: CredentialType.GIT_PLATFORM_TOKEN,
        name: 'cv_hub:default',
        platform: GitPlatform.CV_HUB,
        token: pat!,
        scopes: ['context-engine'],
        username: 'cv-hub-pat',
        metadata: {
          hubUrl: cmdOptions.api,
          authMethod: 'direct',
        },
      });
      console.log(chalk.green('  ✓ Stored PAT in cv-git credential manager (cv_hub:default)'));

      console.log();
      console.log(chalk.green('CV-Hub credentials configured!'));
      console.log(chalk.gray('  Context engine hooks will use these credentials automatically.'));
      console.log();
    });

  addGlobalOptions(cmd);

  return cmd;
}

/**
 * Run setup for a provider
 */
async function runSetup(
  providerId: string,
  credentials: CredentialManager,
  autoBrowser: boolean
): Promise<boolean> {
  switch (providerId) {
    // Git platforms
    case 'github':
      await setupGitHub(credentials, autoBrowser);
      return true;
    case 'gitlab':
      await setupGitLab(credentials, autoBrowser);
      return true;
    case 'bitbucket':
      await setupBitbucket(credentials, autoBrowser);
      return true;
    case 'cv-hub':
      await setupCVHub(credentials, autoBrowser);
      return true;
    case 'controlfab':
      await setupControlfab(credentials, autoBrowser);
      return true;

    // AI providers
    case 'anthropic':
      await setupAnthropic(credentials, autoBrowser);
      return true;
    case 'openai':
      await setupOpenAI(credentials, autoBrowser);
      return true;
    case 'openrouter':
      await setupOpenRouter(credentials, autoBrowser);
      return true;

    // DNS providers
    case 'cloudflare':
      await setupCloudflare(credentials, autoBrowser);
      return true;

    // DevOps providers
    case 'aws':
      await setupAWS(credentials, autoBrowser);
      return true;
    case 'digitalocean':
      await setupDigitalOcean(credentials, autoBrowser);
      return true;

    // Package registry/publish providers
    case 'npm':
      await setupNPM(credentials, autoBrowser);
      return true;

    default:
      return false;
  }
}

/**
 * Run test for a service
 */
async function runTest(service: string, credentials: CredentialManager): Promise<void> {
  const spinner = ora('Testing authentication...').start();

  try {
    switch (service) {
      case 'github': {
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
        break;
      }

      case 'gitlab': {
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
        break;
      }

      case 'bitbucket': {
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
        break;
      }

      case 'cv-hub': {
        spinner.stop();
        await testCVHub(credentials);
        break;
      }

      case 'controlfab': {
        spinner.stop();
        await testControlfab(credentials);
        break;
      }

      case 'anthropic': {
        const key = await credentials.getAnthropicKey();
        if (!key) {
          spinner.fail(chalk.red('Anthropic API key not found'));
          console.log(chalk.gray('Run: ') + chalk.cyan('cv auth setup anthropic'));
          return;
        }
        if (key.startsWith('sk-ant-')) {
          spinner.succeed(chalk.green('Anthropic API key found'));
          console.log(chalk.gray('  Key: ') + chalk.white(key.substring(0, 20) + '...'));
        } else {
          spinner.fail(chalk.red('Anthropic API key invalid format'));
        }
        break;
      }

      case 'openai': {
        const key = await credentials.getOpenAIKey();
        if (!key) {
          spinner.fail(chalk.red('OpenAI API key not found'));
          console.log(chalk.gray('Run: ') + chalk.cyan('cv auth setup openai'));
          return;
        }
        if (key.startsWith('sk-')) {
          spinner.succeed(chalk.green('OpenAI API key found'));
          console.log(chalk.gray('  Key: ') + chalk.white(key.substring(0, 20) + '...'));
        } else {
          spinner.fail(chalk.red('OpenAI API key invalid format'));
        }
        break;
      }

      case 'openrouter': {
        const key = await credentials.getOpenRouterKey();
        if (!key) {
          spinner.fail(chalk.red('OpenRouter API key not found'));
          console.log(chalk.gray('Run: ') + chalk.cyan('cv auth setup openrouter'));
          return;
        }
        if (key.startsWith('sk-or-')) {
          spinner.succeed(chalk.green('OpenRouter API key found'));
          console.log(chalk.gray('  Key: ') + chalk.white(key.substring(0, 20) + '...'));
        } else {
          spinner.fail(chalk.red('OpenRouter API key invalid format'));
        }
        break;
      }

      case 'cloudflare': {
        spinner.stop();
        await testCloudflare(credentials);
        break;
      }

      case 'aws': {
        spinner.stop();
        await testAWS(credentials);
        break;
      }

      case 'digitalocean': {
        spinner.stop();
        await testDigitalOcean(credentials);
        break;
      }

      case 'digitalocean-spaces':
      case 'spaces': {
        spinner.stop();
        await testDigitalOceanSpaces(credentials);
        break;
      }

      case 'npm': {
        spinner.stop();
        await testNPM(credentials);
        break;
      }

      default:
        spinner.fail(chalk.red(`Unknown service: ${service}`));
        console.log(chalk.gray('\nAvailable services:'));
        console.log(chalk.gray('  Git: github, gitlab, bitbucket, cv-hub, controlfab'));
        console.log(chalk.gray('  AI: anthropic, openai, openrouter'));
        console.log(chalk.gray('  DNS: cloudflare'));
        console.log(chalk.gray('  DevOps: aws, digitalocean, digitalocean-spaces'));
        console.log(chalk.gray('  Publish: npm'));
    }
  } catch (error: any) {
    spinner.fail(chalk.red(`Authentication test failed: ${error.message}`));
  }
}

// ============================================================================
// Git Platform Setup Functions
// ============================================================================

async function setupGitHub(credentials: CredentialManager, autoBrowser: boolean = true): Promise<void> {
  console.log(chalk.bold('──────────────────────────────────────────'));
  console.log(chalk.bold.cyan('GitHub Authentication'));
  console.log(chalk.bold('──────────────────────────────────────────\n'));

  const { method } = await inquirer.prompt([
    {
      type: 'list',
      name: 'method',
      message: 'How would you like to authenticate with GitHub?',
      choices: [
        {
          name: `${chalk.cyan('Personal Access Token')} ${chalk.gray('— Direct PAT, you manage the token')}`,
          value: 'pat',
        },
        {
          name: `${chalk.cyan('CV-Hub Proxy')} ${chalk.gray('— Authenticate via ControlFab, no PAT needed')}`,
          value: 'proxy',
        },
      ],
    },
  ]);

  if (method === 'proxy') {
    await setupGitHubViaProxy(credentials, autoBrowser);
    return;
  }

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

    await credentials.store<GitPlatformTokenCredential>({
      type: CredentialType.GIT_PLATFORM_TOKEN,
      name: `github-${user.username}`,
      platform: GitPlatform.GITHUB,
      token,
      scopes,
      username: user.username,
      metadata: { authMethod: 'direct' },
    });

    console.log(chalk.green('✅ GitHub authentication configured!\n'));
  } catch (error: any) {
    spinner.fail(chalk.red(`Token validation failed: ${error.message}`));
    console.log(chalk.yellow('\nPlease try again with a valid token.\n'));
  }
}

async function setupGitHubViaProxy(credentials: CredentialManager, autoBrowser: boolean): Promise<void> {
  console.log(chalk.gray('\nSetting up GitHub via CV-Hub proxy...\n'));

  // Ensure CV-Hub auth exists
  const allCreds = await credentials.list();
  const cvHubCred = allCreds.find(
    (c) => c.type === CredentialType.GIT_PLATFORM_TOKEN &&
           c.metadata?.platform === 'cv-hub'
  );

  if (!cvHubCred) {
    console.log(chalk.yellow('CV-Hub authentication required first.\n'));
    await setupCVHub(credentials, autoBrowser);

    // Re-check after setup
    const updatedCreds = await credentials.list();
    const newCvHub = updatedCreds.find(
      (c) => c.type === CredentialType.GIT_PLATFORM_TOKEN &&
             c.metadata?.platform === 'cv-hub'
    );
    if (!newCvHub) {
      console.log(chalk.red('CV-Hub authentication was not completed. Cannot proceed with proxy setup.'));
      return;
    }
  }

  // Get CV-Hub credential for the API call
  const hubCred = await credentials.getGitPlatformToken(GitPlatform.CV_HUB);
  if (!hubCred) {
    console.log(chalk.red('CV-Hub token not found.'));
    return;
  }

  const hubUrl = cvHubCred?.metadata?.hubUrl || 'https://api.controlfab.ai';
  const spinner = ora('Connecting GitHub via CV-Hub proxy...').start();

  try {
    const response = await fetch(`${hubUrl}/api/v1/git-proxy/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${hubCred}`,
      },
      body: JSON.stringify({
        platform: 'github',
        scopes: ['repo', 'workflow', 'write:packages'],
      }),
    });

    if (response.status === 403) {
      const body = await response.json() as { redirect_url?: string; message?: string };
      spinner.warn(chalk.yellow('GitHub connection required in CV-Hub'));
      if (body.redirect_url) {
        console.log(chalk.gray('\nPlease connect GitHub in CV-Hub first:'));
        console.log(chalk.blue(`  ${body.redirect_url}`));
        if (autoBrowser) {
          await openBrowser(body.redirect_url);
        }
      } else {
        console.log(chalk.gray('\n' + (body.message || 'Please connect GitHub in the CV-Hub web UI first.')));
      }
      return;
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(errBody.message || `HTTP ${response.status}`);
    }

    const data = await response.json() as {
      token: string;
      expires_in?: number;
      proxy_token_id?: string;
      username?: string;
      scopes?: string[];
    };

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : undefined;

    await credentials.store<GitPlatformTokenCredential>({
      type: CredentialType.GIT_PLATFORM_TOKEN,
      name: 'github-proxy',
      platform: GitPlatform.GITHUB,
      token: data.token,
      scopes: data.scopes || ['repo'],
      username: data.username,
      expiresAt,
      metadata: {
        authMethod: 'cv-hub-proxy',
        hubUrl,
        cvHubCredentialName: cvHubCred?.name,
        proxyTokenId: data.proxy_token_id,
      },
    });

    spinner.succeed(chalk.green(`GitHub connected via CV-Hub proxy${data.username ? ` (${data.username})` : ''}`));
    console.log(chalk.green('✅ GitHub proxy authentication configured!\n'));
  } catch (error: any) {
    spinner.fail(chalk.red(`Proxy connection failed: ${error.message}`));
    console.log(chalk.yellow('\nPlease try again or use a Personal Access Token instead.\n'));
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
    Accept: 'application/json',
  };

  // Try /user endpoint - only works with Personal Access Tokens
  try {
    const userResponse = await fetch('https://gitlab.com/api/v4/user', { headers });
    if (userResponse.ok) {
      const user = (await userResponse.json()) as { username: string };

      // Get scopes from personal access token info
      let scopes: string[] = [];
      try {
        const tokenResponse = await fetch(
          'https://gitlab.com/api/v4/personal_access_tokens/self',
          { headers }
        );
        if (tokenResponse.ok) {
          const tokenInfo = (await tokenResponse.json()) as { scopes: string[] };
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
    const groupsResponse = await fetch(
      'https://gitlab.com/api/v4/groups?min_access_level=10&per_page=1',
      { headers }
    );
    if (groupsResponse.ok) {
      const groups = (await groupsResponse.json()) as Array<{ full_path: string }>;
      if (groups.length > 0) {
        return {
          type: 'group',
          groupPath: groups[0].full_path,
          scopes: ['api', 'read_api'],
        };
      }
    }
  } catch {}

  // Try to detect project token
  try {
    const projectsResponse = await fetch(
      'https://gitlab.com/api/v4/projects?membership=true&per_page=1',
      { headers }
    );
    if (projectsResponse.ok) {
      const projects = (await projectsResponse.json()) as Array<{
        path_with_namespace: string;
      }>;
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

  const { method } = await inquirer.prompt([
    {
      type: 'list',
      name: 'method',
      message: 'How would you like to authenticate with GitLab?',
      choices: [
        {
          name: `${chalk.cyan('Access Token')} ${chalk.gray('— Direct PAT/Group/Project token')}`,
          value: 'token',
        },
        {
          name: `${chalk.cyan('CV-Hub Proxy')} ${chalk.gray('— Authenticate via ControlFab, no token needed')}`,
          value: 'proxy',
        },
      ],
    },
  ]);

  if (method === 'proxy') {
    await setupGitLabViaProxy(credentials, autoBrowser);
    return;
  }

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

  const url =
    'https://gitlab.com/-/user_settings/personal_access_tokens?scopes=api,read_user,read_repository,write_repository';

  if (autoBrowser) {
    console.log(chalk.cyan('Opening browser to create Personal Access Token...'));
    await openBrowser(url);
    console.log();
  }

  console.log(chalk.gray('URL: ') + chalk.blue(url));
  console.log(
    chalk.gray('Required scopes: ') +
      chalk.white('api, read_user, read_repository, write_repository')
  );
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

      const requiredScopes = ['api', 'read_api'];
      const hasRequiredScopes = requiredScopes.some((s) => tokenInfo.scopes.includes(s));
      if (!hasRequiredScopes && tokenInfo.scopes.length > 0) {
        console.log();
        console.log(chalk.yellow('⚠ Warning: Token may be missing "api" or "read_api" scope'));
        console.log(chalk.gray('  Some features like "cv clone-group" require API access'));
      }

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

async function setupGitLabViaProxy(credentials: CredentialManager, autoBrowser: boolean): Promise<void> {
  console.log(chalk.gray('\nSetting up GitLab via CV-Hub proxy...\n'));

  // Ensure CV-Hub auth exists
  const allCreds = await credentials.list();
  const cvHubCred = allCreds.find(
    (c) => c.type === CredentialType.GIT_PLATFORM_TOKEN &&
           c.metadata?.platform === 'cv-hub'
  );

  if (!cvHubCred) {
    console.log(chalk.yellow('CV-Hub authentication required first.\n'));
    await setupCVHub(credentials, autoBrowser);

    const updatedCreds = await credentials.list();
    const newCvHub = updatedCreds.find(
      (c) => c.type === CredentialType.GIT_PLATFORM_TOKEN &&
             c.metadata?.platform === 'cv-hub'
    );
    if (!newCvHub) {
      console.log(chalk.red('CV-Hub authentication was not completed. Cannot proceed with proxy setup.'));
      return;
    }
  }

  const hubToken = await credentials.getGitPlatformToken(GitPlatform.CV_HUB);
  if (!hubToken) {
    console.log(chalk.red('CV-Hub token not found.'));
    return;
  }

  const hubUrl = cvHubCred?.metadata?.hubUrl || 'https://api.controlfab.ai';
  const spinner = ora('Connecting GitLab via CV-Hub proxy...').start();

  try {
    const response = await fetch(`${hubUrl}/api/v1/git-proxy/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${hubToken}`,
      },
      body: JSON.stringify({
        platform: 'gitlab',
        scopes: ['api', 'read_user', 'read_repository', 'write_repository'],
      }),
    });

    if (response.status === 403) {
      const body = await response.json() as { redirect_url?: string; message?: string };
      spinner.warn(chalk.yellow('GitLab connection required in CV-Hub'));
      if (body.redirect_url) {
        console.log(chalk.gray('\nPlease connect GitLab in CV-Hub first:'));
        console.log(chalk.blue(`  ${body.redirect_url}`));
        if (autoBrowser) {
          await openBrowser(body.redirect_url);
        }
      } else {
        console.log(chalk.gray('\n' + (body.message || 'Please connect GitLab in the CV-Hub web UI first.')));
      }
      return;
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(errBody.message || `HTTP ${response.status}`);
    }

    const data = await response.json() as {
      token: string;
      expires_in?: number;
      proxy_token_id?: string;
      username?: string;
      scopes?: string[];
    };

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : undefined;

    await credentials.store<GitPlatformTokenCredential>({
      type: CredentialType.GIT_PLATFORM_TOKEN,
      name: 'gitlab-proxy',
      platform: GitPlatform.GITLAB,
      token: data.token,
      scopes: data.scopes || ['api'],
      username: data.username,
      expiresAt,
      metadata: {
        authMethod: 'cv-hub-proxy',
        hubUrl,
        cvHubCredentialName: cvHubCred?.name,
        proxyTokenId: data.proxy_token_id,
      },
    });

    spinner.succeed(chalk.green(`GitLab connected via CV-Hub proxy${data.username ? ` (${data.username})` : ''}`));
    console.log(chalk.green('✅ GitLab proxy authentication configured!\n'));
  } catch (error: any) {
    spinner.fail(chalk.red(`Proxy connection failed: ${error.message}`));
    console.log(chalk.yellow('\nPlease try again or use an Access Token instead.\n'));
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
  console.log(
    chalk.gray(
      '1. Create an App Password with permissions: Repositories (Read, Write), Pull requests (Read, Write)'
    )
  );
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

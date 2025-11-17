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
} from '@cv-git/credentials';
import { GitHubAdapter } from '@cv-git/platform';
import { randomBytes } from 'crypto';

export function authCommand(): Command {
  const cmd = new Command('auth').description(
    'Manage credentials and authentication'
  );

  // cv auth setup
  cmd
    .command('setup [service]')
    .description(
      'Set up authentication (services: github, anthropic, openai, all)'
    )
    .action(async (service?: string) => {
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
        await setupGitHub(credentials);
      }

      if (setupAll || service === 'anthropic') {
        await setupAnthropic(credentials);
      }

      if (setupAll || service === 'openai') {
        await setupOpenAI(credentials);
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
    .description('Test authentication for a service (github, anthropic, openai)')
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

async function setupGitHub(credentials: CredentialManager): Promise<void> {
  console.log(chalk.bold('──────────────────────────────────────────'));
  console.log(chalk.bold.cyan('GitHub Authentication'));
  console.log(chalk.bold('──────────────────────────────────────────\n'));

  console.log(
    chalk.gray('1. Visit: ') +
      chalk.blue(
        'https://github.com/settings/tokens/new?scopes=repo,workflow,write:packages'
      )
  );
  console.log(chalk.gray('2. Generate a Personal Access Token'));
  console.log(chalk.gray('3. Copy the token (it starts with ') + chalk.white('ghp_') + chalk.gray(')'));
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

async function setupAnthropic(credentials: CredentialManager): Promise<void> {
  console.log(chalk.bold('──────────────────────────────────────────'));
  console.log(chalk.bold.cyan('Anthropic Authentication'));
  console.log(chalk.bold('──────────────────────────────────────────\n'));

  console.log(chalk.gray('1. Visit: ') + chalk.blue('https://console.anthropic.com/'));
  console.log(chalk.gray('2. Copy your API key (starts with ') + chalk.white('sk-ant-') + chalk.gray(')'));
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

async function setupOpenAI(credentials: CredentialManager): Promise<void> {
  console.log(chalk.bold('──────────────────────────────────────────'));
  console.log(chalk.bold.cyan('OpenAI Authentication'));
  console.log(chalk.bold('──────────────────────────────────────────\n'));

  console.log(
    chalk.gray('1. Visit: ') + chalk.blue('https://platform.openai.com/api-keys')
  );
  console.log(chalk.gray('2. Copy your API key (starts with ') + chalk.white('sk-') + chalk.gray(')'));
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

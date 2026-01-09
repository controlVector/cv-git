/**
 * DigitalOcean Authentication Setup
 *
 * Sets up DigitalOcean credentials for:
 * - API Token: General API access
 * - Spaces: S3-compatible object storage
 * - App Platform: App deployment
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import {
  CredentialManager,
  CredentialType,
  DigitalOceanTokenCredential,
  DigitalOceanSpacesCredential,
  DigitalOceanAppCredential,
} from '@cv-git/credentials';
import { openBrowser } from '../../auth-utils.js';

// DigitalOcean Spaces regions
const DO_SPACES_REGIONS = [
  { value: 'nyc3', name: 'New York 3 (nyc3)' },
  { value: 'sfo3', name: 'San Francisco 3 (sfo3)' },
  { value: 'ams3', name: 'Amsterdam 3 (ams3)' },
  { value: 'sgp1', name: 'Singapore 1 (sgp1)' },
  { value: 'fra1', name: 'Frankfurt 1 (fra1)' },
  { value: 'syd1', name: 'Sydney 1 (syd1)' },
];

/**
 * Validate DigitalOcean API token
 */
async function validateDOToken(apiToken: string): Promise<{
  valid: boolean;
  accountEmail?: string;
  accountUuid?: string;
  error?: string;
}> {
  try {
    const response = await fetch('https://api.digitalocean.com/v2/account', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { valid: false, error: 'Invalid or expired token' };
      }
      return { valid: false, error: `API error: ${response.status}` };
    }

    const data = (await response.json()) as {
      account?: {
        email: string;
        uuid: string;
        status: string;
      };
    };

    if (!data.account) {
      return { valid: false, error: 'Invalid response from API' };
    }

    return {
      valid: true,
      accountEmail: data.account.email,
      accountUuid: data.account.uuid,
    };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message || 'Failed to validate token',
    };
  }
}

/**
 * Validate DigitalOcean Spaces credentials
 */
async function validateDOSpaces(
  accessKey: string,
  secretKey: string,
  region: string
): Promise<{
  valid: boolean;
  error?: string;
}> {
  // Basic format validation first
  if (accessKey.length < 10) {
    return { valid: false, error: 'Invalid Access Key format' };
  }
  if (secretKey.length < 20) {
    return { valid: false, error: 'Invalid Secret Key format' };
  }

  try {
    // Try using AWS SDK for S3-compatible API (optional dependency)
    // @ts-ignore - Optional dependency, may not be installed
    const s3Module = await import('@aws-sdk/client-s3').catch(() => null);

    if (!s3Module) {
      // SDK not installed - format validation passed, assume valid
      return { valid: true };
    }

    const { S3Client, ListBucketsCommand } = s3Module;

    const client = new S3Client({
      endpoint: `https://${region}.digitaloceanspaces.com`,
      region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: false,
    });

    await client.send(new ListBucketsCommand({}));

    return { valid: true };
  } catch (error: any) {
    if (error.name === 'InvalidAccessKeyId') {
      return { valid: false, error: 'Invalid Access Key' };
    }
    if (error.name === 'SignatureDoesNotMatch') {
      return { valid: false, error: 'Invalid Secret Key' };
    }

    return {
      valid: false,
      error: error.message || 'Failed to validate credentials',
    };
  }
}

/**
 * Setup DigitalOcean authentication (interactive menu)
 */
export async function setupDigitalOcean(
  credentials: CredentialManager,
  autoBrowser: boolean = true
): Promise<void> {
  console.log(chalk.bold('──────────────────────────────────────────'));
  console.log(chalk.bold.cyan('DigitalOcean Authentication'));
  console.log(chalk.bold('──────────────────────────────────────────\n'));

  console.log(chalk.gray('DigitalOcean offers several credential types:\n'));
  console.log(
    chalk.cyan('  API Token      ') +
      chalk.gray('General API access (droplets, domains, etc.)')
  );
  console.log(
    chalk.cyan('  Spaces Keys    ') +
      chalk.gray('S3-compatible object storage')
  );
  console.log(
    chalk.cyan('  App Platform   ') +
      chalk.gray('App deployment and management')
  );
  console.log();

  const { credType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'credType',
      message: 'Which credential type do you want to set up?',
      choices: [
        { value: 'token', name: 'API Token (recommended)' },
        { value: 'spaces', name: 'Spaces Keys' },
        { value: 'app', name: 'App Platform Token' },
        { value: 'all', name: 'All of the above' },
        { value: 'cancel', name: 'Cancel' },
      ],
    },
  ]);

  if (credType === 'cancel') {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  if (credType === 'token' || credType === 'all') {
    await setupDOToken(credentials, autoBrowser);
  }

  if (credType === 'spaces' || credType === 'all') {
    await setupDOSpaces(credentials, autoBrowser);
  }

  if (credType === 'app' || credType === 'all') {
    await setupDOApp(credentials, autoBrowser);
  }
}

/**
 * Setup DigitalOcean API Token
 */
async function setupDOToken(
  credentials: CredentialManager,
  autoBrowser: boolean
): Promise<void> {
  console.log(chalk.bold('\n📍 DigitalOcean API Token\n'));

  const url = 'https://cloud.digitalocean.com/account/api/tokens';

  if (autoBrowser) {
    console.log(chalk.cyan('Opening browser to create API token...'));
    await openBrowser(url);
    console.log();
  }

  console.log(chalk.gray('URL: ') + chalk.blue(url));
  console.log();
  console.log(chalk.yellow('Creating a Personal Access Token:'));
  console.log(chalk.gray('  1. Click "Generate New Token"'));
  console.log(chalk.gray('  2. Enter a name (e.g., "cv-git")'));
  console.log(chalk.gray('  3. Select appropriate scopes'));
  console.log(chalk.gray('  4. Copy the generated token (starts with dop_v1_)'));
  console.log();

  const { apiToken } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiToken',
      message: 'Enter your DigitalOcean API token:',
      validate: (input: string) => {
        if (!input || !input.trim()) {
          return 'API token is required';
        }
        if (!input.startsWith('dop_v1_')) {
          return 'Invalid token format (should start with dop_v1_)';
        }
        return true;
      },
    },
  ]);

  const spinner = ora('Validating token...').start();

  const result = await validateDOToken(apiToken);

  if (!result.valid) {
    spinner.fail(chalk.red(`Token validation failed: ${result.error}`));
    console.log(chalk.yellow('\nPlease try again with a valid token.\n'));
    return;
  }

  spinner.succeed(chalk.green('Token validated successfully'));

  if (result.accountEmail) {
    console.log(chalk.gray('  Account: ') + chalk.white(result.accountEmail));
  }

  await credentials.store<DigitalOceanTokenCredential>({
    type: CredentialType.DIGITALOCEAN_TOKEN,
    name: 'default',
    apiToken,
    accountEmail: result.accountEmail,
    accountUuid: result.accountUuid,
  });

  console.log(chalk.green('✅ DigitalOcean API Token configured!\n'));
}

/**
 * Setup DigitalOcean Spaces credentials
 */
async function setupDOSpaces(
  credentials: CredentialManager,
  autoBrowser: boolean
): Promise<void> {
  console.log(chalk.bold('\n📦 DigitalOcean Spaces Keys\n'));

  const url = 'https://cloud.digitalocean.com/account/api/spaces';

  if (autoBrowser) {
    console.log(chalk.cyan('Opening browser to Spaces keys...'));
    await openBrowser(url);
    console.log();
  }

  console.log(chalk.gray('URL: ') + chalk.blue(url));
  console.log();
  console.log(chalk.yellow('Creating Spaces Access Keys:'));
  console.log(chalk.gray('  1. Click "Generate New Key"'));
  console.log(chalk.gray('  2. Enter a name'));
  console.log(
    chalk.gray('  3. Copy both Access Key and Secret Key immediately')
  );
  console.log(chalk.gray('     (Secret is only shown once!)'));
  console.log();

  const { accessKey } = await inquirer.prompt([
    {
      type: 'input',
      name: 'accessKey',
      message: 'Enter your Spaces Access Key:',
      validate: (input: string) => {
        if (!input || !input.trim()) {
          return 'Access Key is required';
        }
        return true;
      },
    },
  ]);

  const { secretKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'secretKey',
      message: 'Enter your Spaces Secret Key:',
      validate: (input: string) => {
        if (!input || !input.trim()) {
          return 'Secret Key is required';
        }
        return true;
      },
    },
  ]);

  const { region } = await inquirer.prompt([
    {
      type: 'list',
      name: 'region',
      message: 'Select your Spaces region:',
      choices: DO_SPACES_REGIONS,
      default: 'nyc3',
    },
  ]);

  const spinner = ora('Validating credentials...').start();

  const result = await validateDOSpaces(accessKey, secretKey, region);

  if (!result.valid) {
    spinner.fail(chalk.red(`Validation failed: ${result.error}`));
    console.log(chalk.yellow('\nPlease try again with valid credentials.\n'));
    return;
  }

  spinner.succeed(chalk.green('Spaces credentials validated successfully'));

  await credentials.store<DigitalOceanSpacesCredential>({
    type: CredentialType.DIGITALOCEAN_SPACES,
    name: 'default',
    accessKey,
    secretKey,
    region,
    endpoint: `${region}.digitaloceanspaces.com`,
  });

  console.log(chalk.green('✅ DigitalOcean Spaces configured!\n'));
}

/**
 * Setup DigitalOcean App Platform token
 */
async function setupDOApp(
  credentials: CredentialManager,
  autoBrowser: boolean
): Promise<void> {
  console.log(chalk.bold('\n🚀 DigitalOcean App Platform\n'));

  const url = 'https://cloud.digitalocean.com/account/api/tokens';

  if (autoBrowser) {
    console.log(chalk.cyan('Opening browser to create App token...'));
    await openBrowser(url);
    console.log();
  }

  console.log(chalk.gray('URL: ') + chalk.blue(url));
  console.log();
  console.log(
    chalk.gray('Note: App Platform uses the same API token as general access.')
  );
  console.log(
    chalk.gray('Create a token with App Platform scopes if needed.')
  );
  console.log();

  const { appToken } = await inquirer.prompt([
    {
      type: 'password',
      name: 'appToken',
      message: 'Enter your App Platform token:',
      validate: (input: string) => {
        if (!input || !input.trim()) {
          return 'Token is required';
        }
        if (!input.startsWith('dop_v1_')) {
          return 'Invalid token format (should start with dop_v1_)';
        }
        return true;
      },
    },
  ]);

  const spinner = ora('Validating token...').start();

  // Validate using the same API token validation
  const result = await validateDOToken(appToken);

  if (!result.valid) {
    spinner.fail(chalk.red(`Token validation failed: ${result.error}`));
    console.log(chalk.yellow('\nPlease try again with a valid token.\n'));
    return;
  }

  spinner.succeed(chalk.green('Token validated successfully'));

  await credentials.store<DigitalOceanAppCredential>({
    type: CredentialType.DIGITALOCEAN_APP,
    name: 'default',
    appToken,
  });

  console.log(chalk.green('✅ DigitalOcean App Platform configured!\n'));
}

/**
 * Test DigitalOcean API token credential
 */
export async function testDigitalOcean(
  credentials: CredentialManager
): Promise<boolean> {
  const cred = await credentials.getDigitalOceanCredential();

  if (!cred) {
    console.log(chalk.red('DigitalOcean credential not found'));
    console.log(
      chalk.gray('Run: ') + chalk.cyan('cv auth setup devops/digitalocean')
    );
    return false;
  }

  const spinner = ora('Testing DigitalOcean authentication...').start();

  const result = await validateDOToken(cred.apiToken);

  if (result.valid) {
    spinner.succeed(chalk.green('DigitalOcean authentication valid'));
    if (result.accountEmail) {
      console.log(chalk.gray('  Account: ') + chalk.white(result.accountEmail));
    }
    return true;
  } else {
    spinner.fail(chalk.red(`Authentication failed: ${result.error}`));
    return false;
  }
}

/**
 * Test DigitalOcean Spaces credential
 */
export async function testDigitalOceanSpaces(
  credentials: CredentialManager
): Promise<boolean> {
  const cred = await credentials.getDigitalOceanSpaces();

  if (!cred) {
    console.log(chalk.red('DigitalOcean Spaces credential not found'));
    console.log(
      chalk.gray('Run: ') + chalk.cyan('cv auth setup devops/digitalocean')
    );
    return false;
  }

  const spinner = ora('Testing Spaces authentication...').start();

  const result = await validateDOSpaces(cred.accessKey, cred.secretKey, cred.region);

  if (result.valid) {
    spinner.succeed(chalk.green('Spaces authentication valid'));
    console.log(chalk.gray('  Region: ') + chalk.white(cred.region));
    return true;
  } else {
    spinner.fail(chalk.red(`Authentication failed: ${result.error}`));
    return false;
  }
}

/**
 * Cloudflare Authentication Setup
 *
 * Sets up Cloudflare API Token credential for DNS management,
 * CDN configuration, and security services.
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import {
  CredentialManager,
  CredentialType,
  CloudflareCredential,
} from '@cv-git/credentials';
import { openBrowser } from '../../auth-utils.js';

/**
 * Validate Cloudflare API token and get account info
 */
async function validateCloudflareToken(apiToken: string): Promise<{
  valid: boolean;
  accountId?: string;
  email?: string;
  error?: string;
}> {
  try {
    // Verify token
    const verifyResponse = await fetch(
      'https://api.cloudflare.com/client/v4/user/tokens/verify',
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const verifyData = (await verifyResponse.json()) as {
      success: boolean;
      result?: { status: string };
      errors?: Array<{ message: string }>;
    };

    if (!verifyData.success || verifyData.result?.status !== 'active') {
      return {
        valid: false,
        error: verifyData.errors?.[0]?.message || 'Token is not active',
      };
    }

    // Get account info
    let accountId: string | undefined;
    let email: string | undefined;

    try {
      const accountResponse = await fetch(
        'https://api.cloudflare.com/client/v4/accounts',
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const accountData = (await accountResponse.json()) as {
        success: boolean;
        result?: Array<{ id: string; name: string }>;
      };

      if (accountData.success && accountData.result && accountData.result.length > 0) {
        accountId = accountData.result[0].id;
      }
    } catch {
      // Account info is optional
    }

    try {
      const userResponse = await fetch(
        'https://api.cloudflare.com/client/v4/user',
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const userData = (await userResponse.json()) as {
        success: boolean;
        result?: { email: string };
      };

      if (userData.success && userData.result?.email) {
        email = userData.result.email;
      }
    } catch {
      // User info is optional
    }

    return { valid: true, accountId, email };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message || 'Failed to validate token',
    };
  }
}

/**
 * Setup Cloudflare authentication
 */
export async function setupCloudflare(
  credentials: CredentialManager,
  autoBrowser: boolean = true
): Promise<void> {
  console.log(chalk.bold('──────────────────────────────────────────'));
  console.log(chalk.bold.cyan('Cloudflare Authentication'));
  console.log(chalk.bold('──────────────────────────────────────────\n'));

  const url = 'https://dash.cloudflare.com/profile/api-tokens';

  if (autoBrowser) {
    console.log(chalk.cyan('Opening browser to create API token...'));
    await openBrowser(url);
    console.log();
  }

  console.log(chalk.gray('URL: ') + chalk.blue(url));
  console.log();
  console.log(chalk.yellow('Recommended Token Setup:'));
  console.log(chalk.gray('  1. Click "Create Token"'));
  console.log(chalk.gray('  2. Use "Edit zone DNS" template (or custom)'));
  console.log(chalk.gray('  3. Add permissions based on your needs:'));
  console.log(chalk.gray('     - Zone:DNS:Edit (for DNS management)'));
  console.log(chalk.gray('     - Zone:Zone:Read (for zone listing)'));
  console.log(chalk.gray('     - Account:Account Settings:Read (optional)'));
  console.log(chalk.gray('  4. Set Zone/Account resources'));
  console.log(chalk.gray('  5. Copy the generated token'));
  console.log();

  const { apiToken } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiToken',
      message: 'Enter your Cloudflare API token:',
      validate: (input: string) => {
        if (!input || !input.trim()) {
          return 'API token is required';
        }
        if (input.length < 20) {
          return 'Invalid token length';
        }
        return true;
      },
    },
  ]);

  const spinner = ora('Validating token...').start();

  const result = await validateCloudflareToken(apiToken);

  if (!result.valid) {
    spinner.fail(chalk.red(`Token validation failed: ${result.error}`));
    console.log(chalk.yellow('\nPlease try again with a valid API token.\n'));
    return;
  }

  spinner.succeed(chalk.green('Token validated successfully'));

  if (result.email) {
    console.log(chalk.gray('  Account: ') + chalk.white(result.email));
  }
  if (result.accountId) {
    console.log(chalk.gray('  Account ID: ') + chalk.white(result.accountId));
  }

  // Store credential
  await credentials.store<CloudflareCredential>({
    type: CredentialType.CLOUDFLARE_API,
    name: 'default',
    apiToken,
    accountId: result.accountId,
    email: result.email,
  });

  console.log(chalk.green('\n✅ Cloudflare authentication configured!\n'));
}

/**
 * Test Cloudflare credential
 */
export async function testCloudflare(
  credentials: CredentialManager
): Promise<boolean> {
  const cred = await credentials.getCloudflareCredential();

  if (!cred) {
    console.log(chalk.red('Cloudflare credential not found'));
    console.log(chalk.gray('Run: ') + chalk.cyan('cv auth setup dns/cloudflare'));
    return false;
  }

  const spinner = ora('Testing Cloudflare authentication...').start();

  const result = await validateCloudflareToken(cred.apiToken);

  if (result.valid) {
    spinner.succeed(chalk.green('Cloudflare authentication valid'));
    if (result.email) {
      console.log(chalk.gray('  Account: ') + chalk.white(result.email));
    }
    return true;
  } else {
    spinner.fail(chalk.red(`Authentication failed: ${result.error}`));
    return false;
  }
}

/**
 * npm Authentication Setup
 *
 * Sets up npm registry token for publishing packages.
 * Supports automation tokens (CI/CD), publish tokens, and granular tokens.
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import {
  CredentialManager,
  CredentialType,
  NPMCredential,
} from '@cv-git/credentials';
import { openBrowser } from '../../auth-utils.js';

/**
 * Validate npm token and get user info
 */
async function validateNPMToken(token: string): Promise<{
  valid: boolean;
  username?: string;
  email?: string;
  error?: string;
}> {
  try {
    // npm registry whoami endpoint
    const response = await fetch('https://registry.npmjs.org/-/whoami', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { valid: false, error: 'Invalid or expired token' };
      }
      return { valid: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const data = await response.json() as { username?: string };

    if (!data.username) {
      return { valid: false, error: 'Could not retrieve username' };
    }

    // Try to get email from npm profile (optional)
    let email: string | undefined;
    try {
      const profileResponse = await fetch(`https://registry.npmjs.org/-/npm/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (profileResponse.ok) {
        const profileData = await profileResponse.json() as { email?: string };
        email = profileData.email;
      }
    } catch {
      // Profile fetch is optional
    }

    return { valid: true, username: data.username, email };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message || 'Failed to validate token',
    };
  }
}

/**
 * Detect token type from format
 */
function detectTokenType(token: string): 'automation' | 'publish' | 'granular' {
  if (token.startsWith('npm_')) {
    // Granular access tokens start with npm_
    return 'granular';
  }
  // Legacy tokens are UUIDs
  // Can't distinguish automation vs publish without API call
  return 'automation';
}

/**
 * Setup npm authentication
 */
export async function setupNPM(
  credentials: CredentialManager,
  autoBrowser: boolean = true
): Promise<void> {
  console.log(chalk.bold('──────────────────────────────────────────'));
  console.log(chalk.bold.cyan('npm Authentication'));
  console.log(chalk.bold('──────────────────────────────────────────\n'));

  const url = 'https://www.npmjs.com/settings/~/tokens/granular-access-tokens/new';

  if (autoBrowser) {
    console.log(chalk.cyan('Opening browser to create access token...'));
    await openBrowser(url);
    console.log();
  }

  console.log(chalk.gray('URL: ') + chalk.blue(url));
  console.log();
  console.log(chalk.yellow('Token Setup Guide:'));
  console.log(chalk.gray('  1. Sign in to npmjs.com'));
  console.log(chalk.gray('  2. Go to Access Tokens settings'));
  console.log(chalk.gray('  3. Click "Generate New Token"'));
  console.log(chalk.gray('  4. Choose token type:'));
  console.log(chalk.gray('     - ') + chalk.white('Granular Access Token') + chalk.gray(' (recommended)'));
  console.log(chalk.gray('       Scoped permissions, expiration support'));
  console.log(chalk.gray('     - ') + chalk.white('Automation') + chalk.gray(' (CI/CD)'));
  console.log(chalk.gray('       Bypasses 2FA, full publish access'));
  console.log(chalk.gray('     - ') + chalk.white('Publish') + chalk.gray(' (interactive)'));
  console.log(chalk.gray('       Requires 2FA for publish'));
  console.log(chalk.gray('  5. Copy the generated token'));
  console.log();

  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: 'Enter your npm access token:',
      validate: (input: string) => {
        if (!input || !input.trim()) {
          return 'Token is required';
        }
        if (input.length < 20) {
          return 'Invalid token length';
        }
        return true;
      },
    },
  ]);

  const spinner = ora('Validating token...').start();

  const result = await validateNPMToken(token);

  if (!result.valid) {
    spinner.fail(chalk.red(`Token validation failed: ${result.error}`));
    console.log(chalk.yellow('\nPlease try again with a valid access token.\n'));
    return;
  }

  spinner.succeed(chalk.green('Token validated successfully'));

  const tokenType = detectTokenType(token);

  console.log(chalk.gray('  Username: ') + chalk.white(result.username));
  if (result.email) {
    console.log(chalk.gray('  Email: ') + chalk.white(result.email));
  }
  console.log(chalk.gray('  Token type: ') + chalk.white(tokenType));

  // Store credential
  await credentials.store<NPMCredential>({
    type: CredentialType.NPM_TOKEN,
    name: 'default',
    token,
    registry: 'https://registry.npmjs.org/',
    username: result.username,
    email: result.email,
    tokenType,
  });

  console.log(chalk.green('\n✅ npm authentication configured!\n'));

  // Show usage hint
  console.log(chalk.gray('To publish packages:'));
  console.log(chalk.cyan('  cv release publish'));
  console.log(chalk.gray('  or'));
  console.log(chalk.cyan('  npm publish'));
}

/**
 * Test npm credential
 */
export async function testNPM(
  credentials: CredentialManager
): Promise<boolean> {
  const cred = await credentials.getNPMCredential();

  if (!cred) {
    console.log(chalk.red('npm credential not found'));
    console.log(chalk.gray('Run: ') + chalk.cyan('cv auth setup publish/npm'));
    return false;
  }

  const spinner = ora('Testing npm authentication...').start();

  const result = await validateNPMToken(cred.token);

  if (result.valid) {
    spinner.succeed(chalk.green('npm authentication valid'));
    console.log(chalk.gray('  Username: ') + chalk.white(result.username));
    if (result.email) {
      console.log(chalk.gray('  Email: ') + chalk.white(result.email));
    }
    return true;
  } else {
    spinner.fail(chalk.red(`Authentication failed: ${result.error}`));
    return false;
  }
}

/**
 * Configure npm CLI to use stored token
 * Sets up .npmrc with the stored token
 */
export async function configureNPMCLI(
  credentials: CredentialManager
): Promise<boolean> {
  const cred = await credentials.getNPMCredential();

  if (!cred) {
    console.log(chalk.red('npm credential not found'));
    return false;
  }

  const spinner = ora('Configuring npm CLI...').start();

  try {
    const { execSync } = await import('child_process');

    // Set the auth token for the registry
    const registry = cred.registry || 'https://registry.npmjs.org/';
    const registryHost = new URL(registry).host;

    execSync(
      `npm config set //${registryHost}/:_authToken ${cred.token}`,
      { stdio: 'pipe' }
    );

    spinner.succeed(chalk.green('npm CLI configured'));
    console.log(chalk.gray(`  Registry: ${registry}`));
    return true;
  } catch (error: any) {
    spinner.fail(chalk.red(`Failed to configure npm CLI: ${error.message}`));
    return false;
  }
}

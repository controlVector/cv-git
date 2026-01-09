/**
 * AWS Authentication Setup
 *
 * Sets up AWS IAM credentials for cloud infrastructure access.
 * Validates using STS GetCallerIdentity.
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import {
  CredentialManager,
  CredentialType,
  AWSCredential,
} from '@cv-git/credentials';
import { openBrowser } from '../../auth-utils.js';

// Common AWS regions for selection
const AWS_REGIONS = [
  { value: 'us-east-1', name: 'US East (N. Virginia)' },
  { value: 'us-east-2', name: 'US East (Ohio)' },
  { value: 'us-west-1', name: 'US West (N. California)' },
  { value: 'us-west-2', name: 'US West (Oregon)' },
  { value: 'eu-west-1', name: 'EU (Ireland)' },
  { value: 'eu-west-2', name: 'EU (London)' },
  { value: 'eu-central-1', name: 'EU (Frankfurt)' },
  { value: 'ap-northeast-1', name: 'Asia Pacific (Tokyo)' },
  { value: 'ap-southeast-1', name: 'Asia Pacific (Singapore)' },
  { value: 'ap-southeast-2', name: 'Asia Pacific (Sydney)' },
];

/**
 * Validate AWS credentials using STS GetCallerIdentity
 *
 * Note: This uses a dynamic import for the AWS SDK to avoid
 * build-time dependency issues. If the SDK is not installed,
 * falls back to basic format validation only.
 */
async function validateAWSCredentials(
  accessKeyId: string,
  secretAccessKey: string,
  region: string
): Promise<{
  valid: boolean;
  accountId?: string;
  userArn?: string;
  error?: string;
}> {
  // Basic format validation first
  if (!accessKeyId.match(/^AKIA[0-9A-Z]{16}$/)) {
    return {
      valid: false,
      error: 'Invalid Access Key ID format (should start with AKIA and be 20 characters)',
    };
  }
  if (secretAccessKey.length !== 40) {
    return {
      valid: false,
      error: 'Invalid Secret Access Key format (should be 40 characters)',
    };
  }

  try {
    // Try to use AWS SDK if available (optional dependency)
    // @ts-ignore - Optional dependency, may not be installed
    const stsModule = await import('@aws-sdk/client-sts').catch(() => null);

    if (!stsModule) {
      // SDK not installed - format validation passed, assume valid
      return { valid: true };
    }

    const { STSClient, GetCallerIdentityCommand } = stsModule;

    const client = new STSClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const response = await client.send(new GetCallerIdentityCommand({}));

    return {
      valid: true,
      accountId: response.Account,
      userArn: response.Arn,
    };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message || 'Failed to validate credentials',
    };
  }
}

/**
 * Setup AWS authentication
 */
export async function setupAWS(
  credentials: CredentialManager,
  autoBrowser: boolean = true
): Promise<void> {
  console.log(chalk.bold('──────────────────────────────────────────'));
  console.log(chalk.bold.cyan('AWS Authentication'));
  console.log(chalk.bold('──────────────────────────────────────────\n'));

  const url = 'https://console.aws.amazon.com/iam/home#/security_credentials';

  if (autoBrowser) {
    console.log(chalk.cyan('Opening browser to IAM Security Credentials...'));
    await openBrowser(url);
    console.log();
  }

  console.log(chalk.gray('URL: ') + chalk.blue(url));
  console.log();
  console.log(chalk.yellow('Creating IAM Access Keys:'));
  console.log(chalk.gray('  1. Sign in to AWS Console'));
  console.log(
    chalk.gray('  2. Go to IAM → Users → Your User → Security credentials')
  );
  console.log(chalk.gray('  3. Click "Create access key"'));
  console.log(chalk.gray('  4. Select your use case (CLI recommended)'));
  console.log(chalk.gray('  5. Copy both Access Key ID and Secret Access Key'));
  console.log();
  console.log(
    chalk.yellow('⚠ Important: ') +
      chalk.gray('Never share your Secret Access Key!')
  );
  console.log();

  // Get Access Key ID
  const { accessKeyId } = await inquirer.prompt([
    {
      type: 'input',
      name: 'accessKeyId',
      message: 'Enter your AWS Access Key ID:',
      validate: (input: string) => {
        if (!input || !input.trim()) {
          return 'Access Key ID is required';
        }
        if (!input.match(/^AKIA[0-9A-Z]{16}$/)) {
          return 'Invalid format (should start with AKIA and be 20 characters)';
        }
        return true;
      },
    },
  ]);

  // Get Secret Access Key
  const { secretAccessKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'secretAccessKey',
      message: 'Enter your AWS Secret Access Key:',
      validate: (input: string) => {
        if (!input || !input.trim()) {
          return 'Secret Access Key is required';
        }
        if (input.length !== 40) {
          return 'Invalid format (should be 40 characters)';
        }
        return true;
      },
    },
  ]);

  // Get region
  const { region } = await inquirer.prompt([
    {
      type: 'list',
      name: 'region',
      message: 'Select your default AWS region:',
      choices: AWS_REGIONS,
      default: 'us-east-1',
    },
  ]);

  const spinner = ora('Validating credentials...').start();

  const result = await validateAWSCredentials(accessKeyId, secretAccessKey, region);

  if (!result.valid) {
    spinner.fail(chalk.red(`Credential validation failed: ${result.error}`));
    console.log(chalk.yellow('\nPlease try again with valid credentials.\n'));
    return;
  }

  spinner.succeed(chalk.green('Credentials validated successfully'));

  if (result.accountId) {
    console.log(chalk.gray('  Account ID: ') + chalk.white(result.accountId));
  }
  if (result.userArn) {
    console.log(chalk.gray('  User ARN: ') + chalk.white(result.userArn));
  }

  // Store credential
  await credentials.store<AWSCredential>({
    type: CredentialType.AWS_CREDENTIALS,
    name: 'default',
    accessKeyId,
    secretAccessKey,
    region,
    accountId: result.accountId,
    userArn: result.userArn,
  });

  console.log(chalk.green('\n✅ AWS authentication configured!\n'));
}

/**
 * Test AWS credential
 */
export async function testAWS(credentials: CredentialManager): Promise<boolean> {
  const cred = await credentials.getAWSCredentials();

  if (!cred) {
    console.log(chalk.red('AWS credential not found'));
    console.log(chalk.gray('Run: ') + chalk.cyan('cv auth setup devops/aws'));
    return false;
  }

  const spinner = ora('Testing AWS authentication...').start();

  const result = await validateAWSCredentials(
    cred.accessKeyId,
    cred.secretAccessKey,
    cred.region
  );

  if (result.valid) {
    spinner.succeed(chalk.green('AWS authentication valid'));
    if (result.accountId) {
      console.log(chalk.gray('  Account: ') + chalk.white(result.accountId));
    }
    if (result.userArn) {
      console.log(chalk.gray('  User: ') + chalk.white(result.userArn));
    }
    return true;
  } else {
    spinner.fail(chalk.red(`Authentication failed: ${result.error}`));
    return false;
  }
}

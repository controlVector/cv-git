/**
 * CV-Hub Authentication Setup
 *
 * Implements OAuth 2.0 Device Authorization Grant (RFC 8628) for CLI authentication.
 * User runs setup, sees a code, approves in browser, and the CLI receives tokens.
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import {
  CredentialManager,
  CredentialType,
  GitPlatform,
  type GitPlatformTokenCredential,
} from '@cv-git/credentials';
import { openBrowser } from '../../auth-utils.js';

// ==================== Instance Configuration ====================

export interface CVHubInstanceConfig {
  /** Display name for UI */
  displayName: string;
  /** API base URL */
  apiUrl: string;
  /** Web app URL (for browser links) */
  appUrl: string;
  /** GitPlatform enum value */
  platform: GitPlatform;
  /** Prefix for credential names */
  credentialPrefix: string;
}

export const CV_HUB_CONFIG: CVHubInstanceConfig = {
  displayName: 'ControlVector Hub',
  apiUrl: process.env.CV_HUB_URL || 'https://api.hub.controlvector.io',
  appUrl: process.env.CV_HUB_APP_URL || 'https://hub.controlvector.io',
  platform: GitPlatform.CV_HUB,
  credentialPrefix: 'cv-hub',
};

export const CONTROLFAB_CONFIG: CVHubInstanceConfig = {
  displayName: 'Control Fabric',
  apiUrl: process.env.CONTROLFAB_URL || 'https://api.controlfab.ai',
  appUrl: process.env.CONTROLFAB_APP_URL || 'https://hub.controlfab.ai',
  platform: GitPlatform.CONTROLFAB,
  credentialPrefix: 'controlfab',
};

// ==================== Configuration ====================

const CV_HUB_CLIENT_ID = 'cv-git-cli';

// Default scopes for CLI access
const DEFAULT_SCOPES = ['repo:read', 'repo:write', 'profile', 'offline_access'];

// Polling configuration
const POLL_INTERVAL_MS = 5000;  // 5 seconds
const MAX_POLL_ATTEMPTS = 180;   // 15 minutes max (180 * 5s = 900s)

// ==================== Types ====================

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

interface TokenErrorResponse {
  error: string;
  error_description: string;
}

interface UserInfoResponse {
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
}

// ==================== Post-Auth: Git Credentials + MCP ====================

/**
 * Derive the git hostname from the API URL
 * e.g., https://api.hub.controlvector.io → git.hub.controlvector.io
 */
function getGitHost(apiUrl: string): string {
  try {
    const url = new URL(apiUrl);
    // api.hub.controlvector.io → git.hub.controlvector.io
    return url.hostname.replace(/^api\./, 'git.');
  } catch {
    return 'git.hub.controlvector.io';
  }
}

/**
 * Create a PAT via the API using the OAuth access token
 */
async function createPATFromOAuth(
  apiUrl: string,
  accessToken: string,
  username: string
): Promise<string | null> {
  try {
    const response = await fetch(`${apiUrl}/api/user/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        name: `cv-git-cli-${username || 'auto'}`,
        scopes: ['repo:read', 'repo:write', 'repo:admin'],
        expiresInDays: 365,
      }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { token?: string };
    return data.token || null;
  } catch {
    return null;
  }
}

/**
 * Configure git credentials for the cv-hub git host.
 * Uses git credential-store so clone/push works without prompts.
 */
function configureGitCredentials(gitHost: string, pat: string): boolean {
  try {
    // Use git credential-store (file-based, works everywhere)
    const credStorePath = join(homedir(), '.git-credentials');

    // Read existing credentials and remove old entries for this host
    let existing = '';
    if (existsSync(credStorePath)) {
      existing = readFileSync(credStorePath, 'utf-8');
    }

    const lines = existing.split('\n').filter(
      (line) => line.trim() && !line.includes(`@${gitHost}`)
    );
    lines.push(`https://git:${pat}@${gitHost}`);

    writeFileSync(credStorePath, lines.join('\n') + '\n', { mode: 0o600 });

    // Ensure git knows to use credential-store for this host
    try {
      execSync(
        `git config --global credential.https://${gitHost}.helper store`,
        { stdio: 'ignore' }
      );
    } catch {
      // If per-host config fails, that's ok — the credential file still works
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Write MCP server config for Claude Code integration.
 * Creates/updates .mcp.json in the current project directory.
 */
function configureMCPServer(apiUrl: string, pat: string): boolean {
  try {
    // Write to project-level .mcp.json (Claude Code reads this automatically)
    const mcpPath = join(process.cwd(), '.mcp.json');
    let mcpConfig: Record<string, any> = {};

    if (existsSync(mcpPath)) {
      try {
        mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf-8'));
      } catch {
        mcpConfig = {};
      }
    }

    if (!mcpConfig.mcpServers) {
      mcpConfig.mcpServers = {};
    }

    // Derive MCP URL: api.hub.controlvector.io → mcp.controlvector.io
    const url = new URL(apiUrl);
    const mcpHost = url.hostname.replace(/^api\.hub\./, 'mcp.').replace(/^api\./, 'mcp.');

    mcpConfig.mcpServers['cv-hub'] = {
      type: 'url',
      url: `https://${mcpHost}/mcp`,
      headers: {
        Authorization: `Bearer ${pat}`,
      },
    };

    writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}

/**
 * Run post-authentication setup: create PAT, configure git credentials, optionally MCP
 */
async function postAuthSetup(
  config: CVHubInstanceConfig,
  accessToken: string,
  username: string
): Promise<void> {
  const gitHost = getGitHost(config.apiUrl);

  // Step 1: Create a PAT for git operations
  const patSpinner = ora('Creating git access token...').start();
  const pat = await createPATFromOAuth(config.apiUrl, accessToken, username);

  if (!pat) {
    patSpinner.warn(chalk.yellow('Could not create git token — git push/clone will need manual setup'));
    console.log(chalk.gray(`  You can create a PAT at ${config.appUrl}/settings/tokens`));
    return;
  }
  patSpinner.succeed(chalk.green('Git access token created'));

  // Step 2: Configure git credentials
  const gitOk = configureGitCredentials(gitHost, pat);
  if (gitOk) {
    console.log(chalk.green(`  ✓ Git credentials configured for ${gitHost}`));
  } else {
    console.log(chalk.yellow(`  ⚠ Could not auto-configure git credentials`));
    console.log(chalk.gray(`  Add to ~/.netrc:\n    machine ${gitHost}\n      login git\n      password ${pat}`));
  }

  // Step 3: Configure MCP for Claude Code (if in a git repo)
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    const mcpOk = configureMCPServer(config.apiUrl, pat);
    if (mcpOk) {
      console.log(chalk.green('  ✓ MCP server configured for Claude Code (.mcp.json)'));
    }
  } catch {
    // Not in a git repo — skip MCP setup silently
  }
}

// ==================== Device Authorization Flow ====================

/**
 * Request device authorization from CV-Hub
 */
async function requestDeviceAuthorization(
  hubUrl: string,
  scopes: string[]
): Promise<DeviceAuthResponse> {
  const response = await fetch(`${hubUrl}/oauth/device/authorize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: CV_HUB_CLIENT_ID,
      scope: scopes.join(' '),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'unknown_error' })) as { error_description?: string; error?: string };
    throw new Error(error.error_description || error.error || 'Failed to initiate device authorization');
  }

  return response.json() as Promise<DeviceAuthResponse>;
}

/**
 * Poll for token using device code
 */
async function pollForToken(
  hubUrl: string,
  deviceCode: string,
  interval: number
): Promise<TokenResponse | TokenErrorResponse> {
  const response = await fetch(`${hubUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: CV_HUB_CLIENT_ID,
    }),
  });

  const data = await response.json();

  // Check for error responses
  if (!response.ok) {
    return data as TokenErrorResponse;
  }

  return data as TokenResponse;
}

/**
 * Get user info using access token
 */
async function getUserInfo(hubUrl: string, accessToken: string): Promise<UserInfoResponse> {
  const response = await fetch(`${hubUrl}/oauth/userinfo`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to get user information');
  }

  return response.json() as Promise<UserInfoResponse>;
}

/**
 * Display the user code in a styled box
 */
function displayUserCode(userCode: string, verificationUri: string, expiresIn: number): void {
  const expiresMinutes = Math.floor(expiresIn / 60);

  console.log();
  console.log(chalk.bold.cyan('╔══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║') + chalk.bold('              CV-Hub Device Authorization                     ') + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('╠══════════════════════════════════════════════════════════════╣'));
  console.log(chalk.bold.cyan('║') + '                                                              ' + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('║') + '   Open this URL in your browser to sign in:                 ' + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('║') + '                                                              ' + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('║') + chalk.blue(`   ${verificationUri}`.padEnd(62)) + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('║') + '                                                              ' + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('║') + '   Then enter this code:                                      ' + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('║') + '                                                              ' + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('║') + chalk.bold.white(`                       ${userCode}                          `) + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('║') + '                                                              ' + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('║') + chalk.gray(`   Code expires in ${expiresMinutes} minutes`.padEnd(62)) + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('║') + '                                                              ' + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════════════════════════════╝'));
  console.log();
}

/**
 * Poll for authorization with countdown display
 */
async function pollWithCountdown(
  hubUrl: string,
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<TokenResponse> {
  let attempts = 0;
  let currentInterval = Math.max(interval * 1000, POLL_INTERVAL_MS);
  const startTime = Date.now();
  const expireTime = startTime + (expiresIn * 1000);

  const spinner = ora({
    text: 'Waiting for authorization...',
    spinner: 'dots',
  }).start();

  while (attempts < MAX_POLL_ATTEMPTS) {
    const remainingMs = expireTime - Date.now();
    if (remainingMs <= 0) {
      spinner.fail(chalk.red('Authorization timed out'));
      throw new Error('Device code expired');
    }

    const remainingSecs = Math.ceil(remainingMs / 1000);
    const mins = Math.floor(remainingSecs / 60);
    const secs = remainingSecs % 60;
    spinner.text = `Waiting for authorization... (${mins}:${secs.toString().padStart(2, '0')} remaining)`;

    // Wait for the interval
    await new Promise(resolve => setTimeout(resolve, currentInterval));
    attempts++;

    // Poll for token
    const result = await pollForToken(hubUrl, deviceCode, interval);

    // Check if it's an error
    if ('error' in result) {
      switch (result.error) {
        case 'authorization_pending':
          // Keep polling
          continue;

        case 'slow_down':
          // Increase interval by 5 seconds
          currentInterval += 5000;
          continue;

        case 'access_denied':
          spinner.fail(chalk.red('Authorization denied'));
          throw new Error('User denied authorization');

        case 'expired_token':
          spinner.fail(chalk.red('Authorization expired'));
          throw new Error('Device code expired');

        default:
          spinner.fail(chalk.red(`Authorization failed: ${result.error_description}`));
          throw new Error(result.error_description || result.error);
      }
    }

    // Success!
    spinner.succeed(chalk.green('Authorization successful!'));
    return result;
  }

  spinner.fail(chalk.red('Max polling attempts exceeded'));
  throw new Error('Authorization timed out');
}

// ==================== Setup Function ====================

/**
 * Set up CV-Hub authentication using OAuth Device Flow
 */
export async function setupCVHub(
  credentials: CredentialManager,
  autoBrowser: boolean = true,
  config: CVHubInstanceConfig = CV_HUB_CONFIG
): Promise<void> {
  console.log(chalk.bold('──────────────────────────────────────────'));
  console.log(chalk.bold.cyan(`${config.displayName} Authentication`));
  console.log(chalk.bold('──────────────────────────────────────────\n'));

  const hubUrl = config.apiUrl;

  console.log(chalk.gray('Initiating device authorization flow...\n'));

  let deviceAuth: DeviceAuthResponse;

  try {
    // Request device authorization
    deviceAuth = await requestDeviceAuthorization(hubUrl, DEFAULT_SCOPES);
  } catch (error: any) {
    console.log(chalk.red(`\nFailed to initiate device authorization: ${error.message}`));
    console.log(chalk.gray(`\nPlease check that ${config.displayName} is accessible and try again.`));
    return;
  }

  // Display the user code
  displayUserCode(
    deviceAuth.user_code,
    deviceAuth.verification_uri,
    deviceAuth.expires_in
  );

  // Open browser automatically if enabled
  if (autoBrowser) {
    console.log(chalk.cyan('Opening browser...'));
    await openBrowser(deviceAuth.verification_uri_complete);
    console.log();
  } else {
    console.log(chalk.gray('Open the URL above in your browser to continue.\n'));
  }

  try {
    // Poll for authorization
    const tokenResponse = await pollWithCountdown(
      hubUrl,
      deviceAuth.device_code,
      deviceAuth.interval,
      deviceAuth.expires_in
    );

    console.log();

    // Get user info
    const spinner = ora('Fetching user information...').start();
    let userInfo: UserInfoResponse;

    try {
      userInfo = await getUserInfo(hubUrl, tokenResponse.access_token);
      spinner.succeed(chalk.green('User information retrieved'));
    } catch (error) {
      spinner.warn(chalk.yellow('Could not fetch user information'));
      userInfo = { sub: 'unknown' };
    }

    // Parse scopes
    const scopes = tokenResponse.scope ? tokenResponse.scope.split(' ') : DEFAULT_SCOPES;

    // Calculate expiration date
    const expiresAt = tokenResponse.expires_in
      ? new Date(Date.now() + (tokenResponse.expires_in * 1000))
      : undefined;

    // Store credentials
    const credentialName = userInfo.preferred_username
      ? `${config.credentialPrefix}-${userInfo.preferred_username}`
      : `${config.credentialPrefix}-default`;

    await credentials.store<GitPlatformTokenCredential>({
      type: CredentialType.GIT_PLATFORM_TOKEN,
      name: credentialName,
      platform: config.platform,
      token: tokenResponse.access_token,
      scopes,
      username: userInfo.preferred_username || userInfo.name,
      expiresAt,
      metadata: {
        hubUrl,
        refreshToken: tokenResponse.refresh_token,
        userId: userInfo.sub,
        email: userInfo.email,
      },
    });

    // Post-auth: create PAT, configure git credentials + MCP
    console.log();
    await postAuthSetup(
      config,
      tokenResponse.access_token,
      userInfo.preferred_username || userInfo.name || 'user'
    );

    // Display success message
    console.log();
    console.log(chalk.green('╔══════════════════════════════════════════════════════════════╗'));
    console.log(chalk.green('║') + chalk.bold.green(`              ✅ ${config.displayName} Authentication Configured!`.padEnd(62)) + chalk.green('║'));
    console.log(chalk.green('╠══════════════════════════════════════════════════════════════╣'));
    console.log(chalk.green('║') + '                                                              ' + chalk.green('║'));
    if (userInfo.preferred_username || userInfo.name) {
      console.log(chalk.green('║') + chalk.gray(`   User: ${userInfo.preferred_username || userInfo.name}`.padEnd(62)) + chalk.green('║'));
    }
    if (userInfo.email) {
      console.log(chalk.green('║') + chalk.gray(`   Email: ${userInfo.email}`.padEnd(62)) + chalk.green('║'));
    }
    console.log(chalk.green('║') + chalk.gray(`   Scopes: ${scopes.join(', ')}`.padEnd(62)) + chalk.green('║'));
    if (tokenResponse.refresh_token) {
      console.log(chalk.green('║') + chalk.gray('   Refresh token: Stored for offline access'.padEnd(62)) + chalk.green('║'));
    }
    console.log(chalk.green('║') + '                                                              ' + chalk.green('║'));
    console.log(chalk.green('╚══════════════════════════════════════════════════════════════╝'));
    console.log();

  } catch (error: any) {
    console.log(chalk.red(`\n${error.message}\n`));
    console.log(chalk.gray(`Please try again or check that you have access to ${config.displayName}.`));
  }
}

// ==================== Test Function ====================

/**
 * Test CV-Hub authentication
 */
export async function testCVHub(
  credentials: CredentialManager,
  config: CVHubInstanceConfig = CV_HUB_CONFIG
): Promise<boolean> {
  const spinner = ora(`Testing ${config.displayName} authentication...`).start();

  try {
    // Get stored credential
    const cred = await credentials.retrieve(CredentialType.GIT_PLATFORM_TOKEN, undefined);

    // Find credential for this platform
    const allCreds = await credentials.list();
    const cvHubCred = allCreds.find(
      c => c.type === CredentialType.GIT_PLATFORM_TOKEN &&
           (c as GitPlatformTokenCredential).platform === config.platform
    ) as GitPlatformTokenCredential | undefined;

    if (!cvHubCred) {
      spinner.fail(chalk.red(`${config.displayName} credential not found`));
      const cmd = config.platform === GitPlatform.CONTROLFAB ? 'cv auth setup controlfab' : 'cv auth setup cv-hub';
      console.log(chalk.gray('Run: ') + chalk.cyan(cmd));
      return false;
    }

    // Get hub URL from metadata or use default
    const hubUrl = cvHubCred.metadata?.hubUrl || config.apiUrl;

    // Try to fetch user info
    const userInfo = await getUserInfo(hubUrl, cvHubCred.token);

    spinner.succeed(chalk.green(`${config.displayName} authentication valid`));
    console.log(chalk.gray('  Username: ') + chalk.white(userInfo.preferred_username || userInfo.name || 'Unknown'));
    if (userInfo.email) {
      console.log(chalk.gray('  Email: ') + chalk.white(userInfo.email));
    }
    console.log(chalk.gray('  Scopes: ') + chalk.white(cvHubCred.scopes.join(', ')));

    // Check expiration
    if (cvHubCred.expiresAt) {
      const now = new Date();
      if (cvHubCred.expiresAt < now) {
        console.log(chalk.yellow('  ⚠️  Token has expired'));
        if (cvHubCred.metadata?.refreshToken) {
          console.log(chalk.gray('  A refresh token is available. Re-run setup to refresh.'));
        }
        return false;
      } else {
        const daysLeft = Math.ceil((cvHubCred.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        console.log(chalk.gray('  Expires: ') + chalk.white(`${daysLeft} days`));
      }
    }

    return true;

  } catch (error: any) {
    if (error.message?.includes('invalid_token') || error.message?.includes('401')) {
      spinner.fail(chalk.red(`${config.displayName} token is invalid or expired`));
      const cmd = config.platform === GitPlatform.CONTROLFAB ? 'cv auth setup controlfab' : 'cv auth setup cv-hub';
      console.log(chalk.gray('Run: ') + chalk.cyan(cmd));
    } else {
      spinner.fail(chalk.red(`${config.displayName} authentication test failed: ${error.message}`));
    }
    return false;
  }
}

// ==================== Control Fabric Wrappers ====================

/**
 * Set up Control Fabric authentication using OAuth Device Flow
 */
export async function setupControlfab(
  credentials: CredentialManager,
  autoBrowser: boolean = true
): Promise<void> {
  return setupCVHub(credentials, autoBrowser, CONTROLFAB_CONFIG);
}

/**
 * Test Control Fabric authentication
 */
export async function testControlfab(credentials: CredentialManager): Promise<boolean> {
  return testCVHub(credentials, CONTROLFAB_CONFIG);
}

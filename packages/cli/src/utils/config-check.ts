/**
 * Configuration and credential check utilities
 * Helps users understand what's configured and what's missing
 */

import chalk from 'chalk';
import {
  CredentialManager,
  CredentialType,
  GitPlatform,
} from '@cv-git/credentials';

export interface ConfigStatus {
  gitPlatforms: {
    github: boolean;
    gitlab: boolean;
    bitbucket: boolean;
  };
  embeddingProviders: {
    openai: boolean;
    openrouter: boolean;
  };
  aiProviders: {
    anthropic: boolean;
    openai: boolean;
  };
  allRequired: boolean;
  hasEmbeddings: boolean;
  hasGitPlatform: boolean;
}

/**
 * Check all configured credentials and return status
 */
export async function checkCredentials(): Promise<ConfigStatus> {
  const status: ConfigStatus = {
    gitPlatforms: {
      github: false,
      gitlab: false,
      bitbucket: false,
    },
    embeddingProviders: {
      openai: false,
      openrouter: false,
    },
    aiProviders: {
      anthropic: false,
      openai: false,
    },
    allRequired: false,
    hasEmbeddings: false,
    hasGitPlatform: false,
  };

  try {
    const credentials = new CredentialManager();
    await credentials.init();

    const allCreds = await credentials.list();

    for (const cred of allCreds) {
      if (cred.type === CredentialType.GIT_PLATFORM_TOKEN) {
        const platform = cred.metadata?.platform as string;
        if (platform === GitPlatform.GITHUB) status.gitPlatforms.github = true;
        if (platform === GitPlatform.GITLAB) status.gitPlatforms.gitlab = true;
        if (platform === GitPlatform.BITBUCKET) status.gitPlatforms.bitbucket = true;
      }
      if (cred.type === CredentialType.OPENAI_API) {
        status.embeddingProviders.openai = true;
        status.aiProviders.openai = true;
      }
      if (cred.type === CredentialType.OPENROUTER_API) {
        status.embeddingProviders.openrouter = true;
      }
      if (cred.type === CredentialType.ANTHROPIC_API) {
        status.aiProviders.anthropic = true;
      }
    }

    // Also check environment variables
    if (process.env.GITHUB_TOKEN) status.gitPlatforms.github = true;
    if (process.env.GITLAB_TOKEN) status.gitPlatforms.gitlab = true;
    if (process.env.OPENAI_API_KEY) {
      status.embeddingProviders.openai = true;
      status.aiProviders.openai = true;
    }
    if (process.env.OPENROUTER_API_KEY) status.embeddingProviders.openrouter = true;
    if (process.env.ANTHROPIC_API_KEY) status.aiProviders.anthropic = true;

  } catch {
    // Credential manager not available, check env vars only
    if (process.env.GITHUB_TOKEN) status.gitPlatforms.github = true;
    if (process.env.GITLAB_TOKEN) status.gitPlatforms.gitlab = true;
    if (process.env.OPENAI_API_KEY) {
      status.embeddingProviders.openai = true;
      status.aiProviders.openai = true;
    }
    if (process.env.OPENROUTER_API_KEY) status.embeddingProviders.openrouter = true;
    if (process.env.ANTHROPIC_API_KEY) status.aiProviders.anthropic = true;
  }

  // Compute aggregate status
  status.hasGitPlatform = status.gitPlatforms.github || status.gitPlatforms.gitlab || status.gitPlatforms.bitbucket;
  status.hasEmbeddings = status.embeddingProviders.openai || status.embeddingProviders.openrouter;
  status.allRequired = status.hasGitPlatform && status.hasEmbeddings;

  return status;
}

/**
 * Display configuration status to user
 */
export function displayConfigStatus(status: ConfigStatus, verbose: boolean = false): void {
  console.log();
  console.log(chalk.bold('Configuration Status:'));
  console.log(chalk.gray('─'.repeat(50)));

  // Git Platforms
  console.log();
  console.log(chalk.bold('  Git Platforms:'));
  if (status.hasGitPlatform) {
    if (status.gitPlatforms.github) {
      console.log(chalk.green('    ✓ GitHub configured'));
    }
    if (status.gitPlatforms.gitlab) {
      console.log(chalk.green('    ✓ GitLab configured'));
    }
    if (status.gitPlatforms.bitbucket) {
      console.log(chalk.green('    ✓ Bitbucket configured'));
    }
  } else {
    console.log(chalk.yellow('    ⚠ No git platform configured'));
    console.log(chalk.gray('      Run: cv auth setup github'));
    console.log(chalk.gray('       or: cv auth setup gitlab'));
  }

  // Embedding Providers
  console.log();
  console.log(chalk.bold('  Vector Embeddings (for semantic search):'));
  if (status.hasEmbeddings) {
    if (status.embeddingProviders.openai) {
      console.log(chalk.green('    ✓ OpenAI configured'));
    }
    if (status.embeddingProviders.openrouter) {
      console.log(chalk.green('    ✓ OpenRouter configured'));
    }
  } else {
    console.log(chalk.yellow('    ⚠ No embedding provider configured'));
    console.log(chalk.gray('      Run: cv auth setup openai'));
    console.log(chalk.gray('       or: cv auth setup openrouter'));
  }

  // AI Providers (optional)
  if (verbose) {
    console.log();
    console.log(chalk.bold('  AI Providers (for code explanation):'));
    if (status.aiProviders.anthropic || status.aiProviders.openai) {
      if (status.aiProviders.anthropic) {
        console.log(chalk.green('    ✓ Anthropic configured'));
      }
      if (status.aiProviders.openai) {
        console.log(chalk.green('    ✓ OpenAI configured'));
      }
    } else {
      console.log(chalk.gray('    ○ No AI provider configured (optional)'));
      console.log(chalk.gray('      Run: cv auth setup anthropic'));
    }
  }

  console.log(chalk.gray('─'.repeat(50)));
  console.log();
}

/**
 * Display a compact status line
 */
export function displayCompactStatus(status: ConfigStatus): void {
  const parts: string[] = [];

  // Git platform
  if (status.gitPlatforms.github) parts.push(chalk.green('GitHub'));
  else if (status.gitPlatforms.gitlab) parts.push(chalk.green('GitLab'));
  else if (status.gitPlatforms.bitbucket) parts.push(chalk.green('Bitbucket'));
  else parts.push(chalk.yellow('No Git'));

  // Embeddings
  if (status.embeddingProviders.openai) parts.push(chalk.green('OpenAI'));
  else if (status.embeddingProviders.openrouter) parts.push(chalk.green('OpenRouter'));
  else parts.push(chalk.yellow('No Embeddings'));

  console.log(chalk.gray('  Credentials: ') + parts.join(chalk.gray(' | ')));
}

/**
 * Check if setup is needed and prompt user
 */
export async function checkSetupNeeded(options: { quiet?: boolean; verbose?: boolean } = {}): Promise<{
  status: ConfigStatus;
  needsSetup: boolean;
}> {
  const status = await checkCredentials();
  const needsSetup = !status.hasGitPlatform || !status.hasEmbeddings;

  if (needsSetup && !options.quiet) {
    displayConfigStatus(status, options.verbose);

    if (!status.hasGitPlatform) {
      console.log(chalk.yellow('Tip: Configure a git platform to enable PR creation and repository operations.'));
    }
    if (!status.hasEmbeddings) {
      console.log(chalk.yellow('Tip: Configure an embedding provider to enable semantic code search.'));
    }
    console.log();
    console.log(chalk.cyan('Quick setup: ') + chalk.white('cv auth setup'));
    console.log();
  }

  return { status, needsSetup };
}

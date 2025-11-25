/**
 * Platform Adapter Factory
 *
 * Creates the appropriate platform adapter based on configuration.
 * This allows CV-Git to switch between different git hosting platforms
 * (GitHub, CV Platform, GitLab, etc.) with just a configuration change.
 */

import type { CredentialManager } from '@cv-git/credentials';
import { GitPlatform } from '@cv-git/credentials';
import type { GitPlatformAdapter } from './adapter.js';
import { GitHubAdapter } from './adapters/github.js';
import { GitLabAdapter } from './adapters/gitlab.js';
import { BitbucketAdapter } from './adapters/bitbucket.js';

/**
 * Platform configuration
 */
export interface PlatformConfig {
  /** Platform type */
  type: GitPlatform;

  /** Platform API URL (optional, uses default for known platforms) */
  apiUrl?: string;

  /** Platform web URL (optional, uses default for known platforms) */
  webUrl?: string;
}

/**
 * Create a platform adapter based on configuration
 *
 * @param config - Platform configuration
 * @param credentials - Credential manager
 * @returns Platform adapter instance
 */
export function createPlatformAdapter(
  config: PlatformConfig,
  credentials: CredentialManager
): GitPlatformAdapter {
  switch (config.type) {
    case GitPlatform.GITHUB:
      return new GitHubAdapter(credentials);

    case GitPlatform.CV_PLATFORM:
      // TODO: Implement CV Platform adapter when platform is built
      throw new Error('CV Platform adapter not yet implemented');

    case GitPlatform.GITLAB:
      return new GitLabAdapter(credentials, {
        apiUrl: config.apiUrl,
        webUrl: config.webUrl,
      });

    case GitPlatform.BITBUCKET:
      return new BitbucketAdapter(credentials, {
        apiUrl: config.apiUrl,
        webUrl: config.webUrl,
      });

    default:
      throw new Error(`Unknown platform type: ${config.type}`);
  }
}

/**
 * Auto-detect platform from git remote URL
 *
 * @param remoteUrl - Git remote URL
 * @returns Detected platform type
 */
export function detectPlatformFromRemote(remoteUrl: string): GitPlatform {
  if (remoteUrl.includes('github.com')) {
    return GitPlatform.GITHUB;
  } else if (remoteUrl.includes('gitlab.com')) {
    return GitPlatform.GITLAB;
  } else if (remoteUrl.includes('bitbucket.org')) {
    return GitPlatform.BITBUCKET;
  } else if (remoteUrl.includes('cv-platform.com')) {
    return GitPlatform.CV_PLATFORM;
  }

  // Default to GitHub if can't detect
  return GitPlatform.GITHUB;
}

/**
 * Get default API URL for a platform
 *
 * @param platform - Platform type
 * @returns Default API URL
 */
export function getDefaultApiUrl(platform: GitPlatform): string {
  switch (platform) {
    case GitPlatform.GITHUB:
      return 'https://api.github.com';
    case GitPlatform.CV_PLATFORM:
      return 'https://api.cv-platform.com';
    case GitPlatform.GITLAB:
      return 'https://gitlab.com/api/v4';
    case GitPlatform.BITBUCKET:
      return 'https://api.bitbucket.org/2.0';
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

/**
 * Get default web URL for a platform
 *
 * @param platform - Platform type
 * @returns Default web URL
 */
export function getDefaultWebUrl(platform: GitPlatform): string {
  switch (platform) {
    case GitPlatform.GITHUB:
      return 'https://github.com';
    case GitPlatform.CV_PLATFORM:
      return 'https://cv-platform.com';
    case GitPlatform.GITLAB:
      return 'https://gitlab.com';
    case GitPlatform.BITBUCKET:
      return 'https://bitbucket.org';
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

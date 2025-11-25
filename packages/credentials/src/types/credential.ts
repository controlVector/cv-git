/**
 * Platform-Agnostic Credential Types
 *
 * Designed to work with any git hosting platform (GitHub, CV Platform, GitLab, etc.)
 * and any AI service provider.
 */

export enum CredentialType {
  // Git hosting platforms (generic, platform-agnostic)
  GIT_PLATFORM_TOKEN = 'git_platform_token',
  GIT_PLATFORM_SSH = 'git_platform_ssh',

  // AI service providers
  ANTHROPIC_API = 'anthropic_api',
  OPENAI_API = 'openai_api',
  OPENROUTER_API = 'openrouter_api',

  // Generic credentials
  API_KEY = 'api_key',
}

/**
 * Platform types for git hosting
 */
export enum GitPlatform {
  GITHUB = 'github',
  CV_PLATFORM = 'cv-platform',
  GITLAB = 'gitlab',
  BITBUCKET = 'bitbucket',
}

/**
 * Base credential interface
 */
export interface BaseCredential {
  /** Unique identifier */
  id: string;

  /** Credential type */
  type: CredentialType;

  /** Human-readable name */
  name: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Last used timestamp */
  lastUsed?: Date;

  /** Additional metadata (non-sensitive) */
  metadata?: Record<string, any>;
}

/**
 * Git platform token credential (works with any git hosting platform)
 */
export interface GitPlatformTokenCredential extends BaseCredential {
  type: CredentialType.GIT_PLATFORM_TOKEN;

  /** The platform this token is for */
  platform: GitPlatform;

  /** The actual token value */
  token: string;

  /** Token scopes/permissions */
  scopes: string[];

  /** Username associated with token */
  username?: string;

  /** Token expiration date (if applicable) */
  expiresAt?: Date;
}

/**
 * SSH key credential for git operations
 */
export interface GitPlatformSSHCredential extends BaseCredential {
  type: CredentialType.GIT_PLATFORM_SSH;

  /** The platform this SSH key is for */
  platform: GitPlatform;

  /** Private key content */
  privateKey: string;

  /** Public key content */
  publicKey: string;

  /** Passphrase for encrypted key */
  passphrase?: string;
}

/**
 * Anthropic API key credential
 */
export interface AnthropicAPICredential extends BaseCredential {
  type: CredentialType.ANTHROPIC_API;

  /** API key */
  apiKey: string;

  /** Organization ID (optional) */
  organizationId?: string;
}

/**
 * OpenAI API key credential
 */
export interface OpenAIAPICredential extends BaseCredential {
  type: CredentialType.OPENAI_API;

  /** API key */
  apiKey: string;

  /** Organization ID (optional) */
  organizationId?: string;
}

/**
 * OpenRouter API key credential
 */
export interface OpenRouterAPICredential extends BaseCredential {
  type: CredentialType.OPENROUTER_API;

  /** API key */
  apiKey: string;
}

/**
 * Generic API key credential
 */
export interface APIKeyCredential extends BaseCredential {
  type: CredentialType.API_KEY;

  /** Service name */
  service: string;

  /** API key */
  apiKey: string;

  /** API endpoint (optional) */
  endpoint?: string;
}

/**
 * Union type of all credential types
 */
export type Credential =
  | GitPlatformTokenCredential
  | GitPlatformSSHCredential
  | AnthropicAPICredential
  | OpenAIAPICredential
  | OpenRouterAPICredential
  | APIKeyCredential;

/**
 * Credential creation input (without id, createdAt, lastUsed)
 */
export type CreateCredentialInput<T extends Credential = Credential> = Omit<
  T,
  'id' | 'createdAt' | 'lastUsed'
>;

/**
 * Credential update input (partial, except id and type)
 */
export type UpdateCredentialInput<T extends Credential = Credential> = Partial<
  Omit<T, 'id' | 'type' | 'createdAt'>
>;

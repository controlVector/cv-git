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

  // DNS providers
  CLOUDFLARE_API = 'cloudflare_api',

  // DevOps/Cloud providers
  AWS_CREDENTIALS = 'aws_credentials',
  DIGITALOCEAN_TOKEN = 'digitalocean_token',
  DIGITALOCEAN_SPACES = 'digitalocean_spaces',
  DIGITALOCEAN_APP = 'digitalocean_app',

  // Package registry/publish providers
  NPM_TOKEN = 'npm_token',
  // Future: PYPI_TOKEN, CRATES_IO_TOKEN, etc.

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

// =============================================================================
// DNS Provider Credentials
// =============================================================================

/**
 * Cloudflare API Token credential
 */
export interface CloudflareCredential extends BaseCredential {
  type: CredentialType.CLOUDFLARE_API;

  /** API token (scoped token, not global API key) */
  apiToken: string;

  /** Account ID (extracted during validation) */
  accountId?: string;

  /** Email associated with the account */
  email?: string;
}

// =============================================================================
// DevOps/Cloud Provider Credentials
// =============================================================================

/**
 * AWS IAM credentials
 */
export interface AWSCredential extends BaseCredential {
  type: CredentialType.AWS_CREDENTIALS;

  /** AWS Access Key ID */
  accessKeyId: string;

  /** AWS Secret Access Key */
  secretAccessKey: string;

  /** Default AWS region */
  region: string;

  /** AWS Account ID (extracted via STS GetCallerIdentity) */
  accountId?: string;

  /** IAM User ARN */
  userArn?: string;
}

/**
 * DigitalOcean API Token credential
 */
export interface DigitalOceanTokenCredential extends BaseCredential {
  type: CredentialType.DIGITALOCEAN_TOKEN;

  /** Personal access token */
  apiToken: string;

  /** Account email (extracted during validation) */
  accountEmail?: string;

  /** Account UUID */
  accountUuid?: string;
}

/**
 * DigitalOcean Spaces credential (S3-compatible object storage)
 */
export interface DigitalOceanSpacesCredential extends BaseCredential {
  type: CredentialType.DIGITALOCEAN_SPACES;

  /** Spaces access key */
  accessKey: string;

  /** Spaces secret key */
  secretKey: string;

  /** Spaces region (e.g., nyc3, sfo3, ams3, sgp1) */
  region: string;

  /** Spaces endpoint (e.g., nyc3.digitaloceanspaces.com) */
  endpoint?: string;
}

/**
 * DigitalOcean App Platform credential
 */
export interface DigitalOceanAppCredential extends BaseCredential {
  type: CredentialType.DIGITALOCEAN_APP;

  /** App Platform access token */
  appToken: string;

  /** App ID */
  appId?: string;
}

// =============================================================================
// Package Registry/Publish Credentials
// =============================================================================

/**
 * npm registry token credential
 */
export interface NPMCredential extends BaseCredential {
  type: CredentialType.NPM_TOKEN;

  /** npm auth token (automation or publish token) */
  token: string;

  /** npm registry URL (default: https://registry.npmjs.org/) */
  registry?: string;

  /** Username associated with the token */
  username?: string;

  /** Email associated with the token */
  email?: string;

  /** Token type: automation (CI/CD) or publish (interactive) */
  tokenType?: 'automation' | 'publish' | 'granular';
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
  | APIKeyCredential
  // DNS providers
  | CloudflareCredential
  // DevOps/Cloud providers
  | AWSCredential
  | DigitalOceanTokenCredential
  | DigitalOceanSpacesCredential
  | DigitalOceanAppCredential
  // Package registry/publish providers
  | NPMCredential;

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

/**
 * Credential Manager
 *
 * High-level API for managing credentials across different services and platforms.
 * Handles:
 * - Secure storage (OS keychain or encrypted file)
 * - CRUD operations on credentials
 * - Migration from environment variables
 * - Platform-agnostic credential access
 */

import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  CredentialStorage,
  KeychainStorage,
  PlainFileStorage,
} from './storage/index.js';
import {
  Credential,
  CredentialType,
  GitPlatform,
  BaseCredential,
  CreateCredentialInput,
  GitPlatformTokenCredential,
  AnthropicAPICredential,
  OpenAIAPICredential,
  OpenRouterAPICredential,
  // DNS providers
  CloudflareCredential,
  // DevOps/Cloud providers
  AWSCredential,
  DigitalOceanTokenCredential,
  DigitalOceanSpacesCredential,
  DigitalOceanAppCredential,
  // Package registry/publish providers
  NPMCredential,
} from './types/index.js';

export interface CredentialManagerOptions {
  /** Preferred storage backend */
  storage?: CredentialStorage;

  /** Path to metadata file */
  metadataPath?: string;
}

export class CredentialManager {
  private storage: CredentialStorage;
  private metadataPath: string;
  private initialized: boolean = false;

  constructor(options?: CredentialManagerOptions) {
    this.metadataPath =
      options?.metadataPath ||
      path.join(os.homedir(), '.cv-git', 'credentials-metadata.json');

    // Use provided storage or start with keychain (will validate on init)
    this.storage = options?.storage || new KeychainStorage();
  }

  /**
   * Initialize storage and validate it's available
   * Automatically falls back to plain file storage if keychain unavailable
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    const isAvailable = await this.storage.isAvailable();

    if (!isAvailable && this.storage.getName() === 'keychain') {
      // Fall back to plain file storage (like aws, gh, gcloud)
      this.storage = new PlainFileStorage();
    }

    this.initialized = true;
  }

  /**
   * Get the current storage backend name
   */
  getStorageBackend(): string {
    return this.storage.getName();
  }

  /**
   * Make storage key from credential type and name
   */
  private makeKey(type: CredentialType, name: string): string {
    return `${type}:${name}`;
  }

  /**
   * Serialize credential for storage
   */
  private serializeCredential(credential: Credential): string {
    return JSON.stringify(credential);
  }

  /**
   * Deserialize credential from storage
   */
  private deserializeCredential(value: string): Credential {
    return JSON.parse(value) as Credential;
  }

  /**
   * Store a credential
   */
  async store<T extends Credential>(input: CreateCredentialInput<T>): Promise<T> {
    await this.init();

    // Generate ID if not provided
    const credential = {
      ...input,
      id: randomBytes(16).toString('hex'),
      createdAt: new Date(),
    } as T;

    // Store the credential value
    const key = this.makeKey(credential.type, credential.name);
    const value = this.serializeCredential(credential);
    await this.storage.store(key, value);

    // Store metadata separately (unencrypted, no sensitive data)
    await this.storeMetadata(credential);

    return credential;
  }

  /**
   * Retrieve a credential by type and name
   */
  async retrieve(type: CredentialType, name?: string): Promise<Credential | null> {
    await this.init();

    // If no name provided, get the first credential of this type
    if (!name) {
      const metadata = await this.loadMetadata();
      const match = metadata.find((m) => m.type === type);
      if (!match) return null;
      name = match.name;
    }

    const key = this.makeKey(type, name);
    const value = await this.storage.retrieve(key);
    if (!value) return null;

    const credential = this.deserializeCredential(value);

    // Update last used timestamp
    await this.updateLastUsed(credential);

    return credential;
  }

  /**
   * Update a credential
   */
  async update<T extends Credential>(
    type: CredentialType,
    name: string,
    updates: Partial<T>
  ): Promise<T> {
    await this.init();

    const existing = await this.retrieve(type, name);
    if (!existing) {
      throw new Error(`Credential not found: ${type}:${name}`);
    }

    const updated = {
      ...existing,
      ...updates,
      // Don't allow changing these fields
      id: existing.id,
      type: existing.type,
      createdAt: existing.createdAt,
    } as T;

    const key = this.makeKey(type, name);
    const value = this.serializeCredential(updated);
    await this.storage.store(key, value);

    await this.storeMetadata(updated);

    return updated;
  }

  /**
   * Delete a credential
   */
  async delete(type: CredentialType, name: string): Promise<void> {
    await this.init();

    const key = this.makeKey(type, name);
    await this.storage.delete(key);
    await this.deleteMetadata(type, name);
  }

  /**
   * List all credentials (metadata only, no secrets)
   */
  async list(): Promise<BaseCredential[]> {
    await this.init();
    return await this.loadMetadata();
  }

  // ============================================================================
  // Convenience Methods for Common Credential Types
  // ============================================================================

  /**
   * Get git platform token (for any platform: GitHub, CV Platform, etc.)
   *
   * Resolution order for platform-specific lookups:
   * 1. Direct credential (authMethod !== 'cv-hub-proxy') — preferred
   * 2. Proxy credential (authMethod === 'cv-hub-proxy') — fallback
   * 3. On-demand fetch from CV-Hub if connected — last resort
   */
  async getGitPlatformToken(platform?: GitPlatform): Promise<string | null> {
    await this.init();

    if (platform) {
      const metadata = await this.loadMetadata();
      const platformCreds = metadata.filter(
        (m) =>
          m.type === CredentialType.GIT_PLATFORM_TOKEN &&
          m.metadata?.platform === platform
      );

      // 1. Prefer direct credentials
      const directMatch = platformCreds.find(
        (m) => m.metadata?.authMethod !== 'cv-hub-proxy'
      );
      if (directMatch) {
        const cred = await this.retrieve(CredentialType.GIT_PLATFORM_TOKEN, directMatch.name);
        return cred ? (cred as GitPlatformTokenCredential).token : null;
      }

      // 2. Fall back to proxy credentials
      const proxyMatch = platformCreds.find(
        (m) => m.metadata?.authMethod === 'cv-hub-proxy'
      );
      if (proxyMatch) {
        const cred = await this.retrieve(CredentialType.GIT_PLATFORM_TOKEN, proxyMatch.name) as GitPlatformTokenCredential | null;
        if (cred) {
          // Auto-refresh if expired
          if (cred.expiresAt && new Date(cred.expiresAt) < new Date()) {
            const refreshed = await this.refreshProxiedToken(platform, cred);
            return refreshed;
          }
          return cred.token;
        }
      }

      // 3. Try on-demand fetch from CV-Hub
      const proxiedToken = await this.getProxiedToken(platform);
      if (proxiedToken) return proxiedToken;

      return null;
    }

    // Get any git platform token (first one found)
    const cred = await this.retrieve(CredentialType.GIT_PLATFORM_TOKEN);
    return cred ? (cred as GitPlatformTokenCredential).token : null;
  }

  /**
   * Fetch a platform token on-demand from CV-Hub proxy
   */
  private async getProxiedToken(platform: GitPlatform): Promise<string | null> {
    try {
      // Find CV-Hub credential
      const metadata = await this.loadMetadata();
      const cvHubCred = metadata.find(
        (m) => m.type === CredentialType.GIT_PLATFORM_TOKEN &&
               m.metadata?.platform === 'cv-hub'
      );
      if (!cvHubCred) return null;

      const cred = await this.retrieve(CredentialType.GIT_PLATFORM_TOKEN, cvHubCred.name) as GitPlatformTokenCredential | null;
      if (!cred) return null;

      const hubUrl = cred.metadata?.hubUrl || 'https://api.controlfab.ai';
      const response = await fetch(`${hubUrl}/api/v1/git-proxy/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cred.token}`,
        },
        body: JSON.stringify({ platform }),
      });

      if (!response.ok) return null;

      const data = await response.json() as {
        token: string;
        expires_in?: number;
        proxy_token_id?: string;
        username?: string;
        scopes?: string[];
      };

      // Store the proxied token for future use
      const expiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined;

      await this.store<GitPlatformTokenCredential>({
        type: CredentialType.GIT_PLATFORM_TOKEN,
        name: `${platform}-proxy`,
        platform,
        token: data.token,
        scopes: data.scopes || [],
        username: data.username,
        expiresAt,
        metadata: {
          authMethod: 'cv-hub-proxy',
          hubUrl,
          cvHubCredentialName: cvHubCred.name,
          proxyTokenId: data.proxy_token_id,
        },
      });

      return data.token;
    } catch {
      return null;
    }
  }

  /**
   * Refresh an expired proxied token via CV-Hub
   */
  private async refreshProxiedToken(
    platform: GitPlatform,
    expiredCred: GitPlatformTokenCredential
  ): Promise<string | null> {
    try {
      const hubUrl = expiredCred.metadata?.hubUrl || 'https://api.controlfab.ai';
      const cvHubCredName = expiredCred.metadata?.cvHubCredentialName;
      if (!cvHubCredName) return null;

      // Get CV-Hub access token
      const cvHubCred = await this.retrieve(CredentialType.GIT_PLATFORM_TOKEN, cvHubCredName) as GitPlatformTokenCredential | null;
      if (!cvHubCred) return null;

      const response = await fetch(`${hubUrl}/api/v1/git-proxy/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cvHubCred.token}`,
        },
        body: JSON.stringify({
          platform,
          proxy_token_id: expiredCred.metadata?.proxyTokenId,
        }),
      });

      if (!response.ok) return null;

      const data = await response.json() as {
        token: string;
        expires_in?: number;
        proxy_token_id?: string;
      };

      // Update stored credential
      const expiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined;

      await this.update<GitPlatformTokenCredential>(
        CredentialType.GIT_PLATFORM_TOKEN,
        expiredCred.name,
        {
          token: data.token,
          expiresAt,
          metadata: {
            ...expiredCred.metadata,
            proxyTokenId: data.proxy_token_id || expiredCred.metadata?.proxyTokenId,
          },
        }
      );

      return data.token;
    } catch {
      return null;
    }
  }

  /**
   * Get Anthropic API key
   */
  async getAnthropicKey(): Promise<string | null> {
    const cred = await this.retrieve(CredentialType.ANTHROPIC_API);
    return cred ? (cred as AnthropicAPICredential).apiKey : null;
  }

  /**
   * Get OpenAI API key
   */
  async getOpenAIKey(): Promise<string | null> {
    const cred = await this.retrieve(CredentialType.OPENAI_API);
    return cred ? (cred as OpenAIAPICredential).apiKey : null;
  }

  /**
   * Get OpenRouter API key
   */
  async getOpenRouterKey(): Promise<string | null> {
    const cred = await this.retrieve(CredentialType.OPENROUTER_API);
    return cred ? (cred as OpenRouterAPICredential).apiKey : null;
  }

  // ============================================================================
  // DNS Provider Credentials
  // ============================================================================

  /**
   * Get Cloudflare API token
   */
  async getCloudflareToken(): Promise<string | null> {
    const cred = await this.retrieve(CredentialType.CLOUDFLARE_API);
    return cred ? (cred as CloudflareCredential).apiToken : null;
  }

  /**
   * Get full Cloudflare credential (includes account ID, email)
   */
  async getCloudflareCredential(): Promise<CloudflareCredential | null> {
    const cred = await this.retrieve(CredentialType.CLOUDFLARE_API);
    return cred as CloudflareCredential | null;
  }

  // ============================================================================
  // DevOps/Cloud Provider Credentials
  // ============================================================================

  /**
   * Get AWS credentials
   */
  async getAWSCredentials(): Promise<AWSCredential | null> {
    const cred = await this.retrieve(CredentialType.AWS_CREDENTIALS);
    return cred as AWSCredential | null;
  }

  /**
   * Get DigitalOcean API token
   */
  async getDigitalOceanToken(): Promise<string | null> {
    const cred = await this.retrieve(CredentialType.DIGITALOCEAN_TOKEN);
    return cred ? (cred as DigitalOceanTokenCredential).apiToken : null;
  }

  /**
   * Get full DigitalOcean token credential
   */
  async getDigitalOceanCredential(): Promise<DigitalOceanTokenCredential | null> {
    const cred = await this.retrieve(CredentialType.DIGITALOCEAN_TOKEN);
    return cred as DigitalOceanTokenCredential | null;
  }

  /**
   * Get DigitalOcean Spaces credentials
   */
  async getDigitalOceanSpaces(): Promise<DigitalOceanSpacesCredential | null> {
    const cred = await this.retrieve(CredentialType.DIGITALOCEAN_SPACES);
    return cred as DigitalOceanSpacesCredential | null;
  }

  /**
   * Get DigitalOcean App Platform credential
   */
  async getDigitalOceanApp(): Promise<DigitalOceanAppCredential | null> {
    const cred = await this.retrieve(CredentialType.DIGITALOCEAN_APP);
    return cred as DigitalOceanAppCredential | null;
  }

  // ============================================================================
  // Package Registry/Publish Credentials
  // ============================================================================

  /**
   * Get npm token
   */
  async getNPMToken(): Promise<string | null> {
    const cred = await this.retrieve(CredentialType.NPM_TOKEN);
    return cred ? (cred as NPMCredential).token : null;
  }

  /**
   * Get full npm credential
   */
  async getNPMCredential(): Promise<NPMCredential | null> {
    const cred = await this.retrieve(CredentialType.NPM_TOKEN);
    return cred as NPMCredential | null;
  }

  // ============================================================================
  // Migration from Environment Variables
  // ============================================================================

  /**
   * Migrate credentials from environment variables
   */
  async migrateFromEnv(): Promise<{
    migrated: string[];
    skipped: string[];
  }> {
    await this.init();

    const migrations: Array<{
      envVar: string;
      type: CredentialType;
      name: string;
      platform?: GitPlatform;
      pairedEnvVar?: string; // For credentials that need multiple env vars
    }> = [
      // Git platforms
      {
        envVar: 'GITHUB_TOKEN',
        type: CredentialType.GIT_PLATFORM_TOKEN,
        name: 'github-default',
        platform: GitPlatform.GITHUB,
      },
      // AI providers
      {
        envVar: 'ANTHROPIC_API_KEY',
        type: CredentialType.ANTHROPIC_API,
        name: 'default',
      },
      {
        envVar: 'OPENAI_API_KEY',
        type: CredentialType.OPENAI_API,
        name: 'default',
      },
      {
        envVar: 'OPENROUTER_API_KEY',
        type: CredentialType.OPENROUTER_API,
        name: 'default',
      },
      // DNS providers
      {
        envVar: 'CLOUDFLARE_API_TOKEN',
        type: CredentialType.CLOUDFLARE_API,
        name: 'default',
      },
      {
        envVar: 'CF_API_TOKEN',
        type: CredentialType.CLOUDFLARE_API,
        name: 'default',
      },
      // DevOps - AWS
      {
        envVar: 'AWS_ACCESS_KEY_ID',
        type: CredentialType.AWS_CREDENTIALS,
        name: 'default',
        pairedEnvVar: 'AWS_SECRET_ACCESS_KEY',
      },
      // DevOps - DigitalOcean
      {
        envVar: 'DIGITALOCEAN_TOKEN',
        type: CredentialType.DIGITALOCEAN_TOKEN,
        name: 'default',
      },
      {
        envVar: 'DO_TOKEN',
        type: CredentialType.DIGITALOCEAN_TOKEN,
        name: 'default',
      },
      {
        envVar: 'SPACES_ACCESS_KEY_ID',
        type: CredentialType.DIGITALOCEAN_SPACES,
        name: 'default',
        pairedEnvVar: 'SPACES_SECRET_ACCESS_KEY',
      },
      // Package registry/publish
      {
        envVar: 'NPM_TOKEN',
        type: CredentialType.NPM_TOKEN,
        name: 'default',
      },
      {
        envVar: 'NPM_AUTH_TOKEN',
        type: CredentialType.NPM_TOKEN,
        name: 'default',
      },
    ];

    const migrated: string[] = [];
    const skipped: string[] = [];

    for (const { envVar, type, name, platform, pairedEnvVar } of migrations) {
      const value = process.env[envVar];

      if (!value || !value.trim()) {
        skipped.push(envVar);
        continue;
      }

      // For paired env vars (like AWS), check if the paired var exists too
      if (pairedEnvVar && (!process.env[pairedEnvVar] || !process.env[pairedEnvVar]?.trim())) {
        skipped.push(`${envVar} (missing ${pairedEnvVar})`);
        continue;
      }

      // Check if already exists
      const existing = await this.retrieve(type, name);
      if (existing) {
        skipped.push(`${envVar} (already exists)`);
        continue;
      }

      // Migrate based on type
      if (type === CredentialType.GIT_PLATFORM_TOKEN && platform) {
        await this.store<GitPlatformTokenCredential>({
          type: CredentialType.GIT_PLATFORM_TOKEN,
          name,
          platform,
          token: value,
          scopes: [], // Unknown from env var
        });
      } else if (type === CredentialType.ANTHROPIC_API) {
        await this.store<AnthropicAPICredential>({
          type: CredentialType.ANTHROPIC_API,
          name,
          apiKey: value,
        });
      } else if (type === CredentialType.OPENAI_API) {
        await this.store<OpenAIAPICredential>({
          type: CredentialType.OPENAI_API,
          name,
          apiKey: value,
        });
      } else if (type === CredentialType.OPENROUTER_API) {
        await this.store<OpenRouterAPICredential>({
          type: CredentialType.OPENROUTER_API,
          name,
          apiKey: value,
        });
      } else if (type === CredentialType.CLOUDFLARE_API) {
        await this.store<CloudflareCredential>({
          type: CredentialType.CLOUDFLARE_API,
          name,
          apiToken: value,
        });
      } else if (type === CredentialType.AWS_CREDENTIALS) {
        await this.store<AWSCredential>({
          type: CredentialType.AWS_CREDENTIALS,
          name,
          accessKeyId: value,
          secretAccessKey: process.env[pairedEnvVar!]!,
          region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
        });
      } else if (type === CredentialType.DIGITALOCEAN_TOKEN) {
        await this.store<DigitalOceanTokenCredential>({
          type: CredentialType.DIGITALOCEAN_TOKEN,
          name,
          apiToken: value,
        });
      } else if (type === CredentialType.DIGITALOCEAN_SPACES) {
        await this.store<DigitalOceanSpacesCredential>({
          type: CredentialType.DIGITALOCEAN_SPACES,
          name,
          accessKey: value,
          secretKey: process.env[pairedEnvVar!]!,
          region: process.env.SPACES_REGION || 'nyc3',
        });
      }

      migrated.push(envVar);
    }

    return { migrated, skipped };
  }

  // ============================================================================
  // Metadata Management (non-sensitive credential info)
  // ============================================================================

  private async storeMetadata(credential: Credential): Promise<void> {
    const metadata = await this.loadMetadata();

    // Remove old metadata for same credential
    const filtered = metadata.filter(
      (m) => !(m.type === credential.type && m.name === credential.name)
    );

    // Extract non-sensitive fields
    const { id, type, name, createdAt, lastUsed } = credential;
    const credentialMetadata: BaseCredential = {
      id,
      type,
      name,
      createdAt,
      lastUsed,
      metadata: this.extractNonSensitiveMetadata(credential),
    };

    filtered.push(credentialMetadata);
    await this.saveMetadata(filtered);
  }

  private extractNonSensitiveMetadata(credential: Credential): Record<string, any> {
    const metadata: Record<string, any> = {};

    // Git platform
    if ('platform' in credential) {
      metadata.platform = credential.platform;
    }

    if ('username' in credential && credential.username) {
      metadata.username = credential.username;
    }

    if ('expiresAt' in credential && credential.expiresAt) {
      metadata.expiresAt = credential.expiresAt;
    }

    // Cloudflare
    if ('accountId' in credential && credential.accountId) {
      metadata.accountId = credential.accountId;
    }

    if ('email' in credential && credential.email) {
      metadata.email = credential.email;
    }

    // AWS
    if ('region' in credential && credential.region) {
      metadata.region = credential.region;
    }

    if ('userArn' in credential && credential.userArn) {
      metadata.userArn = credential.userArn;
    }

    // DigitalOcean
    if ('accountEmail' in credential && credential.accountEmail) {
      metadata.accountEmail = credential.accountEmail;
    }

    if ('accountUuid' in credential && credential.accountUuid) {
      metadata.accountUuid = credential.accountUuid;
    }

    if ('endpoint' in credential && credential.endpoint) {
      metadata.endpoint = credential.endpoint;
    }

    if ('appId' in credential && credential.appId) {
      metadata.appId = credential.appId;
    }

    return metadata;
  }

  private async deleteMetadata(type: CredentialType, name: string): Promise<void> {
    const metadata = await this.loadMetadata();
    const filtered = metadata.filter((m) => !(m.type === type && m.name === name));
    await this.saveMetadata(filtered);
  }

  private async updateLastUsed(credential: Credential): Promise<void> {
    const metadata = await this.loadMetadata();
    const match = metadata.find(
      (m) => m.type === credential.type && m.name === credential.name
    );

    if (match) {
      match.lastUsed = new Date();
      await this.saveMetadata(metadata);
    }
  }

  private async loadMetadata(): Promise<BaseCredential[]> {
    try {
      const data = await fs.readFile(this.metadataPath, 'utf8');
      const parsed = JSON.parse(data);

      // Convert date strings back to Date objects
      return parsed.map((item: any) => ({
        ...item,
        createdAt: new Date(item.createdAt),
        lastUsed: item.lastUsed ? new Date(item.lastUsed) : undefined,
      }));
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async saveMetadata(metadata: BaseCredential[]): Promise<void> {
    const dir = path.dirname(this.metadataPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.metadataPath, JSON.stringify(metadata, null, 2), {
      mode: 0o600,
    });
  }
}

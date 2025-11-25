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
  EncryptedFileStorage,
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
} from './types/index.js';

export interface CredentialManagerOptions {
  /** Preferred storage backend */
  storage?: CredentialStorage;

  /** Path to metadata file */
  metadataPath?: string;

  /** Master password for encrypted storage (if used) */
  masterPassword?: string;
}

export class CredentialManager {
  private storage: CredentialStorage;
  private metadataPath: string;

  constructor(options?: CredentialManagerOptions) {
    this.metadataPath =
      options?.metadataPath ||
      path.join(os.homedir(), '.cv', 'credentials-metadata.json');

    // Use provided storage or auto-detect best option
    if (options?.storage) {
      this.storage = options.storage;
    } else {
      this.storage = this.detectStorage(options?.masterPassword);
    }
  }

  /**
   * Auto-detect best available storage backend
   */
  private detectStorage(masterPassword?: string): CredentialStorage {
    // Try keychain first (most secure)
    const keychain = new KeychainStorage();

    // We can't use async in constructor, so we'll validate on first use
    // For now, default to keychain and fall back if needed

    return keychain;
  }

  /**
   * Initialize storage and validate it's available
   */
  async init(): Promise<void> {
    const isAvailable = await this.storage.isAvailable();

    if (!isAvailable) {
      console.warn(
        `⚠️  ${this.storage.getName()} storage not available, falling back to encrypted file`
      );

      // Fall back to encrypted file storage
      const masterPassword =
        process.env.CV_MASTER_PASSWORD ||
        (() => {
          throw new Error(
            'Keychain not available. Set CV_MASTER_PASSWORD environment variable.'
          );
        })();

      this.storage = new EncryptedFileStorage(masterPassword);
    }
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
   */
  async getGitPlatformToken(platform?: GitPlatform): Promise<string | null> {
    await this.init();

    if (platform) {
      // Get token for specific platform
      const metadata = await this.loadMetadata();
      const match = metadata.find(
        (m) =>
          m.type === CredentialType.GIT_PLATFORM_TOKEN &&
          (m.metadata?.platform === platform)
      );

      if (!match) return null;

      const cred = await this.retrieve(CredentialType.GIT_PLATFORM_TOKEN, match.name);
      return cred ? (cred as GitPlatformTokenCredential).token : null;
    }

    // Get any git platform token (first one found)
    const cred = await this.retrieve(CredentialType.GIT_PLATFORM_TOKEN);
    return cred ? (cred as GitPlatformTokenCredential).token : null;
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
    }> = [
      {
        envVar: 'GITHUB_TOKEN',
        type: CredentialType.GIT_PLATFORM_TOKEN,
        name: 'github-default',
        platform: GitPlatform.GITHUB,
      },
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
    ];

    const migrated: string[] = [];
    const skipped: string[] = [];

    for (const { envVar, type, name, platform } of migrations) {
      const value = process.env[envVar];

      if (!value || !value.trim()) {
        skipped.push(envVar);
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

    if ('platform' in credential) {
      metadata.platform = credential.platform;
    }

    if ('username' in credential && credential.username) {
      metadata.username = credential.username;
    }

    if ('expiresAt' in credential && credential.expiresAt) {
      metadata.expiresAt = credential.expiresAt;
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

/**
 * Example Implementation: Credential Management
 *
 * This file demonstrates the core credential management system
 * that will be built in Phase 5A.
 *
 * Location: packages/credentials/src/
 */

// ============================================================================
// 1. Credential Types
// ============================================================================

export enum CredentialType {
  GITHUB_PAT = 'github_pat',
  GITHUB_SSH = 'github_ssh',
  ANTHROPIC_API = 'anthropic_api',
  OPENAI_API = 'openai_api',
  GIT_CREDENTIALS = 'git_credentials',
}

export interface BaseCredential {
  id: string;
  type: CredentialType;
  name: string;
  createdAt: Date;
  lastUsed?: Date;
  metadata?: Record<string, any>;
}

export interface GitHubPATCredential extends BaseCredential {
  type: CredentialType.GITHUB_PAT;
  token: string;
  scopes: string[];
  username?: string;
  expiresAt?: Date;
}

export interface AnthropicAPICredential extends BaseCredential {
  type: CredentialType.ANTHROPIC_API;
  apiKey: string;
}

export interface OpenAIAPICredential extends BaseCredential {
  type: CredentialType.OPENAI_API;
  apiKey: string;
}

export type Credential =
  | GitHubPATCredential
  | AnthropicAPICredential
  | OpenAIAPICredential;

// ============================================================================
// 2. Storage Interface
// ============================================================================

export interface CredentialStorage {
  /**
   * Store a credential securely
   */
  store(key: string, value: string): Promise<void>;

  /**
   * Retrieve a credential
   */
  retrieve(key: string): Promise<string | null>;

  /**
   * Delete a credential
   */
  delete(key: string): Promise<void>;

  /**
   * List all stored credential keys
   */
  list(): Promise<string[]>;

  /**
   * Check if storage is available
   */
  isAvailable(): Promise<boolean>;
}

// ============================================================================
// 3. Keychain Storage (macOS, Windows, Linux)
// ============================================================================

import keytar from 'keytar';

export class KeychainStorage implements CredentialStorage {
  private serviceName = 'cv-git';

  async store(key: string, value: string): Promise<void> {
    await keytar.setPassword(this.serviceName, key, value);
  }

  async retrieve(key: string): Promise<string | null> {
    return await keytar.getPassword(this.serviceName, key);
  }

  async delete(key: string): Promise<void> {
    const deleted = await keytar.deletePassword(this.serviceName, key);
    if (!deleted) {
      throw new Error(`Credential not found: ${key}`);
    }
  }

  async list(): Promise<string[]> {
    const credentials = await keytar.findCredentials(this.serviceName);
    return credentials.map((c) => c.account);
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Test by storing and deleting a dummy value
      const testKey = '__cv_git_test__';
      await this.store(testKey, 'test');
      await this.delete(testKey);
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// 4. Encrypted File Storage (Fallback)
// ============================================================================

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2 } from 'crypto';
import { promises as fs } from 'fs';
import { promisify } from 'util';

const pbkdf2Async = promisify(pbkdf2);

export class EncryptedFileStorage implements CredentialStorage {
  private filePath: string;
  private masterPassword: string;
  private algorithm = 'aes-256-gcm';
  private keyLength = 32;
  private saltLength = 64;
  private ivLength = 16;

  constructor(filePath: string, masterPassword: string) {
    this.filePath = filePath;
    this.masterPassword = masterPassword;
  }

  /**
   * Derive encryption key from master password
   */
  private async deriveKey(salt: Buffer): Promise<Buffer> {
    return (await pbkdf2Async(
      this.masterPassword,
      salt,
      100000, // iterations
      this.keyLength,
      'sha256'
    )) as Buffer;
  }

  /**
   * Encrypt data
   */
  private async encrypt(plaintext: string): Promise<string> {
    const salt = randomBytes(this.saltLength);
    const iv = randomBytes(this.ivLength);
    const key = await this.deriveKey(salt);

    const cipher = createCipheriv(this.algorithm, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Format: salt:iv:authTag:encrypted
    return Buffer.concat([salt, iv, authTag, encrypted]).toString('base64');
  }

  /**
   * Decrypt data
   */
  private async decrypt(ciphertext: string): Promise<string> {
    const data = Buffer.from(ciphertext, 'base64');

    const salt = data.slice(0, this.saltLength);
    const iv = data.slice(this.saltLength, this.saltLength + this.ivLength);
    const authTag = data.slice(
      this.saltLength + this.ivLength,
      this.saltLength + this.ivLength + 16
    );
    const encrypted = data.slice(this.saltLength + this.ivLength + 16);

    const key = await this.deriveKey(salt);

    const decipher = createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);

    return decipher.update(encrypted) + decipher.final('utf8');
  }

  /**
   * Load all credentials from file
   */
  private async loadAll(): Promise<Record<string, string>> {
    try {
      const encrypted = await fs.readFile(this.filePath, 'utf8');
      const decrypted = await this.decrypt(encrypted);
      return JSON.parse(decrypted);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return {}; // File doesn't exist yet
      }
      throw error;
    }
  }

  /**
   * Save all credentials to file
   */
  private async saveAll(credentials: Record<string, string>): Promise<void> {
    const json = JSON.stringify(credentials, null, 2);
    const encrypted = await this.encrypt(json);

    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write with restricted permissions (owner only)
    await fs.writeFile(this.filePath, encrypted, { mode: 0o600 });
  }

  async store(key: string, value: string): Promise<void> {
    const credentials = await this.loadAll();
    credentials[key] = value;
    await this.saveAll(credentials);
  }

  async retrieve(key: string): Promise<string | null> {
    const credentials = await this.loadAll();
    return credentials[key] || null;
  }

  async delete(key: string): Promise<void> {
    const credentials = await this.loadAll();
    if (!(key in credentials)) {
      throw new Error(`Credential not found: ${key}`);
    }
    delete credentials[key];
    await this.saveAll(credentials);
  }

  async list(): Promise<string[]> {
    const credentials = await this.loadAll();
    return Object.keys(credentials);
  }

  async isAvailable(): Promise<boolean> {
    return true; // Always available
  }
}

// ============================================================================
// 5. Credential Manager
// ============================================================================

export class CredentialManager {
  private storage: CredentialStorage;
  private metadataPath: string;

  constructor(options?: {
    storage?: CredentialStorage;
    metadataPath?: string;
  }) {
    this.metadataPath = options?.metadataPath || path.join(
      os.homedir(),
      '.cv',
      'credentials.json'
    );

    // Use provided storage or auto-detect best option
    this.storage = options?.storage || this.detectStorage();
  }

  /**
   * Auto-detect best available storage
   */
  private async detectStorage(): Promise<CredentialStorage> {
    // Try keychain first (most secure)
    const keychain = new KeychainStorage();
    if (await keychain.isAvailable()) {
      return keychain;
    }

    // Fall back to encrypted file storage
    console.warn('⚠️  OS keychain not available, using encrypted file storage');
    console.warn('   Run `cv auth setup` to configure master password');

    // In production, prompt for master password here
    const masterPassword = process.env.CV_MASTER_PASSWORD || 'default-change-me';

    return new EncryptedFileStorage(
      path.join(os.homedir(), '.cv', 'credentials.enc'),
      masterPassword
    );
  }

  /**
   * Store a credential
   */
  async store(credential: Credential): Promise<void> {
    // Store the credential value
    const key = this.makeKey(credential.type, credential.name);
    const value = this.serializeCredential(credential);
    await this.storage.store(key, value);

    // Store metadata separately (unencrypted, no sensitive data)
    await this.storeMetadata(credential);

    // Update last used timestamp
    credential.lastUsed = new Date();
  }

  /**
   * Retrieve a credential
   */
  async retrieve(type: CredentialType, name?: string): Promise<Credential | null> {
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

    // Update last used
    await this.updateLastUsed(credential);

    return credential;
  }

  /**
   * Delete a credential
   */
  async delete(type: CredentialType, name: string): Promise<void> {
    const key = this.makeKey(type, name);
    await this.storage.delete(key);
    await this.deleteMetadata(type, name);
  }

  /**
   * List all credentials (metadata only, no secrets)
   */
  async list(): Promise<BaseCredential[]> {
    return await this.loadMetadata();
  }

  /**
   * Get GitHub token (convenience method)
   */
  async getGitHubToken(): Promise<string | null> {
    const cred = await this.retrieve(CredentialType.GITHUB_PAT);
    return cred ? (cred as GitHubPATCredential).token : null;
  }

  /**
   * Get Anthropic API key (convenience method)
   */
  async getAnthropicKey(): Promise<string | null> {
    const cred = await this.retrieve(CredentialType.ANTHROPIC_API);
    return cred ? (cred as AnthropicAPICredential).apiKey : null;
  }

  /**
   * Get OpenAI API key (convenience method)
   */
  async getOpenAIKey(): Promise<string | null> {
    const cred = await this.retrieve(CredentialType.OPENAI_API);
    return cred ? (cred as OpenAIAPICredential).apiKey : null;
  }

  /**
   * Migrate from environment variables
   */
  async migrateFromEnv(): Promise<void> {
    const migrations: Array<{
      envVar: string;
      type: CredentialType;
      name: string;
    }> = [
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
        envVar: 'GITHUB_TOKEN',
        type: CredentialType.GITHUB_PAT,
        name: 'default',
      },
    ];

    for (const { envVar, type, name } of migrations) {
      const value = process.env[envVar];
      if (value && value.trim()) {
        // Check if already exists
        const existing = await this.retrieve(type, name);
        if (existing) {
          console.log(`✓ ${envVar} already migrated`);
          continue;
        }

        // Migrate
        const credential: any = {
          id: randomBytes(16).toString('hex'),
          type,
          name,
          createdAt: new Date(),
        };

        if (type === CredentialType.ANTHROPIC_API) {
          credential.apiKey = value;
        } else if (type === CredentialType.OPENAI_API) {
          credential.apiKey = value;
        } else if (type === CredentialType.GITHUB_PAT) {
          credential.token = value;
          credential.scopes = []; // Unknown
        }

        await this.store(credential);
        console.log(`✓ Migrated ${envVar} to secure storage`);
      }
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private makeKey(type: CredentialType, name: string): string {
    return `${type}:${name}`;
  }

  private serializeCredential(credential: Credential): string {
    return JSON.stringify(credential);
  }

  private deserializeCredential(value: string): Credential {
    return JSON.parse(value);
  }

  private async storeMetadata(credential: Credential): Promise<void> {
    const metadata = await this.loadMetadata();

    // Remove old metadata for same credential
    const filtered = metadata.filter(
      (m) => !(m.type === credential.type && m.name === credential.name)
    );

    // Add new metadata (without sensitive fields)
    const { id, type, name, createdAt, lastUsed, metadata: meta } = credential;
    filtered.push({ id, type, name, createdAt, lastUsed, metadata: meta });

    await this.saveMetadata(filtered);
  }

  private async deleteMetadata(type: CredentialType, name: string): Promise<void> {
    const metadata = await this.loadMetadata();
    const filtered = metadata.filter(
      (m) => !(m.type === type && m.name === name)
    );
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
      return JSON.parse(data);
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
    await fs.writeFile(
      this.metadataPath,
      JSON.stringify(metadata, null, 2),
      { mode: 0o600 }
    );
  }
}

// ============================================================================
// 6. Usage Examples
// ============================================================================

async function exampleUsage() {
  const manager = new CredentialManager();

  // Migrate from environment variables
  await manager.migrateFromEnv();

  // Store a GitHub token
  await manager.store({
    id: randomBytes(16).toString('hex'),
    type: CredentialType.GITHUB_PAT,
    name: 'github-main',
    token: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    scopes: ['repo', 'workflow'],
    createdAt: new Date(),
  });

  // Retrieve GitHub token
  const token = await manager.getGitHubToken();
  console.log('GitHub token:', token ? '***' : 'not found');

  // List all credentials (no secrets shown)
  const credentials = await manager.list();
  console.log('Stored credentials:');
  for (const cred of credentials) {
    console.log(`- ${cred.type}:${cred.name} (last used: ${cred.lastUsed || 'never'})`);
  }

  // Delete a credential
  await manager.delete(CredentialType.GITHUB_PAT, 'github-main');
}

// ============================================================================
// 7. Git Credential Helper Integration
// ============================================================================

/**
 * Git credential helper implementation
 *
 * Git will call this script with stdin containing:
 * protocol=https
 * host=github.com
 *
 * We should respond with:
 * protocol=https
 * host=github.com
 * username=token
 * password=<actual-token>
 */
export async function gitCredentialHelper(action: 'get' | 'store' | 'erase') {
  const manager = new CredentialManager();

  if (action === 'get') {
    // Read from stdin
    const input = await readStdin();
    const { protocol, host } = parseGitCredentialInput(input);

    // Only handle GitHub for now
    if (host === 'github.com') {
      const token = await manager.getGitHubToken();
      if (token) {
        // Output credentials for git
        console.log(`protocol=${protocol}`);
        console.log(`host=${host}`);
        console.log('username=token');
        console.log(`password=${token}`);
        return;
      }
    }
  } else if (action === 'store') {
    // Git is giving us credentials to store (optional)
    // We could auto-store tokens here
  } else if (action === 'erase') {
    // Git wants us to erase stored credentials (optional)
  }
}

function parseGitCredentialInput(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of input.split('\n')) {
    const [key, value] = line.split('=');
    if (key && value) {
      result[key] = value;
    }
  }
  return result;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

// ============================================================================
// 8. Export
// ============================================================================

export {
  CredentialManager,
  KeychainStorage,
  EncryptedFileStorage,
  gitCredentialHelper,
};

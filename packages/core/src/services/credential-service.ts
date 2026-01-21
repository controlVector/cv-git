/**
 * Credential Service
 * Bridge between privilege configuration and credential storage
 *
 * This service provides a simplified interface for credential management
 * that integrates with the CV-Git privilege configuration system.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { loadCVGitConfig, CVGitConfig } from '../config/cv-git-config.js';
import { getDefaultPaths, detectPrivilegeMode } from '../config/privilege-config.js';

export interface CredentialServiceOptions {
  config?: CVGitConfig;
  serviceName?: string;
}

export class CredentialService {
  private config: CVGitConfig | null = null;
  private serviceName: string;
  private initialized = false;

  constructor(options: CredentialServiceOptions = {}) {
    this.serviceName = options.serviceName || 'cv-git';
    if (options.config) {
      this.config = options.config;
      this.initialized = true;
    }
  }

  /**
   * Initialize the credential service
   */
  async initialize(): Promise<void> {
    if (!this.initialized) {
      this.config = await loadCVGitConfig();
      this.serviceName = this.config.credentials.keyringService;
      this.initialized = true;
    }
  }

  /**
   * Store a credential
   */
  async setCredential(key: string, value: string): Promise<void> {
    await this.ensureInitialized();
    const storage = this.config!.credentials.storage;

    switch (storage) {
      case 'keychain':
        await this.setKeychain(key, value);
        break;
      case 'file':
        await this.setFile(key, value);
        break;
      case 'env':
        // Env-only mode - credentials should be set via environment variables
        console.warn(`Credential '${key}' should be set via environment variable`);
        break;
    }
  }

  /**
   * Retrieve a credential
   * Priority: environment variable > configured storage
   */
  async getCredential(key: string): Promise<string | null> {
    await this.ensureInitialized();
    const storage = this.config!.credentials.storage;

    // Always check env first (allows override)
    const envKey = this.keyToEnvVar(key);
    if (process.env[envKey]) {
      return process.env[envKey]!;
    }

    switch (storage) {
      case 'keychain':
        return this.getKeychain(key);
      case 'file':
        return this.getFile(key);
      case 'env':
        return null; // Already checked above
    }

    return null;
  }

  /**
   * Delete a credential
   */
  async deleteCredential(key: string): Promise<void> {
    await this.ensureInitialized();
    const storage = this.config!.credentials.storage;

    switch (storage) {
      case 'keychain':
        await this.deleteKeychain(key);
        break;
      case 'file':
        await this.deleteFile(key);
        break;
    }
  }

  /**
   * List all stored credential keys
   */
  async listCredentials(): Promise<string[]> {
    await this.ensureInitialized();
    const storage = this.config!.credentials.storage;

    switch (storage) {
      case 'keychain':
        return this.listKeychain();
      case 'file':
        return this.listFile();
      case 'env':
        return []; // Can't list env vars reliably
    }

    return [];
  }

  /**
   * Check if a storage method is available
   */
  async isStorageAvailable(storage: 'keychain' | 'file' | 'env'): Promise<boolean> {
    switch (storage) {
      case 'keychain':
        return this.isKeychainAvailable();
      case 'file':
        return true; // File storage is always available
      case 'env':
        return true; // Env vars are always available
    }
    return false;
  }

  // Keychain methods (using dynamic import of keytar)
  private async setKeychain(key: string, value: string): Promise<void> {
    try {
      const keytar = await this.loadKeytar();
      await keytar.setPassword(this.serviceName, key, value);
    } catch (error) {
      // Fallback to file if keychain fails
      console.warn('Keychain unavailable, falling back to file storage');
      await this.setFile(key, value);
    }
  }

  private async getKeychain(key: string): Promise<string | null> {
    try {
      const keytar = await this.loadKeytar();
      return await keytar.getPassword(this.serviceName, key);
    } catch {
      // Try file fallback
      return this.getFile(key);
    }
  }

  private async deleteKeychain(key: string): Promise<void> {
    try {
      const keytar = await this.loadKeytar();
      await keytar.deletePassword(this.serviceName, key);
    } catch {
      // Try file fallback
      await this.deleteFile(key);
    }
  }

  private async listKeychain(): Promise<string[]> {
    try {
      const keytar = await this.loadKeytar();
      const credentials = await keytar.findCredentials(this.serviceName);
      return credentials.map((c: { account: string }) => c.account);
    } catch {
      return this.listFile();
    }
  }

  private async isKeychainAvailable(): Promise<boolean> {
    try {
      await this.loadKeytar();
      return true;
    } catch {
      return false;
    }
  }

  private async loadKeytar(): Promise<typeof import('keytar')> {
    try {
      return await import('keytar');
    } catch (error) {
      throw new Error(`Keytar not available: ${(error as Error).message}`);
    }
  }

  // File-based credential storage (encrypted)
  private async setFile(key: string, value: string): Promise<void> {
    const credPath = await this.getCredentialFilePath();
    const dir = path.dirname(credPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let creds: Record<string, string> = {};
    if (fs.existsSync(credPath)) {
      const encrypted = fs.readFileSync(credPath, 'utf8');
      creds = this.decrypt(encrypted);
    }

    creds[key] = value;
    const encrypted = this.encrypt(creds);

    fs.writeFileSync(credPath, encrypted, { mode: 0o600 });
  }

  private async getFile(key: string): Promise<string | null> {
    const credPath = await this.getCredentialFilePath();

    if (!fs.existsSync(credPath)) {
      return null;
    }

    const encrypted = fs.readFileSync(credPath, 'utf8');
    const creds = this.decrypt(encrypted);
    return creds[key] || null;
  }

  private async deleteFile(key: string): Promise<void> {
    const credPath = await this.getCredentialFilePath();

    if (!fs.existsSync(credPath)) return;

    const encrypted = fs.readFileSync(credPath, 'utf8');
    const creds = this.decrypt(encrypted);
    delete creds[key];

    const newEncrypted = this.encrypt(creds);
    fs.writeFileSync(credPath, newEncrypted, { mode: 0o600 });
  }

  private async listFile(): Promise<string[]> {
    const credPath = await this.getCredentialFilePath();

    if (!fs.existsSync(credPath)) {
      return [];
    }

    const encrypted = fs.readFileSync(credPath, 'utf8');
    const creds = this.decrypt(encrypted);
    return Object.keys(creds);
  }

  private async getCredentialFilePath(): Promise<string> {
    const paths = getDefaultPaths(this.config?.privilege.mode || detectPrivilegeMode());
    return path.join(paths.config, '.credentials');
  }

  /**
   * Convert credential key to environment variable name
   * e.g., 'anthropic-api-key' -> 'ANTHROPIC_API_KEY'
   */
  private keyToEnvVar(key: string): string {
    return key.toUpperCase().replace(/-/g, '_');
  }

  // Encryption using machine-specific key
  private encrypt(data: Record<string, string>): string {
    const key = this.getMachineKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return iv.toString('hex') + ':' + encrypted;
  }

  private decrypt(encrypted: string): Record<string, string> {
    try {
      const key = this.getMachineKey();
      const [ivHex, data] = encrypted.split(':');
      if (!ivHex || !data) {
        return {};
      }
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

      let decrypted = decipher.update(data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);
    } catch {
      return {};
    }
  }

  private getMachineKey(): Buffer {
    // Derive key from machine-specific values
    const machineId = `${os.hostname()}-${os.userInfo().username}-cv-git`;
    return crypto.createHash('sha256').update(machineId).digest();
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

// Singleton instance
let credentialServiceInstance: CredentialService | null = null;

/**
 * Get the global credential service instance
 */
export function getCredentialService(): CredentialService {
  if (!credentialServiceInstance) {
    credentialServiceInstance = new CredentialService();
  }
  return credentialServiceInstance;
}

/**
 * Create a new credential service instance with custom options
 */
export function createCredentialService(options?: CredentialServiceOptions): CredentialService {
  return new CredentialService(options);
}

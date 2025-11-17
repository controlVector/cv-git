/**
 * Encrypted File Storage
 *
 * Fallback storage for when OS keychain is not available.
 * Stores credentials in an encrypted file using AES-256-GCM.
 *
 * Security features:
 * - AES-256-GCM encryption
 * - PBKDF2 key derivation from master password
 * - Random salt and IV for each encryption
 * - Authentication tag for integrity verification
 * - File permissions restricted to owner only (chmod 600)
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2 } from 'crypto';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import { CredentialStorage, StorageBackend } from './interface.js';

const pbkdf2Async = promisify(pbkdf2);

interface EncryptedData {
  version: number;
  salt: string;
  iv: string;
  authTag: string;
  encrypted: string;
}

export class EncryptedFileStorage implements CredentialStorage {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32; // 256 bits
  private readonly saltLength = 64; // 512 bits
  private readonly ivLength = 16; // 128 bits
  private readonly iterations = 100000; // PBKDF2 iterations

  private filePath: string;
  private masterPassword: string;

  /**
   * Create encrypted file storage
   *
   * @param masterPassword - Master password for encryption
   * @param filePath - Path to encrypted credentials file (default: ~/.cv/credentials.enc)
   */
  constructor(
    masterPassword: string,
    filePath?: string
  ) {
    this.masterPassword = masterPassword;
    this.filePath = filePath || path.join(os.homedir(), '.cv', 'credentials.enc');
  }

  getName(): string {
    return StorageBackend.ENCRYPTED_FILE;
  }

  /**
   * Derive encryption key from master password using PBKDF2
   */
  private async deriveKey(salt: Buffer): Promise<Buffer> {
    return (await pbkdf2Async(
      this.masterPassword,
      salt,
      this.iterations,
      this.keyLength,
      'sha256'
    )) as Buffer;
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  private async encrypt(plaintext: string): Promise<EncryptedData> {
    const salt = randomBytes(this.saltLength);
    const iv = randomBytes(this.ivLength);
    const key = await this.deriveKey(salt);

    const cipher = createCipheriv(this.algorithm, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      version: 1,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      encrypted: encrypted.toString('base64'),
    };
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  private async decrypt(data: EncryptedData): Promise<string> {
    const salt = Buffer.from(data.salt, 'base64');
    const iv = Buffer.from(data.iv, 'base64');
    const authTag = Buffer.from(data.authTag, 'base64');
    const encrypted = Buffer.from(data.encrypted, 'base64');

    const key = await this.deriveKey(salt);

    const decipher = createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);

    try {
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch (error) {
      throw new Error('Decryption failed. Invalid master password or corrupted data.');
    }
  }

  /**
   * Load all credentials from encrypted file
   */
  private async loadAll(): Promise<Record<string, string>> {
    try {
      const fileContent = await fs.readFile(this.filePath, 'utf8');
      const encryptedData: EncryptedData = JSON.parse(fileContent);
      const decrypted = await this.decrypt(encryptedData);
      return JSON.parse(decrypted);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet, return empty object
        return {};
      }
      throw error;
    }
  }

  /**
   * Save all credentials to encrypted file
   */
  private async saveAll(credentials: Record<string, string>): Promise<void> {
    const json = JSON.stringify(credentials, null, 2);
    const encryptedData = await this.encrypt(json);
    const fileContent = JSON.stringify(encryptedData, null, 2);

    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write file with restricted permissions (owner only: rw-------)
    await fs.writeFile(this.filePath, fileContent, {
      mode: 0o600, // -rw-------
    });
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
    try {
      // Test encryption/decryption
      const testData: EncryptedData = await this.encrypt('test');
      const decrypted = await this.decrypt(testData);

      // Test file write permissions
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });

      return decrypted === 'test';
    } catch (error) {
      return false;
    }
  }

  /**
   * Change master password
   *
   * Re-encrypts all credentials with new password
   */
  async changeMasterPassword(newPassword: string): Promise<void> {
    // Load with old password
    const credentials = await this.loadAll();

    // Update password
    this.masterPassword = newPassword;

    // Save with new password
    await this.saveAll(credentials);
  }
}

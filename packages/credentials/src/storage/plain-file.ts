/**
 * Plain File Storage
 *
 * Simple unencrypted file storage for when OS keychain is not available.
 * Stores credentials in a JSON file with restricted permissions (chmod 600).
 *
 * This follows the pattern of other CLI tools (aws, gh, gcloud) which store
 * credentials in plain text config files. The security model accepts that:
 * - If an attacker has disk access, they've already compromised the machine
 * - Developer machines are typically single-user
 * - Simplicity and reliability win over marginal security gains
 *
 * Security measures:
 * - File permissions restricted to owner only (chmod 600)
 * - Stored in user's home directory
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CredentialStorage, StorageBackend } from './interface.js';

export class PlainFileStorage implements CredentialStorage {
  private filePath: string;

  /**
   * Create plain file storage
   *
   * @param filePath - Path to credentials file (default: ~/.cv-git/credentials.json)
   */
  constructor(filePath?: string) {
    this.filePath = filePath || path.join(os.homedir(), '.cv-git', 'credentials.json');
  }

  getName(): string {
    return StorageBackend.PLAIN_FILE;
  }

  /**
   * Load all credentials from file
   */
  private async loadAll(): Promise<Record<string, string>> {
    try {
      const fileContent = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(fileContent);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet, return empty object
        return {};
      }
      throw error;
    }
  }

  /**
   * Save all credentials to file
   */
  private async saveAll(credentials: Record<string, string>): Promise<void> {
    const fileContent = JSON.stringify(credentials, null, 2);

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
      // Test file write permissions
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });

      // Try to write and read a test value
      const testFile = path.join(dir, '.write-test');
      await fs.writeFile(testFile, 'test', { mode: 0o600 });
      await fs.unlink(testFile);

      return true;
    } catch (error) {
      return false;
    }
  }
}

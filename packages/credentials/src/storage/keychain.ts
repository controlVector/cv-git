/**
 * OS Keychain Storage
 *
 * Uses native OS credential storage:
 * - macOS: Keychain
 * - Windows: Credential Manager
 * - Linux: Secret Service API (gnome-keyring, kwallet)
 *
 * This is the preferred storage method as it integrates with OS-level security,
 * including biometric authentication (Touch ID, Windows Hello, etc.)
 */

import keytar from 'keytar';
import { CredentialStorage, StorageBackend } from './interface.js';

export class KeychainStorage implements CredentialStorage {
  private readonly serviceName = 'cv-git';

  getName(): string {
    return StorageBackend.KEYCHAIN;
  }

  async store(key: string, value: string): Promise<void> {
    try {
      await keytar.setPassword(this.serviceName, key, value);
    } catch (error) {
      throw new Error(
        `Failed to store credential in keychain: ${(error as Error).message}`
      );
    }
  }

  async retrieve(key: string): Promise<string | null> {
    try {
      return await keytar.getPassword(this.serviceName, key);
    } catch (error) {
      throw new Error(
        `Failed to retrieve credential from keychain: ${(error as Error).message}`
      );
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const deleted = await keytar.deletePassword(this.serviceName, key);
      if (!deleted) {
        throw new Error(`Credential not found: ${key}`);
      }
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        throw error;
      }
      throw new Error(
        `Failed to delete credential from keychain: ${(error as Error).message}`
      );
    }
  }

  async list(): Promise<string[]> {
    try {
      const credentials = await keytar.findCredentials(this.serviceName);
      return credentials.map((c) => c.account);
    } catch (error) {
      throw new Error(
        `Failed to list credentials from keychain: ${(error as Error).message}`
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Test by storing and deleting a dummy credential
      const testKey = '__cv_git_test_' + Date.now() + '__';
      const testValue = 'test';

      await this.store(testKey, testValue);
      const retrieved = await this.retrieve(testKey);
      await this.delete(testKey);

      return retrieved === testValue;
    } catch (error) {
      // Keychain not available or not working
      return false;
    }
  }
}

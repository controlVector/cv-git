/**
 * Credential Storage Interface
 *
 * Abstraction over different secure storage backends:
 * - OS Keychain (macOS, Windows, Linux)
 * - Encrypted file storage (fallback)
 */

export interface CredentialStorage {
  /**
   * Store a credential securely
   *
   * @param key - Unique identifier for the credential
   * @param value - The credential value (will be stored securely)
   */
  store(key: string, value: string): Promise<void>;

  /**
   * Retrieve a credential
   *
   * @param key - Unique identifier for the credential
   * @returns The credential value, or null if not found
   */
  retrieve(key: string): Promise<string | null>;

  /**
   * Delete a credential
   *
   * @param key - Unique identifier for the credential
   * @throws Error if credential not found
   */
  delete(key: string): Promise<void>;

  /**
   * List all stored credential keys
   *
   * @returns Array of credential keys (not the actual credentials)
   */
  list(): Promise<string[]>;

  /**
   * Check if this storage backend is available on the current platform
   *
   * @returns True if storage is available, false otherwise
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the name of this storage backend
   */
  getName(): string;
}

/**
 * Storage backend type
 */
export enum StorageBackend {
  KEYCHAIN = 'keychain',
  ENCRYPTED_FILE = 'encrypted-file',
}

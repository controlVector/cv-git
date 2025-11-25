/**
 * @cv-git/credentials
 *
 * Platform-agnostic credential management for CV-Git
 *
 * Features:
 * - Secure storage (OS keychain or encrypted file)
 * - Support for multiple credential types (git platforms, AI services, etc.)
 * - Platform-agnostic design (works with GitHub, CV Platform, GitLab, etc.)
 * - Migration from environment variables
 * - Automatic credential rotation support
 */

// Main manager
export { CredentialManager, type CredentialManagerOptions } from './manager.js';

// Storage backends
export {
  type CredentialStorage,
  StorageBackend,
  KeychainStorage,
  EncryptedFileStorage,
} from './storage/index.js';

// Types
export {
  CredentialType,
  GitPlatform,
  type BaseCredential,
  type GitPlatformTokenCredential,
  type GitPlatformSSHCredential,
  type AnthropicAPICredential,
  type OpenAIAPICredential,
  type OpenRouterAPICredential,
  type APIKeyCredential,
  type Credential,
  type CreateCredentialInput,
  type UpdateCredentialInput,
} from './types/index.js';

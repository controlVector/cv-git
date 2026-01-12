/**
 * Platform-agnostic credential types
 */

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
  // DNS providers
  type CloudflareCredential,
  // DevOps/Cloud providers
  type AWSCredential,
  type DigitalOceanTokenCredential,
  type DigitalOceanSpacesCredential,
  type DigitalOceanAppCredential,
  // Package registry/publish providers
  type NPMCredential,
  // Union and utility types
  type Credential,
  type CreateCredentialInput,
  type UpdateCredentialInput,
} from './credential.js';

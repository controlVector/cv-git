/**
 * Credential retrieval utilities for CLI commands
 *
 * Provides unified API key retrieval with proper fallback order:
 * 1. CredentialManager (keychain/file storage via cv auth setup)
 * 2. Config file (.cv/config.json)
 * 3. Environment variable
 */

import { CredentialManager } from '@cv-git/credentials';

// Singleton credential manager instance
let credentialManager: CredentialManager | null = null;

/**
 * Get or create a CredentialManager instance
 */
async function getCredentialManager(): Promise<CredentialManager> {
  if (!credentialManager) {
    credentialManager = new CredentialManager();
    await credentialManager.init();
  }
  return credentialManager;
}

/**
 * Get OpenAI API key with fallback order:
 * 1. CredentialManager (keychain/file storage)
 * 2. Config value (if provided)
 * 3. Environment variable
 */
export async function getOpenAIApiKey(configApiKey?: string): Promise<string | null> {
  // 1. Try CredentialManager first
  try {
    const manager = await getCredentialManager();
    const key = await manager.getOpenAIKey();
    if (key) {
      return key;
    }
  } catch (error) {
    // Credential manager failed, continue to fallbacks
  }

  // 2. Try config value
  if (configApiKey) {
    return configApiKey;
  }

  // 3. Try environment variable
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) {
    return envKey;
  }

  return null;
}

/**
 * Get OpenRouter API key with fallback order:
 * 1. CredentialManager (keychain/file storage)
 * 2. Config value (if provided)
 * 3. Environment variable
 */
export async function getOpenRouterApiKey(configApiKey?: string): Promise<string | null> {
  // 1. Try CredentialManager first
  try {
    const manager = await getCredentialManager();
    const key = await manager.getOpenRouterKey();
    if (key) {
      return key;
    }
  } catch (error) {
    // Credential manager failed, continue to fallbacks
  }

  // 2. Try config value
  if (configApiKey) {
    return configApiKey;
  }

  // 3. Try environment variable
  const envKey = process.env.OPENROUTER_API_KEY;
  if (envKey) {
    return envKey;
  }

  return null;
}

/**
 * Get Anthropic API key with fallback order:
 * 1. CredentialManager (keychain/file storage)
 * 2. Config value (if provided)
 * 3. Environment variable
 */
export async function getAnthropicApiKey(configApiKey?: string): Promise<string | null> {
  // 1. Try CredentialManager first
  try {
    const manager = await getCredentialManager();
    const key = await manager.getAnthropicKey();
    if (key) {
      return key;
    }
  } catch (error) {
    // Credential manager failed, continue to fallbacks
  }

  // 2. Try config value
  if (configApiKey) {
    return configApiKey;
  }

  // 3. Try environment variable
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    return envKey;
  }

  return null;
}

/**
 * Embedding credentials with provider info
 */
export interface EmbeddingCredentials {
  openrouterApiKey?: string;
  openaiApiKey?: string;
  provider: 'openrouter' | 'openai' | 'ollama';
}

/**
 * Get embedding API keys with provider priority: OpenRouter > OpenAI > Ollama
 * Returns both keys if available so VectorManager can handle fallbacks
 */
export async function getEmbeddingCredentials(config?: { openaiKey?: string; openRouterKey?: string }): Promise<EmbeddingCredentials> {
  // Get both keys
  const openRouterKey = await getOpenRouterApiKey(config?.openRouterKey);
  const openaiKey = await getOpenAIApiKey(config?.openaiKey);

  // Determine primary provider based on what's available
  let provider: 'openrouter' | 'openai' | 'ollama';
  if (openRouterKey) {
    provider = 'openrouter';
  } else if (openaiKey) {
    provider = 'openai';
  } else {
    provider = 'ollama';
  }

  return {
    openrouterApiKey: openRouterKey || undefined,
    openaiApiKey: openaiKey || undefined,
    provider
  };
}

/**
 * Get embedding API key (tries OpenRouter first, then OpenAI)
 * OpenRouter is preferred due to better model availability
 * @deprecated Use getEmbeddingCredentials() instead for proper provider handling
 */
export async function getEmbeddingApiKey(config?: { openaiKey?: string; openRouterKey?: string }): Promise<string | null> {
  // Try OpenRouter first (preferred - better model availability)
  const openRouterKey = await getOpenRouterApiKey(config?.openRouterKey);
  if (openRouterKey) {
    return openRouterKey;
  }

  // Fall back to OpenAI
  const openaiKey = await getOpenAIApiKey(config?.openaiKey);
  if (openaiKey) {
    return openaiKey;
  }

  return null;
}

/**
 * Get AI/LLM API key for chat/explain/review commands
 * Tries Anthropic first, then OpenAI, then OpenRouter
 */
export async function getAIApiKey(config?: {
  anthropicKey?: string;
  openaiKey?: string;
  openRouterKey?: string;
}): Promise<{ key: string; provider: 'anthropic' | 'openai' | 'openrouter' } | null> {
  // Try Anthropic first (preferred for Claude)
  const anthropicKey = await getAnthropicApiKey(config?.anthropicKey);
  if (anthropicKey) {
    return { key: anthropicKey, provider: 'anthropic' };
  }

  // Try OpenAI
  const openaiKey = await getOpenAIApiKey(config?.openaiKey);
  if (openaiKey) {
    return { key: openaiKey, provider: 'openai' };
  }

  // Try OpenRouter
  const openRouterKey = await getOpenRouterApiKey(config?.openRouterKey);
  if (openRouterKey) {
    return { key: openRouterKey, provider: 'openrouter' };
  }

  return null;
}

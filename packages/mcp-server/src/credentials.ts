/**
 * Credential utilities for MCP Server
 *
 * Provides secure access to API keys via the CredentialManager
 * instead of relying on environment variables.
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
 * Get Anthropic API key from credential manager
 * Falls back to environment variable for backwards compatibility
 */
export async function getAnthropicApiKey(): Promise<string | undefined> {
  try {
    const manager = await getCredentialManager();
    const key = await manager.getAnthropicKey();
    if (key) {
      return key;
    }
  } catch (error) {
    // Credential manager failed, fall back to env var
  }

  // Fallback to environment variable
  return process.env.ANTHROPIC_API_KEY || process.env.CV_ANTHROPIC_KEY || undefined;
}

/**
 * Get OpenAI API key from credential manager
 * Falls back to environment variable for backwards compatibility
 */
export async function getOpenAIApiKey(): Promise<string | undefined> {
  try {
    const manager = await getCredentialManager();
    const key = await manager.getOpenAIKey();
    if (key) {
      return key;
    }
  } catch (error) {
    // Credential manager failed, fall back to env var
  }

  // Fallback to environment variable
  return process.env.OPENAI_API_KEY || process.env.CV_OPENAI_KEY || undefined;
}

/**
 * Get OpenRouter API key from credential manager
 * Falls back to environment variable for backwards compatibility
 */
export async function getOpenRouterApiKey(): Promise<string | undefined> {
  try {
    const manager = await getCredentialManager();
    const key = await manager.getOpenRouterKey();
    if (key) {
      return key;
    }
  } catch (error) {
    // Credential manager failed, fall back to env var
  }

  // Fallback to environment variable
  return process.env.OPENROUTER_API_KEY || undefined;
}

/**
 * Get embedding credentials (OpenRouter preferred, then OpenAI)
 */
export async function getEmbeddingCredentials(): Promise<{
  openrouterApiKey?: string;
  openaiApiKey?: string;
}> {
  const openrouterApiKey = await getOpenRouterApiKey();
  const openaiApiKey = await getOpenAIApiKey();

  return {
    openrouterApiKey,
    openaiApiKey,
  };
}

/**
 * Get AI/LLM credentials for explain/do/review (Anthropic preferred)
 */
export async function getAICredentials(): Promise<{
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
}> {
  const anthropicApiKey = await getAnthropicApiKey();
  const openaiApiKey = await getOpenAIApiKey();
  const openrouterApiKey = await getOpenRouterApiKey();

  return {
    anthropicApiKey,
    openaiApiKey,
    openrouterApiKey,
  };
}

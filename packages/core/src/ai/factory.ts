/**
 * AI Client Factory
 * Creates the appropriate AI client based on provider and configuration
 */

import {
  AIClient,
  AIMessage,
  AIStreamHandler,
  RECOMMENDED_MODELS,
  ModelInfo,
  getRecommendedModels,
  getModelInfo,
  getModelsByProvider,
} from './types.js';
import { OpenRouterClient, createOpenRouterClient, OPENROUTER_MODELS } from './openrouter.js';
import { OllamaClient, createOllamaClient, isOllamaRunning } from './ollama.js';
import { LMStudioClient, createLMStudioClient, isLMStudioRunning } from './lmstudio.js';

export type AIProvider = 'openrouter' | 'ollama' | 'lmstudio' | 'auto';

export interface AIClientOptions {
  provider?: AIProvider;
  model?: string;
  apiKey?: string;        // Required for OpenRouter
  ollamaUrl?: string;     // Optional Ollama URL (default: localhost:11434)
  lmstudioUrl?: string;   // Optional LM Studio URL (default: localhost:1234/v1)
  maxTokens?: number;
  temperature?: number;
}

/**
 * Create an AI client based on options
 *
 * Provider selection:
 * - 'openrouter': Use OpenRouter cloud API (requires API key)
 * - 'ollama': Use local Ollama instance
 * - 'auto': Try Ollama first, fall back to OpenRouter if available
 */
export async function createAIClient(options: AIClientOptions): Promise<AIClient> {
  const provider = options.provider || 'auto';

  if (provider === 'ollama') {
    return createOllamaClient({
      baseUrl: options.ollamaUrl,
      model: options.model,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });
  }

  if (provider === 'lmstudio') {
    return createLMStudioClient({
      baseUrl: options.lmstudioUrl,
      model: options.model,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });
  }

  if (provider === 'openrouter') {
    if (!options.apiKey) {
      throw new Error('OpenRouter API key required. Set OPENROUTER_API_KEY or use --provider ollama');
    }
    return createOpenRouterClient({
      apiKey: options.apiKey,
      model: options.model,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });
  }

  // Auto mode: try local providers first, then cloud
  if (provider === 'auto') {
    // Try Ollama first
    const ollamaAvailable = await isOllamaRunning(options.ollamaUrl);
    if (ollamaAvailable) {
      const client = createOllamaClient({
        baseUrl: options.ollamaUrl,
        model: options.model,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
      });
      if (await client.isReady()) {
        return client;
      }
    }

    // Try LM Studio
    const lmstudioAvailable = await isLMStudioRunning(options.lmstudioUrl);
    if (lmstudioAvailable) {
      const client = createLMStudioClient({
        baseUrl: options.lmstudioUrl,
        model: options.model,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
      });
      if (await client.isReady()) {
        return client;
      }
    }

    // Fall back to OpenRouter
    if (options.apiKey) {
      return createOpenRouterClient({
        apiKey: options.apiKey,
        model: options.model,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
      });
    }

    throw new Error(
      'No AI provider available. Either:\n' +
      '  - Start Ollama locally: ollama serve\n' +
      '  - Start LM Studio: lms server start\n' +
      '  - Set OPENROUTER_API_KEY for cloud API'
    );
  }

  throw new Error(`Unknown provider: ${provider}`);
}

/**
 * Detect available providers
 */
export async function detectAvailableProviders(
  openrouterApiKey?: string,
  ollamaUrl?: string,
  lmstudioUrl?: string
): Promise<{
  ollama: boolean;
  lmstudio: boolean;
  openrouter: boolean;
  recommended: AIProvider;
}> {
  // Check all providers in parallel with timeouts
  const [ollamaAvailable, lmstudioAvailable] = await Promise.all([
    isOllamaRunning(ollamaUrl),
    isLMStudioRunning(lmstudioUrl),
  ]);
  const openrouterAvailable = !!openrouterApiKey;

  let recommended: AIProvider = 'openrouter';
  if (ollamaAvailable) {
    recommended = 'ollama';
  } else if (lmstudioAvailable) {
    recommended = 'lmstudio';
  } else if (!openrouterAvailable) {
    recommended = 'ollama'; // Will prompt user to install
  }

  return {
    ollama: ollamaAvailable,
    lmstudio: lmstudioAvailable,
    openrouter: openrouterAvailable,
    recommended,
  };
}

/**
 * Get model recommendations based on use case
 */
export function getModelRecommendations(useCase: string): {
  cloud: ModelInfo[];
  local: ModelInfo[];
} {
  const allModels = Object.values(RECOMMENDED_MODELS);

  let cloudModels: ModelInfo[];
  let localModels: ModelInfo[];

  switch (useCase) {
    case 'code-editing':
    case 'refactoring':
      cloudModels = allModels.filter(m =>
        m.provider === 'openrouter' &&
        m.bestFor?.includes('code-editing')
      );
      localModels = allModels.filter(m =>
        m.provider === 'ollama' &&
        m.bestFor?.includes('code-editing')
      );
      break;

    case 'quick-edits':
      cloudModels = allModels.filter(m =>
        m.provider === 'openrouter' &&
        (m.bestFor?.includes('quick-edits') || m.costPer1kInput && m.costPer1kInput < 0.001)
      );
      localModels = allModels.filter(m =>
        m.provider === 'ollama' &&
        m.bestFor?.includes('quick-edits')
      );
      break;

    case 'architecture':
    case 'complex':
      cloudModels = allModels.filter(m =>
        m.provider === 'openrouter' &&
        (m.bestFor?.includes('architecture') || m.bestFor?.includes('complex-refactoring'))
      );
      localModels = allModels.filter(m =>
        m.provider === 'ollama' &&
        m.contextWindow >= 64000
      );
      break;

    default:
      cloudModels = allModels.filter(m => m.provider === 'openrouter' && m.recommended);
      localModels = allModels.filter(m => m.provider === 'ollama' && m.recommended);
  }

  return {
    cloud: cloudModels,
    local: localModels,
  };
}

/**
 * Format model list for display
 */
export function formatModelList(provider?: AIProvider): string {
  const lines: string[] = [];

  if (!provider || provider === 'openrouter') {
    lines.push('Cloud Models (OpenRouter):');
    lines.push('');

    const cloudModels = getModelsByProvider('openrouter');
    for (const model of cloudModels) {
      const stars = model.recommended ? ' ★' : '';
      const cost = model.costPer1kInput
        ? ` ($${model.costPer1kInput.toFixed(4)}/1k)`
        : '';
      lines.push(`  ${model.id.split('/').pop()}${stars}${cost}`);
      lines.push(`    ${model.description || ''}`);
    }
    lines.push('');
  }

  if (!provider || provider === 'ollama') {
    lines.push('Local Models (Ollama):');
    lines.push('');

    const localModels = getModelsByProvider('ollama');
    for (const model of localModels) {
      const stars = model.recommended ? ' ★' : '';
      lines.push(`  ${model.id}${stars}`);
      lines.push(`    ${model.description || ''}`);
    }
    lines.push('');
    lines.push('Install with: ollama pull <model-name>');
  }

  if (!provider || provider === 'lmstudio') {
    lines.push('');
    lines.push('Local Models (LM Studio):');
    lines.push('');
    lines.push('  Models are managed in LM Studio. Run "cv ai status" to see loaded models.');
    lines.push('  Start server: lms server start');
  }

  return lines.join('\n');
}

// Re-export types
export {
  AIClient,
  AIMessage,
  AIStreamHandler,
  ModelInfo,
  RECOMMENDED_MODELS,
  getRecommendedModels,
  getModelInfo,
  getModelsByProvider,
};

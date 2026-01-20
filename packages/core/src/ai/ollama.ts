/**
 * Ollama Client
 * Local LLM support via Ollama API
 *
 * Ollama provides OpenAI-compatible API at /v1/chat/completions
 * Default URL: http://localhost:11434 (configurable via CV_OLLAMA_URL)
 */

import { AIClient, AIMessage, AIStreamHandler, RECOMMENDED_MODELS } from './types.js';
import { getOllamaUrl } from '../config/service-urls.js';

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Default Ollama model for code editing
 */
const DEFAULT_MODEL = 'qwen2.5-coder:14b';

/**
 * Ollama API client for local LLM inference
 */
export class OllamaClient implements AIClient {
  private baseUrl: string;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(options: OllamaOptions = {}) {
    // Use service URL helper for default, with option override taking precedence
    this.baseUrl = options.baseUrl ? options.baseUrl.replace(/\/$/, '') : getOllamaUrl();
    this.model = options.model || DEFAULT_MODEL;
    this.maxTokens = options.maxTokens || 8192;
    this.temperature = options.temperature || 0.7;
  }

  /**
   * Get the provider name
   */
  getProvider(): string {
    return 'ollama';
  }

  /**
   * Get the current model
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Set a different model
   */
  setModel(model: string): void {
    this.model = model;
  }

  /**
   * Check if Ollama is running and model is available
   */
  async isReady(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return false;

      const data = await response.json() as { models?: Array<{ name: string }> };
      const models = data.models || [];

      // Check if our model is available
      const modelBase = this.model.split(':')[0];
      return models.some((m: any) =>
        m.name === this.model ||
        m.name.startsWith(modelBase)
      );
    } catch {
      return false;
    }
  }

  /**
   * List available models from Ollama
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];

      const data = await response.json() as { models?: Array<{ name: string }> };
      return (data.models || []).map((m) => m.name);
    } catch {
      return [];
    }
  }

  /**
   * Pull a model from Ollama registry
   */
  async pullModel(model: string, onProgress?: (status: string) => void): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model, stream: true }),
      });

      if (!response.ok) return false;

      const reader = response.body?.getReader();
      if (!reader) return false;

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.status && onProgress) {
              onProgress(json.status);
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Chat completion (non-streaming)
   */
  async chat(messages: AIMessage[], systemPrompt?: string): Promise<string> {
    const ollamaMessages = this.buildMessages(messages, systemPrompt);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: ollamaMessages,
        stream: false,
        options: {
          num_predict: this.maxTokens,
          temperature: this.temperature,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as { message?: { content: string } };
    return data.message?.content || '';
  }

  /**
   * Chat completion with streaming
   */
  async chatStream(
    messages: AIMessage[],
    systemPrompt?: string,
    handler?: AIStreamHandler
  ): Promise<string> {
    const ollamaMessages = this.buildMessages(messages, systemPrompt);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: ollamaMessages,
        stream: true,
        options: {
          num_predict: this.maxTokens,
          temperature: this.temperature,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      const err = new Error(`Ollama API error: ${response.status} - ${error}`);
      handler?.onError?.(err);
      throw err;
    }

    let fullText = '';
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            const token = json.message?.content || '';
            if (token) {
              fullText += token;
              handler?.onToken?.(token);
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      }

      handler?.onComplete?.(fullText);
      return fullText;

    } catch (error) {
      handler?.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Simple completion (single prompt)
   */
  async complete(prompt: string, handler?: AIStreamHandler): Promise<string> {
    return this.chatStream(
      [{ role: 'user', content: prompt }],
      undefined,
      handler
    );
  }

  /**
   * Build messages array for Ollama API
   */
  private buildMessages(
    messages: AIMessage[],
    systemPrompt?: string
  ): Array<{ role: string; content: string }> {
    const ollamaMessages: Array<{ role: string; content: string }> = [];

    if (systemPrompt) {
      ollamaMessages.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      ollamaMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    return ollamaMessages;
  }

  /**
   * Generate embeddings (if model supports it)
   */
  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embeddings error: ${response.status}`);
    }

    const data = await response.json() as { embedding?: number[] };
    return data.embedding || [];
  }
}

/**
 * Create an Ollama client
 */
export function createOllamaClient(options?: OllamaOptions): OllamaClient {
  return new OllamaClient(options);
}

/**
 * Get recommended Ollama models for code editing
 */
export function getRecommendedOllamaModels(): string[] {
  return Object.entries(RECOMMENDED_MODELS)
    .filter(([_, info]) => info.provider === 'ollama' && info.recommended)
    .map(([key, _]) => key);
}

/**
 * Check if Ollama is running
 * Uses CV_OLLAMA_URL env var or default if baseUrl not provided
 */
export async function isOllamaRunning(baseUrl?: string): Promise<boolean> {
  const url = baseUrl ? baseUrl.replace(/\/$/, '') : getOllamaUrl();
  try {
    const response = await fetch(`${url}/api/tags`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

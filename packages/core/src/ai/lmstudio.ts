/**
 * LM Studio Client
 * Local LLM support via LM Studio's OpenAI-compatible API
 *
 * LM Studio exposes an OpenAI-compatible REST API at /v1.
 * Default URL: http://localhost:1234/v1 (configurable via CV_LMSTUDIO_URL)
 *
 * Uses the `openai` npm package (already a dependency) with baseURL override.
 */

import { AIClient, AIMessage, AIStreamHandler, RECOMMENDED_MODELS } from './types.js';
import { getLMStudioUrl } from '../config/service-urls.js';

export interface LMStudioOptions {
  baseUrl?: string;
  model?: string;
  embeddingModel?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * LM Studio API client for local LLM inference
 *
 * Mirrors OllamaClient interface. Uses OpenAI-compatible /v1 endpoints.
 */
export class LMStudioClient implements AIClient {
  private baseUrl: string;
  private model: string;
  private embeddingModel: string;
  private maxTokens: number;
  private temperature: number;
  private timeoutMs: number;

  constructor(options: LMStudioOptions = {}) {
    this.baseUrl = options.baseUrl ? options.baseUrl.replace(/\/$/, '') : getLMStudioUrl();
    this.model = options.model || '';  // Fetched at runtime via /v1/models
    this.embeddingModel = options.embeddingModel || '';
    this.maxTokens = options.maxTokens || 8192;
    this.temperature = options.temperature || 0.7;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  getProvider(): string {
    return 'lmstudio';
  }

  getModel(): string {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  /**
   * Check if LM Studio server is running and has models available
   */
  async isReady(): Promise<boolean> {
    try {
      const models = await this.listModels();
      if (models.length === 0) return false;
      // If a model is configured, check it exists
      if (this.model) {
        return models.some(m => m === this.model || m.includes(this.model));
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List available models from LM Studio /v1/models endpoint
   */
  async listModels(): Promise<string[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${this.baseUrl}/models`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) return [];

      const data = await response.json() as { data?: Array<{ id: string }> };
      return (data.data || []).map(m => m.id);
    } catch {
      return [];
    }
  }

  /**
   * List models categorized by type (chat vs embedding)
   */
  async listModelsByType(): Promise<{ chat: string[]; embedding: string[] }> {
    const all = await this.listModels();
    const embedding: string[] = [];
    const chat: string[] = [];

    for (const id of all) {
      const lower = id.toLowerCase();
      if (lower.includes('embed') || lower.includes('embedding') || lower.includes('bge')) {
        embedding.push(id);
      } else {
        chat.push(id);
      }
    }

    return { chat, embedding };
  }

  /**
   * Chat completion (non-streaming)
   */
  async chat(messages: AIMessage[], systemPrompt?: string): Promise<string> {
    const lmMessages = this.buildMessages(messages, systemPrompt);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer lm-studio',
      },
      body: JSON.stringify({
        model: this.model,
        messages: lmMessages,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LM Studio API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content: string } }>;
    };
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * Chat completion with streaming
   */
  async chatStream(
    messages: AIMessage[],
    systemPrompt?: string,
    handler?: AIStreamHandler
  ): Promise<string> {
    const lmMessages = this.buildMessages(messages, systemPrompt);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer lm-studio',
      },
      body: JSON.stringify({
        model: this.model,
        messages: lmMessages,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        stream: true,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.text();
      const err = new Error(`LM Studio API error: ${response.status} - ${error}`);
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
        const lines = chunk.split('\n').filter(l => l.trim() && l.startsWith('data: '));

        for (const line of lines) {
          const jsonStr = line.slice(6); // Remove 'data: ' prefix
          if (jsonStr === '[DONE]') continue;

          try {
            const json = JSON.parse(jsonStr);
            const token = json.choices?.[0]?.delta?.content || '';
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
   * Generate embeddings via /v1/embeddings
   */
  async embed(text: string): Promise<number[]> {
    const model = this.embeddingModel || this.model;
    if (!model) {
      throw new Error(
        'No embedding model configured for LM Studio. ' +
        'Run "cv ai setup" to select an embedding model.'
      );
    }

    const controller = new AbortController();
    // First embedding request may be slow (model loading)
    const timeout = setTimeout(() => controller.abort(), 60_000);

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer lm-studio',
      },
      body: JSON.stringify({
        model,
        input: [text], // Must be array, not string
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LM Studio embeddings error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      data?: Array<{ embedding: number[] }>;
    };
    return data.data?.[0]?.embedding || [];
  }

  private buildMessages(
    messages: AIMessage[],
    systemPrompt?: string
  ): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = [];

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      result.push({ role: msg.role, content: msg.content });
    }

    return result;
  }
}

/**
 * Create an LM Studio client
 */
export function createLMStudioClient(options?: LMStudioOptions): LMStudioClient {
  return new LMStudioClient(options);
}

/**
 * Check if LM Studio server is running
 */
export async function isLMStudioRunning(baseUrl?: string): Promise<boolean> {
  const url = baseUrl ? baseUrl.replace(/\/$/, '') : getLMStudioUrl();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${url}/models`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

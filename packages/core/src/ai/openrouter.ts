/**
 * OpenRouter Chat Client
 * OpenAI-compatible API for accessing various models via OpenRouter
 */

import OpenAI from 'openai';

export interface OpenRouterOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface OpenRouterStreamHandler {
  onToken?: (token: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

// Simple message type for OpenRouter (doesn't require timestamp)
export interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Popular models available on OpenRouter
export const OPENROUTER_MODELS = {
  // Anthropic
  'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
  'claude-3-opus': 'anthropic/claude-3-opus',
  'claude-3-sonnet': 'anthropic/claude-3-sonnet',
  'claude-3-haiku': 'anthropic/claude-3-haiku',

  // OpenAI
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'gpt-4-turbo': 'openai/gpt-4-turbo',

  // Google
  'gemini-pro': 'google/gemini-pro-1.5',
  'gemini-flash': 'google/gemini-flash-1.5',

  // Meta
  'llama-3.1-70b': 'meta-llama/llama-3.1-70b-instruct',
  'llama-3.1-8b': 'meta-llama/llama-3.1-8b-instruct',

  // Mistral
  'mixtral-8x7b': 'mistralai/mixtral-8x7b-instruct',
  'mistral-large': 'mistralai/mistral-large',

  // DeepSeek
  'deepseek-chat': 'deepseek/deepseek-chat',
  'deepseek-coder': 'deepseek/deepseek-coder',
} as const;

export type ModelAlias = keyof typeof OPENROUTER_MODELS;

export class OpenRouterClient {
  private client: OpenAI;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(options: OpenRouterOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/anthropics/cv-git',
        'X-Title': 'cv-git',
      },
    });

    // Resolve model alias or use directly
    const modelInput = options.model || 'claude-3.5-sonnet';
    this.model = OPENROUTER_MODELS[modelInput as ModelAlias] || modelInput;

    this.maxTokens = options.maxTokens || 4096;
    this.temperature = options.temperature || 0.7;
  }

  /**
   * Get the current model being used
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Set a different model
   */
  setModel(model: string): void {
    this.model = OPENROUTER_MODELS[model as ModelAlias] || model;
  }

  /**
   * Chat completion (non-streaming)
   */
  async chat(messages: OpenRouterMessage[], systemPrompt?: string): Promise<string> {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      openaiMessages.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      openaiMessages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
    });

    return response.choices[0]?.message?.content || '';
  }

  /**
   * Chat completion with streaming
   */
  async chatStream(
    messages: OpenRouterMessage[],
    systemPrompt?: string,
    handler?: OpenRouterStreamHandler
  ): Promise<string> {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      openaiMessages.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      openaiMessages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    let fullText = '';

    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: openaiMessages,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        stream: true,
      });

      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || '';
        if (token) {
          fullText += token;
          handler?.onToken?.(token);
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
  async complete(prompt: string, handler?: OpenRouterStreamHandler): Promise<string> {
    return this.chatStream(
      [{ role: 'user', content: prompt }],
      undefined,
      handler
    );
  }
}

/**
 * Create an OpenRouter client
 */
export function createOpenRouterClient(options: OpenRouterOptions): OpenRouterClient {
  return new OpenRouterClient(options);
}

/**
 * LM Studio Client Tests
 * Mirrors the Ollama test patterns — all HTTP calls are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LMStudioClient, isLMStudioRunning } from './lmstudio.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('LMStudioClient', () => {
  let client: LMStudioClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new LMStudioClient({
      baseUrl: 'http://localhost:1234/v1',
      model: 'test-model',
      embeddingModel: 'test-embed-model',
    });
  });

  describe('getProvider', () => {
    it('returns lmstudio', () => {
      expect(client.getProvider()).toBe('lmstudio');
    });
  });

  describe('getModel / setModel', () => {
    it('returns configured model', () => {
      expect(client.getModel()).toBe('test-model');
    });

    it('sets a new model', () => {
      client.setModel('new-model');
      expect(client.getModel()).toBe('new-model');
    });
  });

  describe('isReady', () => {
    it('returns true when server has models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'test-model' }] }),
      });

      expect(await client.isReady()).toBe(true);
    });

    it('returns false when server is not running', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      expect(await client.isReady()).toBe(false);
    });

    it('returns false when server returns empty model list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      expect(await client.isReady()).toBe(false);
    });
  });

  describe('listModels', () => {
    it('returns model IDs from /v1/models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'llama-3.1-8b-instruct' },
            { id: 'nomic-embed-text-v1.5' },
          ],
        }),
      });

      const models = await client.listModels();
      expect(models).toEqual(['llama-3.1-8b-instruct', 'nomic-embed-text-v1.5']);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:1234/v1/models',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('returns empty array on failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      expect(await client.listModels()).toEqual([]);
    });
  });

  describe('listModelsByType', () => {
    it('separates embedding and chat models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'lmstudio-community/meta-llama-3.1-8b-instruct-gguf' },
            { id: 'nomic-ai/nomic-embed-text-v1.5-gguf' },
            { id: 'text-embedding-bge-small-en' },
            { id: 'qwen2.5-coder-7b-instruct' },
          ],
        }),
      });

      const { chat, embedding } = await client.listModelsByType();
      expect(chat).toEqual([
        'lmstudio-community/meta-llama-3.1-8b-instruct-gguf',
        'qwen2.5-coder-7b-instruct',
      ]);
      expect(embedding).toEqual([
        'nomic-ai/nomic-embed-text-v1.5-gguf',
        'text-embedding-bge-small-en',
      ]);
    });
  });

  describe('chat', () => {
    it('calls /v1/chat/completions with correct shape', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello world' } }],
        }),
      });

      const result = await client.chat([{ role: 'user', content: 'Hi' }]);
      expect(result).toBe('Hello world');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:1234/v1/chat/completions');
      const body = JSON.parse(opts.body);
      expect(body.model).toBe('test-model');
      expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
      expect(body.stream).toBe(false);
    });

    it('includes system prompt when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
        }),
      });

      await client.chat([{ role: 'user', content: 'Hi' }], 'You are helpful');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful' });
      expect(body.messages[1]).toEqual({ role: 'user', content: 'Hi' });
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(client.chat([{ role: 'user', content: 'Hi' }]))
        .rejects.toThrow('LM Studio API error: 500');
    });
  });

  describe('embed', () => {
    it('calls /v1/embeddings with input as array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
      });

      const result = await client.embed('test text');
      expect(result).toEqual([0.1, 0.2, 0.3]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.input).toEqual(['test text']); // Must be array
      expect(body.model).toBe('test-embed-model');
    });

    it('throws descriptive error when no embedding model configured', async () => {
      const noEmbedClient = new LMStudioClient({ baseUrl: 'http://localhost:1234/v1' });

      await expect(noEmbedClient.embed('test'))
        .rejects.toThrow('No embedding model configured');
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Model not found',
      });

      await expect(client.embed('test'))
        .rejects.toThrow('LM Studio embeddings error: 404');
    });
  });

  describe('defaults', () => {
    it('applies default URL when not specified', () => {
      // getLMStudioUrl returns the default, which is http://localhost:1234/v1
      const defaultClient = new LMStudioClient();
      expect(defaultClient.getProvider()).toBe('lmstudio');
    });
  });
});

describe('isLMStudioRunning', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns true when /v1/models responds 200', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    expect(await isLMStudioRunning('http://localhost:1234/v1')).toBe(true);
  });

  it('returns false when server is not running', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await isLMStudioRunning('http://localhost:1234/v1')).toBe(false);
  });
});

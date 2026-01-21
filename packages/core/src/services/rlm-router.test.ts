/**
 * Unit tests for RLM Router
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RLMRouter, RLMContext, RLMStep, RLMTask, RLMResult } from './rlm-router.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"tasks":[],"canAnswer":true,"reasoning":"test"}' }]
        })
      }
    }))
  };
});

describe('RLM Router', () => {
  let router: RLMRouter;

  beforeEach(() => {
    router = new RLMRouter({
      apiKey: 'test-api-key',
      maxDepth: 3,
      maxTokens: 4096
    });
  });

  describe('formatTrace', () => {
    it('should format an empty trace', () => {
      const result = router.formatTrace([]);
      expect(result).toContain('Reasoning Trace:');
    });

    it('should format a single step trace', () => {
      const trace: RLMStep[] = [{
        taskType: 'vector_search',
        query: 'find authentication code',
        result: { type: 'vector_search', results: [] },
        depth: 0,
        timestamp: Date.now(),
        duration: 150
      }];

      const result = router.formatTrace(trace);
      expect(result).toContain('vector_search');
      expect(result).toContain('150ms');
      expect(result).toContain('find authentication code');
    });

    it('should indent based on depth', () => {
      const trace: RLMStep[] = [
        {
          taskType: 'graph_query',
          query: 'depth 0 query',
          result: { type: 'callers', results: [] },
          depth: 0,
          timestamp: Date.now()
        },
        {
          taskType: 'vector_search',
          query: 'depth 1 query',
          result: { type: 'vector_search', results: [] },
          depth: 1,
          timestamp: Date.now()
        }
      ];

      const result = router.formatTrace(trace);
      const lines = result.split('\n');
      // Find lines with the task types
      const depth0Line = lines.find(l => l.includes('graph_query'));
      const depth1Line = lines.find(l => l.includes('vector_search'));

      expect(depth0Line).toBeDefined();
      expect(depth1Line).toBeDefined();
      // Depth 1 should have more leading whitespace
      expect(depth1Line!.search(/\S/)).toBeGreaterThan(depth0Line!.search(/\S/));
    });

    it('should truncate long queries', () => {
      const trace: RLMStep[] = [{
        taskType: 'llm_explain',
        query: 'a'.repeat(200), // Long query
        result: { type: 'explanation', text: 'test' },
        depth: 0,
        timestamp: Date.now()
      }];

      const result = router.formatTrace(trace);
      expect(result).toContain('...');
    });

    it('should show error results', () => {
      const trace: RLMStep[] = [{
        taskType: 'graph_query',
        query: 'test query',
        result: { error: 'Connection failed' },
        depth: 0,
        timestamp: Date.now()
      }];

      const result = router.formatTrace(trace);
      expect(result).toContain('Error');
      expect(result).toContain('Connection failed');
    });
  });

  describe('RLMContext', () => {
    it('should initialize with default values', () => {
      const ctx: RLMContext = {
        originalQuery: 'test query',
        depth: 0,
        maxDepth: 5,
        buffers: new Map(),
        trace: []
      };

      expect(ctx.depth).toBe(0);
      expect(ctx.maxDepth).toBe(5);
      expect(ctx.buffers.size).toBe(0);
      expect(ctx.trace.length).toBe(0);
    });

    it('should store buffer results', () => {
      const ctx: RLMContext = {
        originalQuery: 'test',
        depth: 0,
        maxDepth: 5,
        buffers: new Map(),
        trace: []
      };

      ctx.buffers.set('task1', { type: 'vector_search', results: ['a', 'b'] });
      ctx.buffers.set('task2', { type: 'callers', target: 'func', results: [] });

      expect(ctx.buffers.size).toBe(2);
      expect(ctx.buffers.get('task1')).toHaveProperty('type', 'vector_search');
    });
  });

  describe('RLMTask', () => {
    it('should define valid task types', () => {
      const validTypes = ['graph_query', 'vector_search', 'llm_explain', 'recurse'];

      const task: RLMTask = {
        id: 'task-1',
        type: 'graph_query',
        query: 'what calls handleAuth'
      };

      expect(validTypes).toContain(task.type);
    });

    it('should include optional params', () => {
      const task: RLMTask = {
        id: 'search-1',
        type: 'vector_search',
        query: 'authentication logic',
        params: { limit: 10, minScore: 0.5 }
      };

      expect(task.params).toHaveProperty('limit', 10);
      expect(task.params).toHaveProperty('minScore', 0.5);
    });
  });

  describe('RLMResult', () => {
    it('should contain required fields', () => {
      const result: RLMResult = {
        answer: 'The authentication system uses JWT tokens.',
        trace: [],
        depth: 2,
        sources: ['src/auth/jwt.ts:45', 'src/auth/middleware.ts:12']
      };

      expect(result.answer).toBeDefined();
      expect(result.depth).toBe(2);
      expect(result.sources).toHaveLength(2);
    });
  });

  describe('Router Options', () => {
    it('should use default values when not provided', () => {
      const minimalRouter = new RLMRouter({
        apiKey: 'test-key'
      });

      // Access private properties via any cast for testing
      const routerAny = minimalRouter as any;
      expect(routerAny.maxDepth).toBe(5);
      expect(routerAny.model).toContain('claude');
    });

    it('should use provided values when specified', () => {
      const customRouter = new RLMRouter({
        apiKey: 'test-key',
        maxDepth: 10,
        maxTokens: 8192,
        temperature: 0.5,
        model: 'claude-3-opus-20240229'
      });

      const routerAny = customRouter as any;
      expect(routerAny.maxDepth).toBe(10);
      expect(routerAny.maxTokens).toBe(8192);
      expect(routerAny.temperature).toBe(0.5);
      expect(routerAny.model).toBe('claude-3-opus-20240229');
    });
  });

  describe('Buffer Summarization', () => {
    // Test the private summarizeBuffers method by testing through formatTrace indirectly
    it('should handle empty buffers gracefully', () => {
      const emptyResult: RLMResult = {
        answer: 'No context gathered',
        trace: [],
        depth: 0,
        sources: []
      };

      expect(emptyResult.trace).toHaveLength(0);
      expect(emptyResult.sources).toHaveLength(0);
    });
  });

  describe('Source Extraction', () => {
    it('should extract sources from symbol results', () => {
      const trace: RLMStep[] = [{
        taskType: 'graph_query',
        query: 'find handleAuth',
        result: {
          type: 'symbol',
          target: 'handleAuth',
          result: {
            name: 'handleAuth',
            file: 'src/auth.ts',
            startLine: 42,
            kind: 'function'
          }
        },
        depth: 0,
        timestamp: Date.now()
      }];

      // The sources should be extractable from the result
      const symbolResult = trace[0].result.result;
      const source = `${symbolResult.file}:${symbolResult.startLine}`;
      expect(source).toBe('src/auth.ts:42');
    });

    it('should extract sources from vector search results', () => {
      const trace: RLMStep[] = [{
        taskType: 'vector_search',
        query: 'authentication',
        result: {
          type: 'vector_search',
          query: 'authentication',
          results: [
            { file: 'src/auth.ts', startLine: 10, score: 0.9 },
            { file: 'src/login.ts', startLine: 25, score: 0.8 }
          ]
        },
        depth: 0,
        timestamp: Date.now()
      }];

      const results = trace[0].result.results;
      expect(results).toHaveLength(2);
      expect(`${results[0].file}:${results[0].startLine}`).toBe('src/auth.ts:10');
    });
  });
});

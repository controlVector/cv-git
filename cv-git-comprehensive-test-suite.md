# CV-Git: Comprehensive Test Suite Implementation

## For Claude Code

**Project**: CV-Git (AI-native version control)
**Goal**: Achieve 100+ tests with >80% coverage across all services
**Framework**: Vitest with TypeScript

---

## Part 1: Test Infrastructure Setup

### 1.1 Install Dependencies

```bash
cd /path/to/cv-git
pnpm add -D vitest @vitest/coverage-v8 @vitest/ui vitest-mock-extended
pnpm add -D @types/node
```

### 1.2 Create Vitest Config

**Create**: `vitest.config.ts` (root)

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        '**/test-utils/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['./packages/core/src/test-utils/setup.ts'],
    alias: {
      '@cv-git/core': path.resolve(__dirname, './packages/core/src'),
      '@cv-git/cli': path.resolve(__dirname, './packages/cli/src'),
    },
  },
});
```

### 1.3 Create Test Utilities

**Create**: `packages/core/src/test-utils/setup.ts`

```typescript
import { vi, beforeEach, afterEach, afterAll } from 'vitest';

// Reset all mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Global test timeout
vi.setConfig({ testTimeout: 30000 });
```

**Create**: `packages/core/src/test-utils/mocks.ts`

```typescript
import { vi } from 'vitest';

// ============================================
// FalkorDB Mock
// ============================================
export const createMockGraphClient = () => ({
  query: vi.fn().mockResolvedValue({ data: [] }),
  close: vi.fn().mockResolvedValue(undefined),
});

export const mockFalkorDB = {
  Graph: vi.fn().mockImplementation(() => createMockGraphClient()),
};

// ============================================
// Qdrant Mock
// ============================================
export const createMockQdrantClient = () => ({
  search: vi.fn().mockResolvedValue([]),
  upsert: vi.fn().mockResolvedValue({ status: 'ok' }),
  delete: vi.fn().mockResolvedValue({ status: 'ok' }),
  getCollections: vi.fn().mockResolvedValue({ collections: [] }),
  createCollection: vi.fn().mockResolvedValue({ status: 'ok' }),
  collectionExists: vi.fn().mockResolvedValue(false),
});

export const mockQdrant = {
  QdrantClient: vi.fn().mockImplementation(() => createMockQdrantClient()),
};

// ============================================
// AI/LLM Mock
// ============================================
export interface MockAIResponse {
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export const createMockAIService = (defaultResponse?: MockAIResponse) => ({
  complete: vi.fn().mockResolvedValue(
    defaultResponse ?? {
      content: JSON.stringify({ tasks: [], canAnswer: true, answer: 'Mock answer' }),
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }
  ),
  embed: vi.fn().mockResolvedValue({
    embedding: new Array(1536).fill(0).map(() => Math.random()),
  }),
  embedBatch: vi.fn().mockResolvedValue({
    embeddings: [new Array(1536).fill(0).map(() => Math.random())],
  }),
});

// ============================================
// File System Mock
// ============================================
export const createMockFS = () => ({
  readFile: vi.fn().mockResolvedValue('mock file content'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue(['file1.ts', 'file2.ts']),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => false, isFile: () => true }),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  existsSync: vi.fn().mockReturnValue(true),
});

// ============================================
// Git Mock
// ============================================
export const createMockGit = () => ({
  diff: vi.fn().mockResolvedValue('mock diff content'),
  log: vi.fn().mockResolvedValue([{ hash: 'abc123', message: 'test commit' }]),
  status: vi.fn().mockResolvedValue({ files: [] }),
  revparse: vi.fn().mockResolvedValue('/mock/repo'),
});

// ============================================
// Cache Mock
// ============================================
export const createMockCache = () => {
  const store = new Map<string, any>();
  return {
    get: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, value: any) => store.set(key, value)),
    delete: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
    has: vi.fn((key: string) => store.has(key)),
    getStats: vi.fn(() => ({ hits: 10, misses: 5, size: store.size })),
  };
};
```

**Create**: `packages/core/src/test-utils/fixtures.ts`

```typescript
// ============================================
// Symbol Fixtures
// ============================================
export const mockSymbols = {
  function: {
    name: 'processData',
    kind: 'function',
    file: '/src/utils/data.ts',
    startLine: 10,
    endLine: 25,
    signature: 'processData(input: string): Promise<Result>',
  },
  class: {
    name: 'DataProcessor',
    kind: 'class',
    file: '/src/services/processor.ts',
    startLine: 1,
    endLine: 100,
  },
  interface: {
    name: 'ProcessorConfig',
    kind: 'interface',
    file: '/src/types/config.ts',
    startLine: 5,
    endLine: 15,
  },
};

// ============================================
// Graph Query Result Fixtures
// ============================================
export const mockGraphResults = {
  symbols: [
    { s: { properties: { name: 'functionA', kind: 'function', file: '/src/a.ts' } } },
    { s: { properties: { name: 'functionB', kind: 'function', file: '/src/b.ts' } } },
  ],
  calls: [
    {
      caller: { properties: { name: 'main' } },
      callee: { properties: { name: 'helper' } },
    },
  ],
  path: [
    { nodes: [{ properties: { name: 'A' } }, { properties: { name: 'B' } }, { properties: { name: 'C' } }] },
  ],
  hubs: [
    { s: { properties: { name: 'CoreService' } }, connections: 15 },
    { s: { properties: { name: 'Utils' } }, connections: 10 },
  ],
};

// ============================================
// Vector Search Fixtures
// ============================================
export const mockVectorResults = [
  { id: '1', score: 0.95, payload: { name: 'relevantFunction', file: '/src/relevant.ts' } },
  { id: '2', score: 0.85, payload: { name: 'relatedHelper', file: '/src/helper.ts' } },
];

// ============================================
// Codebase Summary Fixture
// ============================================
export const mockCodebaseSummary = {
  stats: {
    totalFiles: 50,
    totalSymbols: 200,
    languages: { TypeScript: 45, JavaScript: 5 },
  },
  architecture: {
    entryPoints: ['/src/index.ts', '/src/cli.ts'],
    coreModules: ['/src/services/', '/src/core/'],
    patterns: ['Repository', 'Service Layer', 'Dependency Injection'],
  },
  conventions: {
    naming: 'camelCase for functions, PascalCase for classes',
    fileStructure: 'Feature-based organization',
    errorHandling: 'Custom error classes with typed errors',
    testing: 'Vitest with co-located test files',
  },
  abstractions: {
    interfaces: ['IService', 'IRepository', 'IConfig'],
    baseClasses: ['BaseService', 'BaseController'],
    utilities: ['logger', 'validator', 'formatter'],
  },
  dependencies: {
    external: ['typescript', 'vitest', 'commander'],
    hotspots: ['/src/services/core.ts'],
    potentialIssues: [],
  },
  naturalLanguageSummary: 'A TypeScript-based version control system with AI capabilities.',
  embedding: new Array(1536).fill(0.1),
};

// ============================================
// RLM Task Fixtures
// ============================================
export const mockRLMTasks = {
  graphQuery: {
    id: 'task-1',
    type: 'graph_query' as const,
    query: 'MATCH (s:Symbol) RETURN s LIMIT 10',
    description: 'Find all symbols',
  },
  vectorSearch: {
    id: 'task-2',
    type: 'vector_search' as const,
    query: 'authentication flow',
    description: 'Search for auth-related code',
  },
  llmExplain: {
    id: 'task-3',
    type: 'llm_explain' as const,
    prompt: 'Explain the purpose of this function',
    context: 'function processAuth() { ... }',
  },
  findPath: {
    id: 'task-4',
    type: 'find_path' as const,
    from: 'handleRequest',
    to: 'saveToDatabase',
  },
  getNeighborhood: {
    id: 'task-5',
    type: 'get_neighborhood' as const,
    symbol: 'CoreService',
    depth: 2,
  },
  impactAnalysis: {
    id: 'task-6',
    type: 'impact_analysis' as const,
    symbol: 'validateInput',
  },
};

// ============================================
// Diff Fixtures
// ============================================
export const mockDiff = {
  staged: `diff --git a/src/service.ts b/src/service.ts
index abc123..def456 100644
--- a/src/service.ts
+++ b/src/service.ts
@@ -10,6 +10,8 @@ export class Service {
   async process(data: string): Promise<Result> {
+    // Add validation
+    if (!data) throw new Error('Data required');
     return this.handler.process(data);
   }
 }`,
  unstaged: `diff --git a/src/utils.ts b/src/utils.ts
index 111222..333444 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -5,3 +5,7 @@ export function helper() {
   return true;
 }
+
+export function newHelper() {
+  return false;
+}`,
};
```

**Create**: `packages/core/src/test-utils/cli-helper.ts`

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute CLI command and return results
 */
export async function runCLI(args: string[], cwd?: string): Promise<CLIResult> {
  const cliPath = path.resolve(__dirname, '../../../cli/dist/index.js');
  const command = `node ${cliPath} ${args.join(' ')}`;
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, NODE_ENV: 'test' },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message,
      exitCode: error.code ?? 1,
    };
  }
}

/**
 * Parse JSON output from CLI
 */
export function parseJSONOutput<T>(output: string): T {
  // Remove ANSI codes and parse JSON
  const cleaned = output.replace(/\x1b\[[0-9;]*m/g, '').trim();
  return JSON.parse(cleaned);
}
```

**Create**: `packages/core/src/test-utils/index.ts`

```typescript
export * from './mocks';
export * from './fixtures';
export * from './cli-helper';
```

---

## Part 2: Core Service Unit Tests

### 2.1 CacheService Tests

**Create**: `packages/core/src/services/cache-service.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CacheService, graphCache, vectorCache, aiCache } from './cache-service';

describe('CacheService', () => {
  let cache: CacheService<string>;

  beforeEach(() => {
    cache = new CacheService<string>({ max: 100, ttl: 60000 });
  });

  afterEach(() => {
    cache.clear();
  });

  describe('basic operations', () => {
    it('should set and get values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for missing keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should delete values', () => {
      cache.set('key1', 'value1');
      cache.delete('key1');
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should check if key exists', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should clear all values', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
    });
  });

  describe('TTL behavior', () => {
    it('should expire values after TTL', async () => {
      const shortTTLCache = new CacheService<string>({ max: 100, ttl: 100 });
      shortTTLCache.set('key1', 'value1');
      
      // Value exists initially
      expect(shortTTLCache.get('key1')).toBe('value1');
      
      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Value should be gone
      expect(shortTTLCache.get('key1')).toBeUndefined();
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used items when at capacity', () => {
      const smallCache = new CacheService<string>({ max: 3, ttl: 60000 });
      
      smallCache.set('a', '1');
      smallCache.set('b', '2');
      smallCache.set('c', '3');
      
      // Access 'a' to make it recently used
      smallCache.get('a');
      
      // Add new item, should evict 'b' (least recently used)
      smallCache.set('d', '4');
      
      expect(smallCache.has('a')).toBe(true);
      expect(smallCache.has('b')).toBe(false);
      expect(smallCache.has('c')).toBe(true);
      expect(smallCache.has('d')).toBe(true);
    });
  });

  describe('statistics', () => {
    it('should track hits and misses', () => {
      cache.set('key1', 'value1');
      
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('missing'); // miss
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('should calculate hit rate correctly', () => {
      cache.set('key1', 'value1');
      
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('missing'); // miss
      
      const stats = cache.getStats();
      expect(stats.hitRate).toBeCloseTo(0.75, 2);
    });

    it('should report size correctly', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      
      const stats = cache.getStats();
      expect(stats.size).toBe(3);
    });
  });

  describe('global cache instances', () => {
    it('should have separate graph cache', () => {
      graphCache.set('graph-key', { result: 'graph data' });
      expect(graphCache.get('graph-key')).toEqual({ result: 'graph data' });
    });

    it('should have separate vector cache', () => {
      vectorCache.set('vector-key', [0.1, 0.2, 0.3]);
      expect(vectorCache.get('vector-key')).toEqual([0.1, 0.2, 0.3]);
    });

    it('should have separate AI cache', () => {
      aiCache.set('ai-key', 'AI response');
      expect(aiCache.get('ai-key')).toBe('AI response');
    });
  });

  describe('edge cases', () => {
    it('should handle undefined values', () => {
      cache.set('key', undefined as any);
      expect(cache.has('key')).toBe(true);
    });

    it('should handle empty string keys', () => {
      cache.set('', 'empty key value');
      expect(cache.get('')).toBe('empty key value');
    });

    it('should handle special characters in keys', () => {
      const specialKey = 'key:with/special\\chars?query=1&foo=bar';
      cache.set(specialKey, 'special');
      expect(cache.get(specialKey)).toBe('special');
    });

    it('should handle large values', () => {
      const largeValue = 'x'.repeat(10000);
      cache.set('large', largeValue);
      expect(cache.get('large')).toBe(largeValue);
    });
  });
});
```

### 2.2 GraphService Tests (Extended)

**Create**: `packages/core/src/services/graph-service.extended.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphService } from './graph-service';
import { createMockGraphClient, createMockCache } from '../test-utils/mocks';
import { mockGraphResults } from '../test-utils/fixtures';

describe('GraphService', () => {
  let graphService: GraphService;
  let mockClient: ReturnType<typeof createMockGraphClient>;
  let mockCache: ReturnType<typeof createMockCache>;

  beforeEach(() => {
    mockClient = createMockGraphClient();
    mockCache = createMockCache();
    graphService = new GraphService(mockClient as any, mockCache as any);
  });

  describe('findPath', () => {
    it('should find shortest path between two symbols', async () => {
      mockClient.query.mockResolvedValueOnce({
        data: [[{ nodes: [
          { properties: { name: 'A', kind: 'function' } },
          { properties: { name: 'B', kind: 'function' } },
          { properties: { name: 'C', kind: 'function' } },
        ]}]],
      });

      const result = await graphService.findPath('A', 'C');

      expect(result.found).toBe(true);
      expect(result.path).toHaveLength(3);
      expect(result.path[0].name).toBe('A');
      expect(result.path[2].name).toBe('C');
    });

    it('should return not found when no path exists', async () => {
      mockClient.query.mockResolvedValueOnce({ data: [] });

      const result = await graphService.findPath('X', 'Y');

      expect(result.found).toBe(false);
      expect(result.path).toHaveLength(0);
    });

    it('should use cache for repeated queries', async () => {
      mockClient.query.mockResolvedValueOnce({
        data: [[{ nodes: [{ properties: { name: 'A' } }, { properties: { name: 'B' } }] }]],
      });

      await graphService.findPath('A', 'B');
      await graphService.findPath('A', 'B');

      expect(mockClient.query).toHaveBeenCalledTimes(1);
      expect(mockCache.get).toHaveBeenCalled();
    });

    it('should generate human-readable explanation', async () => {
      mockClient.query.mockResolvedValueOnce({
        data: [[{ nodes: [
          { properties: { name: 'handleRequest', kind: 'function' } },
          { properties: { name: 'validateInput', kind: 'function' } },
          { properties: { name: 'processData', kind: 'function' } },
        ]}]],
      });

      const result = await graphService.findPath('handleRequest', 'processData');

      expect(result.explanation).toContain('handleRequest');
      expect(result.explanation).toContain('processData');
    });
  });

  describe('findAllPaths', () => {
    it('should find multiple paths between symbols', async () => {
      mockClient.query.mockResolvedValueOnce({
        data: [
          [{ nodes: [{ properties: { name: 'A' } }, { properties: { name: 'B' } }, { properties: { name: 'C' } }] }],
          [{ nodes: [{ properties: { name: 'A' } }, { properties: { name: 'D' } }, { properties: { name: 'C' } }] }],
        ],
      });

      const result = await graphService.findAllPaths('A', 'C', 5);

      expect(result).toHaveLength(2);
    });

    it('should respect maxPaths limit', async () => {
      const manyPaths = Array(10).fill(null).map((_, i) => 
        [{ nodes: [{ properties: { name: 'A' } }, { properties: { name: `mid${i}` } }, { properties: { name: 'C' } }] }]
      );
      mockClient.query.mockResolvedValueOnce({ data: manyPaths });

      const result = await graphService.findAllPaths('A', 'C', 3);

      expect(result.length).toBeLessThanOrEqual(3);
    });
  });

  describe('getNeighborhood', () => {
    it('should return immediate neighbors at depth 1', async () => {
      mockClient.query.mockResolvedValueOnce({
        data: [
          { neighbor: { properties: { name: 'neighbor1', kind: 'function' } }, rel: { type: 'CALLS' } },
          { neighbor: { properties: { name: 'neighbor2', kind: 'class' } }, rel: { type: 'IMPORTS' } },
        ],
      });

      const result = await graphService.getNeighborhood('CentralNode', 1);

      expect(result.center).toBe('CentralNode');
      expect(result.neighbors).toHaveLength(2);
    });

    it('should expand neighborhood at greater depth', async () => {
      // First query for depth 1
      mockClient.query.mockResolvedValueOnce({
        data: [
          { neighbor: { properties: { name: 'level1' } }, rel: { type: 'CALLS' } },
        ],
      });
      // Second query for depth 2
      mockClient.query.mockResolvedValueOnce({
        data: [
          { neighbor: { properties: { name: 'level2' } }, rel: { type: 'CALLS' } },
        ],
      });

      const result = await graphService.getNeighborhood('Start', 2);

      expect(result.depth).toBe(2);
    });

    it('should categorize relationships by type', async () => {
      mockClient.query.mockResolvedValueOnce({
        data: [
          { neighbor: { properties: { name: 'called1' } }, rel: { type: 'CALLS' } },
          { neighbor: { properties: { name: 'called2' } }, rel: { type: 'CALLS' } },
          { neighbor: { properties: { name: 'imported1' } }, rel: { type: 'IMPORTS' } },
        ],
      });

      const result = await graphService.getNeighborhood('Node', 1);

      const calls = result.neighbors.filter(n => n.relationship === 'CALLS');
      const imports = result.neighbors.filter(n => n.relationship === 'IMPORTS');
      
      expect(calls).toHaveLength(2);
      expect(imports).toHaveLength(1);
    });
  });

  describe('getImpactAnalysis', () => {
    it('should analyze impact of changing a symbol', async () => {
      // Direct callers
      mockClient.query.mockResolvedValueOnce({
        data: [
          { caller: { properties: { name: 'directCaller1' } } },
          { caller: { properties: { name: 'directCaller2' } } },
        ],
      });
      // Indirect callers
      mockClient.query.mockResolvedValueOnce({
        data: [
          { caller: { properties: { name: 'indirectCaller1' } } },
          { caller: { properties: { name: 'indirectCaller2' } } },
          { caller: { properties: { name: 'indirectCaller3' } } },
        ],
      });
      // Implementors
      mockClient.query.mockResolvedValueOnce({
        data: [],
      });

      const result = await graphService.getImpactAnalysis('TargetSymbol');

      expect(result.symbol).toBe('TargetSymbol');
      expect(result.directCallers).toHaveLength(2);
      expect(result.indirectCallers).toHaveLength(3);
      expect(result.totalImpact).toBe(5);
    });

    it('should calculate risk level based on impact', async () => {
      // Many callers = HIGH risk
      const manycallers = Array(20).fill({ caller: { properties: { name: 'caller' } } });
      mockClient.query.mockResolvedValueOnce({ data: manycallers });
      mockClient.query.mockResolvedValueOnce({ data: [] });
      mockClient.query.mockResolvedValueOnce({ data: [] });

      const result = await graphService.getImpactAnalysis('CriticalSymbol');

      expect(result.riskLevel).toBe('HIGH');
    });

    it('should identify implementors for interfaces', async () => {
      mockClient.query.mockResolvedValueOnce({ data: [] });
      mockClient.query.mockResolvedValueOnce({ data: [] });
      mockClient.query.mockResolvedValueOnce({
        data: [
          { impl: { properties: { name: 'ConcreteClass1' } } },
          { impl: { properties: { name: 'ConcreteClass2' } } },
        ],
      });

      const result = await graphService.getImpactAnalysis('IService');

      expect(result.implementors).toHaveLength(2);
    });
  });

  describe('findBridge', () => {
    it('should find connecting code between two concepts', async () => {
      mockClient.query.mockResolvedValueOnce({
        data: [
          { bridge: { properties: { name: 'AuthService' } }, score: 5 },
          { bridge: { properties: { name: 'TokenValidator' } }, score: 3 },
        ],
      });

      const result = await graphService.findBridge('UserLogin', 'DatabaseAccess');

      expect(result.bridges).toHaveLength(2);
      expect(result.bridges[0].name).toBe('AuthService');
    });

    it('should return empty when no bridge exists', async () => {
      mockClient.query.mockResolvedValueOnce({ data: [] });

      const result = await graphService.findBridge('Unrelated1', 'Unrelated2');

      expect(result.bridges).toHaveLength(0);
    });
  });

  describe('getHubs', () => {
    it('should return most connected symbols', async () => {
      mockClient.query.mockResolvedValueOnce({
        data: mockGraphResults.hubs,
      });

      const result = await graphService.getHubs(10);

      expect(result).toHaveLength(2);
      expect(result[0].connections).toBeGreaterThanOrEqual(result[1].connections);
    });

    it('should respect limit parameter', async () => {
      const manyHubs = Array(20).fill(null).map((_, i) => ({
        s: { properties: { name: `Hub${i}` } },
        connections: 20 - i,
      }));
      mockClient.query.mockResolvedValueOnce({ data: manyHubs });

      const result = await graphService.getHubs(5);

      expect(result).toHaveLength(5);
    });
  });

  describe('error handling', () => {
    it('should handle query errors gracefully', async () => {
      mockClient.query.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(graphService.findPath('A', 'B')).rejects.toThrow('Database connection failed');
    });

    it('should handle malformed results', async () => {
      mockClient.query.mockResolvedValueOnce({ data: null });

      const result = await graphService.findPath('A', 'B');

      expect(result.found).toBe(false);
    });

    it('should validate input parameters', async () => {
      await expect(graphService.findPath('', 'B')).rejects.toThrow();
      await expect(graphService.getNeighborhood('A', -1)).rejects.toThrow();
    });
  });
});
```

### 2.3 RLM Router Tests (Extended)

**Create**: `packages/core/src/services/rlm-router.extended.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RLMRouter, RLMContext, RLMTask } from './rlm-router';
import { 
  createMockGraphClient, 
  createMockQdrantClient, 
  createMockAIService 
} from '../test-utils/mocks';
import { mockCodebaseSummary, mockRLMTasks } from '../test-utils/fixtures';

describe('RLMRouter', () => {
  let router: RLMRouter;
  let mockGraph: ReturnType<typeof createMockGraphClient>;
  let mockVector: ReturnType<typeof createMockQdrantClient>;
  let mockAI: ReturnType<typeof createMockAIService>;

  beforeEach(() => {
    mockGraph = createMockGraphClient();
    mockVector = createMockQdrantClient();
    mockAI = createMockAIService();
    
    router = new RLMRouter({
      graphService: mockGraph as any,
      vectorService: mockVector as any,
      aiService: mockAI as any,
      codebaseSummary: mockCodebaseSummary,
    });
  });

  describe('decomposition', () => {
    it('should decompose complex queries into tasks', async () => {
      mockAI.complete.mockResolvedValueOnce({
        content: JSON.stringify({
          tasks: [
            { id: 't1', type: 'graph_query', query: 'MATCH (s) RETURN s' },
            { id: 't2', type: 'vector_search', query: 'authentication' },
          ],
          canAnswer: false,
        }),
      });

      const ctx = router.createContext('How does authentication work?');
      const plan = await router['decompose']('How does authentication work?', ctx);

      expect(plan.tasks).toHaveLength(2);
      expect(plan.tasks[0].type).toBe('graph_query');
      expect(plan.tasks[1].type).toBe('vector_search');
    });

    it('should include codebase summary in decomposition context', async () => {
      mockAI.complete.mockResolvedValueOnce({
        content: JSON.stringify({ tasks: [], canAnswer: true, answer: 'test' }),
      });

      await router.reason('test query');

      expect(mockAI.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('TypeScript-based version control'),
            }),
          ]),
        })
      );
    });
  });

  describe('task execution', () => {
    describe('graph_query', () => {
      it('should execute Cypher queries', async () => {
        mockGraph.query.mockResolvedValueOnce({
          data: [{ s: { properties: { name: 'TestSymbol' } } }],
        });

        const result = await router['executeTask'](mockRLMTasks.graphQuery, router.createContext(''));

        expect(mockGraph.query).toHaveBeenCalledWith(mockRLMTasks.graphQuery.query);
        expect(result).toBeDefined();
      });

      it('should handle empty graph results', async () => {
        mockGraph.query.mockResolvedValueOnce({ data: [] });

        const result = await router['executeTask'](mockRLMTasks.graphQuery, router.createContext(''));

        expect(result).toEqual({ data: [], isEmpty: true });
      });
    });

    describe('vector_search', () => {
      it('should perform semantic search', async () => {
        mockVector.search.mockResolvedValueOnce([
          { id: '1', score: 0.95, payload: { name: 'match1' } },
        ]);

        const result = await router['executeTask'](mockRLMTasks.vectorSearch, router.createContext(''));

        expect(mockVector.search).toHaveBeenCalled();
        expect(result).toHaveLength(1);
      });
    });

    describe('llm_explain', () => {
      it('should get AI explanation', async () => {
        mockAI.complete.mockResolvedValueOnce({
          content: 'This function handles authentication by...',
        });

        const result = await router['executeTask'](mockRLMTasks.llmExplain, router.createContext(''));

        expect(result).toContain('authentication');
      });
    });

    describe('find_path', () => {
      it('should find code paths', async () => {
        mockGraph.query.mockResolvedValueOnce({
          data: [[{ nodes: [{ properties: { name: 'A' } }, { properties: { name: 'B' } }] }]],
        });

        const result = await router['executeTask'](mockRLMTasks.findPath, router.createContext(''));

        expect(result.found).toBe(true);
      });
    });

    describe('get_neighborhood', () => {
      it('should explore symbol neighborhood', async () => {
        mockGraph.query.mockResolvedValueOnce({
          data: [{ neighbor: { properties: { name: 'Neighbor1' } }, rel: { type: 'CALLS' } }],
        });

        const result = await router['executeTask'](mockRLMTasks.getNeighborhood, router.createContext(''));

        expect(result.neighbors).toBeDefined();
      });
    });

    describe('impact_analysis', () => {
      it('should analyze change impact', async () => {
        mockGraph.query
          .mockResolvedValueOnce({ data: [{ caller: { properties: { name: 'Caller1' } } }] })
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValueOnce({ data: [] });

        const result = await router['executeTask'](mockRLMTasks.impactAnalysis, router.createContext(''));

        expect(result.directCallers).toBeDefined();
      });
    });
  });

  describe('recursion', () => {
    it('should recurse when canAnswer is false', async () => {
      // First decomposition returns tasks
      mockAI.complete
        .mockResolvedValueOnce({
          content: JSON.stringify({
            tasks: [{ id: 't1', type: 'graph_query', query: 'MATCH (s) RETURN s' }],
            canAnswer: false,
            refinedQuery: 'What specific functions handle auth?',
          }),
        })
        // Task execution context (if any)
        .mockResolvedValueOnce({
          content: JSON.stringify({
            tasks: [],
            canAnswer: true,
            answer: 'The auth functions are...',
          }),
        });

      mockGraph.query.mockResolvedValue({ data: [] });

      const result = await router.reason('How does auth work?', { maxDepth: 2 });

      expect(mockAI.complete).toHaveBeenCalledTimes(2);
    });

    it('should stop at maxDepth', async () => {
      // Always return canAnswer: false
      mockAI.complete.mockResolvedValue({
        content: JSON.stringify({
          tasks: [],
          canAnswer: false,
          refinedQuery: 'More specific question',
        }),
      });

      const result = await router.reason('Complex question', { maxDepth: 3 });

      // Should stop at depth 3 even if canAnswer is false
      expect(result.depth).toBeLessThanOrEqual(3);
    });

    it('should accumulate results across recursion levels', async () => {
      mockAI.complete
        .mockResolvedValueOnce({
          content: JSON.stringify({
            tasks: [{ id: 't1', type: 'graph_query', query: 'Q1' }],
            canAnswer: false,
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            tasks: [{ id: 't2', type: 'graph_query', query: 'Q2' }],
            canAnswer: true,
            answer: 'Final answer',
          }),
        });

      mockGraph.query.mockResolvedValue({ data: [{ test: true }] });

      const result = await router.reason('Question', { maxDepth: 5 });

      expect(result.trace).toHaveLength(2); // Both task executions recorded
    });
  });

  describe('context management', () => {
    it('should create fresh context for each query', () => {
      const ctx1 = router.createContext('Query 1');
      const ctx2 = router.createContext('Query 2');

      expect(ctx1.id).not.toBe(ctx2.id);
      expect(ctx1.buffers.size).toBe(0);
    });

    it('should store task results in buffers', async () => {
      mockAI.complete.mockResolvedValueOnce({
        content: JSON.stringify({
          tasks: [{ id: 'buffer-test', type: 'graph_query', query: 'Q' }],
          canAnswer: true,
          answer: 'Done',
        }),
      });
      mockGraph.query.mockResolvedValue({ data: ['result'] });

      const result = await router.reason('Test', { trace: true });

      expect(result.trace?.some(t => t.taskId === 'buffer-test')).toBe(true);
    });
  });

  describe('parallel execution', () => {
    it('should execute independent tasks in parallel', async () => {
      const startTime = Date.now();
      
      mockAI.complete.mockResolvedValueOnce({
        content: JSON.stringify({
          tasks: [
            { id: 't1', type: 'graph_query', query: 'Q1' },
            { id: 't2', type: 'vector_search', query: 'search1' },
            { id: 't3', type: 'graph_query', query: 'Q2' },
          ],
          canAnswer: true,
          answer: 'Parallel result',
        }),
      });

      // Simulate 100ms delay for each task
      mockGraph.query.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ data: [] }), 100))
      );
      mockVector.search.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve([]), 100))
      );

      await router.reason('Parallel test');

      const elapsed = Date.now() - startTime;
      // If parallel, should take ~100ms, not 300ms
      expect(elapsed).toBeLessThan(250);
    });
  });

  describe('error handling', () => {
    it('should handle task execution errors', async () => {
      mockAI.complete.mockResolvedValueOnce({
        content: JSON.stringify({
          tasks: [{ id: 't1', type: 'graph_query', query: 'BAD QUERY' }],
          canAnswer: true,
          answer: 'Fallback',
        }),
      });
      mockGraph.query.mockRejectedValue(new Error('Query syntax error'));

      const result = await router.reason('Test');

      // Should still return a result, not throw
      expect(result).toBeDefined();
      expect(result.errors).toContain('Query syntax error');
    });

    it('should handle malformed AI responses', async () => {
      mockAI.complete.mockResolvedValueOnce({
        content: 'Not valid JSON',
      });

      await expect(router.reason('Test')).rejects.toThrow();
    });

    it('should handle AI service timeout', async () => {
      mockAI.complete.mockImplementation(() => 
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
      );

      await expect(router.reason('Test', { timeout: 50 })).rejects.toThrow('Timeout');
    });
  });

  describe('tracing', () => {
    it('should record execution trace when enabled', async () => {
      mockAI.complete.mockResolvedValueOnce({
        content: JSON.stringify({
          tasks: [{ id: 't1', type: 'graph_query', query: 'Q', description: 'Test task' }],
          canAnswer: true,
          answer: 'Result',
        }),
      });
      mockGraph.query.mockResolvedValue({ data: [] });

      const result = await router.reason('Test', { trace: true });

      expect(result.trace).toBeDefined();
      expect(result.trace).toHaveLength(1);
      expect(result.trace?.[0]).toMatchObject({
        taskId: 't1',
        type: 'graph_query',
        description: 'Test task',
      });
    });

    it('should include timing information in trace', async () => {
      mockAI.complete.mockResolvedValueOnce({
        content: JSON.stringify({
          tasks: [{ id: 't1', type: 'graph_query', query: 'Q' }],
          canAnswer: true,
          answer: 'Result',
        }),
      });
      mockGraph.query.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ data: [] }), 50))
      );

      const result = await router.reason('Test', { trace: true });

      expect(result.trace?.[0].durationMs).toBeGreaterThanOrEqual(50);
    });
  });
});
```

### 2.4 CodebaseSummary Tests (Extended)

**Create**: `packages/core/src/services/codebase-summary.extended.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodebaseSummaryService } from './codebase-summary';
import { 
  createMockGraphClient, 
  createMockAIService,
  createMockFS 
} from '../test-utils/mocks';

describe('CodebaseSummaryService', () => {
  let service: CodebaseSummaryService;
  let mockGraph: ReturnType<typeof createMockGraphClient>;
  let mockAI: ReturnType<typeof createMockAIService>;
  let mockFS: ReturnType<typeof createMockFS>;

  beforeEach(() => {
    mockGraph = createMockGraphClient();
    mockAI = createMockAIService();
    mockFS = createMockFS();
    
    service = new CodebaseSummaryService({
      graphService: mockGraph as any,
      aiService: mockAI as any,
      fs: mockFS as any,
    });
  });

  describe('statistics gathering', () => {
    it('should count total files', async () => {
      mockGraph.query.mockResolvedValueOnce({
        data: [[{ count: 42 }]],
      });

      const stats = await service['gatherStats']();

      expect(stats.totalFiles).toBe(42);
    });

    it('should count total symbols', async () => {
      mockGraph.query
        .mockResolvedValueOnce({ data: [[{ count: 100 }]] }) // files
        .mockResolvedValueOnce({ data: [[{ count: 500 }]] }); // symbols

      const stats = await service['gatherStats']();

      expect(stats.totalSymbols).toBe(500);
    });

    it('should break down by language', async () => {
      mockGraph.query
        .mockResolvedValueOnce({ data: [[{ count: 50 }]] })
        .mockResolvedValueOnce({ data: [[{ count: 200 }]] })
        .mockResolvedValueOnce({
          data: [
            { language: 'TypeScript', count: 40 },
            { language: 'JavaScript', count: 10 },
          ],
        });

      const stats = await service['gatherStats']();

      expect(stats.languages).toEqual({
        TypeScript: 40,
        JavaScript: 10,
      });
    });
  });

  describe('architecture detection', () => {
    it('should identify entry points', async () => {
      mockGraph.query.mockResolvedValueOnce({
        data: [
          { file: '/src/index.ts' },
          { file: '/src/cli.ts' },
        ],
      });

      const arch = await service['detectArchitecture']();

      expect(arch.entryPoints).toContain('/src/index.ts');
      expect(arch.entryPoints).toContain('/src/cli.ts');
    });

    it('should detect patterns via AI', async () => {
      mockGraph.query.mockResolvedValue({ data: [] });
      mockAI.complete.mockResolvedValueOnce({
        content: JSON.stringify({
          patterns: ['Repository Pattern', 'Dependency Injection', 'MVC'],
        }),
      });

      const arch = await service['detectArchitecture']();

      expect(arch.patterns).toContain('Repository Pattern');
    });
  });

  describe('convention analysis', () => {
    it('should detect naming conventions', async () => {
      mockGraph.query.mockResolvedValueOnce({
        data: [
          { name: 'getUserById', kind: 'function' },
          { name: 'processData', kind: 'function' },
          { name: 'UserService', kind: 'class' },
          { name: 'DataProcessor', kind: 'class' },
        ],
      });
      mockAI.complete.mockResolvedValueOnce({
        content: JSON.stringify({
          naming: 'camelCase for functions, PascalCase for classes',
          fileStructure: 'Feature-based',
          errorHandling: 'Custom error classes',
          testing: 'Co-located test files',
        }),
      });

      const conventions = await service['analyzeConventions']();

      expect(conventions.naming).toContain('camelCase');
    });
  });

  describe('abstraction extraction', () => {
    it('should identify interfaces', async () => {
      mockGraph.query.mockResolvedValueOnce({
        data: [
          { name: 'IUserService', kind: 'interface' },
          { name: 'IRepository', kind: 'interface' },
        ],
      });

      const abstractions = await service['extractAbstractions']();

      expect(abstractions.interfaces).toContain('IUserService');
    });

    it('should identify base classes', async () => {
      mockGraph.query
        .mockResolvedValueOnce({ data: [] }) // interfaces
        .mockResolvedValueOnce({
          data: [
            { name: 'BaseController', extendedBy: 5 },
            { name: 'BaseService', extendedBy: 3 },
          ],
        });

      const abstractions = await service['extractAbstractions']();

      expect(abstractions.baseClasses).toContain('BaseController');
    });

    it('should identify utility functions', async () => {
      mockGraph.query
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({
          data: [
            { name: 'formatDate', callCount: 50 },
            { name: 'validateEmail', callCount: 30 },
          ],
        });

      const abstractions = await service['extractAbstractions']();

      expect(abstractions.utilities).toContain('formatDate');
    });
  });

  describe('dependency analysis', () => {
    it('should identify external dependencies', async () => {
      mockGraph.query.mockResolvedValueOnce({
        data: [
          { name: 'express', type: 'npm' },
          { name: 'lodash', type: 'npm' },
        ],
      });

      const deps = await service['analyzeDependencies']();

      expect(deps.external).toContain('express');
    });

    it('should identify hotspots', async () => {
      mockGraph.query
        .mockResolvedValueOnce({ data: [] }) // external
        .mockResolvedValueOnce({
          data: [
            { file: '/src/core/service.ts', incomingDeps: 25 },
          ],
        });

      const deps = await service['analyzeDependencies']();

      expect(deps.hotspots).toContain('/src/core/service.ts');
    });

    it('should detect circular dependencies', async () => {
      mockGraph.query
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({
          data: [
            { files: ['/src/a.ts', '/src/b.ts', '/src/a.ts'] },
          ],
        });

      const deps = await service['analyzeDependencies']();

      expect(deps.potentialIssues).toContainEqual(
        expect.objectContaining({ type: 'circular' })
      );
    });
  });

  describe('natural language summary', () => {
    it('should generate comprehensive summary', async () => {
      mockAI.complete.mockResolvedValueOnce({
        content: 'This is a TypeScript-based project that implements...',
      });

      const summary = await service['generateNLSummary']({
        stats: { totalFiles: 50, totalSymbols: 200, languages: { TypeScript: 50 } },
        architecture: { entryPoints: [], coreModules: [], patterns: [] },
        conventions: {},
        abstractions: {},
        dependencies: {},
      });

      expect(summary).toContain('TypeScript');
    });

    it('should include key metrics in summary', async () => {
      mockAI.complete.mockResolvedValueOnce({
        content: 'Project with 50 files and 200 symbols...',
      });

      const input = {
        stats: { totalFiles: 50, totalSymbols: 200, languages: { TypeScript: 50 } },
        architecture: { entryPoints: ['/src/index.ts'], coreModules: [], patterns: ['MVC'] },
        conventions: {},
        abstractions: {},
        dependencies: {},
      };

      await service['generateNLSummary'](input);

      expect(mockAI.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('50'),
            }),
          ]),
        })
      );
    });
  });

  describe('embedding generation', () => {
    it('should create compressed codebase embedding', async () => {
      mockAI.embed.mockResolvedValueOnce({
        embedding: new Array(1536).fill(0.5),
      });

      const embedding = await service['generateEmbedding']('Test summary');

      expect(embedding).toHaveLength(1536);
      expect(mockAI.embed).toHaveBeenCalledWith('Test summary');
    });
  });

  describe('full generation', () => {
    it('should generate complete summary', async () => {
      // Mock all queries
      mockGraph.query.mockResolvedValue({ data: [] });
      mockAI.complete.mockResolvedValue({
        content: JSON.stringify({ patterns: [] }),
      });
      mockAI.embed.mockResolvedValue({
        embedding: new Array(1536).fill(0.1),
      });

      const summary = await service.generate();

      expect(summary).toHaveProperty('stats');
      expect(summary).toHaveProperty('architecture');
      expect(summary).toHaveProperty('conventions');
      expect(summary).toHaveProperty('abstractions');
      expect(summary).toHaveProperty('dependencies');
      expect(summary).toHaveProperty('naturalLanguageSummary');
      expect(summary).toHaveProperty('embedding');
    });

    it('should cache generated summary', async () => {
      mockGraph.query.mockResolvedValue({ data: [] });
      mockAI.complete.mockResolvedValue({ content: '{}' });
      mockAI.embed.mockResolvedValue({ embedding: [] });

      await service.generate();
      await service.generate();

      // Should only generate once
      expect(mockAI.embed).toHaveBeenCalledTimes(1);
    });

    it('should force regeneration when requested', async () => {
      mockGraph.query.mockResolvedValue({ data: [] });
      mockAI.complete.mockResolvedValue({ content: '{}' });
      mockAI.embed.mockResolvedValue({ embedding: [] });

      await service.generate();
      await service.generate({ force: true });

      expect(mockAI.embed).toHaveBeenCalledTimes(2);
    });
  });

  describe('persistence', () => {
    it('should save summary to file', async () => {
      const summary = {
        stats: {},
        architecture: {},
        conventions: {},
        abstractions: {},
        dependencies: {},
        naturalLanguageSummary: 'Test',
        embedding: [],
      };

      await service.save(summary, '/path/to/summary.json');

      expect(mockFS.writeFile).toHaveBeenCalledWith(
        '/path/to/summary.json',
        expect.any(String)
      );
    });

    it('should load summary from file', async () => {
      const savedSummary = {
        stats: { totalFiles: 10 },
        naturalLanguageSummary: 'Loaded summary',
      };
      mockFS.readFile.mockResolvedValueOnce(JSON.stringify(savedSummary));

      const loaded = await service.load('/path/to/summary.json');

      expect(loaded.stats.totalFiles).toBe(10);
    });
  });
});
```

### 2.5 SemanticGraphService Tests

**Create**: `packages/core/src/services/semantic-graph.extended.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SemanticGraphService } from './semantic-graph';
import { 
  createMockGraphClient, 
  createMockQdrantClient,
  createMockAIService 
} from '../test-utils/mocks';
import { mockVectorResults } from '../test-utils/fixtures';

describe('SemanticGraphService', () => {
  let service: SemanticGraphService;
  let mockGraph: ReturnType<typeof createMockGraphClient>;
  let mockVector: ReturnType<typeof createMockQdrantClient>;
  let mockAI: ReturnType<typeof createMockAIService>;

  beforeEach(() => {
    mockGraph = createMockGraphClient();
    mockVector = createMockQdrantClient();
    mockAI = createMockAIService();
    
    service = new SemanticGraphService({
      graphService: mockGraph as any,
      vectorService: mockVector as any,
      aiService: mockAI as any,
    });
  });

  describe('semanticSearch', () => {
    it('should combine vector search with graph context', async () => {
      mockAI.embed.mockResolvedValueOnce({ embedding: new Array(1536).fill(0.1) });
      mockVector.search.mockResolvedValueOnce(mockVectorResults);
      mockGraph.query.mockResolvedValueOnce({
        data: [{ callers: 5, callees: 3 }],
      });

      const results = await service.semanticSearch('authentication handler');

      expect(results[0]).toHaveProperty('graphContext');
    });

    it('should rank results by combined score', async () => {
      mockAI.embed.mockResolvedValueOnce({ embedding: [] });
      mockVector.search.mockResolvedValueOnce([
        { id: '1', score: 0.8, payload: { name: 'lowGraph' } },
        { id: '2', score: 0.7, payload: { name: 'highGraph' } },
      ]);
      // First result has low graph importance
      mockGraph.query
        .mockResolvedValueOnce({ data: [{ callers: 1, callees: 1 }] })
        // Second result has high graph importance
        .mockResolvedValueOnce({ data: [{ callers: 10, callees: 5 }] });

      const results = await service.semanticSearch('test');

      // Higher graph importance should boost ranking
      expect(results[0].name).toBe('highGraph');
    });
  });

  describe('expandContext', () => {
    it('should expand results through graph traversal', async () => {
      mockAI.embed.mockResolvedValueOnce({ embedding: [] });
      mockVector.search.mockResolvedValueOnce([
        { id: '1', score: 0.9, payload: { name: 'CoreFunction' } },
      ]);
      // Graph expansion
      mockGraph.query.mockResolvedValueOnce({
        data: [
          { neighbor: { properties: { name: 'RelatedA' } } },
          { neighbor: { properties: { name: 'RelatedB' } } },
        ],
      });

      const expanded = await service.expandContext('core functionality', { depth: 1 });

      expect(expanded.core).toHaveLength(1);
      expect(expanded.expanded).toHaveLength(2);
    });

    it('should respect expansion depth', async () => {
      mockAI.embed.mockResolvedValue({ embedding: [] });
      mockVector.search.mockResolvedValue([{ id: '1', score: 0.9, payload: { name: 'Start' } }]);
      
      // Track query calls
      let queryCalls = 0;
      mockGraph.query.mockImplementation(() => {
        queryCalls++;
        return Promise.resolve({
          data: [{ neighbor: { properties: { name: `Level${queryCalls}` } } }],
        });
      });

      await service.expandContext('test', { depth: 3 });

      expect(queryCalls).toBeGreaterThanOrEqual(3);
    });
  });

  describe('findConceptCluster', () => {
    it('should find clusters of related code', async () => {
      mockAI.embed.mockResolvedValueOnce({ embedding: [] });
      mockVector.search.mockResolvedValueOnce([
        { id: '1', score: 0.95, payload: { name: 'AuthHandler' } },
        { id: '2', score: 0.90, payload: { name: 'TokenService' } },
        { id: '3', score: 0.85, payload: { name: 'SessionManager' } },
      ]);

      const cluster = await service.findConceptCluster('authentication');

      expect(cluster.concept).toBe('authentication');
      expect(cluster.members).toHaveLength(3);
    });

    it('should calculate cluster cohesion', async () => {
      mockAI.embed.mockResolvedValueOnce({ embedding: [] });
      mockVector.search.mockResolvedValueOnce([
        { id: '1', score: 0.95, payload: {} },
        { id: '2', score: 0.90, payload: {} },
      ]);
      // Members call each other = high cohesion
      mockGraph.query.mockResolvedValueOnce({
        data: [{ connections: 5 }],
      });

      const cluster = await service.findConceptCluster('tight cluster');

      expect(cluster.cohesion).toBeGreaterThan(0);
    });
  });

  describe('findSemanticBridge', () => {
    it('should find code bridging two concepts', async () => {
      // First concept search
      mockAI.embed
        .mockResolvedValueOnce({ embedding: new Array(1536).fill(0.1) })
        .mockResolvedValueOnce({ embedding: new Array(1536).fill(0.2) });
      
      mockVector.search
        .mockResolvedValueOnce([{ id: '1', payload: { name: 'UserAuth' } }])
        .mockResolvedValueOnce([{ id: '2', payload: { name: 'DatabaseAccess' } }]);

      // Bridge query
      mockGraph.query.mockResolvedValueOnce({
        data: [
          { bridge: { properties: { name: 'UserRepository' } }, score: 0.8 },
        ],
      });

      const bridge = await service.findSemanticBridge('user management', 'data storage');

      expect(bridge.concept1).toBe('user management');
      expect(bridge.concept2).toBe('data storage');
      expect(bridge.bridges).toHaveLength(1);
    });
  });

  describe('getComprehensiveContext', () => {
    it('should return full context for a symbol', async () => {
      // Symbol lookup
      mockGraph.query
        .mockResolvedValueOnce({
          data: [{ s: { properties: { name: 'TargetFunction', kind: 'function', file: '/src/target.ts' } } }],
        })
        // Neighborhood
        .mockResolvedValueOnce({
          data: [{ neighbor: { properties: { name: 'Neighbor1' } }, rel: { type: 'CALLS' } }],
        })
        // Impact
        .mockResolvedValueOnce({ data: [{ caller: { properties: { name: 'Caller1' } } }] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      mockAI.embed.mockResolvedValueOnce({ embedding: [] });
      mockVector.search.mockResolvedValueOnce([
        { id: '1', score: 0.8, payload: { name: 'Similar1' } },
      ]);

      const context = await service.getComprehensiveContext('TargetFunction');

      expect(context).toHaveProperty('symbol');
      expect(context).toHaveProperty('neighborhood');
      expect(context).toHaveProperty('impact');
      expect(context).toHaveProperty('semanticallySimilar');
    });
  });
});
```

---

## Part 3: CLI Command Tests

**Create**: `packages/cli/src/commands/commands.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const CLI_PATH = path.resolve(__dirname, '../dist/index.js');

// Helper to run CLI commands
async function runCLI(args: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(`node ${CLI_PATH} ${args}`, {
      env: { ...process.env, NODE_ENV: 'test', CV_GIT_TEST: '1' },
    });
    return { stdout, stderr, code: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      code: error.code || 1,
    };
  }
}

describe('CLI Commands', () => {
  describe('cv --help', () => {
    it('should display help information', async () => {
      const { stdout, code } = await runCLI('--help');

      expect(code).toBe(0);
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('Commands:');
    });

    it('should list all available commands', async () => {
      const { stdout } = await runCLI('--help');

      expect(stdout).toContain('sync');
      expect(stdout).toContain('query');
      expect(stdout).toContain('explain');
      expect(stdout).toContain('graph');
      expect(stdout).toContain('summary');
      expect(stdout).toContain('diff');
      expect(stdout).toContain('cache');
    });
  });

  describe('cv --version', () => {
    it('should display version', async () => {
      const { stdout, code } = await runCLI('--version');

      expect(code).toBe(0);
      expect(stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('cv explain', () => {
    it('should show help for explain command', async () => {
      const { stdout } = await runCLI('explain --help');

      expect(stdout).toContain('--deep');
      expect(stdout).toContain('--trace');
      expect(stdout).toContain('--max-depth');
    });
  });

  describe('cv graph', () => {
    it('should show help for graph command', async () => {
      const { stdout } = await runCLI('graph --help');

      expect(stdout).toContain('path');
      expect(stdout).toContain('neighborhood');
      expect(stdout).toContain('impact');
      expect(stdout).toContain('bridge');
      expect(stdout).toContain('hubs');
    });
  });

  describe('cv summary', () => {
    it('should show help for summary command', async () => {
      const { stdout } = await runCLI('summary --help');

      expect(stdout).toContain('--json');
      expect(stdout).toContain('--regenerate');
    });
  });

  describe('cv diff', () => {
    it('should show help for diff command', async () => {
      const { stdout } = await runCLI('diff --help');

      expect(stdout).toContain('--explain');
      expect(stdout).toContain('--review');
      expect(stdout).toContain('--conventional');
      expect(stdout).toContain('--staged');
      expect(stdout).toContain('--impact');
    });
  });

  describe('cv cache', () => {
    it('should show help for cache command', async () => {
      const { stdout } = await runCLI('cache --help');

      expect(stdout).toContain('stats');
      expect(stdout).toContain('clear');
      expect(stdout).toContain('memory');
    });
  });

  describe('error handling', () => {
    it('should show error for unknown command', async () => {
      const { stderr, code } = await runCLI('unknowncommand');

      expect(code).not.toBe(0);
      expect(stderr).toContain('error');
    });

    it('should show error for missing required arguments', async () => {
      const { stderr, code } = await runCLI('graph path');

      expect(code).not.toBe(0);
    });
  });
});
```

---

## Part 4: MCP Tool Tests

**Create**: `packages/mcp-server/src/tools/tools.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPServer } from '../index';
import { 
  createMockGraphClient,
  createMockQdrantClient,
  createMockAIService,
} from '@cv-git/core/test-utils';

describe('MCP Tools', () => {
  let server: MCPServer;
  let mockGraph: ReturnType<typeof createMockGraphClient>;
  let mockVector: ReturnType<typeof createMockQdrantClient>;
  let mockAI: ReturnType<typeof createMockAIService>;

  beforeEach(() => {
    mockGraph = createMockGraphClient();
    mockVector = createMockQdrantClient();
    mockAI = createMockAIService();
    
    server = new MCPServer({
      graphService: mockGraph as any,
      vectorService: mockVector as any,
      aiService: mockAI as any,
    });
  });

  describe('cv_reason tool', () => {
    it('should process reasoning requests', async () => {
      mockAI.complete.mockResolvedValueOnce({
        content: JSON.stringify({
          tasks: [],
          canAnswer: true,
          answer: 'The authentication flow works by...',
        }),
      });

      const result = await server.handleToolCall('cv_reason', {
        query: 'How does authentication work?',
        deep: true,
        maxDepth: 3,
      });

      expect(result.content[0].text).toContain('authentication');
    });

    it('should include trace when requested', async () => {
      mockAI.complete.mockResolvedValueOnce({
        content: JSON.stringify({
          tasks: [{ id: 't1', type: 'graph_query', query: 'Q' }],
          canAnswer: true,
          answer: 'Result',
        }),
      });
      mockGraph.query.mockResolvedValue({ data: [] });

      const result = await server.handleToolCall('cv_reason', {
        query: 'Test',
        trace: true,
      });

      expect(result.content[0].text).toContain('trace');
    });
  });

  describe('cv_graph_path tool', () => {
    it('should find paths between symbols', async () => {
      mockGraph.query.mockResolvedValueOnce({
        data: [[{
          nodes: [
            { properties: { name: 'A' } },
            { properties: { name: 'B' } },
            { properties: { name: 'C' } },
          ],
        }]],
      });

      const result = await server.handleToolCall('cv_graph_path', {
        from: 'A',
        to: 'C',
      });

      expect(result.content[0].text).toContain('A');
      expect(result.content[0].text).toContain('C');
    });
  });

  describe('cv_graph_neighborhood tool', () => {
    it('should return neighborhood information', async () => {
      mockGraph.query.mockResolvedValueOnce({
        data: [
          { neighbor: { properties: { name: 'N1' } }, rel: { type: 'CALLS' } },
          { neighbor: { properties: { name: 'N2' } }, rel: { type: 'IMPORTS' } },
        ],
      });

      const result = await server.handleToolCall('cv_graph_neighborhood', {
        symbol: 'CenterNode',
        depth: 2,
      });

      expect(result.content[0].text).toContain('N1');
      expect(result.content[0].text).toContain('N2');
    });
  });

  describe('cv_graph_impact tool', () => {
    it('should return impact analysis', async () => {
      mockGraph.query
        .mockResolvedValueOnce({ data: [{ caller: { properties: { name: 'C1' } } }] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      const result = await server.handleToolCall('cv_graph_impact', {
        symbol: 'TargetSymbol',
      });

      expect(result.content[0].text).toContain('impact');
    });
  });

  describe('cv_graph_bridge tool', () => {
    it('should find bridges between concepts', async () => {
      mockGraph.query.mockResolvedValueOnce({
        data: [{ bridge: { properties: { name: 'BridgeService' } }, score: 5 }],
      });

      const result = await server.handleToolCall('cv_graph_bridge', {
        source: 'ConceptA',
        target: 'ConceptB',
      });

      expect(result.content[0].text).toContain('BridgeService');
    });
  });

  describe('cv_summary_view tool', () => {
    it('should return codebase summary', async () => {
      // Mock summary load
      const result = await server.handleToolCall('cv_summary_view', {
        section: 'architecture',
      });

      expect(result.content[0].text).toBeDefined();
    });
  });

  describe('tool registration', () => {
    it('should have all expected tools registered', () => {
      const tools = server.getRegisteredTools();

      expect(tools).toContain('cv_reason');
      expect(tools).toContain('cv_graph_path');
      expect(tools).toContain('cv_graph_neighborhood');
      expect(tools).toContain('cv_graph_impact');
      expect(tools).toContain('cv_graph_bridge');
      expect(tools).toContain('cv_summary_view');
    });

    it('should have proper tool schemas', () => {
      const schema = server.getToolSchema('cv_reason');

      expect(schema).toHaveProperty('name', 'cv_reason');
      expect(schema).toHaveProperty('description');
      expect(schema).toHaveProperty('inputSchema');
    });
  });

  describe('error handling', () => {
    it('should handle unknown tool gracefully', async () => {
      await expect(
        server.handleToolCall('unknown_tool', {})
      ).rejects.toThrow('Unknown tool');
    });

    it('should validate required parameters', async () => {
      await expect(
        server.handleToolCall('cv_graph_path', { from: 'A' }) // missing 'to'
      ).rejects.toThrow();
    });

    it('should handle service errors gracefully', async () => {
      mockGraph.query.mockRejectedValueOnce(new Error('Database error'));

      const result = await server.handleToolCall('cv_graph_path', {
        from: 'A',
        to: 'B',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('error');
    });
  });
});
```

---

## Part 5: Integration Tests

**Create**: `packages/core/src/integration/integration.test.ts`

```typescript
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { GraphService } from '../services/graph-service';
import { CodebaseSummaryService } from '../services/codebase-summary';
import { RLMRouter } from '../services/rlm-router';
import { SemanticGraphService } from '../services/semantic-graph';

/**
 * Integration tests that test multiple services working together.
 * These use mocks but test the interaction patterns.
 */
describe('Service Integration', () => {
  describe('RLM + Graph + Vector', () => {
    it('should complete a full reasoning cycle', async () => {
      // This test verifies the complete flow:
      // 1. Query decomposition
      // 2. Task execution (graph + vector)
      // 3. Result aggregation
      // 4. Final answer generation
      
      const mockGraph = {
        query: vi.fn().mockResolvedValue({ data: [] }),
        findPath: vi.fn().mockResolvedValue({ found: true, path: [] }),
        getNeighborhood: vi.fn().mockResolvedValue({ neighbors: [] }),
        getImpactAnalysis: vi.fn().mockResolvedValue({ totalImpact: 5 }),
      };

      const mockVector = {
        search: vi.fn().mockResolvedValue([]),
      };

      const mockAI = {
        complete: vi.fn()
          .mockResolvedValueOnce({
            content: JSON.stringify({
              tasks: [
                { id: 't1', type: 'graph_query', query: 'MATCH (s) RETURN s' },
                { id: 't2', type: 'vector_search', query: 'auth' },
              ],
              canAnswer: false,
            }),
          })
          .mockResolvedValueOnce({
            content: JSON.stringify({
              tasks: [],
              canAnswer: true,
              answer: 'Final integrated answer',
            }),
          }),
        embed: vi.fn().mockResolvedValue({ embedding: [] }),
      };

      const router = new RLMRouter({
        graphService: mockGraph as any,
        vectorService: mockVector as any,
        aiService: mockAI as any,
        codebaseSummary: null,
      });

      const result = await router.reason('Complex question about auth');

      expect(mockGraph.query).toHaveBeenCalled();
      expect(mockVector.search).toHaveBeenCalled();
      expect(result.answer).toContain('Final');
    });
  });

  describe('Summary + Graph', () => {
    it('should generate summary using graph data', async () => {
      const mockGraph = {
        query: vi.fn()
          .mockResolvedValueOnce({ data: [[{ count: 50 }]] }) // files
          .mockResolvedValueOnce({ data: [[{ count: 200 }]] }) // symbols
          .mockResolvedValue({ data: [] }),
      };

      const mockAI = {
        complete: vi.fn().mockResolvedValue({ content: JSON.stringify({}) }),
        embed: vi.fn().mockResolvedValue({ embedding: new Array(1536).fill(0) }),
      };

      const service = new CodebaseSummaryService({
        graphService: mockGraph as any,
        aiService: mockAI as any,
        fs: { writeFile: vi.fn(), readFile: vi.fn() } as any,
      });

      const summary = await service.generate();

      expect(summary.stats.totalFiles).toBe(50);
      expect(summary.stats.totalSymbols).toBe(200);
    });
  });

  describe('Semantic + Graph + Vector', () => {
    it('should combine semantic and structural search', async () => {
      const mockGraph = {
        query: vi.fn().mockResolvedValue({
          data: [{ callers: 5, callees: 3 }],
        }),
      };

      const mockVector = {
        search: vi.fn().mockResolvedValue([
          { id: '1', score: 0.9, payload: { name: 'Match1' } },
        ]),
      };

      const mockAI = {
        embed: vi.fn().mockResolvedValue({ embedding: [] }),
      };

      const service = new SemanticGraphService({
        graphService: mockGraph as any,
        vectorService: mockVector as any,
        aiService: mockAI as any,
      });

      const results = await service.semanticSearch('authentication');

      expect(results[0]).toHaveProperty('graphContext');
      expect(mockVector.search).toHaveBeenCalled();
      expect(mockGraph.query).toHaveBeenCalled();
    });
  });
});
```

---

## Part 6: Edge Cases and Error Handling Tests

**Create**: `packages/core/src/services/error-handling.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { GraphService } from './graph-service';
import { RLMRouter } from './rlm-router';
import { CodebaseSummaryService } from './codebase-summary';

describe('Error Handling', () => {
  describe('GraphService errors', () => {
    it('should handle connection timeout', async () => {
      const mockClient = {
        query: vi.fn().mockImplementation(() => 
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Connection timeout')), 100)
          )
        ),
      };

      const service = new GraphService(mockClient as any);

      await expect(service.findPath('A', 'B')).rejects.toThrow('timeout');
    });

    it('should handle invalid Cypher syntax', async () => {
      const mockClient = {
        query: vi.fn().mockRejectedValue(new Error('SyntaxError: Invalid query')),
      };

      const service = new GraphService(mockClient as any);

      await expect(service.findPath('A', 'B')).rejects.toThrow('SyntaxError');
    });

    it('should handle empty database', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({ data: [] }),
      };

      const service = new GraphService(mockClient as any);
      const result = await service.getHubs(10);

      expect(result).toEqual([]);
    });
  });

  describe('RLMRouter errors', () => {
    it('should handle AI service unavailable', async () => {
      const mockAI = {
        complete: vi.fn().mockRejectedValue(new Error('Service unavailable')),
      };

      const router = new RLMRouter({
        graphService: {} as any,
        vectorService: {} as any,
        aiService: mockAI as any,
        codebaseSummary: null,
      });

      await expect(router.reason('test')).rejects.toThrow('Service unavailable');
    });

    it('should handle rate limiting', async () => {
      const mockAI = {
        complete: vi.fn().mockRejectedValue(new Error('Rate limit exceeded')),
      };

      const router = new RLMRouter({
        graphService: {} as any,
        vectorService: {} as any,
        aiService: mockAI as any,
        codebaseSummary: null,
      });

      await expect(router.reason('test')).rejects.toThrow('Rate limit');
    });

    it('should handle malformed JSON response', async () => {
      const mockAI = {
        complete: vi.fn().mockResolvedValue({ content: 'not valid json {' }),
      };

      const router = new RLMRouter({
        graphService: {} as any,
        vectorService: {} as any,
        aiService: mockAI as any,
        codebaseSummary: null,
      });

      await expect(router.reason('test')).rejects.toThrow();
    });
  });

  describe('CodebaseSummary errors', () => {
    it('should handle file system errors', async () => {
      const mockFS = {
        readFile: vi.fn().mockRejectedValue(new Error('ENOENT: file not found')),
        writeFile: vi.fn().mockRejectedValue(new Error('EACCES: permission denied')),
      };

      const service = new CodebaseSummaryService({
        graphService: {} as any,
        aiService: {} as any,
        fs: mockFS as any,
      });

      await expect(service.load('/nonexistent')).rejects.toThrow('ENOENT');
    });

    it('should handle corrupted summary file', async () => {
      const mockFS = {
        readFile: vi.fn().mockResolvedValue('corrupted data {{{'),
      };

      const service = new CodebaseSummaryService({
        graphService: {} as any,
        aiService: {} as any,
        fs: mockFS as any,
      });

      await expect(service.load('/path')).rejects.toThrow();
    });
  });

  describe('Input validation', () => {
    it('should reject empty symbol names', async () => {
      const service = new GraphService({} as any);

      await expect(service.findPath('', 'B')).rejects.toThrow();
      await expect(service.getNeighborhood('', 1)).rejects.toThrow();
      await expect(service.getImpactAnalysis('')).rejects.toThrow();
    });

    it('should reject negative depth values', async () => {
      const service = new GraphService({} as any);

      await expect(service.getNeighborhood('A', -1)).rejects.toThrow();
      await expect(service.findAllPaths('A', 'B', -5)).rejects.toThrow();
    });

    it('should reject overly long queries', async () => {
      const router = new RLMRouter({
        graphService: {} as any,
        vectorService: {} as any,
        aiService: {} as any,
        codebaseSummary: null,
      });

      const longQuery = 'a'.repeat(100000);
      await expect(router.reason(longQuery)).rejects.toThrow();
    });
  });

  describe('Concurrent access', () => {
    it('should handle concurrent cache access', async () => {
      const { CacheService } = await import('./cache-service');
      const cache = new CacheService({ max: 100, ttl: 60000 });

      // Simulate concurrent access
      const operations = Array(100).fill(null).map((_, i) => 
        Promise.all([
          Promise.resolve(cache.set(`key${i}`, `value${i}`)),
          Promise.resolve(cache.get(`key${i}`)),
          Promise.resolve(cache.delete(`key${i}`)),
        ])
      );

      // Should not throw
      await expect(Promise.all(operations)).resolves.toBeDefined();
    });
  });
});
```

---

## Part 7: Performance Benchmark Tests

**Create**: `packages/core/src/benchmarks/performance.bench.ts`

```typescript
import { describe, bench, beforeAll } from 'vitest';
import { CacheService } from '../services/cache-service';

describe('Performance Benchmarks', () => {
  describe('CacheService', () => {
    let cache: CacheService<string>;

    beforeAll(() => {
      cache = new CacheService({ max: 10000, ttl: 60000 });
      // Pre-populate
      for (let i = 0; i < 5000; i++) {
        cache.set(`key${i}`, `value${i}`);
      }
    });

    bench('cache set operation', () => {
      cache.set(`bench-${Math.random()}`, 'value');
    });

    bench('cache get (hit)', () => {
      cache.get('key1000');
    });

    bench('cache get (miss)', () => {
      cache.get('nonexistent');
    });

    bench('cache has check', () => {
      cache.has('key2000');
    });
  });

  describe('JSON parsing', () => {
    const smallObj = { name: 'test', value: 123 };
    const largeObj = {
      tasks: Array(100).fill({ id: 'task', type: 'graph_query', query: 'MATCH' }),
      canAnswer: true,
      answer: 'x'.repeat(1000),
    };

    bench('parse small JSON', () => {
      JSON.parse(JSON.stringify(smallObj));
    });

    bench('parse large JSON', () => {
      JSON.parse(JSON.stringify(largeObj));
    });
  });
});
```

---

## Part 8: Update package.json Scripts

Add these scripts to root `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
    "test:bench": "vitest bench",
    "test:ci": "vitest run --coverage --reporter=junit --outputFile=test-results.xml"
  }
}
```

---

## Expected Test Counts

| Service/Module | Tests |
|----------------|-------|
| CacheService | 20 |
| GraphService (extended) | 25 |
| RLMRouter (extended) | 30 |
| CodebaseSummary (extended) | 25 |
| SemanticGraphService | 15 |
| CLI Commands | 15 |
| MCP Tools | 20 |
| Integration | 10 |
| Error Handling | 15 |
| Benchmarks | 5 |
| **Total** | **~180** |

---

## Running Tests

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Run specific test file
pnpm test packages/core/src/services/cache-service.test.ts

# Run in watch mode
pnpm test:watch

# Run benchmarks
pnpm test:bench

# Open UI
pnpm test:ui
```

---

## Quick Start Checklist

1. [ ] Install Vitest dependencies
2. [ ] Create vitest.config.ts
3. [ ] Create test utilities (mocks, fixtures, helpers)
4. [ ] Create CacheService tests
5. [ ] Create extended GraphService tests
6. [ ] Create extended RLMRouter tests
7. [ ] Create extended CodebaseSummary tests
8. [ ] Create SemanticGraphService tests
9. [ ] Create CLI command tests
10. [ ] Create MCP tool tests
11. [ ] Create integration tests
12. [ ] Create error handling tests
13. [ ] Create benchmark tests
14. [ ] Run `pnpm test:coverage` and verify >80% coverage
15. [ ] Add test scripts to package.json

---

## Notes for Claude Code

- Use `vi.fn()` for mocking, not `jest.fn()`
- Use `vi.spyOn()` for spying on methods
- Use `vi.mock()` for module mocking
- Remember to clear mocks in `beforeEach`
- Use `describe.concurrent` for parallel test suites
- Use `test.each` for parameterized tests
- Keep test files co-located with source files (*.test.ts next to *.ts)

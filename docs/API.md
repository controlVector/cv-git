# CV-Git Service API Reference

This document provides API reference for the core services in CV-Git.

## Table of Contents

- [CacheService](#cacheservice)
- [GraphService](#graphservice)
- [SemanticGraphService](#semanticgraphservice)
- [CodebaseSummaryService](#codebasesummaryservice)
- [RLMRouter](#rlmrouter)

---

## CacheService

In-memory LRU cache with three namespaces: graph, vector, and AI.

### Import

```typescript
import { CacheService, getGlobalCache, createCacheService } from '@cv-git/core';
```

### Usage

```typescript
// Get global singleton cache
const cache = getGlobalCache();

// Or create a new instance with custom options
const cache = createCacheService({
  maxSize: 500,        // Max entries per namespace
  ttlMs: 600000        // TTL in milliseconds (10 minutes)
});

// Cache graph queries
const result = await cache.getOrComputeGraph('myKey', async () => {
  return expensiveGraphQuery();
});

// Cache vector operations
const embedding = await cache.getOrComputeVector('embedKey', async () => {
  return generateEmbedding(text);
});

// Cache AI responses
const response = await cache.getOrComputeAI('promptKey', async () => {
  return callAI(prompt);
});

// Get statistics
const stats = cache.getAllStats();
console.log(stats.graph.hitRate);  // e.g., "75.50"

// Clear all caches
cache.clearAll();
```

### Static Methods

```typescript
// Generate cache key from arguments
const key = CacheService.key('method', arg1, arg2, { option: 'value' });
```

### Types

```typescript
interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
  hitRate: string;  // Percentage as string, e.g., "75.50"
}

interface AllCacheStats {
  graph: CacheStats;
  vector: CacheStats;
  ai: CacheStats;
  total: CacheStats;
}

interface CacheOptions {
  maxSize?: number;  // Default: 500
  ttlMs?: number;    // Default: 600000 (10 minutes)
}
```

---

## GraphService

Advanced graph analysis service for path finding, neighborhood exploration, and impact analysis.

### Import

```typescript
import { GraphService, createGraphService } from '@cv-git/core';
```

### Usage

```typescript
const graph = createGraphManager(config.graph.url, config.graph.database);
await graph.connect();

const graphService = createGraphService(graph);

// Find paths between symbols
const path = await graphService.findPath('functionA', 'functionB', {
  maxDepth: 10,
  relationshipTypes: ['CALLS', 'IMPORTS']
});

// Explore symbol neighborhood
const neighborhood = await graphService.getNeighborhood('MyClass', {
  depth: 2,
  direction: 'both',  // 'incoming' | 'outgoing' | 'both'
  maxNodes: 50
});

// Analyze change impact
const impact = await graphService.getImpactAnalysis('updateUser', {
  maxDepth: 3,
  includeIndirect: true
});

// Find bridge between symbols
const bridge = await graphService.findBridge('AuthService', 'DatabaseManager', {
  maxDepth: 5,
  maxPaths: 10
});

await graph.close();
```

### Methods

#### `findPath(from, to, options?)`

Find the shortest path between two symbols.

```typescript
interface PathResult {
  found: boolean;
  path: PathEdge[];
  length: number;
  explanation: string;
}

interface PathEdge {
  from: string;
  to: string;
  relationship: string;
  fromFile?: string;
  toFile?: string;
}
```

#### `findAllPaths(from, to, options?)`

Find all paths between two symbols (up to a limit).

#### `getNeighborhood(symbol, options?)`

Explore the local neighborhood of a symbol.

```typescript
interface Neighborhood {
  center: {
    name: string;
    type: string;
    file: string;
    line?: number;
    docstring?: string;
  };
  nodes: NeighborhoodNode[];
  summary: {
    totalNodes: number;
    byType: Record<string, number>;
    byRelationship: Record<string, number>;
  };
}

interface NeighborhoodNode {
  name: string;
  type: string;
  file: string;
  line?: number;
  relationship: string;
  direction: 'incoming' | 'outgoing' | 'bidirectional';
  distance: number;
}
```

#### `getImpactAnalysis(symbol, options?)`

Analyze the potential impact of changing a symbol.

```typescript
interface ImpactAnalysis {
  target: {
    name: string;
    type: string;
    file: string;
  };
  directCallers: Array<{ name: string; kind: string; file: string }>;
  indirectCallers: Array<{ name: string; kind: string; file: string; depth: number }>;
  implementors: string[];
  extenders: string[];
  affectedFiles: string[];
  totalImpact: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskExplanation: string;
}
```

#### `findBridge(source, target, options?)`

Find how two symbols are connected.

```typescript
interface BridgeResult {
  source: { name: string; kind: string; file: string };
  target: { name: string; kind: string; file: string };
  directConnection: boolean;
  connections: Array<{
    path: string[];
    relationshipTypes: string[];
    length: number;
  }>;
  explanation: string;
}
```

---

## SemanticGraphService

Combines semantic search with graph traversal for context-aware code understanding.

### Import

```typescript
import { SemanticGraphService, createSemanticGraphService } from '@cv-git/core';
```

### Usage

```typescript
const service = createSemanticGraphService(graphManager, vectorManager);

// Search with graph expansion
const results = await service.search('authentication logic', {
  limit: 10,
  expandGraph: true,
  includeCallers: true,
  includeCallees: true
});

// Get expanded context for a symbol
const context = await service.expandContext('LoginHandler', {
  depth: 2,
  includeDocstrings: true
});

// Find concept clusters
const clusters = await service.findConceptClusters('error handling');
```

### Methods

#### `search(query, options?)`

Semantic search with optional graph expansion.

```typescript
interface SemanticGraphSearchOptions {
  limit?: number;
  expandGraph?: boolean;
  includeCallers?: boolean;
  includeCallees?: boolean;
  includeDocstrings?: boolean;
}

interface SemanticSearchResult {
  symbol: string;
  file: string;
  score: number;
  snippet?: string;
  callers?: string[];
  callees?: string[];
}
```

#### `expandContext(symbol, options?)`

Get rich context for a symbol including related code.

#### `findConceptClusters(query)`

Find clusters of related concepts in the codebase.

---

## CodebaseSummaryService

Generates high-level summaries of a codebase using AI and graph analysis.

### Import

```typescript
import {
  CodebaseSummaryService,
  createCodebaseSummaryService,
  loadCodebaseSummary
} from '@cv-git/core';
```

### Usage

```typescript
// Create service
const summaryService = createCodebaseSummaryService(
  {
    apiKey: anthropicApiKey,
    model: 'claude-sonnet-4-5-20250514',
    maxTokens: 4096,
    repoRoot: '/path/to/repo'
  },
  graphManager,
  vectorManager  // optional
);

// Generate summary
const summary = await summaryService.generateSummary();

// Save to .cv directory
await summaryService.saveSummary(summary);

// Load existing summary (standalone function)
const existingSummary = await loadCodebaseSummary('/path/to/repo');

// Format for display
const formatted = summaryService.formatSummary(summary);
console.log(formatted);
```

### Types

```typescript
interface CodebaseSummary {
  version: string;
  generatedAt: string;
  stats: {
    totalFiles: number;
    totalSymbols: number;
    totalFunctions: number;
    totalClasses: number;
    languages: Record<string, number>;
    linesOfCode?: number;
  };
  architecture: {
    entryPoints: string[];
    coreModules: ModuleSummary[];
    patterns: string[];
    layers?: string[];
  };
  conventions: {
    naming: string[];
    fileStructure: string[];
    testing: string[];
  };
  abstractions: {
    interfaces: InterfaceSummary[];
    baseClasses: ClassSummary[];
    utilities: FunctionSummary[];
  };
  dependencies: {
    external: string[];
    hotspots: string[];
    potentialIssues: string[];
    circularDeps?: string[][];
  };
  naturalLanguageSummary: string;
  embedding?: number[];
}
```

---

## RLMRouter

Router for the Reasoning Language Model that handles complex multi-step tasks.

### Import

```typescript
import { RLMRouter, createRLMRouter } from '@cv-git/core';
```

### Usage

```typescript
const router = createRLMRouter({
  aiManager,
  graphManager,
  vectorManager,
  maxSteps: 10,
  verbose: true
});

// Execute a task
const result = await router.execute({
  task: 'Find all functions that handle user authentication',
  context: {
    repoRoot: '/path/to/repo'
  }
});

console.log(result.answer);
console.log(result.steps);  // Array of reasoning steps
```

### Types

```typescript
interface RLMRouterOptions {
  aiManager: AIManager;
  graphManager: GraphManager;
  vectorManager?: VectorManager;
  maxSteps?: number;
  verbose?: boolean;
}

interface RLMTask {
  task: string;
  context?: RLMContext;
}

interface RLMResult {
  answer: string;
  steps: RLMStep[];
  plan?: RLMPlan;
  success: boolean;
  error?: string;
}

interface RLMStep {
  type: RLMTaskType;
  action: string;
  result: string;
  timestamp: string;
}

type RLMTaskType =
  | 'search'
  | 'graph_query'
  | 'code_read'
  | 'reasoning'
  | 'synthesis';
```

---

## CLI Commands Using These Services

| Command | Service Used |
|---------|--------------|
| `cv cache memory` | CacheService |
| `cv graph path` | GraphService |
| `cv summary` | CodebaseSummaryService |
| `cv find` | SemanticGraphService |
| `cv do` | RLMRouter |

## MCP Tools Using These Services

| MCP Tool | Service Used |
|----------|--------------|
| `cv_graph_path` | GraphService.findPath() |
| `cv_graph_neighborhood` | GraphService.getNeighborhood() |
| `cv_graph_impact` | GraphService.getImpactAnalysis() |
| `cv_graph_bridge` | GraphService.findBridge() |
| `cv_summary_view` | loadCodebaseSummary() |
| `cv_find` | SemanticGraphService.search() |
| `cv_auto_context` | SemanticGraphService |

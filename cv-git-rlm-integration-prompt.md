# CV-Git RLM Integration: Claude Code Implementation Prompt

## Project Context

You are working on **CV-Git**, an AI-native version control layer that adds a knowledge graph (FalkorDB) and semantic search (Qdrant) to Git repositories. The codebase is a TypeScript monorepo using pnpm workspaces.

**Repository**: https://github.com/controlVector/cv-git
**Structure**:
```
cv-git/
├── packages/
│   ├── cli/          # Main CLI commands (cv find, cv explain, cv do, etc.)
│   ├── core/         # Core services (graph, vector, AI)
│   ├── mcp-server/   # Model Context Protocol server (20 tools)
│   └── shared/       # Shared types and utilities
├── docs/
└── tests/
```

## Research Foundation

This implementation is based on two papers that solve the fundamental problem of giving AI deep understanding of large codebases:

### 1. Recursive Language Models (RLMs)
**Paper**: arXiv:2512.24601 (Zhang, Kraska, Khattab - MIT)

**Key Innovation**: Treat long context as an external environment the LLM can programmatically interact with via a REPL, rather than stuffing it into the context window. The LLM writes code to:
- Peek into and decompose the context
- Recursively call itself on sub-problems
- Aggregate results into a final answer

**Why it matters for CV-Git**: CV-Git already has the "external environment" (FalkorDB graph + Qdrant vectors). What's missing is the recursive reasoning loop that lets the LLM iteratively drill into these stores to answer complex questions.

### 2. Test-Time Training End-to-End (TTT-E2E)
**Paper**: arXiv:2512.23675 (Sun, Choi - NVIDIA)

**Key Innovation**: Compress context into model weights via next-token prediction at inference time. Achieves constant latency regardless of context length.

**Why it matters for CV-Git**: At `cv sync` time, we could generate a compressed "intuition model" for the codebase that captures patterns, conventions, and architecture without explicit retrieval.

---

## Implementation Plan

### Phase 1: RLM Reasoning Loop (Priority: HIGH)

#### Task 1.1: Create RLM Router Service

Create a new service that implements the RLM pattern for CV-Git queries.

**File**: `packages/core/src/services/rlm-router.ts`

```typescript
import { GraphService } from './graph-service';
import { VectorService } from './vector-service';
import { AIService } from './ai-service';

interface RLMContext {
  originalQuery: string;
  depth: number;
  maxDepth: number;
  buffers: Map<string, any>;
  trace: RLMStep[];
}

interface RLMStep {
  action: 'graph_query' | 'vector_search' | 'llm_call' | 'aggregate';
  input: any;
  output: any;
  reasoning: string;
}

interface RLMResult {
  answer: string;
  confidence: number;
  trace: RLMStep[];
  sources: string[];
}

export class RLMRouter {
  constructor(
    private graph: GraphService,
    private vector: VectorService,
    private ai: AIService,
    private config: RLMConfig
  ) {}

  /**
   * Main entry point - decomposes query and orchestrates sub-queries
   */
  async process(query: string, options?: RLMOptions): Promise<RLMResult> {
    const context: RLMContext = {
      originalQuery: query,
      depth: 0,
      maxDepth: options?.maxDepth ?? 5,
      buffers: new Map(),
      trace: []
    };

    return this.reason(query, context);
  }

  /**
   * Core reasoning loop - implements RLM pattern
   */
  private async reason(query: string, ctx: RLMContext): Promise<RLMResult> {
    if (ctx.depth >= ctx.maxDepth) {
      return this.aggregate(ctx);
    }

    // Step 1: Ask LLM to decompose the query into sub-tasks
    const plan = await this.decompose(query, ctx);

    // Step 2: Execute each sub-task (may recurse)
    for (const task of plan.tasks) {
      const result = await this.executeTask(task, ctx);
      ctx.buffers.set(task.id, result);
      ctx.trace.push({
        action: task.type,
        input: task,
        output: result,
        reasoning: task.reasoning
      });
    }

    // Step 3: Check if we have enough information
    if (plan.canAnswer) {
      return this.aggregate(ctx);
    }

    // Step 4: Recurse with refined query
    ctx.depth++;
    return this.reason(plan.refinedQuery, ctx);
  }

  /**
   * Decompose query into executable sub-tasks
   */
  private async decompose(query: string, ctx: RLMContext): Promise<DecompositionPlan> {
    const prompt = this.buildDecompositionPrompt(query, ctx);
    const response = await this.ai.complete(prompt, {
      responseFormat: 'json',
      schema: DecompositionPlanSchema
    });
    return response;
  }

  /**
   * Execute a single task - dispatches to appropriate service
   */
  private async executeTask(task: RLMTask, ctx: RLMContext): Promise<any> {
    switch (task.type) {
      case 'graph_query':
        return this.executeGraphQuery(task);
      case 'vector_search':
        return this.executeVectorSearch(task);
      case 'llm_explain':
        return this.executeLLMExplain(task, ctx);
      case 'recurse':
        ctx.depth++;
        return this.reason(task.subQuery, ctx);
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  /**
   * Graph queries - calls, called-by, path, imports, etc.
   */
  private async executeGraphQuery(task: GraphQueryTask): Promise<any> {
    switch (task.operation) {
      case 'calls':
        return this.graph.getCalls(task.symbol);
      case 'called_by':
        return this.graph.getCalledBy(task.symbol);
      case 'path':
        return this.graph.findPath(task.from, task.to);
      case 'imports':
        return this.graph.getImports(task.file);
      case 'symbols_in_file':
        return this.graph.getSymbolsInFile(task.file);
      case 'complexity':
        return this.graph.getComplexity(task.threshold);
      default:
        return this.graph.query(task.cypher);
    }
  }

  /**
   * Vector search - semantic code search
   */
  private async executeVectorSearch(task: VectorSearchTask): Promise<any> {
    return this.vector.search(task.query, {
      limit: task.limit ?? 10,
      filter: task.filter
    });
  }

  /**
   * LLM explain - get explanation of specific code
   */
  private async executeLLMExplain(task: LLMExplainTask, ctx: RLMContext): Promise<string> {
    // Get code content from graph or file
    const code = await this.getCodeContent(task.target);
    
    const prompt = `
You are explaining code as part of answering: "${ctx.originalQuery}"

Code to explain:
\`\`\`
${code}
\`\`\`

Provide a focused explanation relevant to the original query.
`;
    return this.ai.complete(prompt);
  }

  /**
   * Aggregate all buffers into final answer
   */
  private async aggregate(ctx: RLMContext): Promise<RLMResult> {
    const prompt = this.buildAggregationPrompt(ctx);
    const answer = await this.ai.complete(prompt);

    return {
      answer,
      confidence: this.calculateConfidence(ctx),
      trace: ctx.trace,
      sources: this.extractSources(ctx)
    };
  }

  /**
   * Build the decomposition prompt with available tools
   */
  private buildDecompositionPrompt(query: string, ctx: RLMContext): string {
    return `
You are an AI reasoning about a codebase. You have access to:

TOOLS:
- graph_query: Query the knowledge graph
  - calls(symbol): What does this function call?
  - called_by(symbol): What calls this function?
  - path(from, to): Find execution path between functions
  - imports(file): What does this file import?
  - symbols_in_file(file): List all symbols in a file
  - complexity(threshold): Find functions with complexity > threshold
  - cypher(query): Raw Cypher query

- vector_search: Semantic code search
  - query: Natural language description
  - limit: Number of results
  - filter: {language?, file?}

- llm_explain: Get AI explanation of specific code
  - target: Symbol name or file path

- recurse: Ask a sub-question (creates recursive call)
  - subQuery: The refined question

CURRENT STATE:
- Original query: "${ctx.originalQuery}"
- Depth: ${ctx.depth}/${ctx.maxDepth}
- Buffers collected: ${Array.from(ctx.buffers.keys()).join(', ') || 'none'}

QUERY TO DECOMPOSE:
${query}

Respond with JSON:
{
  "reasoning": "Your thinking about how to answer this",
  "tasks": [
    {
      "id": "unique_id",
      "type": "graph_query|vector_search|llm_explain|recurse",
      "reasoning": "Why this task helps",
      ...task-specific params
    }
  ],
  "canAnswer": boolean,  // true if buffers contain enough info
  "refinedQuery": "string"  // if canAnswer is false, what to ask next
}
`;
  }

  private buildAggregationPrompt(ctx: RLMContext): string {
    const bufferSummary = Array.from(ctx.buffers.entries())
      .map(([k, v]) => `${k}:\n${JSON.stringify(v, null, 2)}`)
      .join('\n\n');

    return `
You are answering a question about a codebase.

ORIGINAL QUESTION:
${ctx.originalQuery}

INFORMATION GATHERED:
${bufferSummary}

REASONING TRACE:
${ctx.trace.map(s => `- ${s.action}: ${s.reasoning}`).join('\n')}

Synthesize a comprehensive answer. Be specific and reference the code/symbols you found.
`;
  }
}
```

#### Task 1.2: Integrate RLM Router into CLI Commands

**Modify**: `packages/cli/src/commands/explain.ts`

```typescript
import { RLMRouter } from '@cv-git/core';

// Add --deep flag for RLM-powered explanations
export const explainCommand = new Command('explain')
  .description('Get AI explanation of code')
  .argument('<target>', 'Symbol, file, or question')
  .option('--deep', 'Use recursive reasoning for complex questions')
  .option('--trace', 'Show reasoning trace')
  .option('--max-depth <n>', 'Maximum recursion depth', '5')
  .action(async (target, options) => {
    if (options.deep) {
      const rlm = new RLMRouter(graphService, vectorService, aiService, {
        maxDepth: parseInt(options.maxDepth)
      });
      
      const result = await rlm.process(target);
      
      console.log(result.answer);
      
      if (options.trace) {
        console.log('\n--- Reasoning Trace ---');
        result.trace.forEach((step, i) => {
          console.log(`${i + 1}. [${step.action}] ${step.reasoning}`);
        });
      }
    } else {
      // Existing simple explanation logic
      await existingExplainLogic(target, options);
    }
  });
```

#### Task 1.3: Add RLM Tools to MCP Server

**Modify**: `packages/mcp-server/src/tools/index.ts`

Add a new tool that exposes the full RLM reasoning capability:

```typescript
{
  name: 'cv_reason',
  description: 'Deep reasoning about codebase using recursive decomposition. Use for complex questions that require understanding relationships across multiple files/functions.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The question to answer about the codebase'
      },
      maxDepth: {
        type: 'number',
        description: 'Maximum recursion depth (default: 5)',
        default: 5
      },
      includeTrace: {
        type: 'boolean',
        description: 'Include reasoning trace in response',
        default: false
      }
    },
    required: ['query']
  },
  handler: async (params) => {
    const rlm = new RLMRouter(services.graph, services.vector, services.ai, {
      maxDepth: params.maxDepth
    });
    
    const result = await rlm.process(params.query);
    
    return {
      answer: result.answer,
      confidence: result.confidence,
      sources: result.sources,
      trace: params.includeTrace ? result.trace : undefined
    };
  }
}
```

---

### Phase 2: Context Compression via Embeddings (Priority: MEDIUM)

This phase implements TTT-E2E-inspired ideas using practical techniques available today.

#### Task 2.1: Codebase Summary Generation at Sync Time

**File**: `packages/core/src/services/codebase-summary.ts`

```typescript
interface CodebaseSummary {
  version: string;
  generatedAt: Date;
  
  // High-level architecture
  architecture: {
    entryPoints: string[];
    coreModules: ModuleSummary[];
    patterns: string[];  // e.g., "Repository pattern", "Event-driven"
  };
  
  // Conventions detected
  conventions: {
    naming: string[];
    fileStructure: string[];
    errorHandling: string[];
    testing: string[];
  };
  
  // Key abstractions
  abstractions: {
    interfaces: InterfaceSummary[];
    baseClasses: ClassSummary[];
    utilities: FunctionSummary[];
  };
  
  // Dependency graph summary
  dependencies: {
    external: string[];
    internal: ModuleDependency[];
    hotspots: string[];  // Most imported/called
  };
  
  // Compressed embedding of entire codebase
  embedding: number[];
}

export class CodebaseSummaryService {
  async generate(repoPath: string): Promise<CodebaseSummary> {
    // 1. Get all symbols from graph
    const symbols = await this.graph.getAllSymbols();
    
    // 2. Identify architecture patterns
    const architecture = await this.analyzeArchitecture(symbols);
    
    // 3. Detect conventions via sampling + LLM
    const conventions = await this.detectConventions(symbols);
    
    // 4. Extract key abstractions
    const abstractions = await this.extractAbstractions(symbols);
    
    // 5. Summarize dependencies
    const dependencies = await this.summarizeDependencies();
    
    // 6. Generate compressed embedding
    const embedding = await this.generateCodebaseEmbedding({
      architecture,
      conventions,
      abstractions,
      dependencies
    });
    
    return {
      version: '1.0',
      generatedAt: new Date(),
      architecture,
      conventions,
      abstractions,
      dependencies,
      embedding
    };
  }
  
  /**
   * Generate a single embedding that captures the "essence" of the codebase
   * This is our approximation of TTT-E2E's context compression
   */
  private async generateCodebaseEmbedding(summary: Partial<CodebaseSummary>): Promise<number[]> {
    // Create a structured text representation
    const text = `
# Codebase Architecture
Entry points: ${summary.architecture?.entryPoints.join(', ')}
Core modules: ${summary.architecture?.coreModules.map(m => m.name).join(', ')}
Patterns: ${summary.architecture?.patterns.join(', ')}

# Conventions
Naming: ${summary.conventions?.naming.join('; ')}
Structure: ${summary.conventions?.fileStructure.join('; ')}

# Key Abstractions
Interfaces: ${summary.abstractions?.interfaces.map(i => i.name).join(', ')}
Base classes: ${summary.abstractions?.baseClasses.map(c => c.name).join(', ')}

# Dependencies
External: ${summary.dependencies?.external.join(', ')}
Hotspots: ${summary.dependencies?.hotspots.join(', ')}
`;
    
    return this.vector.embed(text);
  }
}
```

#### Task 2.2: Integrate Summary into Sync Command

**Modify**: `packages/cli/src/commands/sync.ts`

```typescript
export const syncCommand = new Command('sync')
  .description('Sync repository with knowledge graph and vector store')
  .option('--full', 'Force full resync')
  .option('--no-summary', 'Skip codebase summary generation')
  .action(async (options) => {
    // Existing sync logic...
    await syncGraph(options);
    await syncVectors(options);
    
    // New: Generate codebase summary
    if (!options.noSummary) {
      console.log('Generating codebase summary...');
      const summaryService = new CodebaseSummaryService(graph, vector, ai);
      const summary = await summaryService.generate(process.cwd());
      
      // Store summary in .cv-git/summary.json
      await fs.writeJson(path.join('.cv-git', 'summary.json'), summary);
      
      // Also store embedding in Qdrant for similarity matching
      await vector.upsert({
        id: 'codebase-summary',
        vector: summary.embedding,
        payload: {
          type: 'codebase-summary',
          ...summary
        }
      });
      
      console.log('Codebase summary generated');
    }
  });
```

#### Task 2.3: Use Summary in RLM Router

**Modify**: `packages/core/src/services/rlm-router.ts`

```typescript
export class RLMRouter {
  private summary: CodebaseSummary | null = null;
  
  async loadSummary(): Promise<void> {
    const summaryPath = path.join(process.cwd(), '.cv-git', 'summary.json');
    if (await fs.pathExists(summaryPath)) {
      this.summary = await fs.readJson(summaryPath);
    }
  }
  
  private buildDecompositionPrompt(query: string, ctx: RLMContext): string {
    // Include codebase context if available
    const codebaseContext = this.summary ? `
CODEBASE CONTEXT:
- Architecture: ${this.summary.architecture.patterns.join(', ')}
- Entry points: ${this.summary.architecture.entryPoints.join(', ')}
- Key modules: ${this.summary.architecture.coreModules.map(m => m.name).join(', ')}
- Conventions: ${this.summary.conventions.naming.join('; ')}
- Hotspots: ${this.summary.dependencies.hotspots.join(', ')}
` : '';

    return `
You are an AI reasoning about a codebase.
${codebaseContext}

TOOLS:
...rest of prompt
`;
  }
}
```

---

### Phase 3: Advanced Graph Queries for RLM (Priority: MEDIUM)

Add new graph operations that support RLM-style reasoning.

#### Task 3.1: Add Path Finding with Explanation

**File**: `packages/core/src/services/graph-service.ts`

```typescript
interface PathResult {
  path: string[];  // Symbol names in order
  edges: EdgeInfo[];  // Relationship details
  explanation: string;  // Human-readable explanation
}

export class GraphService {
  /**
   * Find execution path between two symbols with explanation
   */
  async findPathWithExplanation(from: string, to: string): Promise<PathResult | null> {
    const cypher = `
      MATCH path = shortestPath(
        (start:Symbol {name: $from})-[*..10]->(end:Symbol {name: $to})
      )
      RETURN nodes(path) as nodes, relationships(path) as rels
    `;
    
    const result = await this.query(cypher, { from, to });
    
    if (!result.length) return null;
    
    const nodes = result[0].nodes;
    const rels = result[0].rels;
    
    // Build explanation
    const explanation = this.buildPathExplanation(nodes, rels);
    
    return {
      path: nodes.map(n => n.name),
      edges: rels.map(r => ({
        type: r.type,
        from: r.startNode,
        to: r.endNode
      })),
      explanation
    };
  }
  
  /**
   * Find all symbols that match a pattern (for RLM discovery)
   */
  async findSymbolsMatching(pattern: string): Promise<Symbol[]> {
    const cypher = `
      MATCH (s:Symbol)
      WHERE s.name =~ $pattern OR s.file =~ $pattern
      RETURN s
      LIMIT 50
    `;
    return this.query(cypher, { pattern: `(?i).*${pattern}.*` });
  }
  
  /**
   * Get neighborhood of a symbol (for context building)
   */
  async getNeighborhood(symbol: string, depth: number = 2): Promise<Neighborhood> {
    const cypher = `
      MATCH (center:Symbol {name: $symbol})
      CALL {
        WITH center
        MATCH (center)-[r*1..${depth}]-(neighbor:Symbol)
        RETURN collect(DISTINCT neighbor) as neighbors,
               collect(DISTINCT r) as relationships
      }
      RETURN center, neighbors, relationships
    `;
    return this.query(cypher, { symbol });
  }
}
```

#### Task 3.2: Add Semantic Graph Queries

**File**: `packages/core/src/services/semantic-graph.ts`

```typescript
/**
 * Combines graph structure with semantic understanding
 */
export class SemanticGraphService {
  constructor(
    private graph: GraphService,
    private vector: VectorService,
    private ai: AIService
  ) {}
  
  /**
   * Find symbols semantically related to a concept
   */
  async findRelatedSymbols(concept: string, limit: number = 10): Promise<Symbol[]> {
    // 1. Vector search for semantically similar
    const vectorResults = await this.vector.search(concept, { limit: limit * 2 });
    
    // 2. For each result, get graph neighbors
    const expanded = new Set<string>();
    for (const result of vectorResults) {
      const neighbors = await this.graph.getNeighborhood(result.symbol, 1);
      neighbors.forEach(n => expanded.add(n.name));
    }
    
    // 3. Re-rank by relevance
    return this.rerankByRelevance(Array.from(expanded), concept, limit);
  }
  
  /**
   * Answer "what does X do" with graph + semantic context
   */
  async explainWithContext(symbol: string): Promise<ExplanationWithContext> {
    // Get the symbol and its code
    const symbolInfo = await this.graph.getSymbol(symbol);
    
    // Get what it calls and what calls it
    const calls = await this.graph.getCalls(symbol);
    const calledBy = await this.graph.getCalledBy(symbol);
    
    // Get semantically similar code for context
    const similar = await this.vector.search(symbolInfo.code, { limit: 5 });
    
    // Build comprehensive context
    const context = {
      symbol: symbolInfo,
      calls,
      calledBy,
      similarCode: similar
    };
    
    // Generate explanation with full context
    const explanation = await this.ai.complete(`
      Explain this code in context:
      
      Code:
      ${symbolInfo.code}
      
      This function calls: ${calls.map(c => c.name).join(', ')}
      This function is called by: ${calledBy.map(c => c.name).join(', ')}
      
      Similar code in the codebase:
      ${similar.map(s => `- ${s.name}: ${s.summary}`).join('\n')}
      
      Provide a clear explanation of what this code does and how it fits into the larger system.
    `);
    
    return {
      explanation,
      context
    };
  }
}
```

---

### Phase 4: Testing & Validation

#### Task 4.1: Add RLM Integration Tests

**File**: `tests/rlm-router.test.ts`

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { RLMRouter } from '../packages/core/src/services/rlm-router';

describe('RLM Router', () => {
  let rlm: RLMRouter;
  
  beforeAll(async () => {
    // Setup with test repository
    rlm = new RLMRouter(testGraph, testVector, testAI, {
      maxDepth: 3
    });
  });
  
  it('should decompose complex queries into sub-tasks', async () => {
    const result = await rlm.process(
      'How does authentication flow from login to token validation?'
    );
    
    expect(result.trace.length).toBeGreaterThan(1);
    expect(result.trace.some(s => s.action === 'graph_query')).toBe(true);
  });
  
  it('should find paths between symbols', async () => {
    const result = await rlm.process(
      'What is the execution path from main() to saveToDatabase()?'
    );
    
    expect(result.answer).toContain('main');
    expect(result.answer).toContain('saveToDatabase');
    expect(result.sources.length).toBeGreaterThan(0);
  });
  
  it('should aggregate multiple searches', async () => {
    const result = await rlm.process(
      'What are all the places where user input is validated?'
    );
    
    expect(result.trace.filter(s => s.action === 'vector_search').length)
      .toBeGreaterThanOrEqual(1);
  });
  
  it('should respect max depth', async () => {
    const result = await rlm.process('Explain the entire codebase', {
      maxDepth: 2
    });
    
    expect(result.trace.filter(s => s.action === 'recurse').length)
      .toBeLessThanOrEqual(2);
  });
});
```

#### Task 4.2: Add Codebase Summary Tests

**File**: `tests/codebase-summary.test.ts`

```typescript
describe('Codebase Summary', () => {
  it('should detect architecture patterns', async () => {
    const summary = await summaryService.generate(testRepoPath);
    
    expect(summary.architecture.patterns).toBeDefined();
    expect(summary.architecture.entryPoints.length).toBeGreaterThan(0);
  });
  
  it('should generate valid embedding', async () => {
    const summary = await summaryService.generate(testRepoPath);
    
    expect(summary.embedding).toBeDefined();
    expect(summary.embedding.length).toBe(1536); // OpenAI embedding size
  });
  
  it('should identify hotspots', async () => {
    const summary = await summaryService.generate(testRepoPath);
    
    expect(summary.dependencies.hotspots.length).toBeGreaterThan(0);
  });
});
```

---

## Implementation Order

1. **Week 1**: RLM Router core (`rlm-router.ts`)
   - Implement decomposition logic
   - Implement task execution
   - Implement aggregation
   - Basic tests

2. **Week 2**: CLI & MCP Integration
   - Add `--deep` flag to `cv explain`
   - Add `cv_reason` MCP tool
   - Integration tests

3. **Week 3**: Codebase Summary
   - Implement `CodebaseSummaryService`
   - Integrate into `cv sync`
   - Connect to RLM Router

4. **Week 4**: Advanced Graph Queries
   - Path finding with explanation
   - Semantic graph service
   - Neighborhood queries

5. **Week 5**: Testing & Polish
   - Comprehensive test coverage
   - Performance optimization
   - Documentation

---

## Success Criteria

1. **RLM Router**
   - Can answer multi-hop questions like "How does data flow from API input to database storage?"
   - Correctly decomposes complex queries into graph + vector sub-queries
   - Reasoning trace is understandable and useful

2. **Codebase Summary**
   - Generated in < 60 seconds for medium-sized repos
   - Accurately identifies architecture patterns
   - Embedding similarity works for finding related codebases

3. **Performance**
   - RLM queries complete in < 30 seconds for depth ≤ 5
   - No regressions in existing command performance
   - Memory usage stays reasonable (< 500MB)

4. **Testing**
   - > 80% code coverage on new code
   - All integration tests pass
   - Works on TypeScript, Python, and Go test repos

---

## Notes for Implementation

1. **Start with the RLM Router** - this is the core innovation and provides immediate value

2. **Use structured output from AI** - the decomposition prompt should return JSON that can be parsed reliably

3. **Add good logging** - RLM reasoning can be opaque, so log each step clearly

4. **Consider caching** - graph queries for the same symbol can be cached

5. **Handle cycles** - RLM can get into loops; track visited states

6. **Fail gracefully** - if a sub-query fails, continue with partial information rather than failing entirely

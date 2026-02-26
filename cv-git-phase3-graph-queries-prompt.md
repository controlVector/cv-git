# CV-Git Phase 3: Advanced Graph Queries for RLM

## For Claude Code

**Project**: CV-Git (https://github.com/controlVector/cv-git)
**Goal**: Add advanced graph query capabilities that enhance RLM reasoning

## Context

- **Phase 1** (complete): RLM Router with recursive reasoning
- **Phase 2** (complete): Codebase Summary generation at sync time
- **Phase 3** (this): Advanced graph queries for richer RLM task execution

## Why This Matters

The RLM Router decomposes questions into sub-tasks. Currently it has basic graph operations (calls, called_by). Phase 3 adds:

1. **Path finding with explanation** - "How does data flow from A to B?"
2. **Neighborhood exploration** - "What's related to this symbol?"
3. **Semantic graph queries** - Combine vector similarity with graph structure
4. **Impact analysis** - "What would break if I changed X?"

These give the RLM Router much richer tools for answering complex architectural questions.

---

## Implementation Tasks

### Task 1: Enhanced Path Finding

**Modify**: `packages/core/src/services/graph-service.ts`

Add path finding with multiple algorithms and human-readable explanations:

```typescript
// ============ New Interfaces ============

export interface PathEdge {
  type: 'CALLS' | 'IMPORTS' | 'EXTENDS' | 'IMPLEMENTS' | 'USES';
  from: string;
  to: string;
  file?: string;
}

export interface PathResult {
  found: boolean;
  path: string[];           // Symbol names in order
  edges: PathEdge[];        // Relationship details
  length: number;
  explanation: string;      // Human-readable explanation
}

export interface AllPathsResult {
  paths: PathResult[];
  shortestLength: number;
  longestLength: number;
}

// ============ New Methods ============

export class GraphService {
  // ... existing methods ...

  /**
   * Find shortest path between two symbols with explanation
   */
  async findPath(from: string, to: string, options?: {
    maxDepth?: number;
    relationshipTypes?: string[];
  }): Promise<PathResult> {
    const maxDepth = options?.maxDepth ?? 10;
    const relTypes = options?.relationshipTypes ?? ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS'];
    const relPattern = relTypes.map(r => `:${r}`).join('|');

    const cypher = `
      MATCH (start:Symbol {name: $from})
      MATCH (end:Symbol {name: $to})
      MATCH path = shortestPath((start)-[${relPattern}*1..${maxDepth}]->(end))
      RETURN 
        [node in nodes(path) | node.name] as nodeNames,
        [node in nodes(path) | node.file] as nodeFiles,
        [node in nodes(path) | node.type] as nodeTypes,
        [rel in relationships(path) | type(rel)] as relTypes
    `;

    try {
      const results = await this.query(cypher, { from, to });
      
      if (!results.length) {
        return {
          found: false,
          path: [],
          edges: [],
          length: 0,
          explanation: `No path found from "${from}" to "${to}" within ${maxDepth} hops.`
        };
      }

      const { nodeNames, nodeFiles, nodeTypes, relTypes } = results[0];
      
      // Build edges
      const edges: PathEdge[] = [];
      for (let i = 0; i < relTypes.length; i++) {
        edges.push({
          type: relTypes[i],
          from: nodeNames[i],
          to: nodeNames[i + 1],
          file: nodeFiles[i]
        });
      }

      // Generate explanation
      const explanation = this.buildPathExplanation(nodeNames, nodeTypes, relTypes);

      return {
        found: true,
        path: nodeNames,
        edges,
        length: nodeNames.length - 1,
        explanation
      };
    } catch (error) {
      return {
        found: false,
        path: [],
        edges: [],
        length: 0,
        explanation: `Error finding path: ${error.message}`
      };
    }
  }

  /**
   * Find all paths between two symbols (up to a limit)
   */
  async findAllPaths(from: string, to: string, options?: {
    maxDepth?: number;
    maxPaths?: number;
  }): Promise<AllPathsResult> {
    const maxDepth = options?.maxDepth ?? 6;
    const maxPaths = options?.maxPaths ?? 5;

    const cypher = `
      MATCH (start:Symbol {name: $from})
      MATCH (end:Symbol {name: $to})
      MATCH path = (start)-[:CALLS|IMPORTS|EXTENDS|IMPLEMENTS*1..${maxDepth}]->(end)
      WITH path, length(path) as pathLength
      ORDER BY pathLength
      LIMIT ${maxPaths}
      RETURN 
        [node in nodes(path) | node.name] as nodeNames,
        [node in nodes(path) | node.type] as nodeTypes,
        [rel in relationships(path) | type(rel)] as relTypes
    `;

    const results = await this.query(cypher, { from, to });
    
    const paths: PathResult[] = results.map(r => ({
      found: true,
      path: r.nodeNames,
      edges: this.buildEdgesFromResult(r),
      length: r.nodeNames.length - 1,
      explanation: this.buildPathExplanation(r.nodeNames, r.nodeTypes, r.relTypes)
    }));

    return {
      paths,
      shortestLength: paths.length > 0 ? Math.min(...paths.map(p => p.length)) : 0,
      longestLength: paths.length > 0 ? Math.max(...paths.map(p => p.length)) : 0
    };
  }

  /**
   * Build human-readable path explanation
   */
  private buildPathExplanation(names: string[], types: string[], rels: string[]): string {
    if (names.length === 0) return 'Empty path';
    if (names.length === 1) return `Starting point: ${names[0]}`;

    const steps: string[] = [];
    for (let i = 0; i < rels.length; i++) {
      const rel = rels[i];
      const fromName = names[i];
      const toName = names[i + 1];
      const fromType = types[i];
      const toType = types[i + 1];

      switch (rel) {
        case 'CALLS':
          steps.push(`${fromType} "${fromName}" calls ${toType} "${toName}"`);
          break;
        case 'IMPORTS':
          steps.push(`${fromType} "${fromName}" imports "${toName}"`);
          break;
        case 'EXTENDS':
          steps.push(`${fromType} "${fromName}" extends ${toType} "${toName}"`);
          break;
        case 'IMPLEMENTS':
          steps.push(`${fromType} "${fromName}" implements interface "${toName}"`);
          break;
        default:
          steps.push(`"${fromName}" → "${toName}" (${rel})`);
      }
    }

    return `Path (${names.length - 1} steps):\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`;
  }

  private buildEdgesFromResult(result: any): PathEdge[] {
    const edges: PathEdge[] = [];
    for (let i = 0; i < result.relTypes.length; i++) {
      edges.push({
        type: result.relTypes[i],
        from: result.nodeNames[i],
        to: result.nodeNames[i + 1]
      });
    }
    return edges;
  }
}
```

### Task 2: Neighborhood Exploration

**Add to**: `packages/core/src/services/graph-service.ts`

```typescript
export interface NeighborhoodNode {
  name: string;
  type: string;
  file: string;
  distance: number;  // Hops from center
  relationship: string;  // How it relates to center
}

export interface Neighborhood {
  center: {
    name: string;
    type: string;
    file: string;
  };
  nodes: NeighborhoodNode[];
  summary: {
    totalNodes: number;
    byType: Record<string, number>;
    byRelationship: Record<string, number>;
  };
}

export class GraphService {
  // ... existing methods ...

  /**
   * Get the neighborhood of a symbol (what's nearby in the graph)
   */
  async getNeighborhood(symbol: string, options?: {
    depth?: number;
    limit?: number;
    direction?: 'incoming' | 'outgoing' | 'both';
  }): Promise<Neighborhood> {
    const depth = options?.depth ?? 2;
    const limit = options?.limit ?? 50;
    const direction = options?.direction ?? 'both';

    // Direction pattern for Cypher
    const dirPattern = direction === 'incoming' ? '<-[r*1..' + depth + ']-' 
                     : direction === 'outgoing' ? '-[r*1..' + depth + ']->' 
                     : '-[r*1..' + depth + ']-';

    const cypher = `
      MATCH (center:Symbol {name: $symbol})
      OPTIONAL MATCH (center)${dirPattern}(neighbor:Symbol)
      WITH center, neighbor, r
      WHERE neighbor IS NOT NULL AND neighbor <> center
      WITH center, neighbor, 
           min(length(r)) as distance,
           head([rel in r | type(rel)]) as firstRel
      RETURN 
        center.name as centerName,
        center.type as centerType,
        center.file as centerFile,
        collect(DISTINCT {
          name: neighbor.name,
          type: neighbor.type,
          file: neighbor.file,
          distance: distance,
          relationship: firstRel
        })[0..${limit}] as neighbors
    `;

    const results = await this.query(cypher, { symbol });

    if (!results.length || !results[0].centerName) {
      return {
        center: { name: symbol, type: 'unknown', file: 'unknown' },
        nodes: [],
        summary: { totalNodes: 0, byType: {}, byRelationship: {} }
      };
    }

    const { centerName, centerType, centerFile, neighbors } = results[0];

    // Build summary
    const byType: Record<string, number> = {};
    const byRelationship: Record<string, number> = {};
    
    for (const n of neighbors) {
      byType[n.type] = (byType[n.type] || 0) + 1;
      byRelationship[n.relationship] = (byRelationship[n.relationship] || 0) + 1;
    }

    return {
      center: {
        name: centerName,
        type: centerType,
        file: centerFile
      },
      nodes: neighbors,
      summary: {
        totalNodes: neighbors.length,
        byType,
        byRelationship
      }
    };
  }

  /**
   * Find symbols that would be affected if a symbol changed
   */
  async getImpactAnalysis(symbol: string, options?: {
    depth?: number;
  }): Promise<{
    directCallers: string[];
    indirectCallers: string[];
    implementors: string[];
    extenders: string[];
    totalImpact: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  }> {
    const depth = options?.depth ?? 3;

    // Direct callers
    const directCallersQuery = `
      MATCH (caller:Symbol)-[:CALLS]->(target:Symbol {name: $symbol})
      RETURN collect(DISTINCT caller.name) as callers
    `;
    
    // Indirect callers (transitive)
    const indirectCallersQuery = `
      MATCH (caller:Symbol)-[:CALLS*2..${depth}]->(target:Symbol {name: $symbol})
      WHERE NOT (caller)-[:CALLS]->(target)
      RETURN collect(DISTINCT caller.name) as callers
    `;

    // Classes that implement this interface
    const implementorsQuery = `
      MATCH (impl:Symbol)-[:IMPLEMENTS]->(target:Symbol {name: $symbol})
      RETURN collect(DISTINCT impl.name) as implementors
    `;

    // Classes that extend this class
    const extendersQuery = `
      MATCH (child:Symbol)-[:EXTENDS*1..${depth}]->(target:Symbol {name: $symbol})
      RETURN collect(DISTINCT child.name) as extenders
    `;

    const [directResult, indirectResult, implResult, extResult] = await Promise.all([
      this.query(directCallersQuery, { symbol }),
      this.query(indirectCallersQuery, { symbol }),
      this.query(implementorsQuery, { symbol }),
      this.query(extendersQuery, { symbol })
    ]);

    const directCallers = directResult[0]?.callers || [];
    const indirectCallers = indirectResult[0]?.callers || [];
    const implementors = implResult[0]?.implementors || [];
    const extenders = extResult[0]?.extenders || [];

    const totalImpact = directCallers.length + indirectCallers.length + implementors.length + extenders.length;

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (totalImpact === 0) riskLevel = 'low';
    else if (totalImpact <= 5) riskLevel = 'low';
    else if (totalImpact <= 15) riskLevel = 'medium';
    else if (totalImpact <= 30) riskLevel = 'high';
    else riskLevel = 'critical';

    return {
      directCallers,
      indirectCallers,
      implementors,
      extenders,
      totalImpact,
      riskLevel
    };
  }
}
```

### Task 3: Semantic Graph Service

**Create**: `packages/core/src/services/semantic-graph.ts`

This service combines graph structure with vector similarity for powerful queries:

```typescript
import { GraphService, Neighborhood, PathResult } from './graph-service';
import { VectorService } from './vector-service';
import { AIService } from './ai-service';

export interface SemanticSearchResult {
  symbol: string;
  file: string;
  type: string;
  similarity: number;
  graphDistance?: number;  // If searching from a reference point
  combined?: number;       // Combined score
}

export interface RelatedSymbolsResult {
  query: string;
  results: SemanticSearchResult[];
  graphExpanded: string[];  // Additional symbols found via graph traversal
}

export interface ExplanationWithContext {
  symbol: string;
  code: string;
  explanation: string;
  context: {
    calls: string[];
    calledBy: string[];
    similarCode: SemanticSearchResult[];
    neighborhood: Neighborhood;
  };
}

export class SemanticGraphService {
  constructor(
    private graph: GraphService,
    private vector: VectorService,
    private ai: AIService
  ) {}

  /**
   * Find symbols semantically related to a concept, then expand via graph
   */
  async findRelatedSymbols(
    concept: string,
    options?: {
      limit?: number;
      expandGraph?: boolean;
      graphDepth?: number;
    }
  ): Promise<RelatedSymbolsResult> {
    const limit = options?.limit ?? 10;
    const expandGraph = options?.expandGraph ?? true;
    const graphDepth = options?.graphDepth ?? 1;

    // 1. Vector search for semantically similar
    const vectorResults = await this.vector.search(concept, { 
      limit: limit * 2  // Get more for filtering
    });

    // Convert to our result format
    const results: SemanticSearchResult[] = vectorResults.map(v => ({
      symbol: v.payload?.name || v.id,
      file: v.payload?.file || '',
      type: v.payload?.type || 'unknown',
      similarity: v.score
    }));

    // 2. Optionally expand via graph traversal
    const graphExpanded: string[] = [];
    if (expandGraph && results.length > 0) {
      // Get neighbors of top results
      const topSymbols = results.slice(0, 5).map(r => r.symbol);
      
      for (const symbol of topSymbols) {
        try {
          const neighborhood = await this.graph.getNeighborhood(symbol, {
            depth: graphDepth,
            limit: 10
          });
          
          for (const node of neighborhood.nodes) {
            if (!results.find(r => r.symbol === node.name) && 
                !graphExpanded.includes(node.name)) {
              graphExpanded.push(node.name);
            }
          }
        } catch (e) {
          // Symbol might not exist in graph
        }
      }
    }

    return {
      query: concept,
      results: results.slice(0, limit),
      graphExpanded: graphExpanded.slice(0, limit)
    };
  }

  /**
   * Find symbols similar to a reference symbol (by code similarity + graph proximity)
   */
  async findSimilarTo(
    referenceSymbol: string,
    options?: {
      limit?: number;
      includeGraphNeighbors?: boolean;
    }
  ): Promise<SemanticSearchResult[]> {
    const limit = options?.limit ?? 10;

    // 1. Get the reference symbol's embedding
    const refInfo = await this.graph.getSymbol(referenceSymbol);
    if (!refInfo) {
      throw new Error(`Symbol "${referenceSymbol}" not found`);
    }

    // 2. Search for similar by embedding
    const vectorResults = await this.vector.search(refInfo.code || refInfo.name, {
      limit: limit * 2
    });

    // 3. Get graph neighborhood for distance calculation
    const neighborhood = await this.graph.getNeighborhood(referenceSymbol, {
      depth: 3,
      limit: 100
    });

    const neighborMap = new Map<string, number>();
    for (const node of neighborhood.nodes) {
      neighborMap.set(node.name, node.distance);
    }

    // 4. Combine scores
    const results: SemanticSearchResult[] = vectorResults
      .filter(v => v.payload?.name !== referenceSymbol)
      .map(v => {
        const name = v.payload?.name || v.id;
        const graphDistance = neighborMap.get(name);
        
        // Combined score: similarity * (1 + graph_proximity_bonus)
        const graphBonus = graphDistance !== undefined 
          ? 0.2 / graphDistance  // Closer in graph = higher bonus
          : 0;
        
        return {
          symbol: name,
          file: v.payload?.file || '',
          type: v.payload?.type || 'unknown',
          similarity: v.score,
          graphDistance,
          combined: v.score * (1 + graphBonus)
        };
      });

    // Sort by combined score
    results.sort((a, b) => (b.combined || b.similarity) - (a.combined || a.similarity));

    return results.slice(0, limit);
  }

  /**
   * Explain a symbol with full context (what it does, calls, called by, similar code)
   */
  async explainWithContext(symbol: string): Promise<ExplanationWithContext> {
    // Get the symbol info
    const symbolInfo = await this.graph.getSymbol(symbol);
    if (!symbolInfo) {
      throw new Error(`Symbol "${symbol}" not found`);
    }

    // Get what it calls and what calls it
    const [calls, calledBy, neighborhood] = await Promise.all([
      this.graph.getCalls(symbol),
      this.graph.getCalledBy(symbol),
      this.graph.getNeighborhood(symbol, { depth: 2, limit: 20 })
    ]);

    // Get semantically similar code
    const similar = await this.findSimilarTo(symbol, { limit: 5 });

    // Generate comprehensive explanation with AI
    const explanation = await this.ai.complete(`
Explain this code in context of the larger codebase:

**Code:**
\`\`\`
${symbolInfo.code}
\`\`\`

**This ${symbolInfo.type} calls:** ${calls.map(c => c.name).join(', ') || 'nothing'}

**Called by:** ${calledBy.map(c => c.name).join(', ') || 'nothing'}

**Similar code in the codebase:**
${similar.map(s => `- ${s.symbol} (${s.type} in ${s.file}, ${Math.round(s.similarity * 100)}% similar)`).join('\n')}

**Nearby in the dependency graph:**
${neighborhood.nodes.slice(0, 10).map(n => `- ${n.name} (${n.relationship})`).join('\n')}

Provide a clear explanation that covers:
1. What this code does
2. Its role in the system
3. Key dependencies and dependents
4. Any patterns or conventions it follows
`);

    return {
      symbol,
      code: symbolInfo.code,
      explanation,
      context: {
        calls: calls.map(c => c.name),
        calledBy: calledBy.map(c => c.name),
        similarCode: similar,
        neighborhood
      }
    };
  }

  /**
   * Find the semantic bridge between two parts of the codebase
   * (What concepts/functions connect two seemingly unrelated areas?)
   */
  async findSemanticBridge(
    symbolA: string,
    symbolB: string
  ): Promise<{
    graphPath: PathResult | null;
    semanticBridges: string[];  // Symbols that are semantically related to both
    explanation: string;
  }> {
    // 1. Try to find a graph path
    const graphPath = await this.graph.findPath(symbolA, symbolB, { maxDepth: 8 });

    // 2. Find symbols semantically related to both
    const [relatedToA, relatedToB] = await Promise.all([
      this.findRelatedSymbols(symbolA, { limit: 20, expandGraph: false }),
      this.findRelatedSymbols(symbolB, { limit: 20, expandGraph: false })
    ]);

    const aSymbols = new Set(relatedToA.results.map(r => r.symbol));
    const semanticBridges = relatedToB.results
      .filter(r => aSymbols.has(r.symbol))
      .map(r => r.symbol);

    // 3. Generate explanation
    const explanation = await this.ai.complete(`
Explain how these two code elements are connected:

**Element A:** ${symbolA}
**Element B:** ${symbolB}

${graphPath.found 
  ? `**Graph path found:**\n${graphPath.explanation}` 
  : '**No direct graph path found.**'}

**Semantically similar to both:** ${semanticBridges.join(', ') || 'None found'}

Explain:
1. The relationship between these elements
2. How data/control might flow between them
3. Why they might be related (shared purpose, same feature, etc.)
`);

    return {
      graphPath: graphPath.found ? graphPath : null,
      semanticBridges,
      explanation
    };
  }
}

// Factory function
export function createSemanticGraphService(
  graph: GraphService,
  vector: VectorService,
  ai: AIService
): SemanticGraphService {
  return new SemanticGraphService(graph, vector, ai);
}
```

### Task 4: Integrate New Queries into RLM Router

**Modify**: `packages/core/src/services/rlm-router.ts`

Add new task types and execution:

```typescript
import { SemanticGraphService } from './semantic-graph';

// Add to task types
type RLMTaskType = 
  | 'graph_query' 
  | 'vector_search' 
  | 'llm_explain' 
  | 'recurse'
  | 'find_path'        // NEW
  | 'get_neighborhood' // NEW
  | 'impact_analysis'  // NEW
  | 'semantic_search'  // NEW
  | 'find_bridge';     // NEW

export class RLMRouter {
  private semanticGraph: SemanticGraphService;

  constructor(
    private graph: GraphService,
    private vector: VectorService,
    private ai: AIService,
    private config: RLMConfig
  ) {
    this.semanticGraph = new SemanticGraphService(graph, vector, ai);
  }

  private async executeTask(task: RLMTask, ctx: RLMContext): Promise<any> {
    switch (task.type) {
      // ... existing cases ...

      case 'find_path':
        return this.graph.findPath(task.from, task.to, {
          maxDepth: task.maxDepth
        });

      case 'get_neighborhood':
        return this.graph.getNeighborhood(task.symbol, {
          depth: task.depth,
          direction: task.direction
        });

      case 'impact_analysis':
        return this.graph.getImpactAnalysis(task.symbol, {
          depth: task.depth
        });

      case 'semantic_search':
        return this.semanticGraph.findRelatedSymbols(task.query, {
          limit: task.limit,
          expandGraph: task.expandGraph
        });

      case 'find_bridge':
        return this.semanticGraph.findSemanticBridge(task.symbolA, task.symbolB);

      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  // Update the decomposition prompt with new tools
  private buildDecompositionPrompt(query: string, ctx: RLMContext): string {
    const codebaseContext = this.getCodebaseContext();

    return `
You are an AI reasoning about a codebase. You have access to tools and context.
${codebaseContext}

AVAILABLE TOOLS:

**Graph Structure:**
- graph_query: Query the knowledge graph
  - calls(symbol): What does this function call?
  - called_by(symbol): What calls this function?
  - imports(file): What does this file import?
  - symbols_in_file(file): List all symbols in a file
  - complexity(threshold): Find functions with complexity > threshold

- find_path: Find execution/dependency path between two symbols
  - from: Starting symbol
  - to: Target symbol
  - maxDepth: Maximum path length (default: 10)
  Returns: Path with explanation

- get_neighborhood: Explore what's near a symbol in the graph
  - symbol: Center symbol
  - depth: How many hops (default: 2)
  - direction: 'incoming', 'outgoing', or 'both'
  Returns: Neighboring symbols with relationships

- impact_analysis: Analyze what would be affected by changing a symbol
  - symbol: Symbol to analyze
  Returns: Direct callers, indirect callers, implementors, risk level

**Semantic Search:**
- vector_search: Basic semantic code search
  - query: Natural language description
  - limit: Number of results

- semantic_search: Advanced semantic search with graph expansion
  - query: Natural language or symbol name
  - limit: Number of results
  - expandGraph: Also find graph neighbors of results

- find_bridge: Find how two symbols are connected
  - symbolA: First symbol
  - symbolB: Second symbol
  Returns: Graph path, semantic bridges, explanation

**AI Analysis:**
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
      "type": "task_type",
      "reasoning": "Why this task helps",
      ...task-specific params
    }
  ],
  "canAnswer": boolean,
  "refinedQuery": "string"  // if canAnswer is false
}
`;
  }
}
```

### Task 5: Add CLI Commands for New Queries

**Create**: `packages/cli/src/commands/graph-advanced.ts`

```typescript
import { Command } from 'commander';
import { GraphService, SemanticGraphService } from '@cv-git/core';

export const pathCommand = new Command('path')
  .description('Find path between two symbols')
  .requiredOption('--from <symbol>', 'Starting symbol')
  .requiredOption('--to <symbol>', 'Target symbol')
  .option('--max-depth <n>', 'Maximum path length', '10')
  .option('--all', 'Find all paths (not just shortest)')
  .action(async (options) => {
    const graph = await getGraphService();
    
    if (options.all) {
      const result = await graph.findAllPaths(options.from, options.to, {
        maxDepth: parseInt(options.maxDepth)
      });
      
      console.log(`Found ${result.paths.length} paths:\n`);
      result.paths.forEach((path, i) => {
        console.log(`Path ${i + 1}:`);
        console.log(path.explanation);
        console.log();
      });
    } else {
      const result = await graph.findPath(options.from, options.to, {
        maxDepth: parseInt(options.maxDepth)
      });
      
      if (result.found) {
        console.log(result.explanation);
      } else {
        console.log(result.explanation);
      }
    }
  });

export const neighborhoodCommand = new Command('neighborhood')
  .description('Explore symbols near a given symbol')
  .argument('<symbol>', 'Center symbol')
  .option('--depth <n>', 'How many hops', '2')
  .option('--direction <dir>', 'incoming, outgoing, or both', 'both')
  .option('--limit <n>', 'Maximum neighbors', '20')
  .action(async (symbol, options) => {
    const graph = await getGraphService();
    
    const result = await graph.getNeighborhood(symbol, {
      depth: parseInt(options.depth),
      direction: options.direction,
      limit: parseInt(options.limit)
    });
    
    console.log(`\n🎯 Center: ${result.center.name} (${result.center.type})`);
    console.log(`   File: ${result.center.file}\n`);
    
    console.log(`📊 Summary: ${result.summary.totalNodes} neighbors found`);
    console.log(`   By type: ${Object.entries(result.summary.byType).map(([t, c]) => `${t}(${c})`).join(', ')}`);
    console.log(`   By relationship: ${Object.entries(result.summary.byRelationship).map(([r, c]) => `${r}(${c})`).join(', ')}\n`);
    
    console.log('🔗 Neighbors:');
    result.nodes.forEach(n => {
      console.log(`   ${n.distance === 1 ? '├' : '│ └'}── ${n.name} (${n.type}) [${n.relationship}]`);
    });
  });

export const impactCommand = new Command('impact')
  .description('Analyze impact of changing a symbol')
  .argument('<symbol>', 'Symbol to analyze')
  .option('--depth <n>', 'Analysis depth', '3')
  .action(async (symbol, options) => {
    const graph = await getGraphService();
    
    const result = await graph.getImpactAnalysis(symbol, {
      depth: parseInt(options.depth)
    });
    
    const riskColors = {
      low: '\x1b[32m',      // green
      medium: '\x1b[33m',   // yellow
      high: '\x1b[31m',     // red
      critical: '\x1b[35m'  // magenta
    };
    const reset = '\x1b[0m';
    
    console.log(`\n⚡ Impact Analysis: ${symbol}`);
    console.log(`${'═'.repeat(50)}`);
    console.log(`Risk Level: ${riskColors[result.riskLevel]}${result.riskLevel.toUpperCase()}${reset}`);
    console.log(`Total Impact: ${result.totalImpact} symbols affected\n`);
    
    if (result.directCallers.length > 0) {
      console.log(`📞 Direct Callers (${result.directCallers.length}):`);
      result.directCallers.forEach(c => console.log(`   - ${c}`));
    }
    
    if (result.indirectCallers.length > 0) {
      console.log(`\n📞 Indirect Callers (${result.indirectCallers.length}):`);
      result.indirectCallers.slice(0, 10).forEach(c => console.log(`   - ${c}`));
      if (result.indirectCallers.length > 10) {
        console.log(`   ... and ${result.indirectCallers.length - 10} more`);
      }
    }
    
    if (result.implementors.length > 0) {
      console.log(`\n🔧 Implementors (${result.implementors.length}):`);
      result.implementors.forEach(i => console.log(`   - ${i}`));
    }
    
    if (result.extenders.length > 0) {
      console.log(`\n📦 Extenders (${result.extenders.length}):`);
      result.extenders.forEach(e => console.log(`   - ${e}`));
    }
  });

export const bridgeCommand = new Command('bridge')
  .description('Find how two symbols are connected')
  .argument('<symbolA>', 'First symbol')
  .argument('<symbolB>', 'Second symbol')
  .action(async (symbolA, symbolB) => {
    const semanticGraph = await getSemanticGraphService();
    
    console.log(`\n🌉 Finding bridge between "${symbolA}" and "${symbolB}"...\n`);
    
    const result = await semanticGraph.findSemanticBridge(symbolA, symbolB);
    
    if (result.graphPath) {
      console.log('📊 Graph Path:');
      console.log(result.graphPath.explanation);
      console.log();
    } else {
      console.log('📊 No direct graph path found.\n');
    }
    
    if (result.semanticBridges.length > 0) {
      console.log('🧠 Semantic Bridges (related to both):');
      result.semanticBridges.forEach(b => console.log(`   - ${b}`));
      console.log();
    }
    
    console.log('💡 Explanation:');
    console.log(result.explanation);
  });
```

### Task 6: Add Tests

**Create**: `packages/core/src/services/graph-service-advanced.test.ts`

```typescript
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { GraphService } from './graph-service';

describe('GraphService Advanced Queries', () => {
  let service: GraphService;
  let mockQuery: any;

  beforeAll(() => {
    mockQuery = vi.fn();
    service = new GraphService({ query: mockQuery });
  });

  describe('findPath', () => {
    it('should find shortest path between symbols', async () => {
      mockQuery.mockResolvedValueOnce([{
        nodeNames: ['funcA', 'funcB', 'funcC'],
        nodeFiles: ['a.ts', 'b.ts', 'c.ts'],
        nodeTypes: ['function', 'function', 'function'],
        relTypes: ['CALLS', 'CALLS']
      }]);

      const result = await service.findPath('funcA', 'funcC');

      expect(result.found).toBe(true);
      expect(result.path).toEqual(['funcA', 'funcB', 'funcC']);
      expect(result.length).toBe(2);
      expect(result.explanation).toContain('funcA');
    });

    it('should handle no path found', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await service.findPath('funcA', 'funcZ');

      expect(result.found).toBe(false);
      expect(result.path).toEqual([]);
    });
  });

  describe('getNeighborhood', () => {
    it('should return neighborhood with summary', async () => {
      mockQuery.mockResolvedValueOnce([{
        centerName: 'MyClass',
        centerType: 'class',
        centerFile: 'my-class.ts',
        neighbors: [
          { name: 'helperFunc', type: 'function', distance: 1, relationship: 'CALLS' },
          { name: 'OtherClass', type: 'class', distance: 2, relationship: 'IMPORTS' }
        ]
      }]);

      const result = await service.getNeighborhood('MyClass');

      expect(result.center.name).toBe('MyClass');
      expect(result.nodes).toHaveLength(2);
      expect(result.summary.totalNodes).toBe(2);
      expect(result.summary.byType.function).toBe(1);
    });
  });

  describe('getImpactAnalysis', () => {
    it('should calculate risk level correctly', async () => {
      mockQuery
        .mockResolvedValueOnce([{ callers: ['a', 'b', 'c'] }])  // direct
        .mockResolvedValueOnce([{ callers: ['d', 'e'] }])       // indirect
        .mockResolvedValueOnce([{ implementors: [] }])
        .mockResolvedValueOnce([{ extenders: [] }]);

      const result = await service.getImpactAnalysis('targetFunc');

      expect(result.directCallers).toHaveLength(3);
      expect(result.indirectCallers).toHaveLength(2);
      expect(result.totalImpact).toBe(5);
      expect(result.riskLevel).toBe('low');
    });

    it('should return critical risk for highly connected symbols', async () => {
      mockQuery
        .mockResolvedValueOnce([{ callers: Array(20).fill('caller') }])
        .mockResolvedValueOnce([{ callers: Array(15).fill('indirect') }])
        .mockResolvedValueOnce([{ implementors: [] }])
        .mockResolvedValueOnce([{ extenders: [] }]);

      const result = await service.getImpactAnalysis('coreFunc');

      expect(result.totalImpact).toBe(35);
      expect(result.riskLevel).toBe('critical');
    });
  });
});
```

**Create**: `packages/core/src/services/semantic-graph.test.ts`

```typescript
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { SemanticGraphService } from './semantic-graph';

describe('SemanticGraphService', () => {
  let service: SemanticGraphService;
  let mockGraph: any;
  let mockVector: any;
  let mockAI: any;

  beforeAll(() => {
    mockGraph = {
      getSymbol: vi.fn(),
      getCalls: vi.fn(),
      getCalledBy: vi.fn(),
      getNeighborhood: vi.fn(),
      findPath: vi.fn()
    };
    mockVector = {
      search: vi.fn()
    };
    mockAI = {
      complete: vi.fn()
    };
    service = new SemanticGraphService(mockGraph, mockVector, mockAI);
  });

  describe('findRelatedSymbols', () => {
    it('should combine vector search with graph expansion', async () => {
      mockVector.search.mockResolvedValueOnce([
        { id: 'func1', score: 0.9, payload: { name: 'func1', type: 'function', file: 'a.ts' } },
        { id: 'func2', score: 0.8, payload: { name: 'func2', type: 'function', file: 'b.ts' } }
      ]);
      
      mockGraph.getNeighborhood.mockResolvedValue({
        nodes: [{ name: 'neighborFunc', type: 'function', file: 'c.ts' }]
      });

      const result = await service.findRelatedSymbols('authentication', {
        limit: 10,
        expandGraph: true
      });

      expect(result.results).toHaveLength(2);
      expect(result.graphExpanded).toContain('neighborFunc');
    });
  });

  describe('findSemanticBridge', () => {
    it('should find both graph path and semantic bridges', async () => {
      mockGraph.findPath.mockResolvedValueOnce({
        found: true,
        path: ['A', 'B', 'C'],
        explanation: 'A calls B calls C'
      });
      
      mockVector.search
        .mockResolvedValueOnce([
          { payload: { name: 'shared1' }, score: 0.9 },
          { payload: { name: 'shared2' }, score: 0.8 }
        ])
        .mockResolvedValueOnce([
          { payload: { name: 'shared1' }, score: 0.85 },
          { payload: { name: 'other' }, score: 0.7 }
        ]);
      
      mockAI.complete.mockResolvedValueOnce('These are connected via shared1');

      const result = await service.findSemanticBridge('A', 'C');

      expect(result.graphPath).not.toBeNull();
      expect(result.semanticBridges).toContain('shared1');
      expect(result.explanation).toContain('shared1');
    });
  });
});
```

---

## Export Updates

**Modify**: `packages/core/src/services/index.ts`

```typescript
export * from './graph-service';
export * from './semantic-graph';
export * from './codebase-summary';
export * from './rlm-router';
// ... other exports
```

---

## Verification Steps

```bash
# 1. Build
pnpm build

# 2. Run tests
pnpm test

# 3. Test new CLI commands
cv graph path --from "syncCommand" --to "graphService"
cv graph neighborhood GraphService --depth 2
cv graph impact AIService
cv graph bridge UserService DatabaseService

# 4. Test with RLM
cv explain "how does data flow from API to database" --deep --trace
```

## Success Criteria

1. **Path finding** works with explanations
2. **Neighborhood** returns structured results with summary
3. **Impact analysis** calculates correct risk levels
4. **SemanticGraphService** combines vector + graph queries
5. **RLM Router** uses new task types
6. **CLI commands** display results nicely
7. All tests pass (target: 40+ tests total)

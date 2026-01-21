/**
 * Semantic Graph Service
 *
 * Combines vector (semantic) search with graph (structural) queries
 * to provide richer code understanding. This enables:
 * - Finding conceptually related code with structural context
 * - Exploring code by meaning and relationships
 * - Building comprehensive context for AI reasoning
 */

import { GraphManager } from '../graph/index.js';
import { VectorManager } from '../vector/index.js';
import { GraphService, Neighborhood, PathResult, ImpactAnalysis } from './graph-service.js';
import { SymbolNode } from '@cv-git/shared';

// ========== Type Definitions ==========

/**
 * Combined semantic and structural search result
 */
export interface SemanticSearchResult {
  /** The matched symbol */
  symbol: {
    name: string;
    qualifiedName: string;
    file: string;
    kind: string;
    startLine: number;
    endLine: number;
    signature?: string;
    docstring?: string;
  };
  /** Semantic similarity score (0-1) */
  semanticScore: number;
  /** Code snippet that matched */
  matchedText: string;
  /** Graph context around this symbol */
  graphContext: {
    callers: string[];
    callees: string[];
    relatedSymbols: string[];
  };
}

/**
 * Expanded context result
 */
export interface ExpandedContext {
  /** Original query */
  query: string;
  /** Primary results from semantic search */
  primaryResults: SemanticSearchResult[];
  /** Related code discovered through graph traversal */
  relatedCode: Array<{
    symbol: {
      name: string;
      file: string;
      kind: string;
    };
    relationship: string;
    distance: number;
    fromResult: string; // Which primary result this came from
  }>;
  /** Files involved in this context */
  involvedFiles: string[];
  /** Summary statistics */
  summary: {
    totalPrimaryResults: number;
    totalRelatedSymbols: number;
    fileCount: number;
    languageBreakdown: Record<string, number>;
  };
}

/**
 * Concept cluster result
 */
export interface ConceptCluster {
  /** The central concept/query */
  concept: string;
  /** Core symbols that directly match the concept */
  coreSymbols: Array<{
    name: string;
    file: string;
    kind: string;
    score: number;
  }>;
  /** Related symbols discovered through the graph */
  relatedSymbols: Array<{
    name: string;
    file: string;
    kind: string;
    connection: string;
    depth: number;
  }>;
  /** Key abstractions (interfaces, base classes) */
  abstractions: string[];
  /** Key implementations */
  implementations: string[];
}

/**
 * Options for semantic graph search
 */
export interface SemanticGraphSearchOptions {
  /** Maximum number of semantic results */
  semanticLimit?: number;
  /** Minimum semantic score threshold */
  minScore?: number;
  /** Depth for graph expansion */
  graphDepth?: number;
  /** Include callers in results */
  includeCallers?: boolean;
  /** Include callees in results */
  includeCallees?: boolean;
  /** Filter by file pattern */
  filePattern?: string;
  /** Filter by symbol kind */
  symbolKinds?: string[];
}

// ========== SemanticGraphService Implementation ==========

export class SemanticGraphService {
  private graphService: GraphService;

  constructor(
    private graph: GraphManager,
    private vector: VectorManager
  ) {
    this.graphService = new GraphService(graph);
  }

  /**
   * Perform a combined semantic and structural search
   */
  async semanticSearch(
    query: string,
    options: SemanticGraphSearchOptions = {}
  ): Promise<SemanticSearchResult[]> {
    const {
      semanticLimit = 10,
      minScore = 0.3,
      includeCallers = true,
      includeCallees = true
    } = options;

    // First, do semantic search
    const vectorResults = await this.vector.searchCode(query, semanticLimit, { minScore });

    if (vectorResults.length === 0) {
      return [];
    }

    // Enrich each result with graph context
    const results: SemanticSearchResult[] = [];

    for (const vr of vectorResults) {
      const payload = vr.payload;
      const symbolName = payload.symbolName || payload.qualifiedName;

      // Get graph context
      let callers: string[] = [];
      let callees: string[] = [];
      let relatedSymbols: string[] = [];

      if (symbolName) {
        try {
          if (includeCallers) {
            const callerNodes = await this.graph.getCallers(symbolName);
            callers = callerNodes.slice(0, 5).map(n => n.name);
          }

          if (includeCallees) {
            const calleeNodes = await this.graph.getCallees(symbolName);
            callees = calleeNodes.slice(0, 5).map(n => n.name);
          }

          // Get related symbols through the graph
          const neighborhood = await this.graphService.getNeighborhood(symbolName, { depth: 1, maxNodes: 10 });
          relatedSymbols = neighborhood.nodes
            .filter(n => n.relationship !== 'CALLS')
            .slice(0, 5)
            .map(n => n.name);

        } catch {
          // Graph queries failed, continue without context
        }
      }

      results.push({
        symbol: {
          name: payload.symbolName || 'unknown',
          qualifiedName: payload.qualifiedName || payload.symbolName || '',
          file: payload.file || '',
          kind: payload.symbolKind || 'unknown',
          startLine: payload.startLine || 0,
          endLine: payload.endLine || 0,
          signature: payload.signature,
          docstring: payload.docstring
        },
        semanticScore: vr.score,
        matchedText: payload.text || '',
        graphContext: {
          callers,
          callees,
          relatedSymbols
        }
      });
    }

    return results;
  }

  /**
   * Expand a query into full context with graph traversal
   */
  async expandContext(
    query: string,
    options: SemanticGraphSearchOptions & {
      expandRelated?: boolean;
      maxRelated?: number;
    } = {}
  ): Promise<ExpandedContext> {
    const {
      semanticLimit = 5,
      minScore = 0.4,
      graphDepth = 2,
      expandRelated = true,
      maxRelated = 20
    } = options;

    // Get primary semantic results
    const primaryResults = await this.semanticSearch(query, {
      semanticLimit,
      minScore,
      includeCallers: true,
      includeCallees: true
    });

    // Expand through graph to find related code
    const relatedCode: ExpandedContext['relatedCode'] = [];
    const seenSymbols = new Set<string>();

    // Mark primary results as seen
    for (const pr of primaryResults) {
      seenSymbols.add(pr.symbol.qualifiedName || pr.symbol.name);
    }

    if (expandRelated) {
      for (const pr of primaryResults) {
        const symbolName = pr.symbol.qualifiedName || pr.symbol.name;

        try {
          const neighborhood = await this.graphService.getNeighborhood(symbolName, {
            depth: graphDepth,
            maxNodes: Math.ceil(maxRelated / primaryResults.length)
          });

          for (const node of neighborhood.nodes) {
            if (!seenSymbols.has(node.qualifiedName) && relatedCode.length < maxRelated) {
              seenSymbols.add(node.qualifiedName);
              relatedCode.push({
                symbol: {
                  name: node.name,
                  file: node.file,
                  kind: node.type
                },
                relationship: node.relationship,
                distance: node.distance,
                fromResult: pr.symbol.name
              });
            }
          }
        } catch {
          // Graph traversal failed, continue
        }
      }
    }

    // Collect all involved files
    const involvedFiles = new Set<string>();
    for (const pr of primaryResults) {
      if (pr.symbol.file) involvedFiles.add(pr.symbol.file);
    }
    for (const rc of relatedCode) {
      if (rc.symbol.file) involvedFiles.add(rc.symbol.file);
    }

    // Calculate language breakdown
    const languageBreakdown: Record<string, number> = {};
    for (const file of involvedFiles) {
      const ext = file.split('.').pop() || 'unknown';
      const lang = this.extToLanguage(ext);
      languageBreakdown[lang] = (languageBreakdown[lang] || 0) + 1;
    }

    return {
      query,
      primaryResults,
      relatedCode,
      involvedFiles: Array.from(involvedFiles),
      summary: {
        totalPrimaryResults: primaryResults.length,
        totalRelatedSymbols: relatedCode.length,
        fileCount: involvedFiles.size,
        languageBreakdown
      }
    };
  }

  /**
   * Find a cluster of code related to a concept
   */
  async findConceptCluster(
    concept: string,
    options: {
      coreLimit?: number;
      expandDepth?: number;
      maxRelated?: number;
    } = {}
  ): Promise<ConceptCluster> {
    const { coreLimit = 5, expandDepth = 2, maxRelated = 30 } = options;

    // Find core symbols semantically
    const coreResults = await this.semanticSearch(concept, {
      semanticLimit: coreLimit,
      minScore: 0.4
    });

    const coreSymbols = coreResults.map(r => ({
      name: r.symbol.name,
      file: r.symbol.file,
      kind: r.symbol.kind,
      score: r.semanticScore
    }));

    // Expand through graph
    const relatedSymbols: ConceptCluster['relatedSymbols'] = [];
    const abstractions: string[] = [];
    const implementations: string[] = [];
    const seenSymbols = new Set<string>(coreSymbols.map(s => s.name));

    for (const core of coreSymbols) {
      try {
        const neighborhood = await this.graphService.getNeighborhood(core.name, {
          depth: expandDepth,
          maxNodes: Math.ceil(maxRelated / coreSymbols.length)
        });

        for (const node of neighborhood.nodes) {
          if (seenSymbols.has(node.name)) continue;
          seenSymbols.add(node.name);

          // Categorize the node
          if (node.type === 'interface' || node.type === 'type') {
            abstractions.push(node.name);
          } else if (node.relationship === 'INHERITS' && node.direction === 'incoming') {
            implementations.push(node.name);
          } else {
            relatedSymbols.push({
              name: node.name,
              file: node.file,
              kind: node.type,
              connection: node.relationship,
              depth: node.distance
            });
          }
        }
      } catch {
        // Continue on error
      }
    }

    return {
      concept,
      coreSymbols,
      relatedSymbols: relatedSymbols.slice(0, maxRelated),
      abstractions: [...new Set(abstractions)],
      implementations: [...new Set(implementations)]
    };
  }

  /**
   * Find code that conceptually bridges two areas
   */
  async findSemanticBridge(
    concept1: string,
    concept2: string,
    options: {
      limit?: number;
    } = {}
  ): Promise<{
    bridgeSymbols: Array<{
      name: string;
      file: string;
      kind: string;
      relevanceToFirst: number;
      relevanceToSecond: number;
    }>;
    sharedCallers: string[];
    sharedCallees: string[];
  }> {
    const { limit = 10 } = options;

    // Search for both concepts
    const results1 = await this.semanticSearch(concept1, { semanticLimit: 20, minScore: 0.3 });
    const results2 = await this.semanticSearch(concept2, { semanticLimit: 20, minScore: 0.3 });

    // Find symbols that appear in both result sets or are connected
    const symbols1 = new Map(results1.map(r => [r.symbol.name, r]));
    const symbols2 = new Map(results2.map(r => [r.symbol.name, r]));

    // Find overlapping symbols
    const bridgeSymbols: Array<{
      name: string;
      file: string;
      kind: string;
      relevanceToFirst: number;
      relevanceToSecond: number;
    }> = [];

    for (const [name, r1] of symbols1) {
      const r2 = symbols2.get(name);
      if (r2) {
        bridgeSymbols.push({
          name,
          file: r1.symbol.file,
          kind: r1.symbol.kind,
          relevanceToFirst: r1.semanticScore,
          relevanceToSecond: r2.semanticScore
        });
      }
    }

    // Find shared callers/callees
    const callers1 = new Set(results1.flatMap(r => r.graphContext.callers));
    const callers2 = new Set(results2.flatMap(r => r.graphContext.callers));
    const sharedCallers = [...callers1].filter(c => callers2.has(c));

    const callees1 = new Set(results1.flatMap(r => r.graphContext.callees));
    const callees2 = new Set(results2.flatMap(r => r.graphContext.callees));
    const sharedCallees = [...callees1].filter(c => callees2.has(c));

    // If no direct overlap, try to find connections through the graph
    if (bridgeSymbols.length === 0 && results1.length > 0 && results2.length > 0) {
      const source = results1[0].symbol.name;
      const target = results2[0].symbol.name;

      try {
        const bridge = await this.graphService.findBridge(source, target, { maxDepth: 4 });

        // Add intermediate nodes as potential bridges
        for (const conn of bridge.connections) {
          const intermediates = conn.path.slice(1, -1);
          for (const name of intermediates) {
            if (!bridgeSymbols.find(b => b.name === name)) {
              bridgeSymbols.push({
                name,
                file: conn.pathDetails.find(d => d.name === name)?.file || '',
                kind: conn.pathDetails.find(d => d.name === name)?.kind || 'unknown',
                relevanceToFirst: 0.5,
                relevanceToSecond: 0.5
              });
            }
          }
        }
      } catch {
        // Bridge detection failed
      }
    }

    return {
      bridgeSymbols: bridgeSymbols.slice(0, limit),
      sharedCallers: sharedCallers.slice(0, 10),
      sharedCallees: sharedCallees.slice(0, 10)
    };
  }

  /**
   * Get comprehensive context for a symbol using both semantic and graph approaches
   */
  async getComprehensiveContext(
    symbol: string,
    options: {
      includeSemanticRelated?: boolean;
      includePath?: string;
      maxDepth?: number;
    } = {}
  ): Promise<{
    symbol: SemanticSearchResult | null;
    neighborhood: Neighborhood;
    impactAnalysis: ImpactAnalysis;
    semanticallyRelated: SemanticSearchResult[];
    pathToTarget?: PathResult;
  }> {
    const {
      includeSemanticRelated = true,
      includePath,
      maxDepth = 2
    } = options;

    // Get the symbol through semantic search
    const symbolResults = await this.semanticSearch(symbol, { semanticLimit: 1 });
    const symbolResult = symbolResults[0] || null;

    // Get neighborhood
    const neighborhood = await this.graphService.getNeighborhood(symbol, { depth: maxDepth });

    // Get impact analysis
    const impactAnalysis = await this.graphService.getImpactAnalysis(symbol, { maxDepth: 3 });

    // Get semantically related symbols
    let semanticallyRelated: SemanticSearchResult[] = [];
    if (includeSemanticRelated && symbolResult?.symbol.docstring) {
      // Use the symbol's docstring to find related code
      semanticallyRelated = await this.semanticSearch(
        symbolResult.symbol.docstring,
        { semanticLimit: 5, minScore: 0.5 }
      );
      // Filter out the original symbol
      semanticallyRelated = semanticallyRelated.filter(
        r => r.symbol.name !== symbol && r.symbol.qualifiedName !== symbol
      );
    }

    // Get path to target if specified
    let pathToTarget: PathResult | undefined;
    if (includePath) {
      pathToTarget = await this.graphService.findPath(symbol, includePath);
    }

    return {
      symbol: symbolResult,
      neighborhood,
      impactAnalysis,
      semanticallyRelated,
      pathToTarget
    };
  }

  // ========== Helper Methods ==========

  private extToLanguage(ext: string): string {
    const mapping: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'typescript',
      'js': 'javascript',
      'jsx': 'javascript',
      'py': 'python',
      'go': 'go',
      'rs': 'rust',
      'java': 'java',
      'rb': 'ruby',
      'php': 'php',
      'c': 'c',
      'cpp': 'cpp',
      'h': 'c',
      'hpp': 'cpp'
    };
    return mapping[ext] || ext;
  }
}

/**
 * Create a SemanticGraphService instance
 */
export function createSemanticGraphService(
  graph: GraphManager,
  vector: VectorManager
): SemanticGraphService {
  return new SemanticGraphService(graph, vector);
}

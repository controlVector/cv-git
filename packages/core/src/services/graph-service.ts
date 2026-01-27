/**
 * Advanced Graph Query Service
 *
 * Provides rich graph analysis capabilities:
 * - Path finding between symbols with explanations
 * - Neighborhood exploration
 * - Impact analysis for change risk assessment
 * - Bridge detection between distant concepts
 */

import { GraphManager } from '../graph/index.js';
import { VectorManager } from '../vector/index.js';
import { SymbolNode, CodeChunkPayload } from '@cv-git/shared';
import { getGlobalCache, CacheService } from './cache-service.js';

// ========== Type Definitions ==========

/**
 * Edge in a path result
 */
export interface PathEdge {
  from: string;
  to: string;
  type: string;
  properties?: Record<string, any>;
}

/**
 * Result of a path query
 */
export interface PathResult {
  /** Whether a path was found */
  found: boolean;
  /** Names of symbols in the path */
  path: string[];
  /** Detailed path with files */
  pathDetails: Array<{
    name: string;
    file: string;
    kind: string;
    line?: number;
  }>;
  /** Edges connecting the path */
  edges: PathEdge[];
  /** Path length */
  length: number;
  /** Human-readable explanation */
  explanation: string;
}

/**
 * Node in a neighborhood result
 */
export interface NeighborhoodNode {
  name: string;
  qualifiedName: string;
  type: string;
  file: string;
  line?: number;
  distance: number;
  relationship: string;
  direction: 'incoming' | 'outgoing' | 'both';
}

/**
 * Result of neighborhood exploration
 */
export interface Neighborhood {
  /** Center node of the exploration */
  center: {
    name: string;
    qualifiedName: string;
    type: string;
    file: string;
    line?: number;
    docstring?: string;
  };
  /** All nodes in the neighborhood */
  nodes: NeighborhoodNode[];
  /** Summary statistics */
  summary: {
    totalNodes: number;
    byType: Record<string, number>;
    byRelationship: Record<string, number>;
    byDistance: Record<number, number>;
  };
}

/**
 * Result of impact analysis
 */
export interface ImpactAnalysis {
  /** Target of the analysis */
  target: {
    name: string;
    qualifiedName: string;
    type: string;
    file: string;
  };
  /** Direct callers (depth 1) */
  directCallers: Array<{
    name: string;
    file: string;
    kind: string;
  }>;
  /** Indirect callers (depth 2+) */
  indirectCallers: Array<{
    name: string;
    file: string;
    kind: string;
    depth: number;
  }>;
  /** Classes/interfaces that implement this */
  implementors: string[];
  /** Classes that extend this */
  extenders: string[];
  /** Files that would be affected */
  affectedFiles: string[];
  /** Total number of potentially impacted symbols */
  totalImpact: number;
  /** Risk level based on impact */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** Explanation of the risk */
  riskExplanation: string;
}

/**
 * Result of bridge detection
 */
export interface BridgeResult {
  /** Source symbol */
  source: {
    name: string;
    file: string;
    kind: string;
  };
  /** Target symbol */
  target: {
    name: string;
    file: string;
    kind: string;
  };
  /** Connection paths found */
  connections: Array<{
    path: string[];
    pathDetails: Array<{
      name: string;
      file: string;
      kind: string;
    }>;
    relationshipTypes: string[];
    length: number;
  }>;
  /** Whether a direct connection exists */
  directConnection: boolean;
  /** Human-readable explanation */
  explanation: string;
}

// ========== GraphService Implementation ==========

/**
 * Advanced Graph Query Service
 */
export class GraphService {
  private cache: CacheService;

  constructor(private graph: GraphManager) {
    this.cache = getGlobalCache();
  }

  /**
   * Find the shortest path between two symbols
   */
  async findPath(
    from: string,
    to: string,
    options: {
      maxDepth?: number;
      relationshipTypes?: string[];
    } = {}
  ): Promise<PathResult> {
    const cacheKey = CacheService.key('findPath', from, to, options);

    return this.cache.getOrComputeGraph(cacheKey, async () => {
      return this.findPathImpl(from, to, options);
    });
  }

  /**
   * Internal implementation of findPath (uncached)
   */
  private async findPathImpl(
    from: string,
    to: string,
    options: {
      maxDepth?: number;
      relationshipTypes?: string[];
    } = {}
  ): Promise<PathResult> {
    const maxDepth = options.maxDepth || 10;
    const relTypes = options.relationshipTypes || ['CALLS', 'IMPORTS', 'INHERITS', 'DEFINES'];
    const relPattern = relTypes.join('|');

    try {
      // Try to find shortest path
      const cypher = `
        MATCH (start:Symbol), (end:Symbol)
        WHERE (start.name = $from OR start.qualifiedName = $from)
          AND (end.name = $to OR end.qualifiedName = $to)
        MATCH path = shortestPath((start)-[:${relPattern}*1..${maxDepth}]-(end))
        RETURN
          [node in nodes(path) | node.name] as names,
          [node in nodes(path) | {
            name: node.name,
            qualifiedName: node.qualifiedName,
            file: node.file,
            kind: node.kind,
            startLine: node.startLine
          }] as details,
          [rel in relationships(path) | {
            type: type(rel),
            from: startNode(rel).name,
            to: endNode(rel).name
          }] as edges
        LIMIT 1
      `;

      const results = await this.graph.query(cypher, { from, to });

      if (results.length === 0) {
        return {
          found: false,
          path: [],
          pathDetails: [],
          edges: [],
          length: 0,
          explanation: `No path found between "${from}" and "${to}" within ${maxDepth} hops.`
        };
      }

      const result = results[0];
      const names = result.names as string[];
      const details = result.details as Array<any>;
      const edges = result.edges as PathEdge[];

      return {
        found: true,
        path: names,
        pathDetails: details.map(d => ({
          name: d.name || '',
          file: d.file || '',
          kind: d.kind || 'unknown',
          line: d.startLine
        })),
        edges,
        length: names.length - 1,
        explanation: this.generatePathExplanation(names, edges)
      };

    } catch (error: any) {
      return {
        found: false,
        path: [],
        pathDetails: [],
        edges: [],
        length: 0,
        explanation: `Error finding path: ${error.message}`
      };
    }
  }

  /**
   * Find all paths between two symbols (up to a limit)
   */
  async findAllPaths(
    from: string,
    to: string,
    options: {
      maxDepth?: number;
      maxPaths?: number;
      relationshipTypes?: string[];
    } = {}
  ): Promise<PathResult[]> {
    const cacheKey = CacheService.key('findAllPaths', from, to, options);

    return this.cache.getOrComputeGraph(cacheKey, async () => {
      return this.findAllPathsImpl(from, to, options);
    });
  }

  /**
   * Internal implementation of findAllPaths (uncached)
   */
  private async findAllPathsImpl(
    from: string,
    to: string,
    options: {
      maxDepth?: number;
      maxPaths?: number;
      relationshipTypes?: string[];
    } = {}
  ): Promise<PathResult[]> {
    const maxDepth = options.maxDepth || 6;
    const maxPaths = options.maxPaths || 10;
    const relTypes = options.relationshipTypes || ['CALLS', 'IMPORTS', 'INHERITS'];
    const relPattern = relTypes.join('|');

    try {
      const cypher = `
        MATCH (start:Symbol), (end:Symbol)
        WHERE (start.name = $from OR start.qualifiedName = $from)
          AND (end.name = $to OR end.qualifiedName = $to)
        MATCH path = (start)-[:${relPattern}*1..${maxDepth}]-(end)
        WITH path, length(path) as len
        ORDER BY len
        LIMIT ${maxPaths}
        RETURN
          [node in nodes(path) | node.name] as names,
          [node in nodes(path) | {
            name: node.name,
            file: node.file,
            kind: node.kind,
            startLine: node.startLine
          }] as details,
          [rel in relationships(path) | {
            type: type(rel),
            from: startNode(rel).name,
            to: endNode(rel).name
          }] as edges
      `;

      const results = await this.graph.query(cypher, { from, to });

      return results.map(result => {
        const names = result.names as string[];
        const details = result.details as Array<any>;
        const edges = result.edges as PathEdge[];

        return {
          found: true,
          path: names,
          pathDetails: details.map(d => ({
            name: d.name || '',
            file: d.file || '',
            kind: d.kind || 'unknown',
            line: d.startLine
          })),
          edges,
          length: names.length - 1,
          explanation: this.generatePathExplanation(names, edges)
        };
      });

    } catch (error: any) {
      return [];
    }
  }

  /**
   * Explore the neighborhood of a symbol
   */
  async getNeighborhood(
    symbol: string,
    options: {
      depth?: number;
      maxNodes?: number;
      includeRelationships?: string[];
      direction?: 'incoming' | 'outgoing' | 'both';
    } = {}
  ): Promise<Neighborhood> {
    const cacheKey = CacheService.key('getNeighborhood', symbol, options);

    return this.cache.getOrComputeGraph(cacheKey, async () => {
      return this.getNeighborhoodImpl(symbol, options);
    });
  }

  /**
   * Internal implementation of getNeighborhood (uncached)
   */
  private async getNeighborhoodImpl(
    symbol: string,
    options: {
      depth?: number;
      maxNodes?: number;
      includeRelationships?: string[];
      direction?: 'incoming' | 'outgoing' | 'both';
    } = {}
  ): Promise<Neighborhood> {
    const depth = options.depth || 2;
    const maxNodes = options.maxNodes || 50;
    const relTypes = options.includeRelationships || ['CALLS', 'IMPORTS', 'INHERITS', 'DEFINES'];
    const relPattern = relTypes.join('|');

    // First, get the center node
    const centerResult = await this.graph.query(`
      MATCH (s:Symbol)
      WHERE s.name = $symbol OR s.qualifiedName = $symbol
      RETURN s
      LIMIT 1
    `, { symbol });

    if (centerResult.length === 0) {
      return {
        center: { name: symbol, qualifiedName: symbol, type: 'unknown', file: '' },
        nodes: [],
        summary: { totalNodes: 0, byType: {}, byRelationship: {}, byDistance: {} }
      };
    }

    const center = centerResult[0].s as any;

    // Get neighborhood
    const cypher = `
      MATCH (center:Symbol)
      WHERE center.name = $symbol OR center.qualifiedName = $symbol
      MATCH path = (center)-[r:${relPattern}*1..${depth}]-(neighbor:Symbol)
      WHERE neighbor <> center
      WITH DISTINCT neighbor,
           min(length(path)) as distance,
           head([rel in relationships(path) | type(rel)]) as relType,
           CASE
             WHEN (center)-[]->(neighbor) THEN 'outgoing'
             WHEN (center)<-[]-(neighbor) THEN 'incoming'
             ELSE 'both'
           END as direction
      RETURN neighbor, distance, relType, direction
      ORDER BY distance, neighbor.name
      LIMIT ${maxNodes}
    `;

    const results = await this.graph.query(cypher, { symbol });

    const nodes: NeighborhoodNode[] = results.map(r => {
      const n = r.neighbor as any;
      return {
        name: n.name || '',
        qualifiedName: n.qualifiedName || n.name || '',
        type: n.kind || 'unknown',
        file: n.file || '',
        line: n.startLine,
        distance: r.distance as number,
        relationship: r.relType as string,
        direction: r.direction as 'incoming' | 'outgoing' | 'both'
      };
    });

    // Build summary
    const byType: Record<string, number> = {};
    const byRelationship: Record<string, number> = {};
    const byDistance: Record<number, number> = {};

    for (const node of nodes) {
      byType[node.type] = (byType[node.type] || 0) + 1;
      byRelationship[node.relationship] = (byRelationship[node.relationship] || 0) + 1;
      byDistance[node.distance] = (byDistance[node.distance] || 0) + 1;
    }

    return {
      center: {
        name: center.name || '',
        qualifiedName: center.qualifiedName || center.name || '',
        type: center.kind || 'unknown',
        file: center.file || '',
        line: center.startLine,
        docstring: center.docstring
      },
      nodes,
      summary: {
        totalNodes: nodes.length,
        byType,
        byRelationship,
        byDistance
      }
    };
  }

  /**
   * Analyze the impact of changing a symbol
   */
  async getImpactAnalysis(
    symbol: string,
    options: {
      maxDepth?: number;
      includeIndirect?: boolean;
    } = {}
  ): Promise<ImpactAnalysis> {
    const cacheKey = CacheService.key('getImpactAnalysis', symbol, options);

    return this.cache.getOrComputeGraph(cacheKey, async () => {
      return this.getImpactAnalysisImpl(symbol, options);
    });
  }

  /**
   * Internal implementation of getImpactAnalysis (uncached)
   */
  private async getImpactAnalysisImpl(
    symbol: string,
    options: {
      maxDepth?: number;
      includeIndirect?: boolean;
    } = {}
  ): Promise<ImpactAnalysis> {
    const maxDepth = options.maxDepth || 3;
    const includeIndirect = options.includeIndirect !== false;

    // Get target info
    const targetResult = await this.graph.query(`
      MATCH (s:Symbol)
      WHERE s.name = $symbol OR s.qualifiedName = $symbol
      RETURN s
      LIMIT 1
    `, { symbol });

    if (targetResult.length === 0) {
      return {
        target: { name: symbol, qualifiedName: symbol, type: 'unknown', file: '' },
        directCallers: [],
        indirectCallers: [],
        implementors: [],
        extenders: [],
        affectedFiles: [],
        totalImpact: 0,
        riskLevel: 'low',
        riskExplanation: `Symbol "${symbol}" not found in the codebase.`
      };
    }

    const target = targetResult[0].s as any;

    // Get direct callers
    const directCallersResult = await this.graph.query(`
      MATCH (caller:Symbol)-[:CALLS]->(target:Symbol)
      WHERE target.name = $symbol OR target.qualifiedName = $symbol
      RETURN caller.name as name, caller.file as file, caller.kind as kind
    `, { symbol });

    const directCallers = directCallersResult.map(r => ({
      name: r.name as string,
      file: r.file as string,
      kind: r.kind as string
    }));

    // Get indirect callers (depth 2+)
    let indirectCallers: Array<{ name: string; file: string; kind: string; depth: number }> = [];
    if (includeIndirect && maxDepth > 1) {
      const indirectResult = await this.graph.query(`
        MATCH (caller:Symbol)-[:CALLS*2..${maxDepth}]->(target:Symbol)
        WHERE target.name = $symbol OR target.qualifiedName = $symbol
        WITH caller, min(length((caller)-[:CALLS*]->(target))) as depth
        RETURN DISTINCT caller.name as name, caller.file as file, caller.kind as kind, depth
        LIMIT 50
      `, { symbol });

      indirectCallers = indirectResult.map(r => ({
        name: r.name as string,
        file: r.file as string,
        kind: r.kind as string,
        depth: r.depth as number
      }));
    }

    // Get implementors (for interfaces)
    const implementorsResult = await this.graph.query(`
      MATCH (impl:Symbol)-[:INHERITS]->(target:Symbol)
      WHERE target.name = $symbol OR target.qualifiedName = $symbol
      RETURN impl.name as name
    `, { symbol });

    const implementors = implementorsResult.map(r => r.name as string);

    // Get extenders (for classes)
    const extendersResult = await this.graph.query(`
      MATCH (ext:Symbol)-[:INHERITS {type: 'extends'}]->(target:Symbol)
      WHERE target.name = $symbol OR target.qualifiedName = $symbol
      RETURN ext.name as name
    `, { symbol });

    const extenders = extendersResult.map(r => r.name as string);

    // Get affected files
    const allCallers = [
      ...directCallers.map(c => c.file),
      ...indirectCallers.map(c => c.file)
    ];
    const affectedFiles = [...new Set(allCallers)].filter(f => f);

    // Calculate total impact
    const totalImpact = directCallers.length + indirectCallers.length + implementors.length + extenders.length;

    // Determine risk level
    const riskLevel = this.calculateRiskLevel(totalImpact, directCallers.length, affectedFiles.length);
    const riskExplanation = this.generateRiskExplanation(
      target.name || symbol,
      directCallers.length,
      indirectCallers.length,
      affectedFiles.length,
      riskLevel
    );

    return {
      target: {
        name: target.name || symbol,
        qualifiedName: target.qualifiedName || symbol,
        type: target.kind || 'unknown',
        file: target.file || ''
      },
      directCallers,
      indirectCallers,
      implementors,
      extenders,
      affectedFiles,
      totalImpact,
      riskLevel,
      riskExplanation
    };
  }

  /**
   * Find how two symbols are connected (bridge detection)
   */
  async findBridge(
    source: string,
    target: string,
    options: {
      maxDepth?: number;
      maxPaths?: number;
    } = {}
  ): Promise<BridgeResult> {
    const cacheKey = CacheService.key('findBridge', source, target, options);

    return this.cache.getOrComputeGraph(cacheKey, async () => {
      return this.findBridgeImpl(source, target, options);
    });
  }

  /**
   * Internal implementation of findBridge (uncached)
   */
  private async findBridgeImpl(
    source: string,
    target: string,
    options: {
      maxDepth?: number;
      maxPaths?: number;
    } = {}
  ): Promise<BridgeResult> {
    const maxDepth = options.maxDepth || 6;
    const maxPaths = options.maxPaths || 5;

    // Get source and target info
    const sourceResult = await this.graph.query(`
      MATCH (s:Symbol)
      WHERE s.name = $symbol OR s.qualifiedName = $symbol
      RETURN s
      LIMIT 1
    `, { symbol: source });

    const targetResult = await this.graph.query(`
      MATCH (s:Symbol)
      WHERE s.name = $symbol OR s.qualifiedName = $symbol
      RETURN s
      LIMIT 1
    `, { symbol: target });

    const sourceNode = sourceResult[0]?.s as any || { name: source, file: '', kind: 'unknown' };
    const targetNode = targetResult[0]?.s as any || { name: target, file: '', kind: 'unknown' };

    // Check for direct connection
    const directResult = await this.graph.query(`
      MATCH (s:Symbol)-[r]-(t:Symbol)
      WHERE (s.name = $source OR s.qualifiedName = $source)
        AND (t.name = $target OR t.qualifiedName = $target)
      RETURN type(r) as relType
      LIMIT 1
    `, { source, target });

    const directConnection = directResult.length > 0;

    // Find all connection paths
    const pathsResult = await this.graph.query(`
      MATCH (s:Symbol), (t:Symbol)
      WHERE (s.name = $source OR s.qualifiedName = $source)
        AND (t.name = $target OR t.qualifiedName = $target)
      MATCH path = (s)-[:CALLS|IMPORTS|INHERITS|DEFINES*1..${maxDepth}]-(t)
      WITH path, length(path) as len
      ORDER BY len
      LIMIT ${maxPaths}
      RETURN
        [node in nodes(path) | node.name] as names,
        [node in nodes(path) | {
          name: node.name,
          file: node.file,
          kind: node.kind
        }] as details,
        [rel in relationships(path) | type(rel)] as relTypes
    `, { source, target });

    const connections = pathsResult.map(r => ({
      path: r.names as string[],
      pathDetails: (r.details as Array<any>).map(d => ({
        name: d.name || '',
        file: d.file || '',
        kind: d.kind || 'unknown'
      })),
      relationshipTypes: r.relTypes as string[],
      length: (r.names as string[]).length - 1
    }));

    // Generate explanation
    const explanation = this.generateBridgeExplanation(
      sourceNode.name || source,
      targetNode.name || target,
      directConnection,
      connections
    );

    return {
      source: {
        name: sourceNode.name || source,
        file: sourceNode.file || '',
        kind: sourceNode.kind || 'unknown'
      },
      target: {
        name: targetNode.name || target,
        file: targetNode.file || '',
        kind: targetNode.kind || 'unknown'
      },
      connections,
      directConnection,
      explanation
    };
  }

  /**
   * Get symbols that are most connected (hub analysis)
   */
  async getHubs(
    options: {
      limit?: number;
      minConnections?: number;
    } = {}
  ): Promise<Array<{
    name: string;
    file: string;
    kind: string;
    incomingCount: number;
    outgoingCount: number;
    totalConnections: number;
  }>> {
    const limit = options.limit || 20;
    const minConnections = options.minConnections || 5;

    const results = await this.graph.query(`
      MATCH (s:Symbol)
      OPTIONAL MATCH (s)-[out:CALLS]->()
      OPTIONAL MATCH (s)<-[in:CALLS]-()
      WITH s, count(DISTINCT out) as outgoing, count(DISTINCT in) as incoming
      WHERE outgoing + incoming >= ${minConnections}
      RETURN s.name as name, s.file as file, s.kind as kind,
             incoming as incomingCount, outgoing as outgoingCount,
             incoming + outgoing as totalConnections
      ORDER BY totalConnections DESC
      LIMIT ${limit}
    `);

    return results.map(r => ({
      name: r.name as string,
      file: r.file as string,
      kind: r.kind as string,
      incomingCount: r.incomingCount as number,
      outgoingCount: r.outgoingCount as number,
      totalConnections: r.totalConnections as number
    }));
  }

  // ========== Symbol-Vector Methods ==========

  /**
   * Get vectors for a symbol by looking up in graph then fetching from Qdrant
   * High-level method that bridges graph and vector stores
   *
   * @param qualifiedName - Symbol's qualified name
   * @param vector - VectorManager instance for Qdrant retrieval
   * @returns Symbol with its associated vector payloads
   */
  async getVectorsForSymbol(
    qualifiedName: string,
    vector: VectorManager
  ): Promise<{
    symbol: SymbolNode;
    vectors: Array<{ id: string; payload: CodeChunkPayload }>;
  } | null> {
    // Get symbol with vector IDs from graph
    const result = await this.graph.getSymbolWithVectors(qualifiedName);

    if (!result) {
      return null;
    }

    const { symbol, vectorIds } = result;

    // If no vector IDs, return symbol with empty vectors
    if (vectorIds.length === 0) {
      return { symbol, vectors: [] };
    }

    // Fetch vectors from Qdrant
    const collections = vector.getCollectionNames();
    const vectors: Array<{ id: string; payload: CodeChunkPayload }> = [];

    // Search for each vector ID by payload._id
    for (const vectorId of vectorIds) {
      try {
        // Use semantic search with the symbol name as query and filter by file
        const searchResults = await vector.searchCode(
          symbol.name,
          5,
          { file: symbol.file }
        );

        // Find the matching result
        const match = searchResults.find(r => r.id === vectorId || r.payload?.id === vectorId);
        if (match) {
          vectors.push({
            id: vectorId,
            payload: match.payload
          });
        }
      } catch {
        // Vector not found or search failed - skip
      }
    }

    return { symbol, vectors };
  }

  /**
   * Get all symbols in a file with their vectors
   * Useful for file-level context retrieval
   */
  async getFileSymbolsWithVectors(
    filePath: string,
    vector: VectorManager
  ): Promise<Array<{
    symbol: SymbolNode;
    vectors: Array<{ id: string; payload: CodeChunkPayload }>;
  }>> {
    // Get all symbols in the file
    const symbols = await this.graph.getFileSymbols(filePath);
    const results: Array<{
      symbol: SymbolNode;
      vectors: Array<{ id: string; payload: CodeChunkPayload }>;
    }> = [];

    // Fetch vectors for each symbol
    for (const symbol of symbols) {
      const result = await this.getVectorsForSymbol(symbol.qualifiedName, vector);
      if (result) {
        results.push(result);
      } else {
        results.push({ symbol, vectors: [] });
      }
    }

    return results;
  }

  // ========== Helper Methods ==========

  private generatePathExplanation(path: string[], edges: PathEdge[]): string {
    if (path.length === 0) return 'No path found.';
    if (path.length === 1) return `"${path[0]}" is the same symbol.`;
    if (path.length === 2) {
      const rel = edges[0]?.type || 'connects to';
      return `"${path[0]}" ${rel.toLowerCase()} "${path[1]}" directly.`;
    }

    const steps: string[] = [];
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const relVerb = this.relationshipToVerb(edge.type);
      steps.push(`${edge.from} ${relVerb} ${edge.to}`);
    }

    return `Path (${path.length - 1} steps): ${steps.join(' → ')}`;
  }

  private relationshipToVerb(relationship: string): string {
    const verbs: Record<string, string> = {
      'CALLS': 'calls',
      'IMPORTS': 'imports',
      'INHERITS': 'inherits from',
      'DEFINES': 'defines',
      'MODIFIES': 'modifies',
      'TOUCHES': 'touches'
    };
    return verbs[relationship] || relationship.toLowerCase();
  }

  private calculateRiskLevel(
    totalImpact: number,
    directCallers: number,
    affectedFiles: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    // Critical: High direct usage and many files
    if (directCallers > 20 || affectedFiles > 15) return 'critical';
    // High: Significant usage
    if (directCallers > 10 || affectedFiles > 8 || totalImpact > 30) return 'high';
    // Medium: Some usage
    if (directCallers > 3 || affectedFiles > 3 || totalImpact > 10) return 'medium';
    // Low: Minimal usage
    return 'low';
  }

  private generateRiskExplanation(
    symbolName: string,
    directCallers: number,
    indirectCallers: number,
    affectedFiles: number,
    riskLevel: string
  ): string {
    const parts: string[] = [];

    parts.push(`Changing "${symbolName}" has ${riskLevel} risk.`);

    if (directCallers > 0) {
      parts.push(`${directCallers} function(s) directly call this symbol.`);
    }

    if (indirectCallers > 0) {
      parts.push(`${indirectCallers} additional function(s) indirectly depend on it.`);
    }

    if (affectedFiles > 0) {
      parts.push(`${affectedFiles} file(s) would potentially be affected.`);
    }

    switch (riskLevel) {
      case 'critical':
        parts.push('Consider thorough testing and incremental changes.');
        break;
      case 'high':
        parts.push('Review all callers before making changes.');
        break;
      case 'medium':
        parts.push('Standard testing should be sufficient.');
        break;
      case 'low':
        parts.push('Changes can likely be made safely.');
        break;
    }

    return parts.join(' ');
  }

  private generateBridgeExplanation(
    source: string,
    target: string,
    directConnection: boolean,
    connections: Array<{ path: string[]; relationshipTypes: string[] }>
  ): string {
    if (connections.length === 0) {
      return `No connection found between "${source}" and "${target}".`;
    }

    const parts: string[] = [];

    if (directConnection) {
      parts.push(`"${source}" and "${target}" are directly connected.`);
    } else {
      const shortest = connections[0];
      parts.push(`"${source}" connects to "${target}" through ${shortest.path.length - 2} intermediate symbol(s).`);
    }

    if (connections.length > 1) {
      parts.push(`Found ${connections.length} different connection path(s).`);
    }

    // Describe the shortest path
    const shortest = connections[0];
    if (shortest.path.length > 2) {
      const intermediates = shortest.path.slice(1, -1);
      parts.push(`Shortest path goes through: ${intermediates.join(' → ')}`);
    }

    return parts.join(' ');
  }
}

/**
 * Create a GraphService instance
 */
export function createGraphService(graph: GraphManager): GraphService {
  return new GraphService(graph);
}

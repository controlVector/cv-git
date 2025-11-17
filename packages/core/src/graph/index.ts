/**
 * FalkorDB Graph Manager
 * Manages the knowledge graph using FalkorDB (Redis-based graph database)
 */

import { createClient, RedisClientType } from 'redis';
import {
  FileNode,
  SymbolNode,
  CommitNode,
  ModuleNode,
  GraphError,
  ImportsEdge,
  DefinesEdge,
  CallsEdge,
  InheritsEdge,
  ModifiesEdge,
  TouchesEdge
} from '@cv-git/shared';

interface GraphQueryResult {
  [key: string]: any;
}

export class GraphManager {
  private client: RedisClientType | null = null;
  private graphName: string;
  private connected: boolean = false;

  constructor(private url: string, private database: string = 'cv-git') {
    this.graphName = database;
  }

  /**
   * Connect to FalkorDB (via Redis)
   */
  async connect(): Promise<void> {
    try {
      this.client = createClient({
        url: this.url,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              return new Error('Max reconnection attempts reached');
            }
            return retries * 100;
          }
        }
      });

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
      });

      await this.client.connect();
      this.connected = true;

      // Test connection with GRAPH.QUERY
      await this.ping();

      // Create indexes
      await this.createIndexes();

    } catch (error: any) {
      throw new GraphError(`Failed to connect to FalkorDB: ${error.message}`, error);
    }
  }

  /**
   * Test connection
   */
  async ping(): Promise<boolean> {
    if (!this.client || !this.connected) {
      throw new GraphError('Not connected to FalkorDB');
    }

    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error: any) {
      throw new GraphError(`Ping failed: ${error.message}`, error);
    }
  }

  /**
   * Create indexes for better query performance
   */
  private async createIndexes(): Promise<void> {
    try {
      // File indexes
      await this.safeCreateIndex('File', 'path');
      await this.safeCreateIndex('File', 'language');
      await this.safeCreateIndex('File', 'gitHash');

      // Symbol indexes
      await this.safeCreateIndex('Symbol', 'name');
      await this.safeCreateIndex('Symbol', 'qualifiedName');
      await this.safeCreateIndex('Symbol', 'file');
      await this.safeCreateIndex('Symbol', 'kind');

      // Module indexes
      await this.safeCreateIndex('Module', 'path');
      await this.safeCreateIndex('Module', 'name');

      // Commit indexes
      await this.safeCreateIndex('Commit', 'sha');
      await this.safeCreateIndex('Commit', 'author');
      await this.safeCreateIndex('Commit', 'timestamp');

    } catch (error: any) {
      // Indexes might already exist, log but don't fail
      console.warn('Index creation warning:', error.message);
    }
  }

  /**
   * Safely create index (doesn't fail if exists)
   */
  private async safeCreateIndex(label: string, property: string): Promise<void> {
    try {
      await this.query(`CREATE INDEX FOR (n:${label}) ON (n.${property})`);
    } catch (error: any) {
      // Index might already exist
      if (!error.message.includes('already exists')) {
        throw error;
      }
    }
  }

  /**
   * Execute a Cypher query
   */
  async query(cypher: string, params?: Record<string, any>): Promise<GraphQueryResult[]> {
    if (!this.client || !this.connected) {
      throw new GraphError('Not connected to FalkorDB');
    }

    try {
      // Replace parameters in query (FalkorDB doesn't support parameterized queries the same way as Neo4j)
      let processedQuery = cypher;
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          const placeholder = `$${key}`;
          const escapedValue = this.escapeValue(value);
          processedQuery = processedQuery.replace(new RegExp(`\\${placeholder}`, 'g'), escapedValue);
        }
      }

      // Execute query using GRAPH.QUERY
      const result = await this.client.sendCommand([
        'GRAPH.QUERY',
        this.graphName,
        processedQuery,
        '--compact'
      ]);

      return this.parseQueryResult(result as any);

    } catch (error: any) {
      throw new GraphError(`Query failed: ${error.message}\nQuery: ${cypher}`, error);
    }
  }

  /**
   * Escape value for Cypher query
   */
  private escapeValue(value: any): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "\\'")}'`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map(v => this.escapeValue(v)).join(', ')}]`;
    }
    if (typeof value === 'object') {
      const props = Object.entries(value)
        .map(([k, v]) => `${k}: ${this.escapeValue(v)}`)
        .join(', ');
      return `{${props}}`;
    }
    return String(value);
  }

  /**
   * Parse FalkorDB query result
   */
  private parseQueryResult(result: any): GraphQueryResult[] {
    // FalkorDB returns results in a specific format
    // This is a simplified parser - may need adjustment based on actual FalkorDB response format
    if (!result || !Array.isArray(result)) {
      return [];
    }

    // Result format: [header, data, statistics]
    if (result.length < 2) {
      return [];
    }

    const header = result[0] as string[];
    const rows = result[1] as any[][];

    return rows.map(row => {
      const obj: GraphQueryResult = {};
      header.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }

  /**
   * Create or update a File node
   */
  async upsertFileNode(file: FileNode): Promise<void> {
    const cypher = `
      MERGE (f:File {path: $path})
      SET f.absolutePath = $absolutePath,
          f.language = $language,
          f.lastModified = $lastModified,
          f.size = $size,
          f.gitHash = $gitHash,
          f.linesOfCode = $linesOfCode,
          f.complexity = $complexity,
          f.updatedAt = $updatedAt
      RETURN f
    `;

    await this.query(cypher, {
      path: file.path,
      absolutePath: file.absolutePath,
      language: file.language,
      lastModified: file.lastModified,
      size: file.size,
      gitHash: file.gitHash,
      linesOfCode: file.linesOfCode,
      complexity: file.complexity,
      updatedAt: Date.now()
    });
  }

  /**
   * Create or update a Symbol node
   */
  async upsertSymbolNode(symbol: SymbolNode): Promise<void> {
    const cypher = `
      MERGE (s:Symbol {qualifiedName: $qualifiedName})
      SET s.name = $name,
          s.kind = $kind,
          s.file = $file,
          s.startLine = $startLine,
          s.endLine = $endLine,
          s.signature = $signature,
          s.docstring = $docstring,
          s.returnType = $returnType,
          s.visibility = $visibility,
          s.isAsync = $isAsync,
          s.isStatic = $isStatic,
          s.complexity = $complexity,
          s.vectorId = $vectorId,
          s.updatedAt = $updatedAt
      RETURN s
    `;

    await this.query(cypher, {
      qualifiedName: symbol.qualifiedName,
      name: symbol.name,
      kind: symbol.kind,
      file: symbol.file,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      signature: symbol.signature || '',
      docstring: symbol.docstring || '',
      returnType: symbol.returnType || '',
      visibility: symbol.visibility,
      isAsync: symbol.isAsync,
      isStatic: symbol.isStatic,
      complexity: symbol.complexity,
      vectorId: symbol.vectorId || '',
      updatedAt: Date.now()
    });
  }

  /**
   * Create or update a Module node
   */
  async upsertModuleNode(module: ModuleNode): Promise<void> {
    const cypher = `
      MERGE (m:Module {path: $path})
      SET m.name = $name,
          m.type = $type,
          m.language = $language,
          m.description = $description,
          m.version = $version,
          m.fileCount = $fileCount,
          m.symbolCount = $symbolCount,
          m.updatedAt = $updatedAt
      RETURN m
    `;

    await this.query(cypher, {
      path: module.path,
      name: module.name,
      type: module.type,
      language: module.language,
      description: module.description || '',
      version: module.version || '',
      fileCount: module.fileCount,
      symbolCount: module.symbolCount,
      updatedAt: Date.now()
    });
  }

  /**
   * Create or update a Commit node
   */
  async upsertCommitNode(commit: CommitNode): Promise<void> {
    const cypher = `
      MERGE (c:Commit {sha: $sha})
      SET c.message = $message,
          c.author = $author,
          c.authorEmail = $authorEmail,
          c.committer = $committer,
          c.timestamp = $timestamp,
          c.branch = $branch,
          c.filesChanged = $filesChanged,
          c.insertions = $insertions,
          c.deletions = $deletions,
          c.vectorId = $vectorId,
          c.createdAt = $createdAt
      RETURN c
    `;

    await this.query(cypher, {
      sha: commit.sha,
      message: commit.message,
      author: commit.author,
      authorEmail: commit.authorEmail,
      committer: commit.committer,
      timestamp: commit.timestamp,
      branch: commit.branch,
      filesChanged: commit.filesChanged,
      insertions: commit.insertions,
      deletions: commit.deletions,
      vectorId: commit.vectorId || '',
      createdAt: commit.createdAt
    });
  }

  /**
   * Create IMPORTS relationship
   */
  async createImportsEdge(fromPath: string, toPath: string, edge: ImportsEdge): Promise<void> {
    const cypher = `
      MATCH (from:File {path: $fromPath})
      MATCH (to:File {path: $toPath})
      MERGE (from)-[r:IMPORTS]->(to)
      SET r.line = $line,
          r.importedSymbols = $importedSymbols,
          r.alias = $alias
      RETURN r
    `;

    await this.query(cypher, {
      fromPath,
      toPath,
      line: edge.line,
      importedSymbols: edge.importedSymbols,
      alias: edge.alias || ''
    });
  }

  /**
   * Create DEFINES relationship
   */
  async createDefinesEdge(filePath: string, symbolQualifiedName: string, edge: DefinesEdge): Promise<void> {
    const cypher = `
      MATCH (f:File {path: $filePath})
      MATCH (s:Symbol {qualifiedName: $symbolQualifiedName})
      MERGE (f)-[r:DEFINES]->(s)
      SET r.line = $line
      RETURN r
    `;

    await this.query(cypher, {
      filePath,
      symbolQualifiedName,
      line: edge.line
    });
  }

  /**
   * Create CALLS relationship
   */
  async createCallsEdge(fromSymbol: string, toSymbol: string, edge: CallsEdge): Promise<void> {
    const cypher = `
      MATCH (from:Symbol {qualifiedName: $fromSymbol})
      MATCH (to:Symbol {qualifiedName: $toSymbol})
      MERGE (from)-[r:CALLS]->(to)
      SET r.line = $line,
          r.callCount = $callCount,
          r.isConditional = $isConditional
      RETURN r
    `;

    await this.query(cypher, {
      fromSymbol,
      toSymbol,
      line: edge.line,
      callCount: edge.callCount,
      isConditional: edge.isConditional
    });
  }

  /**
   * Create INHERITS relationship
   */
  async createInheritsEdge(fromSymbol: string, toSymbol: string, edge: InheritsEdge): Promise<void> {
    const cypher = `
      MATCH (from:Symbol {qualifiedName: $fromSymbol})
      MATCH (to:Symbol {qualifiedName: $toSymbol})
      MERGE (from)-[r:INHERITS]->(to)
      SET r.type = $type
      RETURN r
    `;

    await this.query(cypher, {
      fromSymbol,
      toSymbol,
      type: edge.type
    });
  }

  /**
   * Create MODIFIES relationship
   */
  async createModifiesEdge(commitSha: string, filePath: string, edge: ModifiesEdge): Promise<void> {
    const cypher = `
      MATCH (c:Commit {sha: $commitSha})
      MATCH (f:File {path: $filePath})
      MERGE (c)-[r:MODIFIES]->(f)
      SET r.changeType = $changeType,
          r.insertions = $insertions,
          r.deletions = $deletions
      RETURN r
    `;

    await this.query(cypher, {
      commitSha,
      filePath,
      changeType: edge.changeType,
      insertions: edge.insertions,
      deletions: edge.deletions
    });
  }

  /**
   * Create TOUCHES relationship
   */
  async createTouchesEdge(commitSha: string, symbolQualifiedName: string, edge: TouchesEdge): Promise<void> {
    const cypher = `
      MATCH (c:Commit {sha: $commitSha})
      MATCH (s:Symbol {qualifiedName: $symbolQualifiedName})
      MERGE (c)-[r:TOUCHES]->(s)
      SET r.changeType = $changeType,
          r.lineDelta = $lineDelta
      RETURN r
    `;

    await this.query(cypher, {
      commitSha,
      symbolQualifiedName,
      changeType: edge.changeType,
      lineDelta: edge.lineDelta
    });
  }

  /**
   * Get file node by path
   */
  async getFileNode(path: string): Promise<FileNode | null> {
    const result = await this.query('MATCH (f:File {path: $path}) RETURN f', { path });

    if (result.length === 0) {
      return null;
    }

    return result[0].f as FileNode;
  }

  /**
   * Get symbol node by qualified name
   */
  async getSymbolNode(qualifiedName: string): Promise<SymbolNode | null> {
    const result = await this.query(
      'MATCH (s:Symbol {qualifiedName: $qualifiedName}) RETURN s',
      { qualifiedName }
    );

    if (result.length === 0) {
      return null;
    }

    return result[0].s as SymbolNode;
  }

  /**
   * Get all symbols in a file
   */
  async getFileSymbols(filePath: string): Promise<SymbolNode[]> {
    const result = await this.query(
      'MATCH (f:File {path: $filePath})-[:DEFINES]->(s:Symbol) RETURN s',
      { filePath }
    );

    return result.map(r => r.s as SymbolNode);
  }

  /**
   * Get callers of a symbol
   */
  async getCallers(symbolQualifiedName: string): Promise<SymbolNode[]> {
    const result = await this.query(
      'MATCH (caller:Symbol)-[:CALLS]->(s:Symbol {qualifiedName: $symbolQualifiedName}) RETURN caller',
      { symbolQualifiedName }
    );

    return result.map(r => r.caller as SymbolNode);
  }

  /**
   * Get callees of a symbol
   */
  async getCallees(symbolQualifiedName: string): Promise<SymbolNode[]> {
    const result = await this.query(
      'MATCH (s:Symbol {qualifiedName: $symbolQualifiedName})-[:CALLS]->(callee:Symbol) RETURN callee',
      { symbolQualifiedName }
    );

    return result.map(r => r.callee as SymbolNode);
  }

  /**
   * Get file dependencies (imports)
   */
  async getFileDependencies(filePath: string): Promise<string[]> {
    const result = await this.query(
      'MATCH (f:File {path: $filePath})-[:IMPORTS]->(dep:File) RETURN dep.path as path',
      { filePath }
    );

    return result.map(r => r.path as string);
  }

  /**
   * Get files that depend on a file
   */
  async getFileDependents(filePath: string): Promise<string[]> {
    const result = await this.query(
      'MATCH (dependent:File)-[:IMPORTS]->(f:File {path: $filePath}) RETURN dependent.path as path',
      { filePath }
    );

    return result.map(r => r.path as string);
  }

  /**
   * Clear all nodes and relationships
   */
  async clear(): Promise<void> {
    await this.query('MATCH (n) DETACH DELETE n');
  }

  /**
   * Get graph statistics
   */
  async getStats(): Promise<{
    fileCount: number;
    symbolCount: number;
    commitCount: number;
    moduleCount: number;
    relationshipCount: number;
  }> {
    const fileCount = await this.query('MATCH (f:File) RETURN count(f) as count');
    const symbolCount = await this.query('MATCH (s:Symbol) RETURN count(s) as count');
    const commitCount = await this.query('MATCH (c:Commit) RETURN count(c) as count');
    const moduleCount = await this.query('MATCH (m:Module) RETURN count(m) as count');
    const relationshipCount = await this.query('MATCH ()-[r]->() RETURN count(r) as count');

    return {
      fileCount: fileCount[0]?.count || 0,
      symbolCount: symbolCount[0]?.count || 0,
      commitCount: commitCount[0]?.count || 0,
      moduleCount: moduleCount[0]?.count || 0,
      relationshipCount: relationshipCount[0]?.count || 0
    };
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    if (this.client && this.connected) {
      await this.client.quit();
      this.connected = false;
      this.client = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Create a GraphManager instance
 */
export function createGraphManager(url: string, database: string = 'cv-git'): GraphManager {
  return new GraphManager(url, database);
}

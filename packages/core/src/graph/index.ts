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
  DocumentNode,
  DocumentType,
  GraphError,
  ImportsEdge,
  DefinesEdge,
  CallsEdge,
  InheritsEdge,
  ModifiesEdge,
  TouchesEdge
} from '@cv-git/shared';
import { compareVersions } from '../storage/manifest.js';

// Schema version for graph migrations
const GRAPH_SCHEMA_VERSION = '1.0.0';

interface GraphQueryResult {
  [key: string]: any;
}

interface SchemaVersionResult {
  migrated: boolean;
  from?: string;
  to?: string;
}

export class GraphManager {
  private client: RedisClientType | null = null;
  private graphName: string;
  private connected: boolean = false;
  private instanceId: string;

  constructor(private url: string, private database: string = 'cv-git') {
    this.graphName = database;
    this.instanceId = Math.random().toString(36).substring(7);
    if (process.env.CV_DEBUG) {
      console.log(`[GraphManager] Created instance ${this.instanceId}`);
    }
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
        this.connected = false;
      });

      this.client.on('end', () => {
        this.connected = false;
      });

      this.client.on('reconnecting', () => {
        this.connected = false;
      });

      this.client.on('ready', () => {
        this.connected = true;
      });

      await this.client.connect();
      this.connected = true;

      if (process.env.CV_DEBUG) {
        console.log(`[GraphManager ${this.instanceId}] Connected, client exists: ${!!this.client}`);
      }

      // Test connection with GRAPH.QUERY
      await this.ping();

      // Create indexes
      await this.createIndexes();

      // Check and migrate schema if needed
      const schemaResult = await this.ensureSchemaVersion();
      if (schemaResult.migrated) {
        console.log(`Graph schema migrated: ${schemaResult.from} -> ${schemaResult.to}`);
      }

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
   * Enhanced with FalkorDB code-graph-backend patterns
   */
  private async createIndexes(): Promise<void> {
    try {
      // File indexes (FalkorDB pattern)
      await this.safeCreateIndex('File', 'path');
      await this.safeCreateIndex('File', 'name');
      await this.safeCreateIndex('File', 'ext');
      await this.safeCreateIndex('File', 'language');
      await this.safeCreateIndex('File', 'gitHash');

      // Symbol indexes (keep our generic Symbol for backwards compatibility)
      await this.safeCreateIndex('Symbol', 'name');
      await this.safeCreateIndex('Symbol', 'qualifiedName');
      await this.safeCreateIndex('Symbol', 'file');
      await this.safeCreateIndex('Symbol', 'kind');

      // Specific node type indexes (FalkorDB pattern)
      await this.safeCreateIndex('Function', 'name');
      await this.safeCreateIndex('Function', 'qualifiedName');
      await this.safeCreateIndex('Class', 'name');
      await this.safeCreateIndex('Class', 'qualifiedName');
      await this.safeCreateIndex('Interface', 'name');
      await this.safeCreateIndex('Struct', 'name');

      // Full-text search index for Searchable entities (FalkorDB pattern)
      await this.createFullTextIndex('Searchable', 'name');

      // Module indexes
      await this.safeCreateIndex('Module', 'path');
      await this.safeCreateIndex('Module', 'name');

      // Commit indexes
      await this.safeCreateIndex('Commit', 'sha');
      await this.safeCreateIndex('Commit', 'author');
      await this.safeCreateIndex('Commit', 'timestamp');

      // Document indexes (for markdown knowledge graph)
      await this.safeCreateIndex('Document', 'path');
      await this.safeCreateIndex('Document', 'type');
      await this.safeCreateIndex('Document', 'status');
      await this.safeCreateIndex('Document', 'title');

    } catch (error: any) {
      // Only log unexpected errors (not "already indexed" which is handled by safeCreateIndex)
      if (!error.message.includes('already indexed') && !error.message.includes('already exists')) {
        console.warn('Index creation warning:', error.message);
      }
    }
  }

  /**
   * Create full-text search index (FalkorDB pattern)
   */
  private async createFullTextIndex(label: string, property: string): Promise<void> {
    try {
      // FalkorDB full-text index syntax
      await this.query(`CALL db.idx.fulltext.createNodeIndex('${label.toLowerCase()}', '${label}', '${property}')`);
    } catch (error: any) {
      // Index might already exist
      if (!error.message.includes('already exists') && !error.message.includes('Index')) {
        console.warn(`Full-text index creation warning for ${label}:`, error.message);
      }
    }
  }

  // ========== Schema Version Management ==========

  /**
   * Get current schema version from graph metadata
   */
  async getSchemaVersion(): Promise<string | null> {
    try {
      const result = await this.query(
        "MATCH (m:_Meta {key: 'schema_version'}) RETURN m.version as version"
      );
      return result[0]?.version || null;
    } catch {
      return null;
    }
  }

  /**
   * Set schema version in graph metadata
   */
  async setSchemaVersion(version: string): Promise<void> {
    await this.query(`
      MERGE (m:_Meta {key: 'schema_version'})
      SET m.version = $version, m.updatedAt = $updatedAt
    `, { version, updatedAt: Date.now() });
  }

  /**
   * Check and migrate schema if needed
   */
  async ensureSchemaVersion(): Promise<SchemaVersionResult> {
    const currentVersion = await this.getSchemaVersion();

    if (!currentVersion) {
      // New graph or pre-versioned graph - set version
      await this.setSchemaVersion(GRAPH_SCHEMA_VERSION);
      return { migrated: false };
    }

    if (compareVersions(currentVersion, GRAPH_SCHEMA_VERSION) < 0) {
      // Need migration
      await this.migrateSchema(currentVersion, GRAPH_SCHEMA_VERSION);
      return { migrated: true, from: currentVersion, to: GRAPH_SCHEMA_VERSION };
    }

    return { migrated: false };
  }

  /**
   * Migrate graph schema between versions
   * Preserves existing data while updating schema
   */
  private async migrateSchema(fromVersion: string, toVersion: string): Promise<void> {
    console.log(`Migrating graph schema from ${fromVersion} to ${toVersion}`);

    // Migration: Add Searchable label to existing Symbol nodes (pre-1.0.0)
    if (compareVersions(fromVersion, '1.0.0') < 0) {
      console.log('  Adding Searchable labels to Symbol nodes...');

      try {
        // Add Searchable label to all Symbol nodes that don't have it
        await this.query(`
          MATCH (s:Symbol)
          WHERE NOT s:Searchable
          SET s:Searchable
        `);
      } catch (error: any) {
        console.warn('  Warning adding Searchable labels:', error.message);
      }

      // Add specific type labels (Function, Class, etc.) to symbols
      const kindLabelMap = [
        { kind: 'function', label: 'Function' },
        { kind: 'method', label: 'Function' },
        { kind: 'class', label: 'Class' },
        { kind: 'interface', label: 'Interface' },
        { kind: 'struct', label: 'Struct' },
        { kind: 'enum', label: 'Enum' }
      ];

      for (const { kind, label } of kindLabelMap) {
        try {
          await this.query(`
            MATCH (s:Symbol {kind: $kind})
            WHERE NOT s:${label}
            SET s:${label}
          `, { kind });
        } catch (error: any) {
          console.warn(`  Warning adding ${label} labels:`, error.message);
        }
      }
    }

    // Future migrations would go here:
    // if (compareVersions(fromVersion, '1.1.0') < 0) { ... }

    await this.setSchemaVersion(toVersion);
    console.log(`  Schema migration complete.`);
  }

  /**
   * Safely create index (doesn't fail if exists)
   */
  private async safeCreateIndex(label: string, property: string): Promise<void> {
    try {
      await this.query(`CREATE INDEX FOR (n:${label}) ON (n.${property})`);
    } catch (error: any) {
      // Index might already exist - FalkorDB uses "already indexed"
      if (!error.message.includes('already exists') && !error.message.includes('already indexed')) {
        throw error;
      }
    }
  }

  /**
   * Execute a Cypher query
   */
  async query(cypher: string, params?: Record<string, any>): Promise<GraphQueryResult[]> {
    if (!this.client || !this.connected) {
      const state = {
        instanceId: this.instanceId,
        hasClient: !!this.client,
        connected: this.connected,
        clientReady: this.client?.isReady,
      };
      throw new GraphError(`Not connected to FalkorDB (state: ${JSON.stringify(state)})`);
    }

    try {
      // Replace parameters in query (FalkorDB doesn't support parameterized queries the same way as Neo4j)
      let processedQuery = cypher;
      if (params) {
        // Sort keys by length (longest first) to avoid prefix conflicts
        // e.g., $authorEmail should be replaced before $author
        const sortedKeys = Object.keys(params).sort((a, b) => b.length - a.length);

        for (const key of sortedKeys) {
          const value = params[key];
          const placeholder = `$${key}`;
          const escapedValue = this.escapeValue(value);
          // Use split/join for reliable replacement (avoids regex special chars issues)
          processedQuery = processedQuery.split(placeholder).join(escapedValue);
        }
      }

      // Debug logging when CV_DEBUG is set
      if (process.env.CV_DEBUG === '1') {
        console.log('[GraphManager] Processed query:', processedQuery.substring(0, 500));
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
      // Include more context in error for debugging
      const errorQuery = process.env.CV_DEBUG === '1' ? cypher : cypher.substring(0, 200);
      throw new GraphError(`Query failed: ${error.message}\nQuery: ${errorQuery}`, error);
    }
  }

  /**
   * Escape value for Cypher query
   * FalkorDB requires proper escaping of special characters in strings
   */
  private escapeValue(value: any): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'string') {
      // Escape backslashes first, then other special characters
      const escaped = value
        .replace(/\\/g, '\\\\')     // Backslashes
        .replace(/'/g, "\\'")       // Single quotes
        .replace(/\n/g, '\\n')      // Newlines
        .replace(/\r/g, '\\r')      // Carriage returns
        .replace(/\t/g, '\\t');     // Tabs
      return `'${escaped}'`;
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
   * Format: [headers, rows, statistics]
   * - headers: [[type, name], [type, name], ...]
   * - rows: [[[type, value], [type, value], ...], ...]
   * - statistics: [string, string, ...]
   */
  private parseQueryResult(result: any): GraphQueryResult[] {
    if (!result || !Array.isArray(result)) {
      return [];
    }

    // Need at least headers and rows
    if (result.length < 2) {
      return [];
    }

    const headerPairs = result[0];
    const rowArrays = result[1];

    if (!Array.isArray(headerPairs) || !Array.isArray(rowArrays)) {
      return [];
    }

    // Extract column names from header pairs: [[type, name], [type, name], ...]
    const headers: string[] = headerPairs.map((pair: any[]) => pair[1]);

    // Parse each row
    const parsed: GraphQueryResult[] = rowArrays.map((row: any[]) => {
      const obj: GraphQueryResult = {};

      // Each row is an array of [type, value] pairs
      row.forEach((pair: any[], idx: number) => {
        if (idx < headers.length) {
          obj[headers[idx]] = pair[1]; // pair[0] is type, pair[1] is value
        }
      });

      return obj;
    });

    return parsed;
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
   * Enhanced with FalkorDB patterns - creates specific node types with Searchable mixin
   */
  async upsertSymbolNode(symbol: SymbolNode): Promise<void> {
    // Determine specific label based on kind (FalkorDB pattern)
    const specificLabel = this.getSpecificLabel(symbol.kind);

    // Use both generic Symbol and specific label (e.g., :Symbol:Function:Searchable)
    // This gives us backwards compatibility + FalkorDB pattern benefits
    const labels = `Symbol:${specificLabel}:Searchable`;

    const cypher = `
      MERGE (s:${labels} {qualifiedName: $qualifiedName})
      SET s.name = $name,
          s.kind = $kind,
          s.file = $file,
          s.startLine = $startLine,
          s.endLine = $endLine,
          s.signature = $signature,
          s.docstring = $docstring,
          s.doc = $docstring,
          s.returnType = $returnType,
          s.visibility = $visibility,
          s.isAsync = $isAsync,
          s.isStatic = $isStatic,
          s.complexity = $complexity,
          s.vectorId = $vectorId,
          s.src_start = $startLine,
          s.src_end = $endLine,
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
   * Get specific label for symbol kind (FalkorDB pattern)
   */
  private getSpecificLabel(kind: string): string {
    // Note: Avoid reserved keywords in FalkorDB
    // 'Variable' is reserved, so we use 'Var' instead
    const labelMap: Record<string, string> = {
      'function': 'Function',
      'method': 'Function',  // Methods are functions
      'class': 'Class',
      'interface': 'Interface',
      'type': 'TypeDef',     // 'Type' might be reserved
      'struct': 'Struct',
      'enum': 'Enum',
      'constant': 'Const',
      'variable': 'Var'      // 'Variable' is reserved
    };

    return labelMap[kind] || 'CodeSymbol';  // 'Symbol' might also conflict
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

  // ========== Document Node Methods (Markdown Knowledge Graph) ==========

  /**
   * Create or update a Document node
   * Used for indexing markdown documentation into the knowledge graph
   */
  async upsertDocumentNode(doc: DocumentNode): Promise<void> {
    const cypher = `
      MERGE (d:Document:Searchable {path: $path})
      SET d.absolutePath = $absolutePath,
          d.title = $title,
          d.type = $type,
          d.status = $status,
          d.wordCount = $wordCount,
          d.gitHash = $gitHash,
          d.lastModified = $lastModified,
          d.tags = $tags,
          d.priority = $priority,
          d.author = $author,
          d.createdAt = $createdAt,
          d.updatedAt = $updatedAt
      RETURN d
    `;

    await this.query(cypher, {
      path: doc.path,
      absolutePath: doc.absolutePath,
      title: doc.title,
      type: doc.type,
      status: doc.status,
      wordCount: doc.wordCount,
      gitHash: doc.gitHash,
      lastModified: doc.lastModified,
      tags: doc.frontmatter.tags || [],
      priority: doc.frontmatter.priority || '',
      author: doc.frontmatter.author || '',
      createdAt: doc.createdAt,
      updatedAt: Date.now()
    });
  }

  /**
   * Create DESCRIBES relationship (Document -> Code/Symbol)
   * Links documentation to the code it describes
   */
  async createDescribesEdge(
    docPath: string,
    targetPath: string,
    properties?: { section?: string; line?: number }
  ): Promise<void> {
    // First try to find a file, then try a symbol
    const fileQuery = `
      MATCH (d:Document {path: $docPath})
      MATCH (f:File {path: $targetPath})
      MERGE (d)-[r:DESCRIBES]->(f)
      SET r.section = $section, r.line = $line
      RETURN r
    `;

    try {
      await this.query(fileQuery, {
        docPath,
        targetPath,
        section: properties?.section || '',
        line: properties?.line || 0
      });
    } catch {
      // If file not found, try symbol
      const symbolQuery = `
        MATCH (d:Document {path: $docPath})
        MATCH (s:Symbol {qualifiedName: $targetPath})
        MERGE (d)-[r:DESCRIBES]->(s)
        SET r.section = $section, r.line = $line
        RETURN r
      `;

      try {
        await this.query(symbolQuery, {
          docPath,
          targetPath,
          section: properties?.section || '',
          line: properties?.line || 0
        });
      } catch {
        // Target doesn't exist yet - silently skip
      }
    }
  }

  /**
   * Create REFERENCES_DOC relationship (Document -> Document)
   * Links documentation that references other documentation
   */
  async createReferencesDocEdge(
    fromPath: string,
    toPath: string,
    properties?: { anchor?: string }
  ): Promise<void> {
    const cypher = `
      MATCH (from:Document {path: $fromPath})
      MATCH (to:Document {path: $toPath})
      MERGE (from)-[r:REFERENCES_DOC]->(to)
      SET r.anchor = $anchor
      RETURN r
    `;

    try {
      await this.query(cypher, {
        fromPath,
        toPath,
        anchor: properties?.anchor || ''
      });
    } catch {
      // Target document doesn't exist yet - silently skip
    }
  }

  /**
   * Create SUPERSEDES relationship (ADR -> ADR)
   * Links newer architecture decision records to ones they supersede
   */
  async createSupersedesEdge(
    newDocPath: string,
    oldDocPath: string
  ): Promise<void> {
    const cypher = `
      MATCH (newDoc:Document {path: $newDocPath})
      MATCH (oldDoc:Document {path: $oldDocPath})
      MERGE (newDoc)-[r:SUPERSEDES]->(oldDoc)
      RETURN r
    `;

    try {
      await this.query(cypher, { newDocPath, oldDocPath });
    } catch {
      // Target document doesn't exist - silently skip
    }
  }

  /**
   * Get document node by path
   */
  async getDocumentNode(path: string): Promise<DocumentNode | null> {
    const result = await this.query('MATCH (d:Document {path: $path}) RETURN d', { path });

    if (result.length === 0) {
      return null;
    }

    return result[0].d as DocumentNode;
  }

  /**
   * Get all documents describing a file or symbol
   */
  async getDocumentsFor(targetPath: string): Promise<DocumentNode[]> {
    const cypher = `
      MATCH (d:Document)-[:DESCRIBES]->(target)
      WHERE target.path = $targetPath OR target.qualifiedName = $targetPath
      RETURN d
    `;

    const result = await this.query(cypher, { targetPath });
    return result.map(r => r.d as DocumentNode);
  }

  /**
   * Get all documents by type
   */
  async getDocumentsByType(type: DocumentType): Promise<DocumentNode[]> {
    const result = await this.query(
      'MATCH (d:Document {type: $type}) RETURN d ORDER BY d.path',
      { type }
    );

    return result.map(r => r.d as DocumentNode);
  }

  /**
   * Get all documents with a specific tag
   */
  async getDocumentsByTag(tag: string): Promise<DocumentNode[]> {
    const cypher = `
      MATCH (d:Document)
      WHERE $tag IN d.tags
      RETURN d
      ORDER BY d.path
    `;

    const result = await this.query(cypher, { tag });
    return result.map(r => r.d as DocumentNode);
  }

  /**
   * Get documents related to a document (via REFERENCES_DOC)
   */
  async getRelatedDocuments(docPath: string): Promise<DocumentNode[]> {
    const cypher = `
      MATCH (d:Document {path: $docPath})-[:REFERENCES_DOC]->(related:Document)
      RETURN related
    `;

    const result = await this.query(cypher, { docPath });
    return result.map(r => r.related as DocumentNode);
  }

  /**
   * Delete a file node and its relationships (including defined symbols)
   */
  async deleteFileNode(path: string): Promise<void> {
    // Delete symbols defined in this file first
    await this.query(
      'MATCH (f:File {path: $path})-[:DEFINES]->(s:Symbol) DETACH DELETE s',
      { path }
    );
    // Delete the file node
    await this.query('MATCH (f:File {path: $path}) DETACH DELETE f', { path });
  }

  /**
   * Delete a document node and its relationships
   */
  async deleteDocumentNode(path: string): Promise<void> {
    await this.query('MATCH (d:Document {path: $path}) DETACH DELETE d', { path });
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
   * Enhanced with FalkorDB pattern for detailed breakdown
   */
  async getStats(): Promise<{
    fileCount: number;
    symbolCount: number;
    functionCount: number;
    classCount: number;
    commitCount: number;
    moduleCount: number;
    documentCount: number;
    relationshipCount: number;
    nodesByLabel?: Record<string, number>;
    relationshipsByType?: Record<string, number>;
  }> {
    const fileCount = await this.query('MATCH (f:File) RETURN count(f) as count');
    const symbolCount = await this.query('MATCH (s:Symbol) RETURN count(s) as count');
    const functionCount = await this.query('MATCH (f:Function) RETURN count(f) as count');
    const classCount = await this.query('MATCH (c:Class) RETURN count(c) as count');
    const commitCount = await this.query('MATCH (c:Commit) RETURN count(c) as count');
    const moduleCount = await this.query('MATCH (m:Module) RETURN count(m) as count');
    const documentCount = await this.query('MATCH (d:Document) RETURN count(d) as count');
    const relationshipCount = await this.query('MATCH ()-[r]->() RETURN count(r) as count');

    // FalkorDB pattern: Get detailed breakdown
    const nodesByLabel = await this.query('MATCH (n) RETURN labels(n) as label, count(n) as count');
    const relationshipsByType = await this.query('MATCH ()-[r]->() RETURN type(r) as type, count(r) as count');

    return {
      fileCount: fileCount[0]?.count || 0,
      symbolCount: symbolCount[0]?.count || 0,
      functionCount: functionCount[0]?.count || 0,
      classCount: classCount[0]?.count || 0,
      commitCount: commitCount[0]?.count || 0,
      moduleCount: moduleCount[0]?.count || 0,
      documentCount: documentCount[0]?.count || 0,
      relationshipCount: relationshipCount[0]?.count || 0,
      nodesByLabel: this.parseBreakdown(nodesByLabel, 'label'),
      relationshipsByType: this.parseBreakdown(relationshipsByType, 'type')
    };
  }

  /**
   * Parse breakdown results into a record
   */
  private parseBreakdown(results: GraphQueryResult[], key: string): Record<string, number> {
    const breakdown: Record<string, number> = {};
    for (const result of results) {
      const label = Array.isArray(result[key]) ? result[key][0] : result[key];
      if (label) {
        breakdown[label] = result.count || 0;
      }
    }
    return breakdown;
  }

  /**
   * Find all call paths between two functions (FalkorDB pattern)
   * @param fromFunction - Source function name or qualified name
   * @param toFunction - Target function name or qualified name
   * @param maxDepth - Maximum path length (default: 10)
   * @returns Array of paths, where each path is an array of function names
   */
  async findCallPaths(fromFunction: string, toFunction: string, maxDepth: number = 10): Promise<string[][]> {
    const cypher = `
      MATCH p = (f1:Function)-[:CALLS*1..${maxDepth}]->(f2:Function)
      WHERE f1.name = $fromFunction OR f1.qualifiedName = $fromFunction
        AND f2.name = $toFunction OR f2.qualifiedName = $toFunction
      RETURN [node in nodes(p) | node.name] as path
      LIMIT 100
    `;

    const results = await this.query(cypher, { fromFunction, toFunction });
    return results.map(r => r.path as string[]);
  }

  /**
   * Find unreachable/dead code (FalkorDB pattern)
   * Functions that are never called by any other function
   * @returns Array of unused function symbols
   */
  async findDeadCode(): Promise<SymbolNode[]> {
    const cypher = `
      MATCH (f:Function)
      WHERE NOT ()-[:CALLS]->(f)
        AND NOT f.name IN ['main', 'init', '__init__', 'constructor']
      RETURN f
      LIMIT 100
    `;

    const results = await this.query(cypher);
    return results.map(r => r.f as SymbolNode);
  }

  /**
   * Full-text search for entities (FalkorDB pattern)
   * Searches across all Searchable entities (Functions, Classes, etc.)
   * @param searchText - Text to search for (prefix matching)
   * @param limit - Maximum results to return
   * @returns Array of matching symbols
   */
  async searchEntities(searchText: string, limit: number = 10): Promise<SymbolNode[]> {
    try {
      // Try full-text search first (FalkorDB pattern)
      const cypher = `
        CALL db.idx.fulltext.queryNodes('searchable', $searchText)
        YIELD node
        RETURN node
        LIMIT $limit
      `;

      const results = await this.query(cypher, { searchText, limit });
      return results.map(r => r.node as SymbolNode);
    } catch (error) {
      // Fallback to regular pattern matching if full-text index not available
      const cypher = `
        MATCH (s:Searchable)
        WHERE s.name CONTAINS $searchText
        RETURN s
        LIMIT $limit
      `;

      const results = await this.query(cypher, { searchText, limit });
      return results.map(r => r.s as SymbolNode);
    }
  }

  /**
   * Find functions with high cyclomatic complexity (FalkorDB pattern)
   * @param threshold - Minimum complexity score
   * @returns Array of complex functions
   */
  async findComplexFunctions(threshold: number = 10): Promise<SymbolNode[]> {
    const cypher = `
      MATCH (f:Function)
      WHERE f.complexity >= $threshold
      RETURN f
      ORDER BY f.complexity DESC
      LIMIT 50
    `;

    const results = await this.query(cypher, { threshold });
    return results.map(r => r.f as SymbolNode);
  }

  /**
   * Find functions with most callers (hot spots)
   * @param limit - Number of hot spots to return
   * @returns Array of tuples: [function, caller_count]
   */
  async findHotSpots(limit: number = 20): Promise<Array<{ function: SymbolNode; callerCount: number }>> {
    const cypher = `
      MATCH (f:Function)
      OPTIONAL MATCH (caller)-[:CALLS]->(f)
      WITH f, count(caller) as callerCount
      WHERE callerCount > 0
      RETURN f as function, callerCount
      ORDER BY callerCount DESC
      LIMIT $limit
    `;

    const results = await this.query(cypher, { limit });
    return results.map(r => ({
      function: r.function as SymbolNode,
      callerCount: r.callerCount as number
    }));
  }

  /**
   * Detect circular dependencies (FalkorDB pattern)
   * Find cycles in the call graph
   * @param maxDepth - Maximum cycle length to detect
   * @returns Array of cycles
   */
  async findCircularDependencies(maxDepth: number = 5): Promise<string[][]> {
    const cypher = `
      MATCH p = (f:Function)-[:CALLS*2..${maxDepth}]->(f)
      RETURN [node in nodes(p) | node.name] as cycle
      LIMIT 50
    `;

    const results = await this.query(cypher);
    return results.map(r => r.cycle as string[]);
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    if (this.client && this.connected) {
      if (process.env.CV_DEBUG) {
        console.log(`[GraphManager] close() called - stack:`, new Error().stack);
      }
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

  /**
   * Get instance ID for debugging
   */
  getInstanceId(): string {
    return this.instanceId;
  }
}

/**
 * Create a GraphManager instance
 */
export function createGraphManager(url: string, database: string = 'cv-git'): GraphManager {
  return new GraphManager(url, database);
}

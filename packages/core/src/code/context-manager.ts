/**
 * CV Code - Context Manager
 *
 * Smart context management using vector search and graph relationships
 *
 * Key differentiator from Aider:
 * - Uses semantic search instead of sending entire files
 * - Uses graph relationships to include relevant callers/callees
 * - Dynamically adjusts context based on token budget
 * - Localizes context when budget exceeded via graph traversal + centrality
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { VectorManager } from '../vector/index.js';
import { GraphManager } from '../graph/index.js';
import {
  ActiveContext,
  ContextSnapshot,
  FileContext,
  SymbolContext,
  Relationship,
  ContextOptions,
} from './types.js';

// Rough token estimation: ~4 chars per token
const CHARS_PER_TOKEN = 4;

/**
 * Manages context building with smart prioritization
 */
export class ContextManager {
  private tokenLimit: number;

  constructor(
    private vector: VectorManager | null,
    private graph: GraphManager | null,
    private repoRoot: string,
    tokenLimit: number = 100000
  ) {
    this.tokenLimit = tokenLimit;

    // Debug: Check graph state when stored in ContextManager
    if (process.env.CV_DEBUG && graph) {
      console.log(`[ContextManager] Received graph instance ${graph.getInstanceId()}: connected=${graph.isConnected()}`);
    }
  }

  /**
   * Build context for a user message
   *
   * Strategy:
   * 1. Include explicit files (highest priority)
   * 2. Vector search for semantically relevant chunks
   * 3. Graph traversal for callers/callees/dependencies
   * 4. Token budget enforcement with smart localization
   */
  async buildContext(
    query: string,
    activeContext: ActiveContext,
    options: ContextOptions = {}
  ): Promise<ContextSnapshot> {
    const snapshot: ContextSnapshot = {
      files: [],
      symbols: [],
      relationships: [],
      tokenCount: 0,
    };

    // 1. Load explicit files (highest priority, always included)
    for (const filePath of activeContext.explicitFiles) {
      try {
        const fileContext = await this.loadFile(filePath, 'explicit');
        snapshot.files.push(fileContext);
      } catch {
        // File not found, skip
      }
    }

    // 2. Vector search for relevant code chunks
    if (this.vector) {
      if (process.env.CV_DEBUG) {
        console.log(`[ContextManager] Starting vector search for: "${query.slice(0, 50)}..."`);
      }
      try {
        const maxChunks = options.maxChunks || 10;
        const minScore = options.minScore || 0.2; // Lower threshold for better recall on general queries

        const vectorResults = await this.vector.searchCode(query, maxChunks, {
          minScore,
        });

        if (process.env.CV_DEBUG) {
          console.log(`[ContextManager] Vector search returned ${vectorResults.length} results`);
          if (vectorResults.length > 0) {
            console.log(`[ContextManager] Top result: score=${vectorResults[0].score.toFixed(3)}, file=${vectorResults[0].payload?.file}`);
          }
        }

        for (const result of vectorResults) {
          const symbolContext: SymbolContext = {
            name: result.payload.symbolName || 'chunk',
            qualifiedName:
              result.payload.symbolName ||
              `${result.payload.file}:${result.payload.startLine}`,
            file: result.payload.file,
            kind: result.payload.symbolKind || 'function',
            code: result.payload.text,
            startLine: result.payload.startLine,
            endLine: result.payload.endLine,
            docstring: result.payload.docstring,
            relevanceScore: result.score,
          };

          // Avoid duplicates
          if (
            !snapshot.symbols.some(
              (s) => s.qualifiedName === symbolContext.qualifiedName
            )
          ) {
            snapshot.symbols.push(symbolContext);
          }
        }
      } catch (error: any) {
        // Vector search failed, continue without it
        if (process.env.CV_DEBUG) {
          console.error(`[ContextManager] Vector search failed: ${error.message}`);
        }
      }
    }

    // 3. Graph-based search (supplement vector search or use as fallback)
    if (this.graph) {
      if (process.env.CV_DEBUG) {
        console.log(`[ContextManager] Starting graph search, graph connected: ${this.graph.isConnected()}`);
      }
      await this.searchGraphForContext(snapshot, query, options);
      if (process.env.CV_DEBUG) {
        console.log(`[ContextManager] After graph search: ${snapshot.symbols.length} symbols, ${snapshot.files.length} files`);
      }
    }

    // 4. Graph traversal for relationships
    if (this.graph && this.graph.isConnected() && snapshot.symbols.length > 0) {
      await this.enrichWithGraphContext(snapshot, options);
    }

    // 5. Fallback: if no context found, load key project files
    if (snapshot.symbols.length === 0 && snapshot.files.length === 0) {
      if (process.env.CV_DEBUG) {
        console.log(`[ContextManager] No context found, loading key project files as fallback`);
      }
      await this.loadKeyProjectFiles(snapshot);
    }

    // 6. Calculate token count
    snapshot.tokenCount = this.estimateTokens(snapshot);

    // 7. Localize if over budget
    if (snapshot.tokenCount > this.tokenLimit) {
      return this.localizeContext(snapshot, query);
    }

    return snapshot;
  }

  /**
   * Load a file as context using relative path
   */
  private async loadFile(
    relativePath: string,
    source: FileContext['source']
  ): Promise<FileContext> {
    const fullPath = path.join(this.repoRoot, relativePath);
    const content = await fs.readFile(fullPath, 'utf-8');

    return {
      path: relativePath,
      content,
      relevanceScore: source === 'explicit' ? 1.0 : 0.5,
      source,
    };
  }

  /**
   * Load a file using absolute path (for workspace mode)
   * Derives the workspace-relative path from the absolute path
   */
  private async loadFileAbsolute(
    absolutePath: string,
    relativePath: string,
    source: FileContext['source']
  ): Promise<FileContext> {
    const content = await fs.readFile(absolutePath, 'utf-8');

    // Derive workspace-relative path from absolute path
    // e.g., /home/user/workspace/RepoA/src/file.js -> RepoA/src/file.js
    let workspaceRelativePath = relativePath;
    if (absolutePath.startsWith(this.repoRoot)) {
      workspaceRelativePath = absolutePath.slice(this.repoRoot.length + 1); // +1 for trailing slash
    }

    return {
      path: workspaceRelativePath,
      content,
      relevanceScore: source === 'explicit' ? 1.0 : 0.5,
      source,
    };
  }

  /**
   * Enrich snapshot with graph relationships
   */
  private async enrichWithGraphContext(
    snapshot: ContextSnapshot,
    options: ContextOptions
  ): Promise<void> {
    if (!this.graph || !this.graph.isConnected()) return;

    const maxDepth = options.maxDepth || 2;
    const symbolNames = snapshot.symbols
      .filter((s) => s.name && s.name !== 'chunk')
      .map((s) => s.qualifiedName || s.name)
      .slice(0, 5); // Limit to top 5 symbols

    for (const symbolName of symbolNames) {
      try {
        // Get callers
        const callers = await this.graph.getCallers(symbolName);
        for (const caller of callers.slice(0, 3)) {
          snapshot.relationships.push({
            from: caller.qualifiedName || caller.name,
            to: symbolName,
            type: 'calls',
          });

          // Add caller to context if within budget
          if (this.estimateTokens(snapshot) < this.tokenLimit * 0.8) {
            const callerContext = this.symbolNodeToContext(caller, 0.4);
            if (
              !snapshot.symbols.some(
                (s) => s.qualifiedName === callerContext.qualifiedName
              )
            ) {
              snapshot.symbols.push(callerContext);
            }
          }
        }

        // Get callees
        const callees = await this.graph.getCallees(symbolName);
        for (const callee of callees.slice(0, 3)) {
          snapshot.relationships.push({
            from: symbolName,
            to: callee.qualifiedName || callee.name,
            type: 'calls',
          });
        }
      } catch {
        // Graph query failed for this symbol, continue
      }
    }
  }

  /**
   * Search graph for relevant files and symbols based on query keywords
   * This supplements or acts as fallback for vector search
   */
  private async searchGraphForContext(
    snapshot: ContextSnapshot,
    query: string,
    options: ContextOptions
  ): Promise<void> {
    // Check if graph is available and connected
    if (!this.graph) return;
    if (!this.graph.isConnected()) {
      if (process.env.CV_DEBUG) {
        console.log(`[ContextManager] Graph not connected, skipping graph search`);
      }
      return;
    }

    // Extract keywords from query (simple tokenization)
    const keywords = this.extractKeywords(query);
    if (keywords.length === 0) return;

    // Limit graph search if we already have good vector results
    const maxGraphResults = snapshot.symbols.length >= 5 ? 5 : 15;

    try {
      // Debug: log keywords being searched and graph state
      if (process.env.CV_DEBUG) {
        console.log(`[ContextManager] this.graph exists: ${!!this.graph}, instance: ${this.graph?.getInstanceId()}`);
        if (this.graph) {
          const graphAny = this.graph as any;
          console.log(`[ContextManager] Graph state before query: connected=${this.graph.isConnected()}, hasClient=${!!graphAny?.client}`);
        }
        console.log(`[ContextManager] Searching graph for keywords: ${keywords.slice(0, 3).join(', ')}`);
      }

      // Search for symbols matching keywords
      for (const keyword of keywords.slice(0, 3)) {
        // Search by symbol name (case-insensitive)
        if (process.env.CV_DEBUG) {
          console.log(`[ContextManager] Searching for symbols with keyword: ${keyword}`);
        }
        // Query symbols and join with their files to get absolutePath
        const symbolResults = await this.graph.query(
          `
          MATCH (s:Symbol)
          WHERE toLower(s.name) CONTAINS toLower($keyword)
             OR toLower(s.qualifiedName) CONTAINS toLower($keyword)
          OPTIONAL MATCH (f:File {path: s.file})
          RETURN s.name as name, s.qualifiedName as qualifiedName, s.file as file,
                 s.kind as kind, s.signature as signature, s.docstring as docstring,
                 s.startLine as startLine, s.endLine as endLine,
                 f.absolutePath as absolutePath
          LIMIT $limit
          `,
          { keyword, limit: Math.ceil(maxGraphResults / keywords.length) }
        );

        // Safety check for undefined results
        if (!symbolResults || !Array.isArray(symbolResults)) {
          if (process.env.CV_DEBUG) {
            console.log(`[ContextManager] No results for '${keyword}' (undefined or not array)`);
          }
          continue;
        }

        if (process.env.CV_DEBUG) {
          console.log(`[ContextManager] Found ${symbolResults.length} symbols for '${keyword}'`);
          if (symbolResults.length > 0) {
            console.log(`[ContextManager] First result:`, JSON.stringify(symbolResults[0]).slice(0, 300));
          }
        }

        for (const result of symbolResults) {
          if (!result.name) continue;

          const symbolContext: SymbolContext & { absolutePath?: string } = {
            name: result.name,
            qualifiedName: result.qualifiedName || result.name,
            file: result.file || '',
            kind: result.kind || 'function',
            code: result.signature || `// ${result.name}`,
            startLine: result.startLine || 0,
            endLine: result.endLine || 0,
            docstring: result.docstring || undefined,
            relevanceScore: 0.6, // Graph results get moderate relevance
          };
          // Store absolutePath for file loading in workspace mode
          if (result.absolutePath) {
            (symbolContext as any).absolutePath = result.absolutePath;
          }

          // Avoid duplicates
          if (
            !snapshot.symbols.some(
              (s) => s.qualifiedName === symbolContext.qualifiedName
            )
          ) {
            snapshot.symbols.push(symbolContext);
          }
        }

        // Search for files matching keywords
        const fileResults = await this.graph.query(
          `
          MATCH (f:File)
          WHERE toLower(f.path) CONTAINS toLower($keyword)
          RETURN f.path as path
          LIMIT 5
          `,
          { keyword }
        );

        // Safety check for undefined results
        if (!fileResults || !Array.isArray(fileResults)) {
          continue;
        }

        for (const result of fileResults) {
          if (!result.path) continue;

          // Only add if not already in explicit files and within budget
          if (
            !snapshot.files.some((f) => f.path === result.path) &&
            this.estimateTokens(snapshot) < this.tokenLimit * 0.7
          ) {
            try {
              const fileContext = await this.loadFile(result.path, 'related');
              snapshot.files.push(fileContext);
            } catch {
              // File not found, skip
            }
          }
        }
      }

      // Load actual file content for symbols found (important for accurate edits)
      // Collect unique files with their absolute paths
      const symbolFilesMap = new Map<string, string>(); // relativePath -> absolutePath
      for (const symbol of snapshot.symbols) {
        if (symbol.file && !symbolFilesMap.has(symbol.file)) {
          const absPath = (symbol as any).absolutePath;
          symbolFilesMap.set(symbol.file, absPath || '');
        }
      }

      for (const [relativePath, absolutePath] of symbolFilesMap) {
        if (
          !snapshot.files.some((f) => f.path === relativePath) &&
          this.estimateTokens(snapshot) < this.tokenLimit * 0.8
        ) {
          try {
            // Try absolutePath first (for workspace mode), then fall back to relative
            if (process.env.CV_DEBUG) {
              console.log(`[ContextManager] Loading file: rel=${relativePath}, abs=${absolutePath || 'none'}`);
            }
            const fileContext = absolutePath
              ? await this.loadFileAbsolute(absolutePath, relativePath, 'graph')
              : await this.loadFile(relativePath, 'graph');
            snapshot.files.push(fileContext);
            if (process.env.CV_DEBUG) {
              console.log(`[ContextManager] Loaded file for symbol: ${fileContext.path}`);
            }
          } catch (err: any) {
            // File not found, skip
            if (process.env.CV_DEBUG) {
              console.log(`[ContextManager] Could not load file: ${relativePath} (abs: ${absolutePath}) - ${err.message}`);
            }
          }
        }
      }
    } catch (error: any) {
      // Graph search failed, log if debug mode
      if (process.env.CV_DEBUG) {
        console.error(`[ContextManager] Graph search failed: ${error.message}`);
      }
    }
  }

  /**
   * Load key project files as fallback when no specific context is found
   * This provides basic project understanding for general queries
   */
  private async loadKeyProjectFiles(snapshot: ContextSnapshot): Promise<void> {
    // Priority order for key project files
    const keyFiles = [
      // Documentation
      'README.md',
      'readme.md',
      'README.rst',
      // Python entry points
      'run.py',
      'app.py',
      'main.py',
      'wsgi.py',
      '__init__.py',
      'apps/__init__.py',
      'src/__init__.py',
      // JavaScript/TypeScript entry points
      'index.ts',
      'index.js',
      'src/index.ts',
      'src/index.js',
      'app.ts',
      'app.js',
      // Configuration files
      'package.json',
      'pyproject.toml',
      'setup.py',
    ];

    let loaded = 0;
    const maxFiles = 5; // Limit to avoid overloading context

    for (const filePath of keyFiles) {
      if (loaded >= maxFiles) break;

      try {
        const fileContext = await this.loadFile(filePath, 'fallback');
        snapshot.files.push(fileContext);
        loaded++;
        if (process.env.CV_DEBUG) {
          console.log(`[ContextManager] Loaded fallback file: ${filePath}`);
        }
      } catch {
        // File doesn't exist, try next
      }
    }

    // Also try to load some files from the graph if available
    if (this.graph?.isConnected() && loaded < maxFiles) {
      try {
        const fileResults = await this.graph.query(
          `MATCH (f:File)
           WHERE f.language IN ['python', 'typescript', 'javascript']
           RETURN f.path as path, f.absolutePath as absolutePath
           ORDER BY f.path
           LIMIT $limit`,
          { limit: maxFiles - loaded }
        );

        if (fileResults && Array.isArray(fileResults)) {
          for (const result of fileResults) {
            if (!result.path || loaded >= maxFiles) continue;
            try {
              const fileContext = result.absolutePath
                ? await this.loadFileAbsolute(result.absolutePath, result.path, 'fallback')
                : await this.loadFile(result.path, 'fallback');
              snapshot.files.push(fileContext);
              loaded++;
              if (process.env.CV_DEBUG) {
                console.log(`[ContextManager] Loaded fallback file from graph: ${result.path}`);
              }
            } catch {
              // Skip files we can't load
            }
          }
        }
      } catch (error: any) {
        if (process.env.CV_DEBUG) {
          console.error(`[ContextManager] Failed to load fallback files from graph: ${error.message}`);
        }
      }
    }

    if (process.env.CV_DEBUG) {
      console.log(`[ContextManager] Loaded ${loaded} fallback files`);
    }
  }

  /**
   * Extract keywords from a query for graph search
   */
  private extractKeywords(query: string): string[] {
    // Common words to filter out
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
      'used', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
      'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when',
      'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
      'other', 'some', 'such', 'no', 'not', 'only', 'own', 'same', 'so',
      'than', 'too', 'very', 'just', 'add', 'create', 'make', 'update', 'fix',
      'change', 'modify', 'implement', 'write', 'code', 'file', 'function',
      'class', 'method', 'please', 'help', 'me', 'want', 'like', 'get'
    ]);

    // Tokenize and filter
    const tokens = query
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(token =>
        token.length > 2 &&
        !stopWords.has(token) &&
        !/^\d+$/.test(token)
      );

    // Deduplicate while preserving order
    return [...new Set(tokens)];
  }

  /**
   * Convert a graph symbol node to SymbolContext
   */
  private symbolNodeToContext(
    node: any,
    relevanceScore: number
  ): SymbolContext {
    return {
      name: node.name,
      qualifiedName: node.qualifiedName || node.name,
      file: node.file,
      kind: node.kind || 'function',
      code: node.signature || `// ${node.name}`,
      startLine: node.startLine,
      endLine: node.endLine,
      docstring: node.docstring,
      relevanceScore,
    };
  }

  /**
   * Localize context when over token budget
   *
   * Strategy:
   * - Score each symbol by: (relevance * 0.7) + (centrality * 0.3)
   * - Keep highest scoring until within 90% of limit
   * - Preserve only relationships between included symbols
   */
  private async localizeContext(
    snapshot: ContextSnapshot,
    query: string
  ): Promise<ContextSnapshot> {
    // Score each symbol
    const scored = await Promise.all(
      snapshot.symbols.map(async (symbol) => {
        const centrality = await this.calculateCentrality(symbol.qualifiedName);
        const combinedScore = symbol.relevanceScore * 0.7 + centrality * 0.3;
        return { symbol, score: combinedScore };
      })
    );

    // Sort by combined score
    scored.sort((a, b) => b.score - a.score);

    // Build localized snapshot
    const localized: ContextSnapshot = {
      files: snapshot.files, // Keep explicit files
      symbols: [],
      relationships: [],
      tokenCount: 0,
    };

    // Calculate tokens from files first
    localized.tokenCount = this.estimateTokens(localized);
    const remainingBudget = this.tokenLimit * 0.9 - localized.tokenCount;

    // Add symbols until budget reached
    for (const { symbol } of scored) {
      const symbolTokens = this.estimateSymbolTokens(symbol);

      if (localized.tokenCount + symbolTokens <= this.tokenLimit * 0.9) {
        localized.symbols.push(symbol);
        localized.tokenCount += symbolTokens;
      }
    }

    // Keep only relationships between included symbols
    const includedSymbols = new Set(localized.symbols.map((s) => s.qualifiedName));
    localized.relationships = snapshot.relationships.filter(
      (r) => includedSymbols.has(r.from) && includedSymbols.has(r.to)
    );

    return localized;
  }

  /**
   * Calculate graph centrality for a symbol
   * Higher centrality = more important in the codebase
   */
  private async calculateCentrality(symbolName: string): Promise<number> {
    if (!this.graph || !this.graph.isConnected()) return 0;

    try {
      // Query for in-degree and out-degree
      const result = await this.graph.query(
        `
        MATCH (s:Symbol)
        WHERE s.qualifiedName = $name OR s.name = $name
        OPTIONAL MATCH (caller:Symbol)-[:CALLS]->(s)
        OPTIONAL MATCH (s)-[:CALLS]->(callee:Symbol)
        RETURN count(DISTINCT caller) as inDegree, count(DISTINCT callee) as outDegree
      `,
        { name: symbolName }
      );

      if (result.length > 0) {
        const { inDegree, outDegree } = result[0];
        // Normalize using log to handle highly connected nodes
        return Math.min(1, Math.log1p(inDegree + outDegree) / 10);
      }
    } catch {
      // Graph query failed
    }

    return 0;
  }

  /**
   * Estimate total tokens in a snapshot
   */
  private estimateTokens(snapshot: ContextSnapshot): number {
    let chars = 0;

    // Files
    for (const file of snapshot.files) {
      chars += file.content.length;
      chars += file.path.length + 50; // Header overhead
    }

    // Symbols
    for (const symbol of snapshot.symbols) {
      chars += this.estimateSymbolTokens(symbol) * CHARS_PER_TOKEN;
    }

    // Relationships (small overhead)
    chars += snapshot.relationships.length * 50;

    return Math.ceil(chars / CHARS_PER_TOKEN);
  }

  /**
   * Estimate tokens for a single symbol
   */
  private estimateSymbolTokens(symbol: SymbolContext): number {
    let chars = symbol.code?.length || 0;
    chars += (symbol.qualifiedName?.length || 0) + 20;
    chars += (symbol.file?.length || 0) + 10;
    if (symbol.docstring) chars += symbol.docstring.length;
    if (symbol.signature) chars += symbol.signature.length;

    return Math.ceil(chars / CHARS_PER_TOKEN);
  }

  /**
   * Format context snapshot for AI prompt
   */
  formatForPrompt(snapshot: ContextSnapshot): string {
    const parts: string[] = [];

    // Context summary
    const fileCount = snapshot.files.length;
    const symbolCount = snapshot.symbols.length;
    const relCount = snapshot.relationships.length;

    if (fileCount === 0 && symbolCount === 0) {
      parts.push('## Context Status');
      parts.push('*No relevant code found in the knowledge graph. The codebase may not be synced or the query may need different keywords.*');
      parts.push('*Ask the user for specific file paths or run `cv sync` to index the codebase.*\n');
      return parts.join('\n');
    }

    parts.push(`## Context Summary`);
    parts.push(`*Found ${fileCount} file(s), ${symbolCount} symbol(s), and ${relCount} relationship(s) relevant to your query.*\n`);

    // Full files
    if (snapshot.files.length > 0) {
      parts.push('## Files in Context\n');
      for (const file of snapshot.files) {
        parts.push(`### ${file.path}\n`);
        parts.push('```');
        parts.push(file.content);
        parts.push('```\n');
      }
    }

    // Code symbols
    if (snapshot.symbols.length > 0) {
      parts.push('## Relevant Code\n');
      for (const symbol of snapshot.symbols) {
        parts.push(
          `### ${symbol.qualifiedName} (${symbol.kind}) - ${symbol.file}:${symbol.startLine || '?'}`
        );
        if (symbol.docstring) {
          parts.push(`*${symbol.docstring}*`);
        }
        parts.push('```');
        parts.push(symbol.code);
        parts.push('```\n');
      }
    }

    // Relationships
    if (snapshot.relationships.length > 0) {
      parts.push('## Code Relationships\n');
      for (const rel of snapshot.relationships) {
        parts.push(`- ${rel.from} --[${rel.type}]--> ${rel.to}`);
      }
      parts.push('');
    }

    return parts.join('\n');
  }

  /**
   * Add a file to explicit context
   */
  addExplicitFile(activeContext: ActiveContext, filePath: string): void {
    if (!activeContext.explicitFiles.includes(filePath)) {
      activeContext.explicitFiles.push(filePath);
    }
  }

  /**
   * Remove a file from explicit context
   */
  removeExplicitFile(activeContext: ActiveContext, filePath: string): void {
    activeContext.explicitFiles = activeContext.explicitFiles.filter(
      (f) => f !== filePath
    );
  }

  /**
   * Get a summary of current context
   */
  getContextSummary(activeContext: ActiveContext): string {
    const lines: string[] = [];

    if (activeContext.explicitFiles.length > 0) {
      lines.push(`Explicit files: ${activeContext.explicitFiles.length}`);
      for (const file of activeContext.explicitFiles) {
        lines.push(`  - ${file}`);
      }
    }

    if (activeContext.discoveredFiles.length > 0) {
      lines.push(`Discovered files: ${activeContext.discoveredFiles.length}`);
    }

    if (activeContext.activeSymbols.length > 0) {
      lines.push(`Active symbols: ${activeContext.activeSymbols.length}`);
    }

    lines.push(
      `Token usage: ~${activeContext.tokenCount}/${activeContext.tokenLimit}`
    );

    return lines.join('\n');
  }
}

/**
 * Create a ContextManager instance
 */
export function createContextManager(
  vector: VectorManager | null,
  graph: GraphManager | null,
  repoRoot: string,
  tokenLimit?: number
): ContextManager {
  return new ContextManager(vector, graph, repoRoot, tokenLimit);
}

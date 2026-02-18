/**
 * Traversal Service
 * Provides traversal-aware context for Claude Code integration
 * Tracks position in codebase and returns appropriate context at each level
 */

import {
  TraversalPosition,
  TraverseContextArgs,
  TraversalContextResult,
  TraversalSession,
  SymbolNode,
  HierarchicalSummaryPayload
} from '@cv-git/shared';
import { GraphManager } from '../graph/index.js';
import { VectorManager } from '../vector/index.js';
import { GraphService } from './graph-service.js';
import { SessionService } from './session-service.js';
import * as path from 'path';

export interface TraversalServiceOptions {
  /** Maximum context tokens/chars to return */
  defaultBudget?: number;
  /** Include callers by default */
  includeCallersByDefault?: boolean;
  /** Include callees by default */
  includeCalleesByDefault?: boolean;
  /** Enable context caching */
  enableCaching?: boolean;
  /** Cache TTL in milliseconds (default: 60000 = 1 minute) */
  cacheTtlMs?: number;
  /** Maximum cache entries (default: 1000) */
  maxCacheEntries?: number;
  /** Include related symbols from semantic search */
  includeRelatedSymbols?: boolean;
  /** Maximum related symbols to suggest */
  maxRelatedSymbols?: number;
}

/** Cache entry with TTL tracking */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** LRU-style cache with TTL */
class ContextCache {
  private cache = new Map<string, CacheEntry<any>>();
  private accessOrder: string[] = [];

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number
  ) {}

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.accessOrder = this.accessOrder.filter(k => k !== key);
      return undefined;
    }

    // Update access order
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this.accessOrder.push(key);

    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    // Evict if at capacity
    while (this.cache.size >= this.maxEntries && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift()!;
      this.cache.delete(oldest);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs
    });
    this.accessOrder.push(key);
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      this.accessOrder = [];
      return;
    }

    // Invalidate entries matching pattern
    const regex = new RegExp(pattern);
    for (const key of [...this.cache.keys()]) {
      if (regex.test(key)) {
        this.cache.delete(key);
        this.accessOrder = this.accessOrder.filter(k => k !== key);
      }
    }
  }

  getStats(): { size: number; maxEntries: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs
    };
  }
}

/**
 * Service for traversal-aware context retrieval
 * Used by Claude Code to get relevant context as it navigates code
 */
export class TraversalService {
  private options: Required<TraversalServiceOptions>;
  private cache: ContextCache | null = null;

  constructor(
    private graph: GraphManager,
    private vector: VectorManager | null,
    private graphService: GraphService,
    private sessionService: SessionService,
    options?: TraversalServiceOptions
  ) {
    this.options = {
      defaultBudget: options?.defaultBudget ?? 4000,
      includeCallersByDefault: options?.includeCallersByDefault ?? true,
      includeCalleesByDefault: options?.includeCalleesByDefault ?? true,
      enableCaching: options?.enableCaching ?? true,
      cacheTtlMs: options?.cacheTtlMs ?? 60000, // 1 minute default
      maxCacheEntries: options?.maxCacheEntries ?? 1000,
      includeRelatedSymbols: options?.includeRelatedSymbols ?? false,
      maxRelatedSymbols: options?.maxRelatedSymbols ?? 5
    };

    if (this.options.enableCaching) {
      this.cache = new ContextCache(this.options.cacheTtlMs, this.options.maxCacheEntries);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxEntries: number; ttlMs: number } | null {
    return this.cache?.getStats() ?? null;
  }

  /**
   * Invalidate cache entries
   * @param pattern Optional regex pattern to match keys (invalidates all if not provided)
   */
  invalidateCache(pattern?: string): void {
    this.cache?.invalidate(pattern);
  }

  /**
   * Main entry point for traversal with context
   * Handles navigation and returns context for the new position
   */
  async traverse(args: TraverseContextArgs): Promise<TraversalContextResult> {
    // Get or create session
    const session = await this.sessionService.getSession(args.sessionId);
    const sessionId = session.id;

    // Resolve new position based on direction and target
    const newPosition = await this.resolvePosition(session.position, args);

    // Update session with new position
    await this.sessionService.updateSession(session, newPosition);

    // Get context for new position
    const context = await this.getContextForPosition(newPosition, args);

    // Generate navigation hints
    const hints = await this.generateHints(newPosition);

    return {
      position: newPosition,
      sessionId,
      context,
      hints
    };
  }

  /**
   * Resolve new position based on current position and navigation args
   */
  private async resolvePosition(
    current: TraversalPosition,
    args: TraverseContextArgs
  ): Promise<TraversalPosition> {
    const now = Date.now();

    switch (args.direction) {
      case 'jump':
        // Direct jump to specified target
        return this.resolveJumpPosition(args, now);

      case 'in':
        // Drill down (module → file → symbol)
        return this.resolveInPosition(current, args, now);

      case 'out':
        // Move up (symbol → file → module)
        return this.resolveOutPosition(current, now);

      case 'lateral':
        // Move to sibling at same level
        return this.resolveLateralPosition(current, args, now);

      case 'stay':
      default:
        // Stay at current position, just update timestamp
        return { ...current, timestamp: now };
    }
  }

  /**
   * Resolve a jump to a specific target
   */
  private async resolveJumpPosition(
    args: TraverseContextArgs,
    timestamp: number
  ): Promise<TraversalPosition> {
    if (args.symbol) {
      // Jump to symbol level
      return {
        symbol: args.symbol,
        file: args.file,
        module: args.file ? path.dirname(args.file) : undefined,
        depth: 3,
        timestamp
      };
    }

    if (args.file) {
      // Jump to file level
      return {
        file: args.file,
        module: path.dirname(args.file),
        depth: 2,
        timestamp
      };
    }

    if (args.module) {
      // Jump to module level
      return {
        module: args.module,
        depth: 1,
        timestamp
      };
    }

    // Default to repo level
    return {
      depth: 0,
      timestamp
    };
  }

  /**
   * Resolve drilling into current position
   */
  private async resolveInPosition(
    current: TraversalPosition,
    args: TraverseContextArgs,
    timestamp: number
  ): Promise<TraversalPosition> {
    // If at repo level, move to module
    if (current.depth === 0) {
      const module = args.module || await this.getFirstModule();
      return {
        module,
        depth: 1,
        timestamp
      };
    }

    // If at module level, move to file
    if (current.depth === 1) {
      const file = args.file || await this.getFirstFileInModule(current.module);
      return {
        file,
        module: current.module,
        depth: 2,
        timestamp
      };
    }

    // If at file level, move to symbol
    if (current.depth === 2) {
      const symbol = args.symbol || await this.getFirstSymbolInFile(current.file);
      return {
        symbol,
        file: current.file,
        module: current.module,
        depth: 3,
        timestamp
      };
    }

    // Already at symbol level, stay
    return { ...current, timestamp };
  }

  /**
   * Resolve moving out of current position
   */
  private async resolveOutPosition(
    current: TraversalPosition,
    timestamp: number
  ): Promise<TraversalPosition> {
    // If at symbol level, move to file
    if (current.depth === 3) {
      return {
        file: current.file,
        module: current.module,
        depth: 2,
        timestamp
      };
    }

    // If at file level, move to module
    if (current.depth === 2) {
      return {
        module: current.module,
        depth: 1,
        timestamp
      };
    }

    // If at module level, move to repo
    if (current.depth === 1) {
      return {
        depth: 0,
        timestamp
      };
    }

    // Already at repo level, stay
    return { ...current, timestamp };
  }

  /**
   * Resolve moving to a sibling at the same level
   */
  private async resolveLateralPosition(
    current: TraversalPosition,
    args: TraverseContextArgs,
    timestamp: number
  ): Promise<TraversalPosition> {
    // At symbol level, move to sibling symbol
    if (current.depth === 3 && current.file) {
      // Use cached file symbols
      const symbols = await this.getCachedFileSymbols(current.file);
      const currentIdx = symbols.findIndex(s => s.qualifiedName === current.symbol || s.name === current.symbol);
      const nextIdx = (currentIdx + 1) % symbols.length;
      const nextSymbol = symbols[nextIdx];

      return {
        symbol: nextSymbol?.qualifiedName || args.symbol,
        file: current.file,
        module: current.module,
        depth: 3,
        timestamp
      };
    }

    // At file level, move to sibling file (getFilesInModule is already cached)
    if (current.depth === 2 && current.module) {
      const files = await this.getFilesInModule(current.module);
      const currentIdx = files.findIndex(f => f === current.file);
      const nextIdx = (currentIdx + 1) % files.length;

      return {
        file: files[nextIdx] || args.file,
        module: current.module,
        depth: 2,
        timestamp
      };
    }

    // At module level, move to sibling module (getModules is already cached)
    if (current.depth === 1) {
      const modules = await this.getModules();
      const currentIdx = modules.findIndex(m => m === current.module);
      const nextIdx = (currentIdx + 1) % modules.length;

      return {
        module: modules[nextIdx] || args.module,
        depth: 1,
        timestamp
      };
    }

    return { ...current, timestamp };
  }

  /**
   * Get context for a specific position
   */
  private async getContextForPosition(
    position: TraversalPosition,
    args: TraverseContextArgs
  ): Promise<TraversalContextResult['context']> {
    const budget = args.budget || this.options.defaultBudget;

    // At symbol level
    if (position.depth === 3 && position.symbol) {
      return this.getSymbolContext(position, args, budget);
    }

    // At file level
    if (position.depth === 2 && position.file) {
      return this.getFileContext(position, budget);
    }

    // At module level
    if (position.depth === 1 && position.module) {
      return this.getModuleContext(position, budget);
    }

    // At repo level
    return this.getRepoContext(budget);
  }

  /**
   * Get context at symbol level
   */
  private async getSymbolContext(
    position: TraversalPosition,
    args: TraverseContextArgs,
    budget: number
  ): Promise<TraversalContextResult['context']> {
    const context: TraversalContextResult['context'] = {};

    // Get the symbol
    const symbolResult = await this.graph.getSymbolWithVectors(position.symbol!);

    if (symbolResult) {
      const { symbol } = symbolResult;

      // Get the code for this symbol (use cache for vectors, requires vector)
      let vectors: any = null;
      if (this.vector) {
        const vectorCacheKey = `vectors:${symbol.qualifiedName}`;
        vectors = this.cache?.get<any>(vectorCacheKey);
        if (!vectors) {
          vectors = await this.graphService.getVectorsForSymbol(symbol.qualifiedName, this.vector);
          if (this.cache && vectors) {
            this.cache.set(vectorCacheKey, vectors);
          }
        }
      }
      if (vectors && vectors.vectors.length > 0) {
        context.code = vectors.vectors[0].payload.text;
      }

      // Get summary if available (cached)
      const summary = await this.getCachedSummary(`symbol:${symbol.qualifiedName}`);
      if (summary) {
        context.summary = summary.summary;
      }

      // Get callers if requested (use cache)
      const includeCallers = args.includeCallers ?? this.options.includeCallersByDefault;
      if (includeCallers) {
        const callersCacheKey = `callers:${symbol.qualifiedName}`;
        let callers = this.cache?.get<SymbolNode[]>(callersCacheKey);
        if (!callers) {
          callers = await this.graph.getCallers(symbol.qualifiedName);
          if (this.cache) {
            this.cache.set(callersCacheKey, callers);
          }
        }
        context.callers = callers.map(c => ({
          name: c.name,
          file: c.file
        }));
      }

      // Get callees if requested (use cache)
      const includeCallees = args.includeCallees ?? this.options.includeCalleesByDefault;
      if (includeCallees) {
        const calleesCacheKey = `callees:${symbol.qualifiedName}`;
        let callees = this.cache?.get<SymbolNode[]>(calleesCacheKey);
        if (!callees) {
          callees = await this.graph.getCallees(symbol.qualifiedName);
          if (this.cache) {
            this.cache.set(calleesCacheKey, callees);
          }
        }
        context.callees = callees.map(c => ({
          name: c.name,
          file: c.file
        }));
      }

      // Get semantically related symbols if enabled (via args or default option)
      const includeRelated = args.includeRelated ?? this.options.includeRelatedSymbols;
      if (includeRelated && context.summary) {
        const related = await this.getRelatedSymbols(symbol.qualifiedName, context.summary);
        if (related.length > 0) {
          context.relatedSymbols = related;
        }
      }
    }

    return context;
  }

  /**
   * Get semantically related symbols using vector search
   */
  private async getRelatedSymbols(
    currentSymbol: string,
    summary: string
  ): Promise<Array<{ name: string; file: string; score: number; summary?: string }>> {
    const cacheKey = `related:${currentSymbol}`;

    // Check cache
    if (this.cache) {
      const cached = this.cache.get<Array<{ name: string; file: string; score: number; summary?: string }>>(cacheKey);
      if (cached) return cached;
    }

    try {
      if (!this.vector) return [];
      // Search for similar symbol summaries (level 1 = symbol level)
      const results = await this.vector.searchByLevel(summary, 1, {
        limit: this.options.maxRelatedSymbols + 1 // +1 because current symbol might be in results
      });

      const related = results
        .filter(r => {
          // Exclude the current symbol
          const payload = r.payload as HierarchicalSummaryPayload;
          return !payload._id?.includes(currentSymbol);
        })
        .slice(0, this.options.maxRelatedSymbols)
        .map(r => {
          const payload = r.payload as HierarchicalSummaryPayload;
          // Extract symbol name from ID (format: symbol:file:name)
          const idParts = (payload._id || '').split(':');
          const name = idParts[idParts.length - 1] || 'unknown';
          return {
            name,
            file: payload.file || '',
            score: r.score,
            summary: payload.summary
          };
        });

      // Cache result
      if (this.cache) {
        this.cache.set(cacheKey, related);
      }

      return related;
    } catch (error) {
      // Silently fail if vector search is not available
      return [];
    }
  }

  /**
   * Get context at file level
   */
  private async getFileContext(
    position: TraversalPosition,
    budget: number
  ): Promise<TraversalContextResult['context']> {
    const context: TraversalContextResult['context'] = {};

    // Get file summary (cached)
    const summary = await this.getCachedSummary(`file:${position.file}`);
    if (summary) {
      context.summary = summary.summary;
    }

    // Get symbols in file (cached)
    const symbols = await this.getCachedFileSymbols(position.file!);
    context.symbols = symbols.map(s => ({
      name: s.name,
      kind: s.kind,
      summary: undefined // Could be populated from symbol summaries
    }));

    // Get imports (use cache)
    const depsCacheKey = `deps:${position.file}`;
    let deps = this.cache?.get<string[]>(depsCacheKey);
    if (!deps) {
      deps = await this.graph.getFileDependencies(position.file!);
      if (this.cache) {
        this.cache.set(depsCacheKey, deps);
      }
    }
    context.imports = deps;

    return context;
  }

  /**
   * Get context at module level
   */
  private async getModuleContext(
    position: TraversalPosition,
    budget: number
  ): Promise<TraversalContextResult['context']> {
    const context: TraversalContextResult['context'] = {};

    // Get directory summary (cached)
    const summary = await this.getCachedSummary(`dir:${position.module}`);
    if (summary) {
      context.summary = summary.summary;
    }

    // Get files in module (already cached in getFilesInModule)
    const files = await this.getFilesInModule(position.module!);
    context.files = files.map(f => ({
      path: f,
      summary: undefined // Could be populated from file summaries
    }));

    return context;
  }

  /**
   * Get context at repo level
   */
  private async getRepoContext(budget: number): Promise<TraversalContextResult['context']> {
    const context: TraversalContextResult['context'] = {};

    // Get repo summary (cached, requires vector)
    if (this.vector) {
      const repoId = this.vector.getRepoId() || 'default';
      const summary = await this.getCachedSummary(`repo:${repoId}`);
      if (summary) {
        context.summary = summary.summary;
      }
    }

    // Get top-level modules (already cached in getModules)
    const modules = await this.getModules();
    context.files = modules.slice(0, 20).map(m => ({
      path: m,
      summary: undefined
    }));

    return context;
  }

  /**
   * Generate navigation hints for current position
   * Enhanced with graph-based analysis and relationship suggestions
   */
  private async generateHints(position: TraversalPosition): Promise<string[]> {
    const hints: string[] = [];

    if (position.depth === 0) {
      // getModules is already cached
      const modules = await this.getModules();
      if (modules.length > 0) {
        hints.push(`Navigate to modules: ${modules.slice(0, 3).join(', ')}...`);
      }
      // Add suggestion to find entry points
      hints.push('Jump to a specific file with file="path/to/file.ts"');
    }

    if (position.depth === 1 && position.module) {
      // getFilesInModule is already cached
      const files = await this.getFilesInModule(position.module);
      if (files.length > 0) {
        hints.push(`Files in ${path.basename(position.module)}: ${files.slice(0, 3).map(f => path.basename(f)).join(', ')}...`);

        // Suggest entry point files (index.ts, main.ts, etc.)
        const entryPoints = files.filter(f =>
          f.endsWith('index.ts') || f.endsWith('main.ts') || f.endsWith('index.js') || f.endsWith('mod.ts')
        );
        if (entryPoints.length > 0) {
          hints.push(`Entry points: ${entryPoints.slice(0, 2).map(f => path.basename(f)).join(', ')}`);
        }
      }
      hints.push('Use direction="in" to drill into a file');
      hints.push('Use direction="out" to return to repo level');
    }

    if (position.depth === 2 && position.file) {
      // Use cached file symbols
      const symbols = await this.getCachedFileSymbols(position.file);
      if (symbols.length > 0) {
        // Group by kind for better suggestions
        const funcs = symbols.filter(s => s.kind === 'function' || s.kind === 'method');
        const classes = symbols.filter(s => s.kind === 'class' || s.kind === 'interface');
        const publicSymbols = symbols.filter(s => s.visibility === 'public');

        if (publicSymbols.length > 0) {
          hints.push(`Public: ${publicSymbols.slice(0, 3).map(s => s.name).join(', ')}${publicSymbols.length > 3 ? '...' : ''}`);
        } else if (funcs.length > 0) {
          hints.push(`Functions: ${funcs.slice(0, 3).map(s => s.name).join(', ')}${funcs.length > 3 ? '...' : ''}`);
        }
        if (classes.length > 0) {
          hints.push(`Classes/Interfaces: ${classes.slice(0, 2).map(s => s.name).join(', ')}`);
        }
      }
      hints.push('Use direction="in" to inspect a symbol');
      hints.push('Use direction="lateral" to move to sibling file');
    }

    if (position.depth === 3 && position.symbol) {
      // Get related symbols from call graph
      const relatedHints = await this.getRelatedSymbolHints(position.symbol);
      hints.push(...relatedHints);

      hints.push('Use direction="out" to return to file level');
      hints.push('Use direction="lateral" to move to sibling symbol');
    }

    return hints;
  }

  /**
   * Get hints about related symbols from the call graph
   */
  private async getRelatedSymbolHints(symbolName: string): Promise<string[]> {
    const hints: string[] = [];

    try {
      // Get callers (cached)
      const callersCacheKey = `callers:${symbolName}`;
      let callers = this.cache?.get<SymbolNode[]>(callersCacheKey);
      if (!callers) {
        callers = await this.graph.getCallers(symbolName);
        if (this.cache && callers) {
          this.cache.set(callersCacheKey, callers);
        }
      }

      // Get callees (cached)
      const calleesCacheKey = `callees:${symbolName}`;
      let callees = this.cache?.get<SymbolNode[]>(calleesCacheKey);
      if (!callees) {
        callees = await this.graph.getCallees(symbolName);
        if (this.cache && callees) {
          this.cache.set(calleesCacheKey, callees);
        }
      }

      if (callers && callers.length > 0) {
        const callerNames = callers.slice(0, 3).map(c => c.name);
        hints.push(`Called by: ${callerNames.join(', ')}${callers.length > 3 ? ` (+${callers.length - 3} more)` : ''}`);
      }

      if (callees && callees.length > 0) {
        const calleeNames = callees.slice(0, 3).map(c => c.name);
        hints.push(`Calls: ${calleeNames.join(', ')}${callees.length > 3 ? ` (+${callees.length - 3} more)` : ''}`);
      }

      if (callers && callers.length === 0 && callees && callees.length === 0) {
        hints.push('No direct callers or callees found');
      }
    } catch (error) {
      // Silently ignore errors in hint generation
    }

    return hints;
  }

  // ========== Helper Methods ==========

  private async getFirstModule(): Promise<string | undefined> {
    const modules = await this.getModules();
    return modules[0];
  }

  private async getModules(): Promise<string[]> {
    const cacheKey = 'modules:all';

    // Check cache
    if (this.cache) {
      const cached = this.cache.get<string[]>(cacheKey);
      if (cached) return cached;
    }

    const result = await this.graph.query(
      'MATCH (f:File) RETURN DISTINCT f.path as path'
    );

    // Extract unique directory paths
    const dirs = new Set<string>();
    for (const r of result) {
      const dir = path.dirname(r.path as string);
      if (dir && dir !== '.') {
        // Get top-level directory
        const parts = dir.split('/');
        dirs.add(parts[0]);
      }
    }

    const modules = [...dirs].sort();

    // Cache result
    if (this.cache) {
      this.cache.set(cacheKey, modules);
    }

    return modules;
  }

  private async getFilesInModule(module: string): Promise<string[]> {
    const cacheKey = `files:${module}`;

    // Check cache
    if (this.cache) {
      const cached = this.cache.get<string[]>(cacheKey);
      if (cached) return cached;
    }

    const result = await this.graph.query(
      `MATCH (f:File) WHERE f.path STARTS WITH $prefix RETURN f.path as path ORDER BY f.path`,
      { prefix: module + '/' }
    );

    const files = result.map(r => r.path as string);

    // Cache result
    if (this.cache) {
      this.cache.set(cacheKey, files);
    }

    return files;
  }

  private async getFirstFileInModule(module?: string): Promise<string | undefined> {
    if (!module) return undefined;
    const files = await this.getFilesInModule(module);
    return files[0];
  }

  private async getFirstSymbolInFile(file?: string): Promise<string | undefined> {
    if (!file) return undefined;

    const cacheKey = `symbols:${file}`;

    // Check cache
    if (this.cache) {
      const cached = this.cache.get<SymbolNode[]>(cacheKey);
      if (cached) return cached[0]?.qualifiedName;
    }

    const symbols = await this.graph.getFileSymbols(file);

    // Cache result
    if (this.cache) {
      this.cache.set(cacheKey, symbols);
    }

    return symbols[0]?.qualifiedName;
  }

  /**
   * Get cached summary or fetch from vector store
   */
  private async getCachedSummary(summaryId: string): Promise<HierarchicalSummaryPayload | null> {
    const cacheKey = `summary:${summaryId}`;

    // Check cache
    if (this.cache) {
      const cached = this.cache.get<HierarchicalSummaryPayload | null>(cacheKey);
      if (cached !== undefined) return cached;
    }

    if (!this.vector) return null;
    const summary = await this.vector.getSummary(summaryId);

    // Cache result (even nulls to avoid repeated lookups)
    if (this.cache) {
      this.cache.set(cacheKey, summary);
    }

    return summary;
  }

  /**
   * Get cached file symbols or fetch from graph
   */
  private async getCachedFileSymbols(file: string): Promise<SymbolNode[]> {
    const cacheKey = `symbols:${file}`;

    // Check cache
    if (this.cache) {
      const cached = this.cache.get<SymbolNode[]>(cacheKey);
      if (cached) return cached;
    }

    const symbols = await this.graph.getFileSymbols(file);

    // Cache result
    if (this.cache) {
      this.cache.set(cacheKey, symbols);
    }

    return symbols;
  }
}

/**
 * Create a TraversalService instance
 */
export function createTraversalService(
  graph: GraphManager,
  vector: VectorManager | null,
  graphService: GraphService,
  sessionService: SessionService,
  options?: TraversalServiceOptions
): TraversalService {
  return new TraversalService(graph, vector, graphService, sessionService, options);
}

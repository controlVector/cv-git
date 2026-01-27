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
}

/**
 * Service for traversal-aware context retrieval
 * Used by Claude Code to get relevant context as it navigates code
 */
export class TraversalService {
  private options: Required<TraversalServiceOptions>;

  constructor(
    private graph: GraphManager,
    private vector: VectorManager,
    private graphService: GraphService,
    private sessionService: SessionService,
    options?: TraversalServiceOptions
  ) {
    this.options = {
      defaultBudget: options?.defaultBudget ?? 4000,
      includeCallersByDefault: options?.includeCallersByDefault ?? true,
      includeCalleesByDefault: options?.includeCalleesByDefault ?? true
    };
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
      const symbols = await this.graph.getFileSymbols(current.file);
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

    // At file level, move to sibling file
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

    // At module level, move to sibling module
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

      // Get the code for this symbol
      const vectors = await this.graphService.getVectorsForSymbol(symbol.qualifiedName, this.vector);
      if (vectors && vectors.vectors.length > 0) {
        context.code = vectors.vectors[0].payload.text;
      }

      // Get summary if available
      const summary = await this.vector.getSummary(`symbol:${symbol.qualifiedName}`);
      if (summary) {
        context.summary = summary.summary;
      }

      // Get callers if requested
      const includeCallers = args.includeCallers ?? this.options.includeCallersByDefault;
      if (includeCallers) {
        const callers = await this.graph.getCallers(symbol.qualifiedName);
        context.callers = callers.map(c => ({
          name: c.name,
          file: c.file
        }));
      }

      // Get callees if requested
      const includeCallees = args.includeCallees ?? this.options.includeCalleesByDefault;
      if (includeCallees) {
        const callees = await this.graph.getCallees(symbol.qualifiedName);
        context.callees = callees.map(c => ({
          name: c.name,
          file: c.file
        }));
      }
    }

    return context;
  }

  /**
   * Get context at file level
   */
  private async getFileContext(
    position: TraversalPosition,
    budget: number
  ): Promise<TraversalContextResult['context']> {
    const context: TraversalContextResult['context'] = {};

    // Get file summary
    const summary = await this.vector.getSummary(`file:${position.file}`);
    if (summary) {
      context.summary = summary.summary;
    }

    // Get symbols in file
    const symbols = await this.graph.getFileSymbols(position.file!);
    context.symbols = symbols.map(s => ({
      name: s.name,
      kind: s.kind,
      summary: undefined // Could be populated from symbol summaries
    }));

    // Get imports
    const deps = await this.graph.getFileDependencies(position.file!);
    context.imports = deps.map(d => d.path);

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

    // Get directory summary
    const summary = await this.vector.getSummary(`dir:${position.module}`);
    if (summary) {
      context.summary = summary.summary;
    }

    // Get files in module
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

    // Get repo summary
    const repoId = this.vector.getRepoId() || 'default';
    const summary = await this.vector.getSummary(`repo:${repoId}`);
    if (summary) {
      context.summary = summary.summary;
    }

    // Get top-level modules
    const modules = await this.getModules();
    context.files = modules.slice(0, 20).map(m => ({
      path: m,
      summary: undefined
    }));

    return context;
  }

  /**
   * Generate navigation hints for current position
   */
  private async generateHints(position: TraversalPosition): Promise<string[]> {
    const hints: string[] = [];

    if (position.depth === 0) {
      const modules = await this.getModules();
      if (modules.length > 0) {
        hints.push(`Navigate to modules: ${modules.slice(0, 3).join(', ')}...`);
      }
    }

    if (position.depth === 1 && position.module) {
      const files = await this.getFilesInModule(position.module);
      if (files.length > 0) {
        hints.push(`Files in ${path.basename(position.module)}: ${files.slice(0, 3).map(f => path.basename(f)).join(', ')}...`);
      }
      hints.push('Use direction="in" to drill into a file');
      hints.push('Use direction="out" to return to repo level');
    }

    if (position.depth === 2 && position.file) {
      const symbols = await this.graph.getFileSymbols(position.file);
      if (symbols.length > 0) {
        hints.push(`Symbols: ${symbols.slice(0, 5).map(s => s.name).join(', ')}...`);
      }
      hints.push('Use direction="in" to inspect a symbol');
      hints.push('Use direction="lateral" to move to sibling file');
    }

    if (position.depth === 3 && position.symbol) {
      hints.push('Use direction="out" to return to file level');
      hints.push('Use includeCallers/includeCallees to see relationships');
      hints.push('Use direction="lateral" to move to sibling symbol');
    }

    return hints;
  }

  // ========== Helper Methods ==========

  private async getFirstModule(): Promise<string | undefined> {
    const modules = await this.getModules();
    return modules[0];
  }

  private async getModules(): Promise<string[]> {
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

    return [...dirs].sort();
  }

  private async getFilesInModule(module: string): Promise<string[]> {
    const result = await this.graph.query(
      `MATCH (f:File) WHERE f.path STARTS WITH $prefix RETURN f.path as path ORDER BY f.path`,
      { prefix: module + '/' }
    );

    return result.map(r => r.path as string);
  }

  private async getFirstFileInModule(module?: string): Promise<string | undefined> {
    if (!module) return undefined;
    const files = await this.getFilesInModule(module);
    return files[0];
  }

  private async getFirstSymbolInFile(file?: string): Promise<string | undefined> {
    if (!file) return undefined;
    const symbols = await this.graph.getFileSymbols(file);
    return symbols[0]?.qualifiedName;
  }
}

/**
 * Create a TraversalService instance
 */
export function createTraversalService(
  graph: GraphManager,
  vector: VectorManager,
  graphService: GraphService,
  sessionService: SessionService,
  options?: TraversalServiceOptions
): TraversalService {
  return new TraversalService(graph, vector, graphService, sessionService, options);
}

/**
 * Context Assembly for AI Code Generation
 *
 * Gathers multi-layer context from:
 * - Knowledge Graph (code structure, symbols, relationships)
 * - Vector Database (semantic similarity)
 * - PRD Requirements (business requirements linked to code)
 * - Git History (recent changes, commit context)
 */

import { GraphManager } from '../graph/index.js';
import { VectorManager } from '../vector/index.js';

export { ContextualBandit, BanditContext, BanditArm, BanditState, CONTEXT_DIM } from './contextual-bandit.js';
export { ContextScorer, ScoredNode } from './scorer.js';

export interface ContextRequest {
  // The task or query to gather context for
  query: string;

  // Optional: Focus on specific files
  files?: string[];

  // Optional: Focus on specific symbols
  symbols?: string[];

  // Optional: Include PRD requirements
  includePRD?: boolean;

  // Optional: Include related code via graph traversal
  includeRelated?: boolean;

  // Optional: Include similar code via vector search
  includeSimilar?: boolean;

  // Optional: Include git history
  includeHistory?: boolean;

  // Token budget for context (default: 8000)
  maxTokens?: number;
}

export interface CodeContext {
  // Files relevant to the task
  files: AssemblyFileContext[];

  // Symbols (functions, classes) relevant to the task
  symbols: AssemblySymbolContext[];

  // Import/dependency relationships
  dependencies: DependencyContext[];
}

export interface AssemblyFileContext {
  path: string;
  language: string;
  content?: string;
  relevance: number;
  source: 'graph' | 'vector' | 'direct';
}

export interface AssemblySymbolContext {
  name: string;
  kind: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  signature?: string;
  docstring?: string;
  relevance: number;
}

export interface DependencyContext {
  source: string;
  target: string;
  type: 'imports' | 'calls' | 'inherits';
}

export interface PRDContext {
  // PRDs relevant to the task
  prds: PRDInfo[];

  // Requirement chunks relevant to the task
  requirements: RequirementContext[];

  // Implementation links (code ↔ requirements)
  implementations: ImplementationLink[];
}

export interface PRDInfo {
  id: string;
  name: string;
  description?: string;
}

export interface RequirementContext {
  id: string;
  prdId: string;
  text: string;
  type: string;
  priority: string;
  relevance: number;
  implemented: boolean;
}

export interface ImplementationLink {
  chunkId: string;
  symbolName?: string;
  filePath: string;
  line?: number;
}

export interface AssembledContext {
  // The original query
  query: string;

  // Code-related context
  code: CodeContext;

  // PRD/requirements context
  prd: PRDContext;

  // Formatted context for AI prompt
  formatted: string;

  // Metadata about context assembly
  meta: {
    totalTokens: number;
    sources: {
      graph: number;
      vector: number;
      prd: number;
    };
    assemblyTime: number;
  };
}

/**
 * Context Assembler - gathers multi-layer context for AI code generation
 */
export class ContextAssembler {
  private graph: GraphManager;
  private vector: VectorManager;

  constructor(graph: GraphManager, vector: VectorManager) {
    this.graph = graph;
    this.vector = vector;
  }

  /**
   * Assemble context for a given request
   */
  async assemble(request: ContextRequest): Promise<AssembledContext> {
    const startTime = Date.now();
    const maxTokens = request.maxTokens || 8000;

    // Initialize result structure
    const code: CodeContext = {
      files: [] as AssemblyFileContext[],
      symbols: [] as AssemblySymbolContext[],
      dependencies: [] as DependencyContext[]
    };

    const prd: PRDContext = {
      prds: [],
      requirements: [],
      implementations: []
    };

    const sources = { graph: 0, vector: 0, prd: 0 };

    // 1. Get directly mentioned files/symbols
    if (request.files?.length) {
      for (const filePath of request.files) {
        const fileInfo = await this.getFileContext(filePath);
        if (fileInfo) {
          code.files.push({ ...fileInfo, relevance: 1.0, source: 'direct' });
        }
      }
    }

    if (request.symbols?.length) {
      for (const symbolName of request.symbols) {
        const symbolInfo = await this.getSymbolContext(symbolName);
        if (symbolInfo) {
          code.symbols.push({ ...symbolInfo, relevance: 1.0 });
        }
      }
    }

    // 2. Get related code via graph traversal
    if (request.includeRelated !== false) {
      const related = await this.getRelatedCode(request.query, code.files, code.symbols);
      code.files.push(...related.files);
      code.symbols.push(...related.symbols);
      code.dependencies.push(...related.dependencies);
      sources.graph = related.files.length + related.symbols.length;
    }

    // 3. Get similar code via vector search
    if (request.includeSimilar !== false) {
      const similar = await this.getSimilarCode(request.query);
      // Merge with existing, avoiding duplicates
      for (const file of similar.files) {
        if (!code.files.find(f => f.path === file.path)) {
          code.files.push(file);
        }
      }
      for (const symbol of similar.symbols) {
        if (!code.symbols.find(s => s.name === symbol.name && s.file === symbol.file)) {
          code.symbols.push(symbol);
        }
      }
      sources.vector = similar.files.length + similar.symbols.length;
    }

    // 4. Get PRD requirements context
    if (request.includePRD !== false) {
      const prdContext = await this.getPRDContext(request.query, code.symbols);
      prd.prds = prdContext.prds;
      prd.requirements = prdContext.requirements;
      prd.implementations = prdContext.implementations;
      sources.prd = prd.requirements.length;
    }

    // 5. Sort by relevance and trim to token budget
    code.files.sort((a, b) => b.relevance - a.relevance);
    code.symbols.sort((a, b) => b.relevance - a.relevance);
    prd.requirements.sort((a, b) => b.relevance - a.relevance);

    // 6. Format context for AI
    const formatted = this.formatContext(request.query, code, prd, maxTokens);

    const assemblyTime = Date.now() - startTime;

    return {
      query: request.query,
      code,
      prd,
      formatted,
      meta: {
        totalTokens: this.estimateTokens(formatted),
        sources,
        assemblyTime
      }
    };
  }

  /**
   * Get file context from graph
   */
  private async getFileContext(filePath: string): Promise<Omit<AssemblyFileContext, 'relevance' | 'source'> | null> {
    const result = await this.graph.query(`
      MATCH (f:File {path: $path})
      RETURN f.path as path, f.language as language
    `, { path: filePath });

    if (result.length === 0) return null;

    return {
      path: result[0].path,
      language: result[0].language || 'unknown'
    };
  }

  /**
   * Get symbol context from graph
   */
  private async getSymbolContext(symbolName: string): Promise<Omit<AssemblySymbolContext, 'relevance'> | null> {
    const result = await this.graph.query(`
      MATCH (s:Symbol {name: $name})
      MATCH (f:File)-[:DEFINES]->(s)
      RETURN s.name as name, s.kind as kind, f.path as file,
             s.line_start as lineStart, s.line_end as lineEnd,
             s.signature as signature, s.docstring as docstring
    `, { name: symbolName });

    if (result.length === 0) return null;

    return {
      name: result[0].name,
      kind: result[0].kind,
      file: result[0].file,
      lineStart: result[0].lineStart,
      lineEnd: result[0].lineEnd,
      signature: result[0].signature,
      docstring: result[0].docstring
    };
  }

  /**
   * Get related code via graph traversal
   */
  private async getRelatedCode(
    query: string,
    existingFiles: AssemblyFileContext[],
    existingSymbols: AssemblySymbolContext[]
  ): Promise<{ files: AssemblyFileContext[]; symbols: AssemblySymbolContext[]; dependencies: DependencyContext[] }> {
    const files: AssemblyFileContext[] = [];
    const symbols: AssemblySymbolContext[] = [];
    const dependencies: DependencyContext[] = [];

    // Get imports/dependencies for existing files
    for (const file of existingFiles) {
      const imports = await this.graph.query(`
        MATCH (f:File {path: $path})-[:IMPORTS]->(imported:File)
        RETURN imported.path as path, imported.language as language
      `, { path: file.path });

      for (const imp of imports) {
        if (!files.find(f => f.path === imp.path)) {
          files.push({
            path: imp.path,
            language: imp.language || 'unknown',
            relevance: 0.7,
            source: 'graph'
          });
          dependencies.push({
            source: file.path,
            target: imp.path,
            type: 'imports'
          });
        }
      }
    }

    // Get callers/callees for existing symbols
    for (const symbol of existingSymbols) {
      const calls = await this.graph.query(`
        MATCH (s:Symbol {name: $name})-[:CALLS]->(called:Symbol)
        MATCH (f:File)-[:DEFINES]->(called)
        RETURN called.name as name, called.kind as kind, f.path as file,
               called.line_start as lineStart, called.line_end as lineEnd
      `, { name: symbol.name });

      for (const call of calls) {
        if (!symbols.find(s => s.name === call.name && s.file === call.file)) {
          symbols.push({
            name: call.name,
            kind: call.kind,
            file: call.file,
            lineStart: call.lineStart,
            lineEnd: call.lineEnd,
            relevance: 0.6
          });
          dependencies.push({
            source: symbol.name,
            target: call.name,
            type: 'calls'
          });
        }
      }
    }

    return { files, symbols, dependencies };
  }

  /**
   * Get similar code via vector search
   */
  private async getSimilarCode(query: string): Promise<{ files: AssemblyFileContext[]; symbols: AssemblySymbolContext[] }> {
    const files: AssemblyFileContext[] = [];
    const symbols: AssemblySymbolContext[] = [];

    try {
      // Search for similar code chunks
      const results = await this.vector.search('code_chunks', query, 10);

      for (const result of results) {
        const payload = result.payload as Record<string, unknown>;

        if (payload.type === 'file') {
          files.push({
            path: payload.path as string,
            language: payload.language as string || 'unknown',
            relevance: result.score,
            source: 'vector'
          });
        } else if (payload.type === 'symbol') {
          symbols.push({
            name: payload.name as string,
            kind: payload.kind as string,
            file: payload.file as string,
            lineStart: payload.line_start as number || 0,
            lineEnd: payload.line_end as number || 0,
            relevance: result.score
          });
        }
      }
    } catch {
      // Vector search may not be available
    }

    return { files, symbols };
  }

  /**
   * Get PRD requirements context
   */
  private async getPRDContext(
    query: string,
    symbols: AssemblySymbolContext[]
  ): Promise<{ prds: PRDInfo[]; requirements: RequirementContext[]; implementations: ImplementationLink[] }> {
    const prds: PRDInfo[] = [];
    const requirements: RequirementContext[] = [];
    const implementations: ImplementationLink[] = [];

    try {
      // Search for relevant requirements via vector search
      const vectorResults = await this.vector.search('prd_chunks', query, 10);

      const seenPrdIds = new Set<string>();

      for (const result of vectorResults) {
        const payload = result.payload as Record<string, unknown>;
        const prdId = payload.prd_id as string;

        // Get PRD info if we haven't seen it
        if (prdId && !seenPrdIds.has(prdId)) {
          seenPrdIds.add(prdId);
          const prdResult = await this.graph.query(`
            MATCH (p:PRD {id: $id})
            RETURN p.name as name, p.description as description
          `, { id: prdId });

          if (prdResult.length > 0) {
            prds.push({
              id: prdId,
              name: prdResult[0].name,
              description: prdResult[0].description
            });
          }
        }

        // Check if this requirement is implemented
        const implResult = await this.graph.query(`
          MATCH (s:Symbol)-[:IMPLEMENTS]->(c:Chunk {id: $id})
          RETURN s.name as symbol, s.file as file
          LIMIT 1
        `, { id: result.id });

        const implemented = implResult.length > 0;

        requirements.push({
          id: result.id as string,
          prdId: prdId || '',
          text: payload.text as string,
          type: payload.chunk_type as string || 'requirement',
          priority: payload.priority as string || 'medium',
          relevance: result.score,
          implemented
        });

        // Add implementation links
        if (implemented) {
          implementations.push({
            chunkId: result.id as string,
            symbolName: implResult[0].symbol,
            filePath: implResult[0].file
          });
        }
      }

      // Also get requirements linked to current symbols
      for (const symbol of symbols) {
        const linkedReqs = await this.graph.query(`
          MATCH (s:Symbol {name: $name})-[:IMPLEMENTS]->(c:Chunk)
          RETURN c.id as id, c.prd_id as prd_id, c.text as text,
                 c.chunk_type as type, c.priority as priority
        `, { name: symbol.name });

        for (const req of linkedReqs) {
          if (!requirements.find(r => r.id === req.id)) {
            requirements.push({
              id: req.id,
              prdId: req.prd_id,
              text: req.text,
              type: req.type || 'requirement',
              priority: req.priority || 'medium',
              relevance: 0.9, // High relevance since directly linked
              implemented: true
            });

            implementations.push({
              chunkId: req.id,
              symbolName: symbol.name,
              filePath: symbol.file
            });
          }
        }
      }
    } catch {
      // Vector search or graph query may fail
    }

    return { prds, requirements, implementations };
  }

  /**
   * Format context for AI prompt
   */
  private formatContext(
    query: string,
    code: CodeContext,
    prd: PRDContext,
    maxTokens: number
  ): string {
    const sections: string[] = [];

    // Task section
    sections.push('## Task');
    sections.push(query);
    sections.push('');

    // Requirements section (PRD context)
    if (prd.requirements.length > 0) {
      sections.push('## Requirements');
      sections.push('The following requirements are relevant to this task:');
      sections.push('');

      for (const req of prd.requirements.slice(0, 5)) {
        const status = req.implemented ? '✓' : '○';
        const priority = req.priority === 'critical' ? '🔴' :
          req.priority === 'high' ? '🟡' : '⚪';
        sections.push(`${status} [${priority} ${req.priority}] ${req.text}`);
        sections.push('');
      }
    }

    // Code Context section
    if (code.symbols.length > 0) {
      sections.push('## Relevant Code');
      sections.push('');

      for (const symbol of code.symbols.slice(0, 10)) {
        sections.push(`### ${symbol.name} (${symbol.kind})`);
        sections.push(`File: ${symbol.file}:${symbol.lineStart}`);
        if (symbol.signature) {
          sections.push(`\`\`\`\n${symbol.signature}\n\`\`\``);
        }
        if (symbol.docstring) {
          sections.push(symbol.docstring);
        }
        sections.push('');
      }
    }

    // Dependencies section
    if (code.dependencies.length > 0) {
      sections.push('## Dependencies');
      for (const dep of code.dependencies.slice(0, 10)) {
        sections.push(`- ${dep.source} ${dep.type} ${dep.target}`);
      }
      sections.push('');
    }

    // Implementation status
    if (prd.implementations.length > 0) {
      sections.push('## Implementation Links');
      sections.push('These symbols implement the requirements:');
      for (const impl of prd.implementations.slice(0, 5)) {
        sections.push(`- ${impl.symbolName || impl.filePath} → ${impl.chunkId}`);
      }
      sections.push('');
    }

    let formatted = sections.join('\n');

    // Trim to token budget
    const estimatedTokens = this.estimateTokens(formatted);
    if (estimatedTokens > maxTokens) {
      // Simple truncation - could be smarter
      const ratio = maxTokens / estimatedTokens;
      formatted = formatted.slice(0, Math.floor(formatted.length * ratio));
      formatted += '\n\n[Context truncated to fit token budget]';
    }

    return formatted;
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}

/**
 * Factory function to create context assembler
 */
export function createContextAssembler(
  graph: GraphManager,
  vector: VectorManager
): ContextAssembler {
  return new ContextAssembler(graph, vector);
}

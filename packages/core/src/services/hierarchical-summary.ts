/**
 * Hierarchical Summary Service
 * Generates multi-level summaries for code (symbol, file, directory, repo)
 * Used for traversal-aware context in Claude Code integration
 */

import {
  ParsedFile,
  SymbolNode,
  HierarchicalSummaryPayload,
  HierarchyLevel,
  HierarchicalSummaryOptions,
  SummaryGenerationResult
} from '@cv-git/shared';
import { VectorManager } from '../vector/index.js';
import { GraphManager } from '../graph/index.js';
import * as crypto from 'crypto';
import * as path from 'path';

export interface SummaryContext {
  /** LLM API function for generating summaries */
  generateSummary?: (prompt: string, maxTokens?: number) => Promise<string>;
  /** Use simple extraction instead of LLM */
  useFallback?: boolean;
}

/**
 * Service for generating and managing hierarchical code summaries
 */
export class HierarchicalSummaryService {
  private summaryCache: Map<string, HierarchicalSummaryPayload> = new Map();

  constructor(
    private vector: VectorManager,
    private graph: GraphManager,
    private context: SummaryContext = {}
  ) {}

  /**
   * Generate a summary for a single symbol (function, class, etc.)
   * Level 1 summary
   */
  async generateSymbolSummary(
    symbol: SymbolNode,
    code: string,
    options?: HierarchicalSummaryOptions
  ): Promise<HierarchicalSummaryPayload> {
    const id = `symbol:${symbol.qualifiedName}`;
    const contentHash = this.hashContent(code);

    // Check if we already have a valid summary
    const existing = this.summaryCache.get(id);
    if (existing && existing.contentHash === contentHash && options?.skipUnchanged !== false) {
      return existing;
    }

    // Generate summary
    let summary: string;
    let keywords: string[];

    if (this.context.generateSummary && !this.context.useFallback) {
      // Use LLM for high-quality summary
      const prompt = this.buildSymbolSummaryPrompt(symbol, code);
      const response = await this.context.generateSummary(prompt, options?.maxTokens || 150);
      const parsed = this.parseSymbolSummaryResponse(response);
      summary = parsed.summary;
      keywords = parsed.keywords;
    } else {
      // Fallback: extract from docstring or generate simple summary
      summary = this.extractSymbolSummary(symbol, code);
      keywords = this.extractKeywords(code);
    }

    const payload: HierarchicalSummaryPayload = {
      id,
      level: 1,
      path: symbol.qualifiedName,
      parent: `file:${symbol.file}`,
      summary,
      keywords,
      contentHash,
      symbolKind: symbol.kind,
      lastModified: Date.now()
    };

    this.summaryCache.set(id, payload);
    return payload;
  }

  /**
   * Generate a summary for a file (aggregates symbol summaries)
   * Level 2 summary
   */
  async generateFileSummary(
    parsedFile: ParsedFile,
    symbolSummaries: HierarchicalSummaryPayload[],
    options?: HierarchicalSummaryOptions
  ): Promise<HierarchicalSummaryPayload> {
    const id = `file:${parsedFile.path}`;
    const contentHash = this.hashContent(parsedFile.content);

    // Check if we already have a valid summary
    const existing = this.summaryCache.get(id);
    if (existing && existing.contentHash === contentHash && options?.skipUnchanged !== false) {
      return existing;
    }

    // Aggregate symbol summaries
    const symbolTexts = symbolSummaries
      .slice(0, options?.maxSymbolsPerFile || 50)
      .map(s => `- ${s.path.split(':').pop()}: ${s.summary}`)
      .join('\n');

    let summary: string;
    let keywords: string[];

    if (this.context.generateSummary && !this.context.useFallback) {
      // Use LLM for high-quality summary
      const prompt = this.buildFileSummaryPrompt(parsedFile, symbolTexts);
      const response = await this.context.generateSummary(prompt, options?.maxTokens || 200);
      const parsed = this.parseFileSummaryResponse(response);
      summary = parsed.summary;
      keywords = parsed.keywords;
    } else {
      // Fallback: combine symbol summaries
      summary = this.extractFileSummary(parsedFile, symbolSummaries);
      keywords = this.aggregateKeywords(symbolSummaries);
    }

    // Determine parent directory
    const dirPath = path.dirname(parsedFile.path);
    const parent = dirPath === '.' ? `repo:${this.vector.getRepoId() || 'default'}` : `dir:${dirPath}`;

    const payload: HierarchicalSummaryPayload = {
      id,
      level: 2,
      path: parsedFile.path,
      parent,
      children: symbolSummaries.map(s => s.id),
      summary,
      keywords,
      contentHash,
      symbolCount: symbolSummaries.length,
      languages: [parsedFile.language],
      lastModified: Date.now()
    };

    this.summaryCache.set(id, payload);
    return payload;
  }

  /**
   * Generate a summary for a directory (aggregates file summaries)
   * Level 3 summary
   */
  async generateDirectorySummary(
    dirPath: string,
    fileSummaries: HierarchicalSummaryPayload[],
    options?: HierarchicalSummaryOptions
  ): Promise<HierarchicalSummaryPayload> {
    const id = `dir:${dirPath}`;

    // Content hash based on child file hashes
    const contentHash = this.hashContent(
      fileSummaries.map(f => f.contentHash).sort().join('')
    );

    // Check if we already have a valid summary
    const existing = this.summaryCache.get(id);
    if (existing && existing.contentHash === contentHash && options?.skipUnchanged !== false) {
      return existing;
    }

    // Aggregate file summaries
    const fileTexts = fileSummaries
      .slice(0, options?.maxFilesPerDirectory || 100)
      .map(f => `- ${path.basename(f.path)}: ${f.summary}`)
      .join('\n');

    let summary: string;
    let keywords: string[];

    if (this.context.generateSummary && !this.context.useFallback) {
      // Use LLM for high-quality summary
      const prompt = this.buildDirectorySummaryPrompt(dirPath, fileTexts);
      const response = await this.context.generateSummary(prompt, options?.maxTokens || 250);
      const parsed = this.parseDirectorySummaryResponse(response);
      summary = parsed.summary;
      keywords = parsed.keywords;
    } else {
      // Fallback: combine file summaries
      summary = this.extractDirectorySummary(dirPath, fileSummaries);
      keywords = this.aggregateKeywords(fileSummaries);
    }

    // Determine parent directory
    const parentDir = path.dirname(dirPath);
    const parent = parentDir === '.' || parentDir === dirPath
      ? `repo:${this.vector.getRepoId() || 'default'}`
      : `dir:${parentDir}`;

    // Count total symbols and collect languages
    const totalSymbols = fileSummaries.reduce((sum, f) => sum + (f.symbolCount || 0), 0);
    const languages = [...new Set(fileSummaries.flatMap(f => f.languages || []))];

    const payload: HierarchicalSummaryPayload = {
      id,
      level: 3,
      path: dirPath,
      parent,
      children: fileSummaries.map(f => f.id),
      summary,
      keywords,
      contentHash,
      symbolCount: totalSymbols,
      fileCount: fileSummaries.length,
      languages,
      lastModified: Date.now()
    };

    this.summaryCache.set(id, payload);
    return payload;
  }

  /**
   * Generate all summaries bottom-up for a set of parsed files
   * Returns summaries at all levels
   */
  async generateAllSummaries(
    parsedFiles: ParsedFile[],
    options?: HierarchicalSummaryOptions
  ): Promise<SummaryGenerationResult> {
    const result: SummaryGenerationResult = {
      count: 0,
      byLevel: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 },
      skipped: 0,
      errors: []
    };

    const allSummaries: HierarchicalSummaryPayload[] = [];

    // Level 1: Symbol summaries
    console.log('Generating symbol summaries...');
    const symbolSummariesByFile = new Map<string, HierarchicalSummaryPayload[]>();

    for (const file of parsedFiles) {
      const fileSummaries: HierarchicalSummaryPayload[] = [];

      for (const symbol of file.symbols.slice(0, options?.maxSymbolsPerFile || 50)) {
        try {
          // Find the code for this symbol
          const code = this.extractSymbolCode(file, symbol);
          const summary = await this.generateSymbolSummary(symbol, code, options);
          fileSummaries.push(summary);
          allSummaries.push(summary);
          result.byLevel[1]++;
        } catch (error: any) {
          result.errors.push(`Symbol ${symbol.qualifiedName}: ${error.message}`);
        }
      }

      symbolSummariesByFile.set(file.path, fileSummaries);
    }

    // Level 2: File summaries
    console.log('Generating file summaries...');
    const fileSummariesByDir = new Map<string, HierarchicalSummaryPayload[]>();

    for (const file of parsedFiles) {
      try {
        const symbolSummaries = symbolSummariesByFile.get(file.path) || [];
        const summary = await this.generateFileSummary(file, symbolSummaries, options);
        allSummaries.push(summary);
        result.byLevel[2]++;

        // Group by directory
        const dirPath = path.dirname(file.path);
        const existing = fileSummariesByDir.get(dirPath) || [];
        existing.push(summary);
        fileSummariesByDir.set(dirPath, existing);
      } catch (error: any) {
        result.errors.push(`File ${file.path}: ${error.message}`);
      }
    }

    // Level 3: Directory summaries (bottom-up)
    console.log('Generating directory summaries...');
    const dirSummaries = new Map<string, HierarchicalSummaryPayload>();

    // Sort directories by depth (deepest first) for bottom-up processing
    const directories = [...fileSummariesByDir.keys()].sort(
      (a, b) => b.split('/').length - a.split('/').length
    );

    for (const dirPath of directories) {
      if (dirPath === '.') continue; // Skip root directory

      try {
        const fileSummaries = fileSummariesByDir.get(dirPath) || [];

        // Include child directory summaries
        const childDirSummaries: HierarchicalSummaryPayload[] = [];
        for (const [childDir, summary] of dirSummaries) {
          if (path.dirname(childDir) === dirPath) {
            childDirSummaries.push(summary);
          }
        }

        const allChildSummaries = [...fileSummaries, ...childDirSummaries];

        if (allChildSummaries.length > 0) {
          const summary = await this.generateDirectorySummary(dirPath, allChildSummaries, options);
          dirSummaries.set(dirPath, summary);
          allSummaries.push(summary);
          result.byLevel[3]++;
        }
      } catch (error: any) {
        result.errors.push(`Directory ${dirPath}: ${error.message}`);
      }
    }

    result.count = allSummaries.length;

    // Store all summaries in vector database
    if (allSummaries.length > 0) {
      console.log(`Storing ${allSummaries.length} summaries in vector database...`);
      await this.storeSummaries(allSummaries);
    }

    return result;
  }

  /**
   * Store summaries in the vector database
   */
  private async storeSummaries(summaries: HierarchicalSummaryPayload[]): Promise<void> {
    // Generate embeddings for all summaries
    const texts = summaries.map(s => s.summary);
    const embeddings = await this.vector.embedBatch(texts);

    // Prepare batch for upsert
    const items = summaries.map((summary, idx) => ({
      summary,
      vector: embeddings[idx]
    }));

    await this.vector.upsertSummaryBatch(items);
  }

  // ========== Prompt Building Methods ==========

  private buildSymbolSummaryPrompt(symbol: SymbolNode, code: string): string {
    return `Summarize this ${symbol.kind} in 1-2 sentences. Focus on what it does, not implementation details.

${symbol.kind}: ${symbol.name}
File: ${symbol.file}
${symbol.docstring ? `Docstring: ${symbol.docstring}` : ''}

Code:
\`\`\`
${code.slice(0, 1000)}
\`\`\`

Respond with:
SUMMARY: <your summary>
KEYWORDS: <comma-separated keywords>`;
  }

  private buildFileSummaryPrompt(file: ParsedFile, symbolTexts: string): string {
    return `Summarize this ${file.language} file in 2-3 sentences. Focus on its purpose and main functionality.

File: ${file.path}
Language: ${file.language}
Symbols:
${symbolTexts}

Respond with:
SUMMARY: <your summary>
KEYWORDS: <comma-separated keywords>`;
  }

  private buildDirectorySummaryPrompt(dirPath: string, fileTexts: string): string {
    return `Summarize this directory/module in 2-3 sentences. Focus on its purpose and what it provides.

Directory: ${dirPath}
Contents:
${fileTexts}

Respond with:
SUMMARY: <your summary>
KEYWORDS: <comma-separated keywords>`;
  }

  // ========== Response Parsing Methods ==========

  private parseSymbolSummaryResponse(response: string): { summary: string; keywords: string[] } {
    const summaryMatch = response.match(/SUMMARY:\s*(.+?)(?=KEYWORDS:|$)/s);
    const keywordsMatch = response.match(/KEYWORDS:\s*(.+)/s);

    return {
      summary: summaryMatch?.[1]?.trim() || response.trim(),
      keywords: keywordsMatch?.[1]?.split(',').map(k => k.trim()).filter(k => k) || []
    };
  }

  private parseFileSummaryResponse(response: string): { summary: string; keywords: string[] } {
    return this.parseSymbolSummaryResponse(response);
  }

  private parseDirectorySummaryResponse(response: string): { summary: string; keywords: string[] } {
    return this.parseSymbolSummaryResponse(response);
  }

  // ========== Fallback Extraction Methods ==========

  private extractSymbolSummary(symbol: SymbolNode, _code: string): string {
    if (symbol.docstring) {
      // Extract first sentence from docstring
      const firstSentence = symbol.docstring.split(/[.!?]/)[0];
      return firstSentence.trim() + '.';
    }

    // Generate simple summary from symbol metadata
    const kindDesc = symbol.kind === 'function' ? 'Function' :
                     symbol.kind === 'method' ? 'Method' :
                     symbol.kind === 'class' ? 'Class' :
                     symbol.kind === 'interface' ? 'Interface' :
                     symbol.kind.charAt(0).toUpperCase() + symbol.kind.slice(1);

    return `${kindDesc} ${symbol.name} in ${path.basename(symbol.file)}.`;
  }

  private extractFileSummary(file: ParsedFile, symbolSummaries: HierarchicalSummaryPayload[]): string {
    const exports = file.exports.slice(0, 5).map(e => e.name).join(', ');
    const symbolCount = symbolSummaries.length;

    if (exports) {
      return `${file.language} file exporting ${exports}. Contains ${symbolCount} symbol${symbolCount !== 1 ? 's' : ''}.`;
    }

    return `${file.language} file with ${symbolCount} symbol${symbolCount !== 1 ? 's' : ''}.`;
  }

  private extractDirectorySummary(dirPath: string, fileSummaries: HierarchicalSummaryPayload[]): string {
    const fileCount = fileSummaries.length;
    const languages = [...new Set(fileSummaries.flatMap(f => f.languages || []))];
    const langStr = languages.length > 0 ? languages.join(', ') : 'mixed';

    return `${path.basename(dirPath)} module with ${fileCount} ${langStr} file${fileCount !== 1 ? 's' : ''}.`;
  }

  // ========== Helper Methods ==========

  private extractSymbolCode(file: ParsedFile, symbol: SymbolNode): string {
    const lines = file.content.split('\n');
    const startLine = Math.max(0, symbol.startLine - 1);
    const endLine = Math.min(lines.length, symbol.endLine);
    return lines.slice(startLine, endLine).join('\n');
  }

  private extractKeywords(code: string): string[] {
    // Extract identifiers as keywords
    const identifiers = code.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
    const counts = new Map<string, number>();

    for (const id of identifiers) {
      if (id.length > 2 && !this.isCommonWord(id)) {
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    }

    // Return top keywords by frequency
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k]) => k);
  }

  private aggregateKeywords(summaries: HierarchicalSummaryPayload[]): string[] {
    const counts = new Map<string, number>();

    for (const summary of summaries) {
      for (const keyword of summary.keywords) {
        counts.set(keyword, (counts.get(keyword) || 0) + 1);
      }
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([k]) => k);
  }

  private isCommonWord(word: string): boolean {
    const common = new Set([
      'if', 'else', 'for', 'while', 'return', 'const', 'let', 'var',
      'function', 'class', 'import', 'export', 'from', 'async', 'await',
      'try', 'catch', 'throw', 'new', 'this', 'true', 'false', 'null',
      'undefined', 'string', 'number', 'boolean', 'any', 'void', 'type',
      'interface', 'extends', 'implements', 'private', 'public', 'static',
      'def', 'self', 'None', 'True', 'False', 'and', 'or', 'not', 'in',
      'func', 'package', 'struct', 'impl', 'pub', 'use', 'mod', 'fn'
    ]);
    return common.has(word);
  }

  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * Clear the summary cache
   */
  clearCache(): void {
    this.summaryCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number } {
    return { size: this.summaryCache.size };
  }
}

/**
 * Create a HierarchicalSummaryService instance
 */
export function createHierarchicalSummaryService(
  vector: VectorManager,
  graph: GraphManager,
  context?: SummaryContext
): HierarchicalSummaryService {
  return new HierarchicalSummaryService(vector, graph, context);
}

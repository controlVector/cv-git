/**
 * Base Parser Interface
 * Defines the contract that all language-specific parsers must implement
 * Based on FalkorDB code-graph-backend modular analyzer pattern
 */

import Parser from 'tree-sitter';
import {
  ParsedFile,
  SymbolNode,
  Import,
  Export,
  CodeChunk
} from '@cv-git/shared';

/**
 * Tree-sitter node interface
 * Abstraction over tree-sitter's native node type
 */
export interface TreeSitterNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: TreeSitterNode[];
  childForFieldName(name: string): TreeSitterNode | null;
  namedChildren: TreeSitterNode[];
}

/**
 * Language-specific parser configuration
 */
export interface ParserConfig {
  language: string;
  extensions: string[];
  commentPatterns?: {
    singleLine?: string[];
    multiLineStart?: string[];
    multiLineEnd?: string[];
    docComment?: string[];
  };
}

/**
 * Base parser interface that all language parsers implement
 */
export interface ILanguageParser {
  /**
   * Get the language this parser handles
   */
  getLanguage(): string;

  /**
   * Get supported file extensions
   */
  getSupportedExtensions(): string[];

  /**
   * Initialize the tree-sitter parser for this language
   */
  initialize(): void;

  /**
   * Parse a file and extract all information
   */
  parseFile(filePath: string, content: string): Promise<ParsedFile>;

  /**
   * Extract symbols from AST
   */
  extractSymbols(node: TreeSitterNode, filePath: string, content: string): SymbolNode[];

  /**
   * Extract imports from AST
   */
  extractImports(node: TreeSitterNode, content: string): Import[];

  /**
   * Extract exports from AST
   */
  extractExports(node: TreeSitterNode): Export[];

  /**
   * Chunk code for embedding
   */
  chunkCode(content: string, symbols: SymbolNode[], filePath: string): CodeChunk[];
}

/**
 * Abstract base class implementing common parser functionality
 * Language-specific parsers extend this class
 */
export abstract class BaseLanguageParser implements ILanguageParser {
  protected parser: Parser | null = null;
  protected config: ParserConfig;

  constructor(config: ParserConfig) {
    this.config = config;
  }

  abstract getLanguage(): string;
  abstract getSupportedExtensions(): string[];
  abstract initialize(): void;

  /**
   * Parse a file - common implementation
   */
  async parseFile(filePath: string, content: string): Promise<ParsedFile> {
    if (!this.parser) {
      throw new Error(`Parser not initialized for ${this.getLanguage()}`);
    }

    const tree = this.parser.parse(content);
    const absolutePath = filePath; // Assume already absolute

    // Extract symbols
    const symbols = this.extractSymbols(tree.rootNode as any, filePath, content);

    // Extract imports
    const imports = this.extractImports(tree.rootNode as any, content);

    // Extract exports
    const exports = this.extractExports(tree.rootNode as any);

    // Create code chunks
    const chunks = this.chunkCode(content, symbols, filePath);

    return {
      path: filePath,
      absolutePath,
      language: this.getLanguage(),
      content,
      symbols,
      imports,
      exports,
      chunks
    };
  }

  /**
   * Default symbol extraction - override in language-specific parsers
   */
  abstract extractSymbols(node: TreeSitterNode, filePath: string, content: string): SymbolNode[];

  /**
   * Default import extraction - override in language-specific parsers
   */
  abstract extractImports(node: TreeSitterNode, content: string): Import[];

  /**
   * Default export extraction - override in language-specific parsers
   */
  abstract extractExports(node: TreeSitterNode): Export[];

  /**
   * Chunk code for embedding - common implementation
   */
  chunkCode(content: string, symbols: SymbolNode[], filePath: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');

    // Chunk by symbol (preferred)
    for (const symbol of symbols) {
      if (symbol.kind === 'function' || symbol.kind === 'method' || symbol.kind === 'class') {
        const text = lines.slice(symbol.startLine - 1, symbol.endLine).join('\n');

        chunks.push({
          id: this.generateChunkId(filePath, symbol.startLine, symbol.endLine),
          file: filePath,
          language: this.getLanguage(),
          startLine: symbol.startLine,
          endLine: symbol.endLine,
          text,
          symbolName: symbol.name,
          symbolKind: symbol.kind,
          summary: symbol.docstring,
          docstring: symbol.docstring,
          complexity: symbol.complexity
        });
      }
    }

    // If no symbols or file is small, chunk the whole file
    if (chunks.length === 0 && lines.length < 200) {
      chunks.push({
        id: this.generateChunkId(filePath, 1, lines.length),
        file: filePath,
        language: this.getLanguage(),
        startLine: 1,
        endLine: lines.length,
        text: content
      });
    }

    return chunks;
  }

  // ========== Helper Methods ==========

  /**
   * Find nodes by type recursively
   */
  protected findNodesByType(node: TreeSitterNode, types: string[]): TreeSitterNode[] {
    const results: TreeSitterNode[] = [];

    if (types.includes(node.type)) {
      results.push(node);
    }

    for (const child of node.namedChildren) {
      results.push(...this.findNodesByType(child, types));
    }

    return results;
  }

  /**
   * Get docstring/comment above a node
   */
  protected getDocstring(node: TreeSitterNode, content: string): string | undefined {
    const lines = content.split('\n');
    const nodeLine = node.startPosition.row;

    // Look for doc comments in the lines above
    const commentPatterns = this.config.commentPatterns?.docComment || ['/**', '"""', '///'];

    for (let i = nodeLine - 1; i >= Math.max(0, nodeLine - 10); i--) {
      const line = lines[i].trim();

      // Check if this line starts a doc comment
      for (const pattern of commentPatterns) {
        if (line.startsWith(pattern)) {
          const docLines: string[] = [];
          for (let j = i; j < nodeLine; j++) {
            docLines.push(lines[j]);
          }
          return docLines.join('\n').trim();
        }
      }

      // Stop if we hit non-comment code
      if (line && !this.isComment(line)) {
        break;
      }
    }

    return undefined;
  }

  /**
   * Check if a line is a comment
   */
  protected isComment(line: string): boolean {
    const trimmed = line.trim();

    // Single line comments
    const singleLinePatterns = this.config.commentPatterns?.singleLine || ['//', '#'];
    for (const pattern of singleLinePatterns) {
      if (trimmed.startsWith(pattern)) {
        return true;
      }
    }

    // Multi-line comment markers
    const multiStartPatterns = this.config.commentPatterns?.multiLineStart || ['/*', '"""'];
    const multiEndPatterns = this.config.commentPatterns?.multiLineEnd || ['*/', '"""'];

    for (const pattern of [...multiStartPatterns, ...multiEndPatterns, '*']) {
      if (trimmed.startsWith(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate cyclomatic complexity
   */
  protected calculateComplexity(node: TreeSitterNode): number {
    // Simple cyclomatic complexity calculation
    let complexity = 1;

    const controlFlowTypes = [
      'if_statement',
      'elif_clause',
      'else_clause',
      'for_statement',
      'while_statement',
      'do_statement',
      'switch_statement',
      'case',
      'catch_clause',
      'ternary_expression',
      'conditional_expression'
    ];

    const controlFlowNodes = this.findNodesByType(node, controlFlowTypes);
    complexity += controlFlowNodes.length;

    return complexity;
  }

  /**
   * Generate unique chunk ID
   */
  protected generateChunkId(filePath: string, startLine: number, endLine: number): string {
    return `${filePath}:${startLine}-${endLine}`;
  }

  /**
   * Check if node is inside a conditional block
   */
  protected isInsideConditional(node: TreeSitterNode, rootNode: TreeSitterNode): boolean {
    const conditionalTypes = [
      'if_statement',
      'else_clause',
      'try_statement',
      'catch_clause',
      'switch_statement',
      'case',
      'ternary_expression'
    ];

    const conditionals = this.findNodesByType(rootNode, conditionalTypes);

    for (const conditional of conditionals) {
      if (this.nodeContains(conditional, node)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if parent node contains child node
   */
  protected nodeContains(parent: TreeSitterNode, child: TreeSitterNode): boolean {
    const parentStart = parent.startPosition.row;
    const parentEnd = parent.endPosition.row;
    const childStart = child.startPosition.row;
    const childEnd = child.endPosition.row;

    return childStart >= parentStart && childEnd <= parentEnd;
  }
}

/**
 * Simple Parser (Fallback)
 *
 * Basic code chunking without tree-sitter. Used when tree-sitter
 * native modules are not available (e.g., Node 24+).
 *
 * Provides basic functionality:
 * - Chunks code by function/class patterns (regex-based)
 * - Extracts basic symbols
 * - No full AST parsing
 */

import {
  ParsedFile,
  SymbolNode,
  Import,
  Export,
  CodeChunk,
  ImportType
} from '@cv-git/shared';
import { ILanguageParser, ParserConfig, TreeSitterNode } from './base.js';

/**
 * Simple regex-based parser for when tree-sitter is unavailable
 */
export class SimpleParser implements ILanguageParser {
  private config: ParserConfig;
  private patterns: {
    function: RegExp;
    class: RegExp;
    import: RegExp;
    export: RegExp;
  };

  constructor(config: ParserConfig) {
    this.config = config;
    this.patterns = this.getPatterns(config.language);
  }

  private getPatterns(language: string) {
    switch (language) {
      case 'typescript':
      case 'javascript':
        return {
          function: /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(|(\w+)\s*:\s*(?:async\s+)?\([^)]*\)\s*(?:=>|{)/gm,
          class: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm,
          import: /import\s+(?:{([^}]+)}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/gm,
          export: /export\s+(?:(default)\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/gm
        };
      case 'python':
        return {
          function: /(?:async\s+)?def\s+(\w+)\s*\(/gm,
          class: /class\s+(\w+)(?:\s*\([^)]*\))?:/gm,
          import: /(?:from\s+(\S+)\s+)?import\s+([^#\n]+)/gm,
          export: /^(?!_)(\w+)\s*=/gm
        };
      case 'go':
        return {
          function: /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/gm,
          class: /type\s+(\w+)\s+struct/gm,
          import: /import\s+(?:\(\s*)?["']([^"']+)["']/gm,
          export: /^[A-Z]\w*/gm
        };
      case 'rust':
        return {
          function: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm,
          class: /(?:pub\s+)?struct\s+(\w+)|(?:pub\s+)?enum\s+(\w+)|(?:pub\s+)?trait\s+(\w+)/gm,
          import: /use\s+([^;]+);/gm,
          export: /pub\s+(?:fn|struct|enum|trait|mod)\s+(\w+)/gm
        };
      case 'java':
        return {
          function: /(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*(?:throws\s+[^{]+)?{/gm,
          class: /(?:public\s+)?(?:abstract\s+)?(?:class|interface|enum)\s+(\w+)/gm,
          import: /import\s+(?:static\s+)?([^;]+);/gm,
          export: /public\s+(?:class|interface|enum)\s+(\w+)/gm
        };
      default:
        return {
          function: /function\s+(\w+)/gm,
          class: /class\s+(\w+)/gm,
          import: /import|require|use|include/gm,
          export: /export|public/gm
        };
    }
  }

  getLanguage(): string {
    return this.config.language;
  }

  getSupportedExtensions(): string[] {
    return this.config.extensions;
  }

  initialize(): void {
    // No-op for simple parser (no tree-sitter to initialize)
  }

  extractSymbols(_node: TreeSitterNode, _filePath: string, _content: string): SymbolNode[] {
    // Not used directly - parseFile handles extraction
    return [];
  }

  extractImports(_node: TreeSitterNode, _content: string): Import[] {
    // Not used directly - parseFile handles extraction
    return [];
  }

  extractExports(_node: TreeSitterNode): Export[] {
    // Not used directly - parseFile handles extraction
    return [];
  }

  chunkCode(_content: string, _symbols: SymbolNode[], _filePath: string): CodeChunk[] {
    // Not used directly - parseFile handles chunking
    return [];
  }

  async parseFile(filePath: string, content: string): Promise<ParsedFile> {
    const lines = content.split('\n');
    const symbols: SymbolNode[] = [];
    const imports: Import[] = [];
    const exports: Export[] = [];
    const chunks: CodeChunk[] = [];
    const now = Date.now();

    // Extract functions
    let match;
    this.patterns.function.lastIndex = 0;
    while ((match = this.patterns.function.exec(content)) !== null) {
      const name = match[1] || match[2] || match[3];
      if (name) {
        const line = content.substring(0, match.index).split('\n').length;
        const endLine = this.findEndLine(content, match.index, lines.length);
        symbols.push({
          name,
          qualifiedName: `${filePath}:${name}`,
          kind: 'function',
          file: filePath,
          startLine: line,
          endLine,
          signature: match[0].trim().substring(0, 100),
          visibility: 'public',
          isAsync: match[0].includes('async'),
          isStatic: false,
          complexity: 1,
          createdAt: now,
          updatedAt: now
        });
      }
    }

    // Extract classes
    this.patterns.class.lastIndex = 0;
    while ((match = this.patterns.class.exec(content)) !== null) {
      const name = match[1] || match[2] || match[3];
      if (name) {
        const line = content.substring(0, match.index).split('\n').length;
        const endLine = this.findEndLine(content, match.index, lines.length);
        symbols.push({
          name,
          qualifiedName: `${filePath}:${name}`,
          kind: 'class',
          file: filePath,
          startLine: line,
          endLine,
          signature: match[0].trim(),
          visibility: 'public',
          isAsync: false,
          isStatic: false,
          complexity: 1,
          createdAt: now,
          updatedAt: now
        });
      }
    }

    // Extract imports (with proper Import type)
    this.patterns.import.lastIndex = 0;
    while ((match = this.patterns.import.exec(content)) !== null) {
      const source = this.getImportSource(match);
      const importedSymbols = this.getImportedSymbols(match);
      const importType = this.getImportType(match);
      const isExternal = !source.startsWith('.') && !source.startsWith('/');

      imports.push({
        source: source.trim(),
        importedSymbols,
        importType,
        isExternal,
        line: content.substring(0, match.index).split('\n').length
      });
    }

    // Extract exports (with proper Export type)
    this.patterns.export.lastIndex = 0;
    while ((match = this.patterns.export.exec(content)) !== null) {
      const isDefault = match[1] === 'default';
      const name = match[2] || match[1] || 'default';
      if (name && name !== 'default') {
        exports.push({
          name,
          type: isDefault ? 'default' : 'named',
          line: content.substring(0, match.index).split('\n').length
        });
      }
    }

    // Create code chunks (by symbols or fixed-size blocks)
    if (symbols.length > 0) {
      for (const symbol of symbols) {
        const chunkLines = lines.slice(symbol.startLine - 1, symbol.endLine);
        chunks.push({
          id: `${filePath}:${symbol.startLine}`,
          file: filePath,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
          text: chunkLines.join('\n'),
          language: this.config.language,
          symbolName: symbol.name,
          symbolKind: symbol.kind
        });
      }
    } else {
      // Fallback: chunk by fixed line count
      const chunkSize = 50;
      for (let i = 0; i < lines.length; i += chunkSize) {
        const endLine = Math.min(i + chunkSize, lines.length);
        chunks.push({
          id: `${filePath}:${i + 1}`,
          file: filePath,
          startLine: i + 1,
          endLine,
          text: lines.slice(i, endLine).join('\n'),
          language: this.config.language
        });
      }
    }

    return {
      path: filePath,
      absolutePath: filePath,
      language: this.config.language,
      content,
      symbols,
      imports,
      exports,
      chunks
    };
  }

  private getImportSource(match: RegExpExecArray): string {
    // For JS/TS: match[4] is the source path
    // For Python: match[1] is from source, match[2] is what's imported
    // For others: match[1] is typically the source
    if (this.config.language === 'typescript' || this.config.language === 'javascript') {
      return match[4] || match[0];
    }
    if (this.config.language === 'python') {
      return match[1] || match[2] || match[0];
    }
    return match[1] || match[0];
  }

  private getImportedSymbols(match: RegExpExecArray): string[] {
    if (this.config.language === 'typescript' || this.config.language === 'javascript') {
      // match[1] = named imports {a, b}, match[2] = namespace *, match[3] = default
      if (match[1]) {
        return match[1].split(',').map(s => s.trim()).filter(Boolean);
      }
      if (match[2]) {
        return [match[2]]; // namespace import
      }
      if (match[3]) {
        return [match[3]]; // default import
      }
    }
    return ['*'];
  }

  private getImportType(match: RegExpExecArray): ImportType {
    if (this.config.language === 'typescript' || this.config.language === 'javascript') {
      if (match[1]) return 'named';
      if (match[2]) return 'namespace';
      if (match[3]) return 'default';
    }
    return 'named';
  }

  private findEndLine(content: string, startIndex: number, maxLine: number): number {
    let braceCount = 0;
    let started = false;
    let lineNum = content.substring(0, startIndex).split('\n').length;
    const lines = content.substring(startIndex).split('\n');

    for (let i = 0; i < lines.length && i < 100; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === '{' || char === '(') {
          braceCount++;
          started = true;
        } else if (char === '}' || char === ')') {
          braceCount--;
        }
      }
      if (started && braceCount <= 0) {
        return Math.min(lineNum + i, maxLine);
      }
    }
    return Math.min(lineNum + 20, maxLine);
  }
}

/**
 * Create simple parsers for all supported languages
 */
export function createSimpleParsers(): Map<string, ILanguageParser> {
  const parsers = new Map<string, ILanguageParser>();

  const configs: ParserConfig[] = [
    { language: 'typescript', extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] },
    { language: 'python', extensions: ['.py', '.pyi'] },
    { language: 'go', extensions: ['.go'] },
    { language: 'rust', extensions: ['.rs'] },
    { language: 'java', extensions: ['.java'] }
  ];

  for (const config of configs) {
    const parser = new SimpleParser(config);
    parsers.set(config.language, parser);
  }

  return parsers;
}

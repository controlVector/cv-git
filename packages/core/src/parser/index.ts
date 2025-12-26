/**
 * Parser Manager
 * Manages language-specific parsers and routes parsing requests
 * Refactored to modular architecture based on FalkorDB pattern
 */

import { ParsedFile, ParsedDocument } from '@cv-git/shared';
import { ILanguageParser } from './base.js';
import { createTypeScriptParser } from './typescript.js';
import { createPythonParser } from './python.js';
import { createGoParser } from './go.js';
import { createRustParser } from './rust.js';
import { createJavaParser } from './java.js';
import { createMarkdownParser, MarkdownParser } from './markdown.js';
import * as path from 'path';

/**
 * Main parser class that manages all language-specific parsers
 */
export class CodeParser {
  private parsers: Map<string, ILanguageParser> = new Map();
  private extensionMap: Map<string, string> = new Map();
  private markdownParser: MarkdownParser;

  constructor() {
    this.markdownParser = createMarkdownParser();
    this.initializeParsers();
  }

  /**
   * Initialize all supported language parsers
   */
  private initializeParsers(): void {
    // TypeScript/JavaScript parser
    const tsParser = createTypeScriptParser();
    this.registerParser('typescript', tsParser);

    // Python parser
    const pythonParser = createPythonParser();
    this.registerParser('python', pythonParser);

    // Go parser
    const goParser = createGoParser();
    this.registerParser('go', goParser);

    // Rust parser
    const rustParser = createRustParser();
    this.registerParser('rust', rustParser);

    // Java parser
    const javaParser = createJavaParser();
    this.registerParser('java', javaParser);

    // Register markdown extensions
    for (const ext of this.markdownParser.getSupportedExtensions()) {
      this.extensionMap.set(ext, 'markdown');
    }
  }

  /**
   * Register a language parser
   */
  private registerParser(language: string, parser: ILanguageParser): void {
    this.parsers.set(language, parser);

    // Map file extensions to language
    const extensions = parser.getSupportedExtensions();
    for (const ext of extensions) {
      this.extensionMap.set(ext, language);
    }
  }

  /**
   * Parse a file
   */
  async parseFile(filePath: string, content: string, language?: string): Promise<ParsedFile> {
    // Determine language if not provided
    if (!language) {
      language = this.detectLanguage(filePath);
    }

    // Get parser for language
    const parser = this.parsers.get(language);

    if (!parser) {
      throw new Error(`No parser available for language: ${language}`);
    }

    // Parse the file
    return await parser.parseFile(filePath, content);
  }

  /**
   * Detect language from file path
   */
  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath);

    // Check extension map
    const language = this.extensionMap.get(ext);

    if (language) {
      return language;
    }

    // Default to typescript for unknown extensions
    // This provides backwards compatibility
    return 'typescript';
  }

  /**
   * Get all supported languages
   */
  getSupportedLanguages(): string[] {
    return Array.from(this.parsers.keys());
  }

  /**
   * Get all supported file extensions
   */
  getSupportedExtensions(): string[] {
    return Array.from(this.extensionMap.keys());
  }

  /**
   * Check if a language is supported
   */
  isLanguageSupported(language: string): boolean {
    return this.parsers.has(language);
  }

  /**
   * Check if a file extension is supported
   */
  isExtensionSupported(extension: string): boolean {
    return this.extensionMap.has(extension);
  }

  /**
   * Check if a file is a markdown document
   */
  isMarkdownFile(filePath: string): boolean {
    const ext = path.extname(filePath);
    return this.markdownParser.getSupportedExtensions().includes(ext);
  }

  /**
   * Parse a markdown document
   */
  async parseDocument(filePath: string, content: string): Promise<ParsedDocument> {
    return this.markdownParser.parseFile(filePath, content);
  }

  /**
   * Get the markdown parser instance
   */
  getMarkdownParser(): MarkdownParser {
    return this.markdownParser;
  }
}

/**
 * Create a parser instance
 */
export function createParser(): CodeParser {
  return new CodeParser();
}

// Re-export base classes for extending
export { ILanguageParser, BaseLanguageParser, TreeSitterNode } from './base.js';
export { TypeScriptParser, createTypeScriptParser } from './typescript.js';
export { PythonParser, createPythonParser } from './python.js';
export { GoParser, createGoParser } from './go.js';
export { RustParser, createRustParser } from './rust.js';
export { JavaParser, createJavaParser } from './java.js';
export { MarkdownParser, createMarkdownParser, MarkdownParserConfig } from './markdown.js';

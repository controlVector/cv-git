/**
 * Parser Manager
 * Manages language-specific parsers and routes parsing requests
 * Refactored to modular architecture based on FalkorDB pattern
 */

import { ParsedFile } from '@cv-git/shared';
import { ILanguageParser } from './base.js';
import { createTypeScriptParser } from './typescript.js';
import * as path from 'path';

/**
 * Main parser class that manages all language-specific parsers
 */
export class CodeParser {
  private parsers: Map<string, ILanguageParser> = new Map();
  private extensionMap: Map<string, string> = new Map();

  constructor() {
    this.initializeParsers();
  }

  /**
   * Initialize all supported language parsers
   */
  private initializeParsers(): void {
    // TypeScript/JavaScript parser
    const tsParser = createTypeScriptParser();
    this.registerParser('typescript', tsParser);

    // TODO: Add more parsers here
    // Python: this.registerParser('python', createPythonParser());
    // Go: this.registerParser('go', createGoParser());
    // Rust: this.registerParser('rust', createRustParser());
    // Java: this.registerParser('java', createJavaParser());
  }

  /**
   * Register a language parser
   */
  private registerParser(language: string, parser: ILanguageParser): void {
    this.parsers.set(language, parser);

    // Map file extensions to language
    for (const ext of parser.getSupportedExtensions()) {
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

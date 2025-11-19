/**
 * Parser Manager
 * Manages language-specific parsers and routes parsing requests
 * Refactored to modular architecture based on FalkorDB pattern
 */

import { ParsedFile } from '@cv-git/shared';
import { ILanguageParser } from './base.js';
import { createTypeScriptParser } from './typescript.js';
import { createPythonParser } from './python.js';
import { createGoParser } from './go.js';
import { createRustParser } from './rust.js';
import { createJavaParser } from './java.js';
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
    console.log('[DEBUG] Initializing parsers...');

    // TypeScript/JavaScript parser
    console.log('[DEBUG] Creating TypeScript parser...');
    const tsParser = createTypeScriptParser();
    console.log('[DEBUG] Registering TypeScript parser...');
    this.registerParser('typescript', tsParser);

    // Python parser
    console.log('[DEBUG] Creating Python parser...');
    const pythonParser = createPythonParser();
    console.log('[DEBUG] Registering Python parser...');
    this.registerParser('python', pythonParser);

    // Go parser (disabled - needs native build)
    // console.log('[DEBUG] Creating Go parser...');
    // const goParser = createGoParser();
    // console.log('[DEBUG] Registering Go parser...');
    // this.registerParser('go', goParser);

    // Rust parser (disabled - needs native build)
    // console.log('[DEBUG] Creating Rust parser...');
    // const rustParser = createRustParser();
    // console.log('[DEBUG] Registering Rust parser...');
    // this.registerParser('rust', rustParser);

    // Java parser (disabled - needs native build)
    // console.log('[DEBUG] Creating Java parser...');
    // const javaParser = createJavaParser();
    // console.log('[DEBUG] Registering Java parser...');
    // this.registerParser('java', javaParser);

    console.log('[DEBUG] All parsers initialized successfully');
  }

  /**
   * Register a language parser
   */
  private registerParser(language: string, parser: ILanguageParser): void {
    console.log(`[DEBUG] Registering parser for ${language}`);
    this.parsers.set(language, parser);

    // Map file extensions to language
    console.log(`[DEBUG] Getting extensions for ${language}...`);
    const extensions = parser.getSupportedExtensions();
    console.log(`[DEBUG] Extensions for ${language}:`, extensions);
    console.log(`[DEBUG] Extensions length: ${extensions?.length}`);

    for (const ext of extensions) {
      console.log(`[DEBUG] Mapping ${ext} to ${language}`);
      this.extensionMap.set(ext, language);
    }
    console.log(`[DEBUG] Finished registering ${language}`);
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
export { PythonParser, createPythonParser } from './python.js';
export { GoParser, createGoParser } from './go.js';
export { RustParser, createRustParser } from './rust.js';
export { JavaParser, createJavaParser } from './java.js';

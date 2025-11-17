/**
 * AST Parser
 * Parses source files using tree-sitter and extracts symbols, imports, exports
 */

import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import {
  ParsedFile,
  SymbolNode,
  Import,
  Export,
  CodeChunk,
  SymbolKind,
  Visibility,
  Parameter,
  CallInfo
} from '@cv-git/shared';
import { generateChunkId, detectLanguage } from '@cv-git/shared';
import * as fs from 'fs/promises';
import * as path from 'path';

interface TreeSitterNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: TreeSitterNode[];
  childForFieldName(name: string): TreeSitterNode | null;
  namedChildren: TreeSitterNode[];
}

export class CodeParser {
  private parsers: Map<string, Parser> = new Map();

  constructor() {
    this.initializeParsers();
  }

  /**
   * Initialize tree-sitter parsers for supported languages
   */
  private initializeParsers(): void {
    // TypeScript/TSX
    const tsParser = new Parser();
    tsParser.setLanguage(TypeScript.typescript);
    this.parsers.set('typescript', tsParser);

    // JavaScript/JSX
    const tsxParser = new Parser();
    tsxParser.setLanguage(TypeScript.tsx);
    this.parsers.set('tsx', tsxParser);

    // We'll use the same parser for JavaScript
    this.parsers.set('javascript', tsParser);
  }

  /**
   * Parse a file and extract all relevant information
   */
  async parseFile(filePath: string, content: string, language: string): Promise<ParsedFile> {
    const parser = this.parsers.get(language);

    if (!parser) {
      throw new Error(`No parser available for language: ${language}`);
    }

    const tree = parser.parse(content);
    const absolutePath = path.resolve(filePath);

    // Extract symbols
    const symbols = this.extractSymbols(tree.rootNode as any, filePath, content);

    // Extract imports
    const imports = this.extractImports(tree.rootNode as any, content);

    // Extract exports
    const exports = this.extractExports(tree.rootNode as any);

    // Create code chunks
    const chunks = this.chunkCode(content, symbols, filePath, language);

    return {
      path: filePath,
      absolutePath,
      language,
      content,
      symbols,
      imports,
      exports,
      chunks
    };
  }

  /**
   * Extract all symbols from AST
   */
  private extractSymbols(node: TreeSitterNode, filePath: string, content: string): SymbolNode[] {
    const symbols: SymbolNode[] = [];

    // Extract function declarations
    symbols.push(...this.extractFunctions(node, filePath, content));

    // Extract class declarations
    symbols.push(...this.extractClasses(node, filePath, content));

    // Extract interfaces (TypeScript)
    symbols.push(...this.extractInterfaces(node, filePath, content));

    // Extract type aliases (TypeScript)
    symbols.push(...this.extractTypeAliases(node, filePath, content));

    // Extract variables/constants
    symbols.push(...this.extractVariables(node, filePath, content));

    return symbols;
  }

  /**
   * Extract function declarations
   */
  private extractFunctions(node: TreeSitterNode, filePath: string, content: string): SymbolNode[] {
    const functions: SymbolNode[] = [];

    const functionNodes = this.findNodesByType(node, [
      'function_declaration',
      'function',
      'arrow_function',
      'function_expression'
    ]);

    for (const funcNode of functionNodes) {
      const name = this.getFunctionName(funcNode);
      if (!name) continue;

      const qualifiedName = `${filePath}:${name}`;
      const signature = this.getFunctionSignature(funcNode, content);
      const parameters = this.getFunctionParameters(funcNode);
      const returnType = this.getReturnType(funcNode);
      const docstring = this.getDocstring(funcNode, content);
      const isAsync = this.isAsyncFunction(funcNode);

      functions.push({
        name,
        qualifiedName,
        kind: 'function',
        file: filePath,
        startLine: funcNode.startPosition.row + 1,
        endLine: funcNode.endPosition.row + 1,
        signature,
        docstring,
        returnType,
        parameters,
        visibility: 'public', // Default for functions
        isAsync,
        isStatic: false,
        complexity: this.calculateComplexity(funcNode),
        calls: this.extractCalls(funcNode),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }

    return functions;
  }

  /**
   * Extract class declarations
   */
  private extractClasses(node: TreeSitterNode, filePath: string, content: string): SymbolNode[] {
    const classes: SymbolNode[] = [];

    const classNodes = this.findNodesByType(node, ['class_declaration', 'class']);

    for (const classNode of classNodes) {
      const name = this.getClassName(classNode);
      if (!name) continue;

      const qualifiedName = `${filePath}:${name}`;
      const docstring = this.getDocstring(classNode, content);

      // Add class symbol
      classes.push({
        name,
        qualifiedName,
        kind: 'class',
        file: filePath,
        startLine: classNode.startPosition.row + 1,
        endLine: classNode.endPosition.row + 1,
        docstring,
        visibility: 'public',
        isAsync: false,
        isStatic: false,
        complexity: this.calculateComplexity(classNode),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      // Extract methods from class
      const methods = this.extractClassMethods(classNode, filePath, name, content);
      classes.push(...methods);
    }

    return classes;
  }

  /**
   * Extract methods from a class
   */
  private extractClassMethods(classNode: TreeSitterNode, filePath: string, className: string, content: string): SymbolNode[] {
    const methods: SymbolNode[] = [];

    const methodNodes = this.findNodesByType(classNode, ['method_definition']);

    for (const methodNode of methodNodes) {
      const name = this.getMethodName(methodNode);
      if (!name) continue;

      const qualifiedName = `${filePath}:${className}.${name}`;
      const signature = this.getFunctionSignature(methodNode, content);
      const parameters = this.getFunctionParameters(methodNode);
      const returnType = this.getReturnType(methodNode);
      const docstring = this.getDocstring(methodNode, content);
      const isAsync = this.isAsyncFunction(methodNode);
      const isStatic = this.isStaticMethod(methodNode);
      const visibility = this.getMethodVisibility(methodNode);

      methods.push({
        name,
        qualifiedName,
        kind: 'method',
        file: filePath,
        startLine: methodNode.startPosition.row + 1,
        endLine: methodNode.endPosition.row + 1,
        signature,
        docstring,
        returnType,
        parameters,
        visibility,
        isAsync,
        isStatic,
        complexity: this.calculateComplexity(methodNode),
        calls: this.extractCalls(methodNode),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }

    return methods;
  }

  /**
   * Extract interface declarations (TypeScript)
   */
  private extractInterfaces(node: TreeSitterNode, filePath: string, content: string): SymbolNode[] {
    const interfaces: SymbolNode[] = [];

    const interfaceNodes = this.findNodesByType(node, ['interface_declaration']);

    for (const intNode of interfaceNodes) {
      const name = this.getInterfaceName(intNode);
      if (!name) continue;

      const qualifiedName = `${filePath}:${name}`;
      const docstring = this.getDocstring(intNode, content);

      interfaces.push({
        name,
        qualifiedName,
        kind: 'interface',
        file: filePath,
        startLine: intNode.startPosition.row + 1,
        endLine: intNode.endPosition.row + 1,
        docstring,
        visibility: 'public',
        isAsync: false,
        isStatic: false,
        complexity: 1,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }

    return interfaces;
  }

  /**
   * Extract type alias declarations (TypeScript)
   */
  private extractTypeAliases(node: TreeSitterNode, filePath: string, content: string): SymbolNode[] {
    const types: SymbolNode[] = [];

    const typeNodes = this.findNodesByType(node, ['type_alias_declaration']);

    for (const typeNode of typeNodes) {
      const name = this.getTypeName(typeNode);
      if (!name) continue;

      const qualifiedName = `${filePath}:${name}`;
      const docstring = this.getDocstring(typeNode, content);

      types.push({
        name,
        qualifiedName,
        kind: 'type',
        file: filePath,
        startLine: typeNode.startPosition.row + 1,
        endLine: typeNode.endPosition.row + 1,
        docstring,
        visibility: 'public',
        isAsync: false,
        isStatic: false,
        complexity: 1,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }

    return types;
  }

  /**
   * Extract variable/constant declarations
   */
  private extractVariables(node: TreeSitterNode, filePath: string, content: string): SymbolNode[] {
    const variables: SymbolNode[] = [];

    const varNodes = this.findNodesByType(node, ['variable_declaration', 'lexical_declaration']);

    for (const varNode of varNodes) {
      const declarators = this.findNodesByType(varNode, ['variable_declarator']);

      for (const declarator of declarators) {
        const name = this.getVariableName(declarator);
        if (!name) continue;

        const qualifiedName = `${filePath}:${name}`;
        const kind = this.getVariableKind(varNode);

        variables.push({
          name,
          qualifiedName,
          kind: kind as SymbolKind,
          file: filePath,
          startLine: declarator.startPosition.row + 1,
          endLine: declarator.endPosition.row + 1,
          visibility: 'public',
          isAsync: false,
          isStatic: false,
          complexity: 1,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }
    }

    return variables;
  }

  /**
   * Extract import statements
   */
  private extractImports(node: TreeSitterNode, content: string): Import[] {
    const imports: Import[] = [];

    const importNodes = this.findNodesByType(node, ['import_statement']);

    for (const importNode of importNodes) {
      const source = this.getImportSource(importNode);
      if (!source) continue;

      const importedSymbols = this.getImportedSymbols(importNode);
      const isExternal = !source.startsWith('.') && !source.startsWith('/');

      imports.push({
        source,
        importedSymbols,
        importType: this.getImportType(importNode),
        isExternal,
        packageName: isExternal ? source.split('/')[0] : undefined,
        line: importNode.startPosition.row + 1
      });
    }

    return imports;
  }

  /**
   * Extract export statements
   */
  private extractExports(node: TreeSitterNode): Export[] {
    const exports: Export[] = [];

    const exportNodes = this.findNodesByType(node, ['export_statement']);

    for (const exportNode of exportNodes) {
      const name = this.getExportName(exportNode);
      if (!name) continue;

      const type = this.getExportType(exportNode);

      exports.push({
        name,
        type,
        line: exportNode.startPosition.row + 1
      });
    }

    return exports;
  }

  /**
   * Chunk code for embedding
   */
  private chunkCode(content: string, symbols: SymbolNode[], filePath: string, language: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');

    // Chunk by symbol (preferred)
    for (const symbol of symbols) {
      if (symbol.kind === 'function' || symbol.kind === 'method' || symbol.kind === 'class') {
        const text = lines.slice(symbol.startLine - 1, symbol.endLine).join('\n');

        chunks.push({
          id: generateChunkId(filePath, symbol.startLine, symbol.endLine),
          file: filePath,
          language,
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
        id: generateChunkId(filePath, 1, lines.length),
        file: filePath,
        language,
        startLine: 1,
        endLine: lines.length,
        text: content
      });
    }

    return chunks;
  }

  // ========== Helper Methods ==========

  private findNodesByType(node: TreeSitterNode, types: string[]): TreeSitterNode[] {
    const results: TreeSitterNode[] = [];

    if (types.includes(node.type)) {
      results.push(node);
    }

    for (const child of node.namedChildren) {
      results.push(...this.findNodesByType(child, types));
    }

    return results;
  }

  private getFunctionName(node: TreeSitterNode): string | null {
    const nameNode = node.childForFieldName('name');
    return nameNode?.text || null;
  }

  private getClassName(node: TreeSitterNode): string | null {
    const nameNode = node.childForFieldName('name');
    return nameNode?.text || null;
  }

  private getMethodName(node: TreeSitterNode): string | null {
    const nameNode = node.childForFieldName('name');
    return nameNode?.text || null;
  }

  private getInterfaceName(node: TreeSitterNode): string | null {
    const nameNode = node.childForFieldName('name');
    return nameNode?.text || null;
  }

  private getTypeName(node: TreeSitterNode): string | null {
    const nameNode = node.childForFieldName('name');
    return nameNode?.text || null;
  }

  private getVariableName(node: TreeSitterNode): string | null {
    const nameNode = node.childForFieldName('name');
    return nameNode?.text || null;
  }

  private getFunctionSignature(node: TreeSitterNode, content: string): string {
    // Extract the function signature from the node
    const lines = content.split('\n');
    const startLine = node.startPosition.row;
    const endLine = Math.min(node.endPosition.row, startLine + 2); // First 2-3 lines

    return lines.slice(startLine, endLine + 1).join('\n').trim();
  }

  private getFunctionParameters(node: TreeSitterNode): Parameter[] {
    const parameters: Parameter[] = [];
    const paramsNode = node.childForFieldName('parameters');

    if (paramsNode) {
      const paramNodes = this.findNodesByType(paramsNode, ['required_parameter', 'optional_parameter']);

      for (const paramNode of paramNodes) {
        const nameNode = paramNode.childForFieldName('pattern');
        const typeNode = paramNode.childForFieldName('type');

        parameters.push({
          name: nameNode?.text || '',
          type: typeNode?.text,
          optional: paramNode.type === 'optional_parameter'
        });
      }
    }

    return parameters;
  }

  private getReturnType(node: TreeSitterNode): string | undefined {
    const returnTypeNode = node.childForFieldName('return_type');
    return returnTypeNode?.text;
  }

  private getDocstring(node: TreeSitterNode, content: string): string | undefined {
    // Look for JSDoc comment above the node
    const lines = content.split('\n');
    const nodeLine = node.startPosition.row;

    // Check previous lines for JSDoc
    for (let i = nodeLine - 1; i >= Math.max(0, nodeLine - 10); i--) {
      const line = lines[i].trim();
      if (line.startsWith('/**')) {
        // Found JSDoc, extract it
        const docLines: string[] = [];
        for (let j = i; j < nodeLine; j++) {
          docLines.push(lines[j]);
        }
        return docLines.join('\n').trim();
      }
      if (line && !line.startsWith('//') && !line.startsWith('*')) {
        break; // Stop if we hit non-comment code
      }
    }

    return undefined;
  }

  private isAsyncFunction(node: TreeSitterNode): boolean {
    // Check if function has 'async' modifier
    return node.text.trimStart().startsWith('async');
  }

  private isStaticMethod(node: TreeSitterNode): boolean {
    // Check if method has 'static' modifier
    return node.text.trimStart().startsWith('static');
  }

  private getMethodVisibility(node: TreeSitterNode): Visibility {
    // Check for visibility modifiers
    const text = node.text.trimStart();
    if (text.startsWith('private')) return 'private';
    if (text.startsWith('protected')) return 'protected';
    return 'public';
  }

  private getVariableKind(node: TreeSitterNode): string {
    // Check if it's const or let/var
    const text = node.text.trimStart();
    if (text.startsWith('const')) return 'constant';
    return 'variable';
  }

  private getImportSource(node: TreeSitterNode): string | null {
    const sourceNode = node.childForFieldName('source');
    if (!sourceNode) return null;

    // Remove quotes
    const text = sourceNode.text;
    return text.slice(1, -1);
  }

  private getImportedSymbols(node: TreeSitterNode): string[] {
    const symbols: string[] = [];

    // Look for import clause
    const clauseNode = this.findNodesByType(node, ['import_clause'])[0];
    if (!clauseNode) return symbols;

    // Get named imports
    const specifiers = this.findNodesByType(clauseNode, ['import_specifier']);
    for (const spec of specifiers) {
      const nameNode = spec.childForFieldName('name');
      if (nameNode) {
        symbols.push(nameNode.text);
      }
    }

    return symbols;
  }

  private getImportType(node: TreeSitterNode): 'default' | 'named' | 'namespace' | 'side-effect' {
    const clauseNode = this.findNodesByType(node, ['import_clause'])[0];
    if (!clauseNode) return 'side-effect';

    const text = clauseNode.text;
    if (text.includes('* as')) return 'namespace';
    if (text.includes('{')) return 'named';
    return 'default';
  }

  private getExportName(node: TreeSitterNode): string | null {
    // Try to find exported name
    const nameNode = node.childForFieldName('name');
    return nameNode?.text || null;
  }

  private getExportType(node: TreeSitterNode): 'default' | 'named' {
    return node.text.includes('export default') ? 'default' : 'named';
  }

  private calculateComplexity(node: TreeSitterNode): number {
    // Simple cyclomatic complexity calculation
    let complexity = 1;

    const controlFlowNodes = this.findNodesByType(node, [
      'if_statement',
      'for_statement',
      'while_statement',
      'do_statement',
      'switch_statement',
      'case',
      'catch_clause',
      'ternary_expression'
    ]);

    complexity += controlFlowNodes.length;

    return complexity;
  }

  /**
   * Extract function calls from a symbol (function/method)
   */
  private extractCalls(node: TreeSitterNode): CallInfo[] {
    const calls: CallInfo[] = [];

    // Find all call expressions
    const callNodes = this.findNodesByType(node, ['call_expression']);

    for (const callNode of callNodes) {
      const calleeName = this.getCalleeName(callNode);
      if (!calleeName) continue;

      const isConditional = this.isInsideConditional(callNode, node);

      calls.push({
        callee: calleeName,
        line: callNode.startPosition.row + 1,
        isConditional
      });
    }

    return calls;
  }

  /**
   * Get the name of the called function/method
   */
  private getCalleeName(callNode: TreeSitterNode): string | null {
    // Get the function being called
    const functionNode = callNode.childForFieldName('function');
    if (!functionNode) return null;

    // Handle different call types
    if (functionNode.type === 'identifier') {
      // Simple function call: foo()
      return functionNode.text;
    } else if (functionNode.type === 'member_expression') {
      // Method call: obj.method()
      const propertyNode = functionNode.childForFieldName('property');
      if (propertyNode) {
        // Return just the method name for now
        return propertyNode.text;
      }
    } else if (functionNode.type === 'call_expression') {
      // Chained call: foo()()
      return this.getCalleeName(functionNode);
    }

    return null;
  }

  /**
   * Check if a node is inside a conditional block
   */
  private isInsideConditional(node: TreeSitterNode, rootNode: TreeSitterNode): boolean {
    // Walk up the tree to find conditional parents
    let current: TreeSitterNode | null = node;
    const conditionalTypes = [
      'if_statement',
      'else_clause',
      'try_statement',
      'catch_clause',
      'switch_statement',
      'case',
      'ternary_expression'
    ];

    // We need to walk up the parent chain, but TreeSitter doesn't expose parent
    // For now, we'll search within the root node for conditionals containing this call
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
  private nodeContains(parent: TreeSitterNode, child: TreeSitterNode): boolean {
    // Check if child is within parent's range
    const parentStart = parent.startPosition.row;
    const parentEnd = parent.endPosition.row;
    const childStart = child.startPosition.row;
    const childEnd = child.endPosition.row;

    return childStart >= parentStart && childEnd <= parentEnd;
  }
}

/**
 * Create a parser instance
 */
export function createParser(): CodeParser {
  return new CodeParser();
}

/**
 * TypeScript/JavaScript Parser
 * Extends BaseLanguageParser for TypeScript and JavaScript files
 */

import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import { BaseLanguageParser, TreeSitterNode } from './base.js';
import {
  SymbolNode,
  Import,
  Export,
  Parameter,
  CallInfo,
  Visibility
} from '@cv-git/shared';

/**
 * TypeScript/JavaScript specific parser
 */
export class TypeScriptParser extends BaseLanguageParser {
  constructor() {
    super({
      language: 'typescript',
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
      commentPatterns: {
        singleLine: ['//'],
        multiLineStart: ['/*'],
        multiLineEnd: ['*/'],
        docComment: ['/**']
      }
    });
  }

  getLanguage(): string {
    return 'typescript';
  }

  getSupportedExtensions(): string[] {
    return this.config.extensions;
  }

  initialize(): void {
    // TypeScript/TSX parser
    const tsParser = new Parser();
    tsParser.setLanguage(TypeScript.typescript);
    this.parser = tsParser;
  }

  /**
   * Extract symbols (functions, classes, interfaces, etc.)
   */
  extractSymbols(node: TreeSitterNode, filePath: string, content: string): SymbolNode[] {
    const symbols: SymbolNode[] = [];

    // Extract all symbol types
    symbols.push(...this.extractFunctions(node, filePath, content));
    symbols.push(...this.extractClasses(node, filePath, content));
    symbols.push(...this.extractInterfaces(node, filePath, content));
    symbols.push(...this.extractTypeAliases(node, filePath, content));
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
        visibility: 'public',
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
   * Extract interface declarations
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
   * Extract type aliases
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
          kind: kind as any,
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
  extractImports(node: TreeSitterNode, content: string): Import[] {
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
  extractExports(node: TreeSitterNode): Export[] {
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

  // ========== TypeScript-specific Helper Methods ==========

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
    const lines = content.split('\n');
    const startLine = node.startPosition.row;
    const endLine = Math.min(node.endPosition.row, startLine + 2);

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

  private isAsyncFunction(node: TreeSitterNode): boolean {
    return node.text.trimStart().startsWith('async');
  }

  private isStaticMethod(node: TreeSitterNode): boolean {
    return node.text.trimStart().startsWith('static');
  }

  private getMethodVisibility(node: TreeSitterNode): Visibility {
    const text = node.text.trimStart();
    if (text.startsWith('private')) return 'private';
    if (text.startsWith('protected')) return 'protected';
    return 'public';
  }

  private getVariableKind(node: TreeSitterNode): string {
    const text = node.text.trimStart();
    if (text.startsWith('const')) return 'constant';
    return 'variable';
  }

  private getImportSource(node: TreeSitterNode): string | null {
    const sourceNode = node.childForFieldName('source');
    if (!sourceNode) return null;

    const text = sourceNode.text;
    return text.slice(1, -1); // Remove quotes
  }

  private getImportedSymbols(node: TreeSitterNode): string[] {
    const symbols: string[] = [];

    const clauseNode = this.findNodesByType(node, ['import_clause'])[0];
    if (!clauseNode) return symbols;

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
    const nameNode = node.childForFieldName('name');
    return nameNode?.text || null;
  }

  private getExportType(node: TreeSitterNode): 'default' | 'named' {
    return node.text.includes('export default') ? 'default' : 'named';
  }

  /**
   * Extract function calls from a symbol
   */
  private extractCalls(node: TreeSitterNode): CallInfo[] {
    const calls: CallInfo[] = [];

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

  private getCalleeName(callNode: TreeSitterNode): string | null {
    const functionNode = callNode.childForFieldName('function');
    if (!functionNode) return null;

    if (functionNode.type === 'identifier') {
      return functionNode.text;
    } else if (functionNode.type === 'member_expression') {
      const propertyNode = functionNode.childForFieldName('property');
      if (propertyNode) {
        return propertyNode.text;
      }
    } else if (functionNode.type === 'call_expression') {
      return this.getCalleeName(functionNode);
    }

    return null;
  }
}

/**
 * Create a TypeScript parser instance
 */
export function createTypeScriptParser(): TypeScriptParser {
  const parser = new TypeScriptParser();
  parser.initialize();
  return parser;
}

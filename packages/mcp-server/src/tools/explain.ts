/**
 * Explain Tool Handler
 * Implements cv_explain - AI-powered code explanation
 */

import { ExplainArgs, ToolResult } from '../types.js';
import { successResult, errorResult, createIsolatedGraphManager } from '../utils.js';
import {
  configManager,
  createAIManager,
  createGitManager,
} from '@cv-git/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getAnthropicApiKey } from '../credentials.js';

/**
 * Handle cv_explain tool call
 */
export async function handleExplain(args: ExplainArgs): Promise<ToolResult> {
  try {
    const { target, noStream = false } = args;

    // Initialize graph manager with repo isolation
    const { graph, repoRoot } = await createIsolatedGraphManager();
    await graph.connect();

    // Load configuration
    const config = await configManager.load(repoRoot);

    // Get API key from credential manager
    const anthropicApiKey = config.ai.apiKey || await getAnthropicApiKey();
    if (!anthropicApiKey) {
      return errorResult(
        'Anthropic API key not found. Run `cv auth setup anthropic`.'
      );
    }

    // Initialize managers
    const git = createGitManager(repoRoot);

    // Initialize AI manager with all dependencies
    const ai = createAIManager(
      {
        provider: 'anthropic',
        model: config.ai.model || 'claude-sonnet-4-5-20250514',
        apiKey: anthropicApiKey,
        maxTokens: config.ai.maxTokens,
        temperature: config.ai.temperature,
      },
      undefined,  // vector manager not needed for explain
      graph,
      git
    );

    // Search for the target in the graph
    let context = '';

    // Try to find as a symbol
    const symbol = await graph.getSymbolNode(target);
    if (symbol) {
      context += `Symbol: ${symbol.name} (${symbol.kind})\n`;
      context += `Location: ${symbol.file}:${symbol.startLine}\n\n`;

      if (symbol.docstring) {
        context += `Documentation: ${symbol.docstring}\n\n`;
      }

      // Get symbol dependencies
      const callees = await graph.getCallees(symbol.qualifiedName);
      if (callees.length > 0) {
        context += `Calls: ${callees.map((c: any) => c.name).join(', ')}\n`;
      }

      const callers = await graph.getCallers(symbol.qualifiedName);
      if (callers.length > 0) {
        context += `Called by: ${callers.map((c: any) => c.name).join(', ')}\n`;
      }

      // Get source code
      try {
        const filePath = path.join(repoRoot, symbol.file);
        const sourceCode = await fs.readFile(filePath, 'utf-8');
        const lines = sourceCode.split('\n');
        const startLine = Math.max(0, symbol.startLine - 5);
        const endLine = Math.min(lines.length, symbol.endLine + 5);
        context += `\nSource code:\n${lines.slice(startLine, endLine).join('\n')}\n`;
      } catch (error: any) {
        context += `\nCould not read source file: ${error.message}\n`;
      }
    } else {
      // Might be a file path or concept
      try {
        const filePath = target.startsWith('/') ? target : path.join(repoRoot, target);
        const fileContent = await fs.readFile(filePath, 'utf-8');
        context += `File: ${target}\n\n`;
        context += `Content:\n${fileContent.slice(0, 5000)}${fileContent.length > 5000 ? '\n...(truncated)' : ''}\n`;
      } catch {
        // Not a file, treat as a concept
        context += `Explaining concept: ${target}\n`;
      }
    }

    await graph.close();

    // Generate explanation using AI (let AI manager gather its own context)
    const explanation = await ai.explain(target);

    return successResult(explanation);
  } catch (error: any) {
    return errorResult('Code explanation failed', error);
  }
}

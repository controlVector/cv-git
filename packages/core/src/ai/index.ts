/**
 * AI Manager
 * Manages Claude API interactions and context assembly
 */

import Anthropic from '@anthropic-ai/sdk';

// Re-export CommitAnalyzer
export {
  CommitAnalyzer,
  createCommitAnalyzer,
  CommitAnalysis,
  GeneratedCommitMessage,
  CommitType,
  SymbolChange,
  BreakingChange,
  CommitAnalyzerOptions,
  CommitAIProvider
} from './commit-analyzer.js';
import {
  Context,
  Plan,
  PlanStep,
  Diff,
  SymbolNode,
  FileNode,
  VectorSearchResult,
  CodeChunkPayload,
  ChatMessage
} from '@cv-git/shared';
import { VectorManager } from '../vector/index.js';
import { GraphManager } from '../graph/index.js';
import { GitManager } from '../git/index.js';
import { PRDClient, AIContext as PRDContext } from '@cv-git/prd-client';

export interface AIManagerOptions {
  provider: 'anthropic';
  model: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
  prdUrl?: string;
  prdApiKey?: string;
}

export interface StreamHandler {
  onToken?: (token: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

export class AIManager {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private temperature: number;
  private prdClient?: PRDClient;

  constructor(
    private options: AIManagerOptions,
    private vector?: VectorManager,
    private graph?: GraphManager,
    private git?: GitManager
  ) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model || 'claude-3-5-sonnet-20241022';
    this.maxTokens = options.maxTokens || 4096;
    this.temperature = options.temperature || 0.7;

    // Initialize PRD client if URL provided
    if (options.prdUrl) {
      this.prdClient = new PRDClient({
        baseUrl: options.prdUrl,
        apiKey: options.prdApiKey
      });
    }
  }

  /**
   * Gather relevant context for a query
   */
  async gatherContext(
    query: string,
    options?: {
      maxChunks?: number;
      maxSymbols?: number;
      includeGitStatus?: boolean;
      specificFiles?: string[];
      prdRefs?: string[];
    }
  ): Promise<Context> {
    const context: Context = {
      chunks: [],
      symbols: [],
      files: [],
      prdContext: undefined
    };

    // Extract PRD refs from query if not provided
    const prdRefs = options?.prdRefs || PRDClient.extractPRDReferences(query);

    const maxChunks = options?.maxChunks || 10;
    const maxSymbols = options?.maxSymbols || 20;

    // 1. Vector search for relevant code chunks
    if (this.vector) {
      try {
        context.chunks = await this.vector.searchCode(query, maxChunks, {
          minScore: 0.25  // Lowered from 0.6 to be more lenient with semantic matches
        });
      } catch (error) {
        console.error('Vector search failed:', error);
      }
    }

    // 2. Graph queries for related symbols
    if (this.graph && context.chunks.length > 0) {
      try {
        // Get symbols from matched chunks
        const symbolNames = context.chunks
          .map(c => c.payload.symbolName)
          .filter((name): name is string => !!name)
          .slice(0, 5);

        // For each symbol, get related symbols (callers, callees)
        for (const symbolName of symbolNames) {
          // Get the symbol itself
          const symbolQuery = `
            MATCH (s:Symbol)
            WHERE s.name = '${symbolName}'
            RETURN s
            LIMIT 1
          `;
          const symbolResults = await this.graph.query(symbolQuery);
          if (symbolResults.length > 0) {
            context.symbols.push(symbolResults[0].s as SymbolNode);
          }

          // Get callers and callees
          const callers = await this.graph.getCallers(symbolName);
          const callees = await this.graph.getCallees(symbolName);

          context.symbols.push(...callers.slice(0, 3));
          context.symbols.push(...callees.slice(0, 3));
        }

        // Remove duplicates
        context.symbols = Array.from(
          new Map(context.symbols.map(s => [s.qualifiedName, s])).values()
        ).slice(0, maxSymbols);

      } catch (error) {
        console.error('Graph query failed:', error);
      }
    }

    // 3. Get file information
    if (this.graph && context.chunks.length > 0) {
      try {
        const filePaths = Array.from(
          new Set(context.chunks.map(c => c.payload.file))
        );

        for (const filePath of filePaths.slice(0, 5)) {
          const fileQuery = `
            MATCH (f:File {path: '${filePath}'})
            RETURN f
            LIMIT 1
          `;
          const fileResults = await this.graph.query(fileQuery);
          if (fileResults.length > 0) {
            context.files.push(fileResults[0].f as FileNode);
          }
        }
      } catch (error) {
        console.error('File query failed:', error);
      }
    }

    // 4. Get git working tree status
    if (this.git && options?.includeGitStatus) {
      try {
        context.workingTreeStatus = await this.git.getStatus();
      } catch (error) {
        console.error('Git status failed:', error);
      }
    }

    // 5. Get PRD context if refs found
    if (this.prdClient && prdRefs.length > 0) {
      try {
        // Get context for the first PRD reference
        const prdContext = await this.prdClient.getContext(prdRefs[0], {
          depth: 3,
          strategy: 'expanded'
        });
        context.prdContext = prdContext;
      } catch (error) {
        console.error('PRD context fetch failed:', error);
      }
    }

    return context;
  }

  /**
   * Explain code or concept
   */
  async explain(
    target: string,
    context?: Context,
    streamHandler?: StreamHandler
  ): Promise<string> {
    // Gather context if not provided
    if (!context) {
      context = await this.gatherContext(target);
    }

    // Build prompt
    const prompt = this.buildExplainPrompt(target, context);

    // Call Claude
    return await this.complete(prompt, streamHandler);
  }

  /**
   * Generate a plan for a task
   */
  async generatePlan(task: string, context?: Context): Promise<Plan> {
    // Gather context if not provided
    if (!context) {
      context = await this.gatherContext(task, { includeGitStatus: true });
    }

    // Build prompt
    const prompt = this.buildPlanPrompt(task, context);

    // Call Claude
    const response = await this.complete(prompt);

    // Parse the response into a Plan
    return this.parsePlanFromResponse(response, task);
  }

  /**
   * Generate code changes for a task
   */
  async generateCode(
    task: string,
    context?: Context,
    streamHandler?: StreamHandler
  ): Promise<string> {
    // Gather context if not provided
    if (!context) {
      context = await this.gatherContext(task, { includeGitStatus: true });
    }

    // Build prompt
    const prompt = this.buildCodeGenerationPrompt(task, context);

    // Call Claude
    return await this.complete(prompt, streamHandler);
  }

  /**
   * Review code changes
   */
  async reviewCode(
    diff: string,
    context?: Context
  ): Promise<string> {
    // Build prompt for code review
    const prompt = this.buildReviewPrompt(diff, context);

    // Call Claude
    return await this.complete(prompt);
  }

  /**
   * Chat with Claude
   */
  async chat(
    messages: ChatMessage[],
    streamHandler?: StreamHandler
  ): Promise<string> {
    const anthropicMessages = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
      content: msg.content
    }));

    if (streamHandler) {
      return await this.streamComplete(anthropicMessages, streamHandler);
    } else {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        messages: anthropicMessages
      });

      return response.content[0].type === 'text' ? response.content[0].text : '';
    }
  }

  /**
   * Complete a prompt with Claude
   */
  private async complete(
    prompt: string,
    streamHandler?: StreamHandler
  ): Promise<string> {
    const messages = [{ role: 'user' as const, content: prompt }];

    if (streamHandler) {
      return await this.streamComplete(messages, streamHandler);
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages
    });

    return response.content[0].type === 'text' ? response.content[0].text : '';
  }

  /**
   * Stream completion from Claude
   */
  private async streamComplete(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    streamHandler: StreamHandler
  ): Promise<string> {
    let fullText = '';

    try {
      const stream = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        messages,
        stream: true
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta') {
          const token = event.delta.text;
          fullText += token;
          if (streamHandler.onToken) {
            streamHandler.onToken(token);
          }
        }
      }

      if (streamHandler.onComplete) {
        streamHandler.onComplete(fullText);
      }

      return fullText;

    } catch (error) {
      if (streamHandler.onError) {
        streamHandler.onError(error as Error);
      }
      throw error;
    }
  }

  /**
   * Build prompt for explanation
   */
  private buildExplainPrompt(target: string, context: Context): string {
    let prompt = `You are an expert software engineer analyzing a codebase. Explain the following in clear, concise terms:\n\n`;
    prompt += `Target: ${target}\n\n`;

    if (context.chunks.length > 0) {
      prompt += `## Relevant Code\n\n`;
      for (const chunk of context.chunks.slice(0, 5)) {
        prompt += `### ${chunk.payload.file}:${chunk.payload.startLine}\n`;
        if (chunk.payload.symbolName) {
          prompt += `Symbol: ${chunk.payload.symbolName} (${chunk.payload.symbolKind})\n`;
        }
        if (chunk.payload.docstring) {
          prompt += `Doc: ${chunk.payload.docstring}\n`;
        }
        prompt += `\`\`\`${chunk.payload.language}\n${chunk.payload.text}\n\`\`\`\n\n`;
      }
    }

    if (context.symbols.length > 0) {
      prompt += `## Related Functions\n\n`;
      for (const symbol of context.symbols.slice(0, 10)) {
        prompt += `- ${symbol.name} (${symbol.kind}) in ${symbol.file}\n`;
        if (symbol.docstring) {
          prompt += `  ${symbol.docstring.split('\n')[0]}\n`;
        }
      }
      prompt += `\n`;
    }

    prompt += `\nProvide a clear explanation that covers:\n`;
    prompt += `1. What this code does\n`;
    prompt += `2. How it works (key logic)\n`;
    prompt += `3. How it fits into the larger system\n`;
    prompt += `4. Any important design decisions or patterns\n\n`;
    prompt += `Keep it concise but thorough.`;

    return prompt;
  }

  /**
   * Build prompt for plan generation
   */
  private buildPlanPrompt(task: string, context: Context): string {
    let prompt = `You are an expert software engineer. Create a detailed plan for the following task:\n\n`;
    prompt += `Task: ${task}\n\n`;

    if (context.chunks.length > 0) {
      prompt += `## Existing Code\n\n`;
      for (const chunk of context.chunks.slice(0, 3)) {
        prompt += `### ${chunk.payload.file}\n`;
        prompt += `\`\`\`${chunk.payload.language}\n${chunk.payload.text.split('\n').slice(0, 20).join('\n')}\n\`\`\`\n\n`;
      }
    }

    if (context.workingTreeStatus) {
      const status = context.workingTreeStatus;
      prompt += `## Current Git Status\n`;
      prompt += `- Modified: ${status.modified.length} files\n`;
      prompt += `- Added: ${status.added.length} files\n`;
      prompt += `- Deleted: ${status.deleted.length} files\n\n`;
    }

    prompt += `\nCreate a step-by-step plan in the following JSON format:\n`;
    prompt += `{\n`;
    prompt += `  "steps": [\n`;
    prompt += `    {\n`;
    prompt += `      "description": "Clear description of the step",\n`;
    prompt += `      "type": "create|modify|delete|rename",\n`;
    prompt += `      "file": "path/to/file",\n`;
    prompt += `      "details": "Additional details if needed"\n`;
    prompt += `    }\n`;
    prompt += `  ],\n`;
    prompt += `  "estimatedComplexity": "low|medium|high",\n`;
    prompt += `  "risks": ["Any potential risks or concerns"]\n`;
    prompt += `}\n\n`;
    prompt += `Be specific about files and changes. Consider dependencies and testing.`;

    return prompt;
  }

  /**
   * Build prompt for code generation
   */
  private buildCodeGenerationPrompt(task: string, context: Context): string {
    let prompt = `You are an expert software engineer. Generate code for the following task:\n\n`;
    prompt += `Task: ${task}\n\n`;

    // Include PRD context if available
    if (context.prdContext) {
      prompt += `## Requirements Context\n\n`;
      prompt += PRDClient.formatContextForPrompt(context.prdContext);
      prompt += `\n`;
    }

    if (context.chunks.length > 0) {
      prompt += `## Existing Code Context\n\n`;
      for (const chunk of context.chunks.slice(0, 5)) {
        prompt += `### ${chunk.payload.file}\n`;
        prompt += `\`\`\`${chunk.payload.language}\n${chunk.payload.text}\n\`\`\`\n\n`;
      }
    }

    prompt += `\nGenerate the necessary code changes. Include:\n`;
    prompt += `1. File paths for each change\n`;
    prompt += `2. Complete, working code\n`;
    prompt += `3. Comments explaining key logic\n`;
    prompt += `4. Follow existing code style and patterns\n`;
    if (context.prdContext) {
      prompt += `5. Ensure all requirements from the PRD are addressed\n`;
    }
    prompt += `\nFormat your response clearly with file paths and code blocks.`;

    return prompt;
  }

  /**
   * Build prompt for code review
   */
  private buildReviewPrompt(diff: string, context?: Context): string {
    let prompt = `You are an expert code reviewer. Review the following changes:\n\n`;
    prompt += `## Diff\n\`\`\`diff\n${diff}\n\`\`\`\n\n`;

    if (context?.chunks && context.chunks.length > 0) {
      prompt += `## Related Code\n\n`;
      for (const chunk of context.chunks.slice(0, 3)) {
        prompt += `### ${chunk.payload.file}\n`;
        prompt += `\`\`\`${chunk.payload.language}\n${chunk.payload.text.split('\n').slice(0, 15).join('\n')}\n\`\`\`\n\n`;
      }
    }

    prompt += `\nProvide a thorough review covering:\n`;
    prompt += `1. **Correctness**: Does the code work as intended?\n`;
    prompt += `2. **Best Practices**: Any anti-patterns or improvements?\n`;
    prompt += `3. **Performance**: Any efficiency concerns?\n`;
    prompt += `4. **Security**: Any security vulnerabilities?\n`;
    prompt += `5. **Testing**: What should be tested?\n`;
    prompt += `6. **Documentation**: Is it well-documented?\n\n`;
    prompt += `Be constructive and specific.`;

    return prompt;
  }

  /**
   * Parse plan from Claude response
   */
  private parsePlanFromResponse(response: string, task: string): Plan {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          task,
          steps: parsed.steps || [],
          estimatedComplexity: parsed.estimatedComplexity || 'medium',
          affectedFiles: parsed.steps?.map((s: PlanStep) => s.file) || [],
          risks: parsed.risks || []
        };
      }
    } catch (error) {
      // Fallback: parse manually
    }

    // Fallback: return basic plan
    return {
      task,
      steps: [{
        description: response,
        type: 'modify',
        file: 'unknown',
        details: 'See AI response for details'
      }],
      estimatedComplexity: 'medium',
      affectedFiles: [],
      risks: []
    };
  }
}

/**
 * Create an AI manager instance
 */
export function createAIManager(
  options: AIManagerOptions,
  vector?: VectorManager,
  graph?: GraphManager,
  git?: GitManager
): AIManager {
  return new AIManager(options, vector, graph, git);
}

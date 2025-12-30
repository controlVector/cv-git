/**
 * CommitAnalyzer Service
 * Analyzes staged changes using knowledge graph to generate intelligent commit messages
 *
 * Phase 6.1 Implementation - AI Commit Message Generation
 *
 * Supports multiple AI providers:
 * - Anthropic (direct)
 * - OpenRouter (for various models)
 * - None (analysis only, for use with AI coding agents like Claude Code)
 */

import Anthropic from '@anthropic-ai/sdk';
import { SymbolNode, SymbolKind, ParsedFile } from '@cv-git/shared';
import { GraphManager } from '../graph/index.js';
import { GitManager } from '../git/index.js';
import { CodeParser } from '../parser/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * AI Provider types supported for commit message generation
 */
export type CommitAIProvider = 'anthropic' | 'openrouter' | 'none';

/**
 * Conventional commit types
 */
export type CommitType = 'feat' | 'fix' | 'refactor' | 'docs' | 'test' | 'chore' | 'style' | 'perf' | 'build' | 'ci';

/**
 * Symbol change information
 */
export interface SymbolChange {
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  file: string;
  changeType: 'added' | 'modified' | 'deleted';
  signature?: string;
  complexity?: number;
}

/**
 * Breaking change detection result
 */
export interface BreakingChange {
  symbol: string;
  file: string;
  reason: string;
  affectedCallers: string[];
}

/**
 * Complete commit analysis result
 */
export interface CommitAnalysis {
  // From diff
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;

  // From knowledge graph (CV-Git unique)
  symbolsAdded: SymbolChange[];
  symbolsModified: SymbolChange[];
  symbolsDeleted: SymbolChange[];

  // Impact analysis
  callersAffected: Array<{ caller: string; callee: string; file: string }>;
  modulesAffected: string[];
  complexityDelta: number;

  // Inferred
  suggestedType: CommitType;
  suggestedScope: string;
  isBreakingChange: boolean;
  breakingChanges: BreakingChange[];

  // Raw data for AI prompt
  rawDiff: string;
}

/**
 * Generated commit message
 */
export interface GeneratedCommitMessage {
  subject: string;        // First line (type(scope): description)
  body?: string;          // Optional detailed body
  footer?: string;        // Optional footer (BREAKING CHANGE, etc.)
  fullMessage: string;    // Complete message
  analysis: CommitAnalysis;
}

export interface CommitAnalyzerOptions {
  repoRoot: string;
  provider?: CommitAIProvider;  // Default: 'anthropic', use 'none' for analysis-only mode
  apiKey?: string;              // Required for 'anthropic' or 'openrouter' provider
  model?: string;               // Model to use (default varies by provider)
  maxTokens?: number;
  openRouterBaseUrl?: string;   // For OpenRouter: base URL (default: https://openrouter.ai/api/v1)
}

/**
 * CommitAnalyzer - Analyzes staged changes and generates intelligent commit messages
 */
export class CommitAnalyzer {
  private provider: CommitAIProvider;
  private anthropicClient?: Anthropic;
  private openRouterApiKey?: string;
  private openRouterBaseUrl: string;
  private model: string;
  private maxTokens: number;
  private repoRoot: string;
  private parser: CodeParser;

  constructor(options: CommitAnalyzerOptions) {
    this.provider = options.provider || 'anthropic';
    this.maxTokens = options.maxTokens || 1024;
    this.repoRoot = options.repoRoot;
    this.parser = new CodeParser();
    this.openRouterBaseUrl = options.openRouterBaseUrl || 'https://openrouter.ai/api/v1';

    // Set up provider-specific clients
    if (this.provider === 'anthropic') {
      if (!options.apiKey) {
        throw new Error('API key required for Anthropic provider');
      }
      this.anthropicClient = new Anthropic({ apiKey: options.apiKey });
      this.model = options.model || 'claude-3-5-sonnet-20241022';
    } else if (this.provider === 'openrouter') {
      if (!options.apiKey) {
        throw new Error('API key required for OpenRouter provider');
      }
      this.openRouterApiKey = options.apiKey;
      this.model = options.model || 'anthropic/claude-3.5-sonnet';
    } else {
      // 'none' provider - analysis only mode
      this.model = '';
    }
  }

  /**
   * Analyze staged changes
   */
  async analyzeStaged(
    git: GitManager,
    graph?: GraphManager
  ): Promise<CommitAnalysis> {
    // Get staged diff
    const rawDiff = await git.getRawDiff('--staged');

    if (!rawDiff.trim()) {
      throw new Error('No staged changes to analyze. Stage your changes with `git add` first.');
    }

    // Parse diff to get changed files and line counts
    const { filesChanged, linesAdded, linesRemoved } = this.parseDiffStats(rawDiff);

    // Get current status to identify staged files
    const status = await git.getStatus();
    const stagedFiles = status.staged;

    // Analyze symbols in changed files
    const symbolAnalysis = await this.analyzeSymbolChanges(stagedFiles, git, graph);

    // Get callers affected (if graph available)
    const callersAffected = graph
      ? await this.findAffectedCallers(symbolAnalysis, graph)
      : [];

    // Detect breaking changes
    const breakingChanges = await this.detectBreakingChanges(symbolAnalysis, callersAffected);

    // Infer commit type and scope
    const suggestedType = this.inferCommitType(symbolAnalysis, filesChanged);
    const suggestedScope = this.inferScope(symbolAnalysis, filesChanged);

    // Calculate complexity delta
    const complexityDelta = this.calculateComplexityDelta(symbolAnalysis);

    // Get affected modules
    const modulesAffected = this.getAffectedModules(filesChanged);

    return {
      filesChanged,
      linesAdded,
      linesRemoved,
      symbolsAdded: symbolAnalysis.added,
      symbolsModified: symbolAnalysis.modified,
      symbolsDeleted: symbolAnalysis.deleted,
      callersAffected,
      modulesAffected,
      complexityDelta,
      suggestedType,
      suggestedScope,
      isBreakingChange: breakingChanges.length > 0,
      breakingChanges,
      rawDiff
    };
  }

  /**
   * Generate commit message from analysis
   *
   * If provider is 'none', returns a template message based on analysis.
   * This is useful for AI coding agents that want to generate the message themselves.
   */
  async generateMessage(analysis: CommitAnalysis): Promise<GeneratedCommitMessage> {
    // For 'none' provider, return a template based on analysis
    if (this.provider === 'none') {
      return this.generateTemplateMessage(analysis);
    }

    const prompt = this.buildPrompt(analysis);
    let responseText: string;

    if (this.provider === 'anthropic' && this.anthropicClient) {
      const response = await this.anthropicClient.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }]
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from AI');
      }
      responseText = content.text;

    } else if (this.provider === 'openrouter' && this.openRouterApiKey) {
      responseText = await this.callOpenRouter(prompt);

    } else {
      throw new Error(`Invalid provider configuration: ${this.provider}`);
    }

    return this.parseGeneratedMessage(responseText, analysis);
  }

  /**
   * Call OpenRouter API for message generation
   */
  private async callOpenRouter(prompt: string): Promise<string> {
    const response = await fetch(`${this.openRouterBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openRouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/cv-git/cv-git',
        'X-Title': 'CV-Git Commit Analyzer'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in OpenRouter response');
    }

    return content;
  }

  /**
   * Generate a template message without AI (for use by AI coding agents)
   */
  private generateTemplateMessage(analysis: CommitAnalysis): GeneratedCommitMessage {
    const type = analysis.suggestedType;
    const scope = analysis.suggestedScope ? `(${analysis.suggestedScope})` : '';

    // Generate subject based on analysis
    let subject: string;
    if (analysis.symbolsAdded.length > 0 && analysis.symbolsDeleted.length === 0) {
      const mainSymbol = analysis.symbolsAdded[0];
      subject = `${type}${scope}: add ${mainSymbol.kind} ${mainSymbol.name}`;
    } else if (analysis.symbolsDeleted.length > 0 && analysis.symbolsAdded.length === 0) {
      const mainSymbol = analysis.symbolsDeleted[0];
      subject = `${type}${scope}: remove ${mainSymbol.kind} ${mainSymbol.name}`;
    } else if (analysis.symbolsModified.length > 0) {
      const mainSymbol = analysis.symbolsModified[0];
      subject = `${type}${scope}: update ${mainSymbol.kind} ${mainSymbol.name}`;
    } else {
      subject = `${type}${scope}: update ${analysis.filesChanged[0] || 'code'}`;
    }

    // Build body
    let body = '';
    if (analysis.filesChanged.length > 1) {
      body += `Files changed: ${analysis.filesChanged.length}\n`;
    }
    if (analysis.symbolsAdded.length > 0) {
      body += `Added: ${analysis.symbolsAdded.map(s => s.name).slice(0, 5).join(', ')}`;
      if (analysis.symbolsAdded.length > 5) body += ` (+${analysis.symbolsAdded.length - 5} more)`;
      body += '\n';
    }
    if (analysis.symbolsModified.length > 0) {
      body += `Modified: ${analysis.symbolsModified.map(s => s.name).slice(0, 5).join(', ')}\n`;
    }
    if (analysis.symbolsDeleted.length > 0) {
      body += `Removed: ${analysis.symbolsDeleted.map(s => s.name).slice(0, 5).join(', ')}\n`;
    }

    // Build footer for breaking changes
    let footer = '';
    if (analysis.isBreakingChange) {
      footer = 'BREAKING CHANGE: ' + analysis.breakingChanges.map(bc => bc.reason).join('; ');
    }

    const fullMessage = [subject, body.trim(), footer].filter(Boolean).join('\n\n');

    return {
      subject,
      body: body.trim() || undefined,
      footer: footer || undefined,
      fullMessage,
      analysis
    };
  }

  /**
   * Combined: Analyze and generate in one call
   */
  async analyzeAndGenerate(
    git: GitManager,
    graph?: GraphManager
  ): Promise<GeneratedCommitMessage> {
    const analysis = await this.analyzeStaged(git, graph);
    return this.generateMessage(analysis);
  }

  /**
   * Parse diff to extract stats
   */
  private parseDiffStats(diff: string): { filesChanged: string[]; linesAdded: number; linesRemoved: number } {
    const filesChanged: string[] = [];
    let linesAdded = 0;
    let linesRemoved = 0;

    const lines = diff.split('\n');

    for (const line of lines) {
      // Match file paths in diff headers
      if (line.startsWith('diff --git')) {
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match) {
          filesChanged.push(match[2]);
        }
      }
      // Count additions (lines starting with + but not ++)
      else if (line.startsWith('+') && !line.startsWith('+++')) {
        linesAdded++;
      }
      // Count deletions (lines starting with - but not --)
      else if (line.startsWith('-') && !line.startsWith('---')) {
        linesRemoved++;
      }
    }

    return { filesChanged: [...new Set(filesChanged)], linesAdded, linesRemoved };
  }

  /**
   * Analyze symbol changes in staged files
   */
  private async analyzeSymbolChanges(
    stagedFiles: string[],
    git: GitManager,
    graph?: GraphManager
  ): Promise<{ added: SymbolChange[]; modified: SymbolChange[]; deleted: SymbolChange[] }> {
    const added: SymbolChange[] = [];
    const modified: SymbolChange[] = [];
    const deleted: SymbolChange[] = [];

    // Get previous symbols from graph (if available)
    const previousSymbols = new Map<string, SymbolNode>();
    if (graph) {
      for (const file of stagedFiles) {
        try {
          const query = `
            MATCH (f:File {path: $path})-[:DEFINES]->(s:Symbol)
            RETURN s.name AS name, s.qualifiedName AS qualifiedName, s.kind AS kind,
                   s.signature AS signature, s.complexity AS complexity
          `;
          const results = await graph.query(query, { path: file });
          for (const row of results) {
            previousSymbols.set(row.qualifiedName, {
              name: row.name,
              qualifiedName: row.qualifiedName,
              kind: row.kind,
              file,
              signature: row.signature,
              complexity: row.complexity
            } as SymbolNode);
          }
        } catch {
          // Graph query failed, continue without previous symbols
        }
      }
    }

    // Parse current state of staged files
    for (const file of stagedFiles) {
      const ext = path.extname(file);
      if (!this.parser.isExtensionSupported(ext)) {
        continue;
      }

      try {
        const absolutePath = path.join(this.repoRoot, file);
        const content = await fs.readFile(absolutePath, 'utf-8');
        const parsed = await this.parser.parseFile(file, content);

        // Compare symbols
        const currentSymbols = new Set<string>();

        for (const symbol of parsed.symbols) {
          currentSymbols.add(symbol.qualifiedName);

          const previous = previousSymbols.get(symbol.qualifiedName);

          if (!previous) {
            // New symbol
            added.push({
              name: symbol.name,
              qualifiedName: symbol.qualifiedName,
              kind: symbol.kind,
              file,
              changeType: 'added',
              signature: symbol.signature,
              complexity: symbol.complexity
            });
          } else if (previous.signature !== symbol.signature) {
            // Modified symbol (signature changed)
            modified.push({
              name: symbol.name,
              qualifiedName: symbol.qualifiedName,
              kind: symbol.kind,
              file,
              changeType: 'modified',
              signature: symbol.signature,
              complexity: symbol.complexity
            });
          }
        }

        // Check for deleted symbols
        for (const [qualifiedName, prev] of previousSymbols) {
          if (prev.file === file && !currentSymbols.has(qualifiedName)) {
            deleted.push({
              name: prev.name,
              qualifiedName,
              kind: prev.kind,
              file,
              changeType: 'deleted',
              signature: prev.signature,
              complexity: prev.complexity
            });
          }
        }
      } catch {
        // File parsing failed, skip
      }
    }

    return { added, modified, deleted };
  }

  /**
   * Find callers affected by symbol changes
   */
  private async findAffectedCallers(
    symbolAnalysis: { added: SymbolChange[]; modified: SymbolChange[]; deleted: SymbolChange[] },
    graph: GraphManager
  ): Promise<Array<{ caller: string; callee: string; file: string }>> {
    const affected: Array<{ caller: string; callee: string; file: string }> = [];

    // Check callers for modified and deleted symbols
    const symbolsToCheck = [...symbolAnalysis.modified, ...symbolAnalysis.deleted];

    for (const symbol of symbolsToCheck) {
      try {
        const callers = await graph.getCallers(symbol.name);
        for (const caller of callers) {
          // Only include external callers (not in the same file)
          if (caller.file !== symbol.file) {
            affected.push({
              caller: caller.qualifiedName,
              callee: symbol.qualifiedName,
              file: caller.file
            });
          }
        }
      } catch {
        // Graph query failed, continue
      }
    }

    return affected;
  }

  /**
   * Detect breaking changes
   */
  private async detectBreakingChanges(
    symbolAnalysis: { added: SymbolChange[]; modified: SymbolChange[]; deleted: SymbolChange[] },
    callersAffected: Array<{ caller: string; callee: string; file: string }>
  ): Promise<BreakingChange[]> {
    const breaking: BreakingChange[] = [];

    // Deleted symbols with external callers are breaking
    for (const deleted of symbolAnalysis.deleted) {
      const affectedCallers = callersAffected
        .filter(c => c.callee === deleted.qualifiedName)
        .map(c => c.caller);

      if (affectedCallers.length > 0) {
        breaking.push({
          symbol: deleted.qualifiedName,
          file: deleted.file,
          reason: `Deleted ${deleted.kind} '${deleted.name}' which has ${affectedCallers.length} external caller(s)`,
          affectedCallers
        });
      }
    }

    // Modified signatures with external callers may be breaking
    for (const modified of symbolAnalysis.modified) {
      const affectedCallers = callersAffected
        .filter(c => c.callee === modified.qualifiedName)
        .map(c => c.caller);

      if (affectedCallers.length > 0 && modified.signature) {
        breaking.push({
          symbol: modified.qualifiedName,
          file: modified.file,
          reason: `Modified signature of ${modified.kind} '${modified.name}' which has ${affectedCallers.length} external caller(s)`,
          affectedCallers
        });
      }
    }

    return breaking;
  }

  /**
   * Infer commit type from changes
   */
  private inferCommitType(
    symbolAnalysis: { added: SymbolChange[]; modified: SymbolChange[]; deleted: SymbolChange[] },
    filesChanged: string[]
  ): CommitType {
    // Check for test files
    const hasTestChanges = filesChanged.some(f =>
      f.includes('.test.') || f.includes('.spec.') || f.includes('/tests/') || f.includes('__tests__')
    );
    if (hasTestChanges && filesChanged.every(f =>
      f.includes('.test.') || f.includes('.spec.') || f.includes('/tests/') || f.includes('__tests__')
    )) {
      return 'test';
    }

    // Check for docs only
    const hasDocsOnly = filesChanged.every(f =>
      f.endsWith('.md') || f.includes('/docs/') || f.includes('README')
    );
    if (hasDocsOnly) {
      return 'docs';
    }

    // Check for config/build files
    const hasBuildConfig = filesChanged.some(f =>
      f.includes('package.json') || f.includes('tsconfig') ||
      f.includes('webpack') || f.includes('vite') || f.includes('.config.')
    );
    if (hasBuildConfig && filesChanged.every(f =>
      f.includes('package.json') || f.includes('tsconfig') ||
      f.includes('webpack') || f.includes('vite') || f.includes('.config.') ||
      f.endsWith('.json') || f.endsWith('.yaml') || f.endsWith('.yml')
    )) {
      return 'build';
    }

    // Check for CI files
    const hasCIChanges = filesChanged.some(f =>
      f.includes('.github/workflows') || f.includes('.gitlab-ci') ||
      f.includes('Jenkinsfile') || f.includes('.circleci')
    );
    if (hasCIChanges) {
      return 'ci';
    }

    // New symbols = likely feat
    if (symbolAnalysis.added.length > 0 && symbolAnalysis.deleted.length === 0) {
      // Check if it's a refactor (many modifications)
      if (symbolAnalysis.modified.length > symbolAnalysis.added.length * 2) {
        return 'refactor';
      }
      return 'feat';
    }

    // Deletions without additions = likely refactor
    if (symbolAnalysis.deleted.length > 0 && symbolAnalysis.added.length === 0) {
      return 'refactor';
    }

    // Only modifications = could be fix or refactor
    if (symbolAnalysis.added.length === 0 && symbolAnalysis.deleted.length === 0) {
      // Default to fix for modifications
      return 'fix';
    }

    // Mixed changes
    return 'chore';
  }

  /**
   * Infer scope from changes
   */
  private inferScope(
    symbolAnalysis: { added: SymbolChange[]; modified: SymbolChange[]; deleted: SymbolChange[] },
    filesChanged: string[]
  ): string {
    // Extract module/directory names from file paths
    const moduleCounts = new Map<string, number>();

    for (const file of filesChanged) {
      const parts = file.split('/');
      // Skip root files, look for package/module names
      if (parts.length > 1) {
        // Try to find meaningful scope: packages/X, src/X, lib/X
        let scope = '';
        for (let i = 0; i < parts.length - 1; i++) {
          if (parts[i] === 'packages' || parts[i] === 'src' || parts[i] === 'lib') {
            scope = parts[i + 1];
            break;
          }
        }
        // Fallback to first directory
        if (!scope && parts.length > 1) {
          scope = parts[0];
        }
        if (scope) {
          moduleCounts.set(scope, (moduleCounts.get(scope) || 0) + 1);
        }
      }
    }

    // Return most common scope
    let maxCount = 0;
    let scope = '';
    for (const [mod, count] of moduleCounts) {
      if (count > maxCount) {
        maxCount = count;
        scope = mod;
      }
    }

    return scope;
  }

  /**
   * Calculate complexity change
   */
  private calculateComplexityDelta(
    symbolAnalysis: { added: SymbolChange[]; modified: SymbolChange[]; deleted: SymbolChange[] }
  ): number {
    let delta = 0;

    for (const added of symbolAnalysis.added) {
      delta += added.complexity || 1;
    }

    for (const deleted of symbolAnalysis.deleted) {
      delta -= deleted.complexity || 1;
    }

    return delta;
  }

  /**
   * Get affected modules
   */
  private getAffectedModules(filesChanged: string[]): string[] {
    const modules = new Set<string>();

    for (const file of filesChanged) {
      const parts = file.split('/');
      // Extract module path (first 2-3 directories)
      if (parts.length > 1) {
        modules.add(parts.slice(0, Math.min(2, parts.length - 1)).join('/'));
      }
    }

    return Array.from(modules);
  }

  /**
   * Build prompt for AI
   */
  private buildPrompt(analysis: CommitAnalysis): string {
    let prompt = `You are generating a git commit message following the Conventional Commits specification.

## Analysis Summary
- Files changed: ${analysis.filesChanged.length}
- Lines added: ${analysis.linesAdded}
- Lines removed: ${analysis.linesRemoved}

## Symbol Changes (from code analysis)
`;

    if (analysis.symbolsAdded.length > 0) {
      prompt += `\n### Added Symbols (${analysis.symbolsAdded.length}):\n`;
      for (const s of analysis.symbolsAdded.slice(0, 10)) {
        prompt += `- ${s.kind}: ${s.name} (${s.file})\n`;
      }
      if (analysis.symbolsAdded.length > 10) {
        prompt += `- ... and ${analysis.symbolsAdded.length - 10} more\n`;
      }
    }

    if (analysis.symbolsModified.length > 0) {
      prompt += `\n### Modified Symbols (${analysis.symbolsModified.length}):\n`;
      for (const s of analysis.symbolsModified.slice(0, 10)) {
        prompt += `- ${s.kind}: ${s.name} (${s.file})\n`;
      }
    }

    if (analysis.symbolsDeleted.length > 0) {
      prompt += `\n### Deleted Symbols (${analysis.symbolsDeleted.length}):\n`;
      for (const s of analysis.symbolsDeleted.slice(0, 5)) {
        prompt += `- ${s.kind}: ${s.name} (${s.file})\n`;
      }
    }

    if (analysis.callersAffected.length > 0) {
      prompt += `\n## Impact Analysis
- ${analysis.callersAffected.length} external caller(s) potentially affected\n`;
    }

    if (analysis.isBreakingChange) {
      prompt += `\n## BREAKING CHANGES DETECTED
`;
      for (const bc of analysis.breakingChanges) {
        prompt += `- ${bc.reason}\n`;
      }
    }

    prompt += `
## Suggested Classification
- Type: ${analysis.suggestedType}
- Scope: ${analysis.suggestedScope || '(none)'}

## Raw Diff (truncated)
\`\`\`diff
${analysis.rawDiff.slice(0, 3000)}${analysis.rawDiff.length > 3000 ? '\n... (truncated)' : ''}
\`\`\`

## Instructions
Generate a commit message following this format:
\`\`\`
<type>(<scope>): <subject>

[optional body]

[optional footer]
\`\`\`

Rules:
1. The subject line should be 50-72 characters
2. Use imperative mood ("add" not "added")
3. Don't capitalize the first letter of the subject
4. No period at the end of the subject
5. Focus on WHY, not WHAT (the diff shows what)
6. If there are breaking changes, include "BREAKING CHANGE:" in the footer
7. Use the suggested type unless you have strong reason to change it

Respond with ONLY the commit message, no explanations or markdown code blocks.`;

    return prompt;
  }

  /**
   * Parse generated message
   */
  private parseGeneratedMessage(text: string, analysis: CommitAnalysis): GeneratedCommitMessage {
    // Clean up the response
    let message = text.trim();

    // Remove any markdown code blocks if present
    message = message.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    message = message.trim();

    // Split into parts
    const lines = message.split('\n');
    const subject = lines[0];

    let body: string | undefined;
    let footer: string | undefined;

    // Find body and footer
    if (lines.length > 1) {
      const restLines = lines.slice(1).join('\n').trim();

      // Check for BREAKING CHANGE footer
      const breakingIndex = restLines.indexOf('BREAKING CHANGE:');
      if (breakingIndex !== -1) {
        body = restLines.slice(0, breakingIndex).trim() || undefined;
        footer = restLines.slice(breakingIndex).trim();
      } else {
        body = restLines || undefined;
      }
    }

    return {
      subject,
      body,
      footer,
      fullMessage: message,
      analysis
    };
  }
}

/**
 * Create a CommitAnalyzer instance
 */
export function createCommitAnalyzer(options: CommitAnalyzerOptions): CommitAnalyzer {
  return new CommitAnalyzer(options);
}

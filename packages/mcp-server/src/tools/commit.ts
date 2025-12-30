/**
 * Commit Tool Handlers
 * MCP tools for AI-powered commit message generation
 *
 * Phase 6.1 - AI Commit Message Generation
 *
 * Design philosophy:
 * - cv_commit_analyze returns structured analysis for the AI agent to use
 * - The calling AI agent (Claude Code, etc.) generates the commit message
 * - This avoids extra API costs and lets the agent use full context
 */

import { ToolResult } from '../types.js';
import { successResult, errorResult } from '../utils.js';
import {
  configManager,
  createGitManager,
  createGraphManager,
  createCommitAnalyzer,
  CommitAnalysis
} from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';

/**
 * Arguments for cv_commit_analyze
 */
export interface CommitAnalyzeArgs {
  // No arguments needed - analyzes staged changes
}

/**
 * Arguments for cv_commit_generate
 */
export interface CommitGenerateArgs {
  type?: string;   // Override commit type
  scope?: string;  // Override commit scope
}

/**
 * Handle cv_commit_analyze tool call
 * Analyzes staged changes and returns structured information
 *
 * This tool returns rich analysis that the calling AI agent can use
 * to generate a commit message, avoiding extra API costs.
 */
export async function handleCommitAnalyze(_args: CommitAnalyzeArgs): Promise<ToolResult> {
  try {
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Create managers
    const git = createGitManager(repoRoot);

    // Try to connect to graph for enhanced analysis
    let graph: any = undefined;
    try {
      const config = await configManager.load(repoRoot);
      graph = createGraphManager(config.graph.url, config.graph.database);
      await graph.connect();
    } catch {
      // Graph not available, continue without it
    }

    // Create analyzer in 'none' mode (analysis only, no AI call)
    const analyzer = createCommitAnalyzer({ repoRoot, provider: 'none' });
    const analysis = await analyzer.analyzeStaged(git, graph);

    // Close graph if connected
    if (graph) {
      await graph.close();
    }

    // Format output with suggested message template
    const output = formatAnalysisForAgent(analysis);
    return successResult(output);

  } catch (error: any) {
    return errorResult('Failed to analyze staged changes', error);
  }
}

/**
 * Handle cv_commit_generate tool call
 * Returns a suggested commit message template based on analysis
 *
 * The AI agent can use this as a starting point and refine based on context.
 */
export async function handleCommitGenerate(args: CommitGenerateArgs): Promise<ToolResult> {
  try {
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    // Create managers
    const git = createGitManager(repoRoot);

    // Try to connect to graph for enhanced analysis
    let graph: any = undefined;
    try {
      const config = await configManager.load(repoRoot);
      graph = createGraphManager(config.graph.url, config.graph.database);
      await graph.connect();
    } catch {
      // Graph not available, continue without it
    }

    // Create analyzer in 'none' mode (generates template, no external AI call)
    const analyzer = createCommitAnalyzer({ repoRoot, provider: 'none' });

    // Analyze staged changes
    const analysis = await analyzer.analyzeStaged(git, graph);

    // Apply overrides
    if (args.type) {
      analysis.suggestedType = args.type as any;
    }
    if (args.scope) {
      analysis.suggestedScope = args.scope;
    }

    // Generate template message (no AI call, just analysis-based template)
    const generated = await analyzer.generateMessage(analysis);

    // Close graph if connected
    if (graph) {
      await graph.close();
    }

    // Format output with suggested message and analysis
    let output = `## Suggested Commit Message\n\n`;
    output += `\`\`\`\n${generated.fullMessage}\n\`\`\`\n\n`;
    output += `**Note:** This is a template based on code analysis. `;
    output += `You can refine this message based on the actual intent of the changes.\n\n`;
    output += `## Analysis Summary\n\n`;
    output += formatAnalysisBrief(analysis);

    if (analysis.isBreakingChange) {
      output += `\n## Breaking Changes Detected\n\n`;
      for (const bc of analysis.breakingChanges) {
        output += `- ${bc.reason}\n`;
      }
    }

    return successResult(output);

  } catch (error: any) {
    return errorResult('Failed to generate commit message', error);
  }
}

/**
 * Format analysis for AI agents with guidance for commit message generation
 */
function formatAnalysisForAgent(analysis: CommitAnalysis): string {
  let output = `## Commit Analysis\n\n`;
  output += `Use this analysis to generate a conventional commit message.\n\n`;

  output += `### Changes Overview\n`;
  output += `- Files changed: ${analysis.filesChanged.length}\n`;
  output += `- Lines added: ${analysis.linesAdded}\n`;
  output += `- Lines removed: ${analysis.linesRemoved}\n`;
  output += `- Complexity delta: ${analysis.complexityDelta > 0 ? '+' : ''}${analysis.complexityDelta}\n\n`;

  if (analysis.symbolsAdded.length > 0) {
    output += `### Symbols Added (${analysis.symbolsAdded.length})\n`;
    for (const s of analysis.symbolsAdded.slice(0, 15)) {
      output += `- ${s.kind}: \`${s.name}\` in ${s.file}\n`;
    }
    if (analysis.symbolsAdded.length > 15) {
      output += `- ... and ${analysis.symbolsAdded.length - 15} more\n`;
    }
    output += `\n`;
  }

  if (analysis.symbolsModified.length > 0) {
    output += `### Symbols Modified (${analysis.symbolsModified.length})\n`;
    for (const s of analysis.symbolsModified.slice(0, 10)) {
      output += `- ${s.kind}: \`${s.name}\` in ${s.file}\n`;
    }
    if (analysis.symbolsModified.length > 10) {
      output += `- ... and ${analysis.symbolsModified.length - 10} more\n`;
    }
    output += `\n`;
  }

  if (analysis.symbolsDeleted.length > 0) {
    output += `### Symbols Deleted (${analysis.symbolsDeleted.length})\n`;
    for (const s of analysis.symbolsDeleted.slice(0, 10)) {
      output += `- ${s.kind}: \`${s.name}\` in ${s.file}\n`;
    }
    output += `\n`;
  }

  if (analysis.callersAffected.length > 0) {
    output += `### Impact Analysis\n`;
    output += `${analysis.callersAffected.length} external caller(s) potentially affected:\n`;
    for (const c of analysis.callersAffected.slice(0, 10)) {
      output += `- \`${c.caller}\` calls \`${c.callee}\` (${c.file})\n`;
    }
    if (analysis.callersAffected.length > 10) {
      output += `- ... and ${analysis.callersAffected.length - 10} more\n`;
    }
    output += `\n`;
  }

  output += `### Suggested Classification\n`;
  output += `- Type: **${analysis.suggestedType}**\n`;
  output += `- Scope: ${analysis.suggestedScope || '(none)'}\n`;
  output += `- Breaking Change: ${analysis.isBreakingChange ? '**YES**' : 'No'}\n\n`;

  if (analysis.isBreakingChange) {
    output += `### Breaking Changes\n`;
    for (const bc of analysis.breakingChanges) {
      output += `- **${bc.symbol}**: ${bc.reason}\n`;
      if (bc.affectedCallers.length > 0) {
        output += `  - Affected callers: ${bc.affectedCallers.slice(0, 5).join(', ')}`;
        if (bc.affectedCallers.length > 5) {
          output += ` (+${bc.affectedCallers.length - 5} more)`;
        }
        output += `\n`;
      }
    }
    output += `\n`;
  }

  output += `### Affected Modules\n`;
  for (const mod of analysis.modulesAffected) {
    output += `- ${mod}\n`;
  }

  output += `\n### Commit Message Format\n`;
  output += `Use conventional commits format:\n`;
  output += `\`\`\`\n`;
  output += `${analysis.suggestedType}${analysis.suggestedScope ? `(${analysis.suggestedScope})` : ''}: <description>\n\n`;
  output += `[optional body]\n\n`;
  output += `[optional footer]${analysis.isBreakingChange ? '\nBREAKING CHANGE: <description>' : ''}\n`;
  output += `\`\`\`\n`;

  return output;
}

/**
 * Format brief analysis for message output
 */
function formatAnalysisBrief(analysis: CommitAnalysis): string {
  let output = `- Files changed: ${analysis.filesChanged.length}\n`;
  output += `- Lines: +${analysis.linesAdded} / -${analysis.linesRemoved}\n`;
  output += `- Symbols: +${analysis.symbolsAdded.length} / ~${analysis.symbolsModified.length} / -${analysis.symbolsDeleted.length}\n`;
  output += `- Type: ${analysis.suggestedType}\n`;
  output += `- Scope: ${analysis.suggestedScope || '(none)'}\n`;
  return output;
}

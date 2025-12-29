/**
 * Modification Tool Handlers
 * Implements cv_do and cv_review
 */

import { DoArgs, ReviewArgs, ToolResult } from '../types.js';
import { successResult, errorResult, formatTaskResult, formatReview } from '../utils.js';
import {
  configManager,
  createAIManager,
  createVectorManager,
  createGraphManager,
  createGitManager,
} from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';
import { getAnthropicApiKey } from '../credentials.js';

/**
 * Handle cv_do tool call
 */
export async function handleDo(args: DoArgs): Promise<ToolResult> {
  try {
    const { task, planOnly = false, autoApprove = false } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

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
    const graph = createGraphManager(config.graph.url, config.graph.database);

    await graph.connect();

    // Initialize AI manager with all dependencies
    const ai = createAIManager(
      {
        provider: 'anthropic',
        model: config.ai.model || 'claude-sonnet-4-5-20250514',
        apiKey: anthropicApiKey,
        maxTokens: config.ai.maxTokens,
        temperature: config.ai.temperature,
      },
      undefined,  // vector manager not needed here
      graph,
      git
    );

    // Step 1: Analyze the task and create a plan using AI
    const plan = await ai.generatePlan(task);

    if (planOnly) {
      await graph.close();
      const planText = `Task: ${plan.task}

Complexity: ${plan.estimatedComplexity}

Steps:
${plan.steps.map((step, i) => `${i + 1}. [${step.type}] ${step.file}: ${step.description}`).join('\n')}

Affected Files:
${plan.affectedFiles.map(f => `  - ${f}`).join('\n')}

${plan.risks && plan.risks.length > 0 ? `\nRisks:\n${plan.risks.map(r => `  ⚠️  ${r}`).join('\n')}` : ''}`;

      return successResult(`Execution Plan:\n\n${planText}\n\nUse autoApprove=true to execute this plan.`);
    }

    // Step 2: Generate code changes using AI
    const codeChanges = await ai.generateCode(task);

    await graph.close();

    const result = {
      plan,
      changes: parseCodeChanges(codeChanges),
      summary: `Task analysis complete. ${planOnly ? 'Plan generated.' : 'Changes generated but not applied (MCP tools are read-only for safety).'}`,
    };

    const formattedResult = formatTaskResult(result);
    return successResult(formattedResult);
  } catch (error: any) {
    return errorResult('Task execution failed', error);
  }
}

/**
 * Handle cv_review tool call
 */
export async function handleReview(args: ReviewArgs): Promise<ToolResult> {
  try {
    const { ref = 'HEAD', staged = false, context: includeContext = false } = args;

    // Find repository root
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

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
    const graph = createGraphManager(config.graph.url, config.graph.database);

    await graph.connect();

    // Initialize AI manager with all dependencies
    const ai = createAIManager(
      {
        provider: 'anthropic',
        model: config.ai.model || 'claude-sonnet-4-5-20250514',
        apiKey: anthropicApiKey,
        maxTokens: config.ai.maxTokens,
        temperature: config.ai.temperature,
      },
      undefined,  // vector manager not needed
      graph,
      git
    );

    // Get the diff
    let diff: string;
    if (staged) {
      diff = await git.getRawDiff();
    } else {
      diff = await git.getRawDiff(ref);
    }

    if (!diff || diff.trim().length === 0) {
      await graph.close();
      return successResult('No changes to review.');
    }

    // Generate review using AI
    const reviewText = await ai.reviewCode(diff);

    const review = {
      summary: extractSummary(reviewText),
      issues: parseReviewIssues(reviewText),
      stats: {
        filesChanged: (diff.match(/diff --git/g) || []).length,
        linesAdded: (diff.match(/^\+[^+]/gm) || []).length,
        linesRemoved: (diff.match(/^-[^-]/gm) || []).length,
      },
    };

    await graph.close();

    const formattedReview = formatReview(review);
    return successResult(formattedReview);
  } catch (error: any) {
    return errorResult('Code review failed', error);
  }
}

/**
 * Parse code changes from AI response
 */
function parseCodeChanges(text: string): any[] {
  const changes: any[] = [];
  const sections = text.split('---').filter(s => s.trim());

  for (const section of sections) {
    const fileMatch = section.match(/FILE:\s*(.+)/);
    const changeMatch = section.match(/CHANGE:\s*(.+)/);
    const codeMatch = section.match(/CODE:\s*([\s\S]+)/);

    if (fileMatch && changeMatch) {
      changes.push({
        file: fileMatch[1].trim(),
        description: changeMatch[1].trim(),
        code: codeMatch ? codeMatch[1].trim() : '',
      });
    }
  }

  return changes;
}

/**
 * Extract summary from review text
 */
function extractSummary(text: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/summary/i) && i + 1 < lines.length) {
      return lines[i + 1].trim();
    }
  }
  return text.split('\n')[0] || 'Code review completed';
}

/**
 * Parse review issues from text
 */
function parseReviewIssues(text: string): any[] {
  const issues: any[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const severityMatch = line.match(/\[(ERROR|WARNING|INFO|STYLE)\]/i);

    if (severityMatch) {
      const severity = severityMatch[1].toLowerCase();
      const message = line.replace(/\[.+?\]/, '').trim();

      const issue: any = { severity, message };

      // Look for location and suggestion in following lines
      for (let j = i + 1; j < i + 5 && j < lines.length; j++) {
        const locationMatch = lines[j].match(/Location:\s*(.+)/);
        const suggestionMatch = lines[j].match(/Suggestion:\s*(.+)/);

        if (locationMatch) {
          const [file, line] = locationMatch[1].split(':');
          issue.file = file.trim();
          issue.line = parseInt(line) || undefined;
        }
        if (suggestionMatch) {
          issue.suggestion = suggestionMatch[1].trim();
        }
      }

      issues.push(issue);
    }
  }

  return issues;
}

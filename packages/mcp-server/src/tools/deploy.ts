/**
 * Deploy Tool Handlers
 * Implements cv_deploy_list, cv_deploy_push, cv_deploy_rollback, cv_deploy_status
 */

import { ToolResult } from '../types.js';
import { successResult, errorResult } from '../utils.js';
import { DeployOrchestrator } from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';

export interface DeployListArgs {
  // no args
}

export interface DeployPushArgs {
  target: string;
  ref?: string;
  dry_run?: boolean;
}

export interface DeployRollbackArgs {
  target: string;
  to_version?: string;
}

export interface DeployStatusArgs {
  target: string;
}

/**
 * Handle cv_deploy_list — list all deploy targets
 */
export async function handleDeployList(_args: DeployListArgs): Promise<ToolResult> {
  try {
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository. Run `cv init` first.');
    }

    const orchestrator = new DeployOrchestrator();
    const configs = await orchestrator.list(repoRoot);

    if (configs.length === 0) {
      return successResult('No deploy targets found. Create one with: cv deploy init <target> --provider <provider>');
    }

    const formatted = configs
      .map((c) => {
        const services = c.services.map((s) => s.name).join(', ');
        return `- ${c.target} (${c.provider}): ${services}`;
      })
      .join('\n');

    return successResult(`Deploy Targets:\n${formatted}`);
  } catch (error: any) {
    return errorResult('Failed to list deploy targets', error);
  }
}

/**
 * Handle cv_deploy_push — deploy a target
 */
export async function handleDeployPush(args: DeployPushArgs): Promise<ToolResult> {
  try {
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository.');
    }

    const orchestrator = new DeployOrchestrator();
    const events: string[] = [];

    const result = await orchestrator.push(args.target, repoRoot, {
      dryRun: args.dry_run ?? false,
      ref: args.ref,
      onEvent: (event) => {
        events.push(`[${event.status}] ${event.message}`);
      },
    });

    const statusLine = result.services
      .map((s) => `  ${s.name}: ${s.status}${s.message ? ` (${s.message})` : ''}`)
      .join('\n');

    const eventsLog = events.length > 0 ? `\nEvents:\n${events.join('\n')}\n` : '';

    return successResult(
      `Deploy ${args.target} (${result.provider}) — ${result.version}\n` +
        `Duration: ${(result.durationMs / 1000).toFixed(1)}s | Dry run: ${result.dryRun}\n` +
        eventsLog +
        `\nServices:\n${statusLine}`,
    );
  } catch (error: any) {
    return errorResult('Deploy failed', error);
  }
}

/**
 * Handle cv_deploy_rollback — rollback a target
 */
export async function handleDeployRollback(args: DeployRollbackArgs): Promise<ToolResult> {
  try {
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository.');
    }

    const orchestrator = new DeployOrchestrator();
    const result = await orchestrator.rollback(
      args.target,
      repoRoot,
      args.to_version ?? 'previous',
      { dryRun: false },
    );

    const statusLine = result.services
      .map((s) => `  ${s.name}: ${s.status}${s.message ? ` (${s.message})` : ''}`)
      .join('\n');

    return successResult(
      `Rollback ${args.target}: ${result.fromVersion} → ${result.toVersion}\n` +
        `Duration: ${(result.durationMs / 1000).toFixed(1)}s\n\n` +
        `Services:\n${statusLine}`,
    );
  } catch (error: any) {
    return errorResult('Rollback failed', error);
  }
}

/**
 * Handle cv_deploy_status — check health of a target
 */
export async function handleDeployStatus(args: DeployStatusArgs): Promise<ToolResult> {
  try {
    const repoRoot = await findRepoRoot();
    if (!repoRoot) {
      return errorResult('Not in a CV-Git repository.');
    }

    const orchestrator = new DeployOrchestrator();
    const health = await orchestrator.status(args.target, repoRoot);

    const statusLine = health.services
      .map((s) => {
        const latency = s.latencyMs ? ` (${s.latencyMs}ms)` : '';
        return `  ${s.healthy ? '✓' : '✗'} ${s.name}${latency}${s.message ? ` — ${s.message}` : ''}`;
      })
      .join('\n');

    return successResult(
      `Target: ${health.target}\n` +
        `Health: ${health.healthy ? 'healthy' : 'unhealthy'}\n` +
        `Checked: ${health.checkedAt}\n\n` +
        `Services:\n${statusLine}`,
    );
  } catch (error: any) {
    return errorResult('Health check failed', error);
  }
}

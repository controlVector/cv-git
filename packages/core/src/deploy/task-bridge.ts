/**
 * Deploy ↔ Task Event Bridge
 *
 * Creates DeployOptions whose onEvent callback forwards deploy lifecycle
 * events to the CV-Hub task event stream via HubClient.
 * This lets the planner see deploy progress in real-time.
 */

import type { DeployOptions, DeployEvent } from './provider.js';
import type { HubClient } from '../gateway/hub-client.js';

export interface TaskBridgeConfig {
  hub: HubClient;
  executorId: string;
  taskId: string;
  dryRun: boolean;
  ref?: string;
  verbose?: boolean;
  /** Also call this local handler (e.g. CLI output) */
  localOnEvent?: (event: DeployEvent) => void;
}

/**
 * Create DeployOptions that bridge deploy events to a hub task.
 *
 * Each deploy event (preflight, build, push, deploy, healthcheck) is
 * forwarded as a 'progress' task event so the planner can follow along.
 * Errors are forwarded as 'error' task events.
 */
export function createTaskBridgedOptions(config: TaskBridgeConfig): DeployOptions {
  const { hub, taskId, dryRun, ref, verbose, localOnEvent } = config;

  return {
    dryRun,
    ref,
    verbose,
    onEvent: (event: DeployEvent) => {
      // Always call local handler first (CLI spinner, etc.)
      localOnEvent?.(event);

      // Map deploy event to task event
      const eventType = event.status === 'error' ? 'error' : 'progress';
      const content = {
        text: `[deploy:${event.phase}] ${event.message}`,
        phase: event.phase,
        status: event.status,
        service: event.service,
        timestamp: event.timestamp,
      };

      // Fire-and-forget POST to hub task events
      hub.postTaskEvent(taskId, eventType, content).catch(() => {
        // Non-critical: deploy continues even if event delivery fails
      });
    },
  };
}

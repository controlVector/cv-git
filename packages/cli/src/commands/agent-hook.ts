/**
 * cv agent-hook — Claude Code hook handler
 *
 * Stub: will handle PermissionRequest hook relay from Claude Code
 * when running as a cv agent subprocess.
 */

import { Command } from 'commander';

export function agentHookCommand(): Command {
  const cmd = new Command('agent-hook')
    .description('Handle Claude Code hook events (used internally by cv agent)')
    .argument('[event]', 'Hook event name')
    .option('--json', 'Read JSON payload from stdin')
    .action(async (event?: string) => {
      // Stub — hook relay not yet implemented
      console.error(`cv agent-hook: event "${event ?? 'unknown'}" received (handler not yet implemented)`);
      process.exit(0);
    });

  return cmd;
}

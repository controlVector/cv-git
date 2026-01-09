/**
 * Options Interceptor
 * Intercepts --options flag before command execution to display available options
 */

import { Command } from 'commander';
import { displayOptions } from './options-display.js';

/**
 * Add preAction hook to intercept --options flag
 * When --options is passed, display options and exit instead of running the command
 */
export function withOptionsInterceptor(cmd: Command): Command {
  // Add preAction hook to check for --options
  cmd.hook('preAction', (thisCommand, actionCommand) => {
    const opts = actionCommand.opts();

    // Check if --options flag was passed
    if (opts.options === true) {
      displayOptions(actionCommand, opts.json);
      // Exit to prevent the actual command from running
      process.exit(0);
    }
  });

  // Process subcommands recursively
  cmd.commands.forEach((subCmd: Command) => {
    withOptionsInterceptor(subCmd);
  });

  return cmd;
}

/**
 * Apply options interceptor to all commands in a program
 */
export function applyOptionsInterceptor(program: Command): Command {
  // Add global preAction hook
  program.hook('preAction', (thisCommand, actionCommand) => {
    const opts = actionCommand.opts();

    // Check if --options flag was passed
    if (opts.options === true) {
      displayOptions(actionCommand, opts.json);
      // Exit to prevent the actual command from running
      process.exit(0);
    }
  });

  // Process all registered commands
  program.commands.forEach((cmd: Command) => {
    withOptionsInterceptor(cmd);
  });

  return program;
}

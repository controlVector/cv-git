/**
 * Options Display Utility
 * Display available options for CLI commands in a clean format
 */

import chalk from 'chalk';
import { Command, Option } from 'commander';

export interface OptionInfo {
  flags: string;
  description: string;
  defaultValue?: string;
  required: boolean;
  isGlobal: boolean;
}

/**
 * Global options that are added to all commands
 */
const GLOBAL_OPTIONS = ['--json', '--quiet', '--verbose', '--options'];

/**
 * Extract options from a Command object
 */
export function getCommandOptions(cmd: Command): OptionInfo[] {
  return cmd.options.map((opt: Option) => ({
    flags: opt.flags,
    description: opt.description || '',
    defaultValue: opt.defaultValue?.toString(),
    required: opt.required || false,
    isGlobal: GLOBAL_OPTIONS.some(g => opt.flags.includes(g)),
  }));
}

/**
 * Get full command path including parent commands
 */
export function getCommandPath(cmd: Command): string {
  const parts: string[] = [];
  let current: Command | null = cmd;

  while (current) {
    if (current.name() && current.name() !== 'cv') {
      parts.unshift(current.name());
    }
    current = current.parent as Command | null;
  }

  return parts.length > 0 ? `cv ${parts.join(' ')}` : 'cv';
}

/**
 * Display options for a command
 */
export function displayOptions(cmd: Command, json: boolean = false): void {
  const options = getCommandOptions(cmd);
  const commandPath = getCommandPath(cmd);

  // Separate command-specific and global options
  const commandOptions = options.filter(o => !o.isGlobal);
  const globalOptions = options.filter(o => o.isGlobal);

  if (json) {
    console.log(JSON.stringify({
      command: commandPath,
      description: cmd.description(),
      options: commandOptions,
      globalOptions: globalOptions,
    }, null, 2));
    return;
  }

  // Header
  console.log(chalk.bold(`\nOptions for '${commandPath}'`));
  console.log(chalk.gray('─'.repeat(50)));

  // Command description
  if (cmd.description()) {
    console.log(chalk.gray(cmd.description()));
    console.log();
  }

  // Command-specific options
  if (commandOptions.length > 0) {
    console.log(chalk.bold.cyan('Command Options:'));
    for (const opt of commandOptions) {
      printOption(opt);
    }
    console.log();
  }

  // Arguments
  const args = cmd.registeredArguments || [];
  if (args.length > 0) {
    console.log(chalk.bold.cyan('Arguments:'));
    for (const arg of args) {
      const required = arg.required ? chalk.red('(required)') : chalk.gray('(optional)');
      const name = chalk.yellow(`<${arg.name()}>`);
      const desc = arg.description || '';
      console.log(`  ${name.padEnd(35)} ${desc} ${required}`);
    }
    console.log();
  }

  // Global options
  if (globalOptions.length > 0) {
    console.log(chalk.bold.gray('Global Options:'));
    for (const opt of globalOptions) {
      printOption(opt, true);
    }
  }

  console.log();
}

/**
 * Print a single option
 */
function printOption(opt: OptionInfo, dimmed: boolean = false): void {
  const flags = dimmed ? chalk.gray(opt.flags.padEnd(30)) : chalk.cyan(opt.flags.padEnd(30));
  const desc = dimmed ? chalk.gray(opt.description) : opt.description;
  const def = opt.defaultValue ? chalk.gray(` [default: ${opt.defaultValue}]`) : '';
  const req = opt.required ? chalk.red(' (required)') : '';
  console.log(`  ${flags}${desc}${def}${req}`);
}

/**
 * Create a summary of all available options for help text
 */
export function createOptionsSummary(cmd: Command): string {
  const options = getCommandOptions(cmd);
  const commandOptions = options.filter(o => !o.isGlobal);

  if (commandOptions.length === 0) {
    return 'No command-specific options. Use --options for details.';
  }

  return commandOptions.map(o => o.flags.split(',')[0].trim()).join(', ');
}

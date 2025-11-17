/**
 * cv git command
 * Git passthrough
 */

import { Command } from 'commander';
import { spawn } from 'child_process';
import chalk from 'chalk';

export function gitCommand(): Command {
  const cmd = new Command('git');

  cmd
    .description('Git passthrough - execute any git command')
    .allowUnknownOption()
    .allowExcessArguments()
    .action(async () => {
      // Get all arguments after 'git'
      const args = process.argv.slice(3);

      if (args.length === 0) {
        console.log(chalk.yellow('Usage: cv git <git-command>'));
        console.log(chalk.gray('Example: cv git status'));
        return;
      }

      // Spawn git process
      const git = spawn('git', args, {
        stdio: 'inherit',
        shell: true
      });

      git.on('error', (error) => {
        console.error(chalk.red('Failed to execute git command:'), error.message);
        process.exit(1);
      });

      git.on('close', (code) => {
        process.exit(code || 0);
      });
    });

  return cmd;
}

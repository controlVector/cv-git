/**
 * cv init command
 * Initialize CV-Git in a repository
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { configManager } from '@cv-git/core';
import { ensureDir, getCVDir } from '@cv-git/shared';

export function initCommand(): Command {
  const cmd = new Command('init');

  cmd
    .description('Initialize CV-Git in the current repository')
    .option('--name <name>', 'Repository name (defaults to directory name)')
    .action(async (options) => {
      const spinner = ora('Initializing CV-Git...').start();

      try {
        const repoRoot = process.cwd();
        const repoName = options.name || path.basename(repoRoot);

        // Check if already initialized
        const cvDir = getCVDir(repoRoot);
        try {
          await configManager.load(repoRoot);
          spinner.warn(chalk.yellow('CV-Git is already initialized in this directory'));
          return;
        } catch {
          // Not initialized, proceed
        }

        // Create .cv directory
        spinner.text = 'Creating .cv directory...';
        await ensureDir(cvDir);

        // Initialize configuration
        spinner.text = 'Creating configuration...';
        const config = await configManager.init(repoRoot, repoName);

        // Create subdirectories
        spinner.text = 'Setting up directories...';
        await ensureDir(path.join(cvDir, 'cache'));
        await ensureDir(path.join(cvDir, 'sessions'));

        spinner.succeed(chalk.green('CV-Git initialized successfully!'));

        console.log();
        console.log(chalk.bold('Next steps:'));
        console.log(chalk.gray('  1. Set up your API keys:'));
        console.log(chalk.cyan('     export CV_ANTHROPIC_KEY="your-key-here"'));
        console.log(chalk.cyan('     export CV_OPENAI_KEY="your-key-here"'));
        console.log();
        console.log(chalk.gray('  2. Sync your repository:'));
        console.log(chalk.cyan('     cv sync'));
        console.log();
        console.log(chalk.gray('  3. Start using CV-Git:'));
        console.log(chalk.cyan('     cv find "authentication logic"'));
        console.log(chalk.cyan('     cv do "add logging to error handlers"'));
        console.log();

      } catch (error: any) {
        spinner.fail(chalk.red('Failed to initialize CV-Git'));
        console.error(chalk.red(error.message));
        if (error.stack) {
          console.error(chalk.gray(error.stack));
        }
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * cv review command
 * AI-powered code review using Claude
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  configManager,
  createAIManager,
  createVectorManager,
  createGraphManager,
  createGitManager
} from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';
import { addGlobalOptions } from '../utils/output.js';

export function reviewCommand(): Command {
  const cmd = new Command('review');

  cmd
    .description('Review code changes with AI')
    .argument('[ref]', 'Git ref to review (default: HEAD)', 'HEAD')
    .option('--staged', 'Review staged changes instead of a commit')
    .option('--context', 'Include related code context in review');

  addGlobalOptions(cmd);

  cmd.action(async (ref: string, options) => {
      let spinner = ora('Initializing...').start();

      try {
        // Find repository root
        const repoRoot = await findRepoRoot();
        if (!repoRoot) {
          spinner.fail(chalk.red('Not in a CV-Git repository'));
          console.error(chalk.gray('Run `cv init` first'));
          process.exit(1);
        }

        // Load configuration
        const config = await configManager.load(repoRoot);

        // Check for API keys
        const anthropicApiKey = config.ai.apiKey || process.env.ANTHROPIC_API_KEY;
        if (!anthropicApiKey) {
          spinner.fail(chalk.red('Anthropic API key not found'));
          console.error();
          console.error(chalk.yellow('Set your Anthropic API key:'));
          console.error(chalk.gray('  export ANTHROPIC_API_KEY=sk-ant-...'));
          console.error(chalk.gray('Or add it to .cv/config.json'));
          process.exit(1);
        }

        const openaiApiKey = config.ai.apiKey || process.env.OPENAI_API_KEY;

        // Initialize components
        spinner.text = 'Connecting to services...';

        // Git manager
        const git = createGitManager(repoRoot);

        // Get diff
        spinner.text = 'Getting code changes...';
        let diff: string;

        if (options.staged) {
          diff = await git.getRawDiff('--staged');
        } else {
          diff = await git.getRawDiff(ref);
        }

        if (!diff || diff.trim().length === 0) {
          spinner.warn(chalk.yellow('No changes to review'));
          console.log();
          console.log(chalk.gray('Tips:'));
          console.log(chalk.gray('  • Make some changes and stage them: git add .'));
          console.log(chalk.gray('  • Review staged changes: cv review --staged'));
          console.log(chalk.gray('  • Review a specific commit: cv review <commit-sha>'));
          console.log();
          process.exit(0);
        }

        spinner.succeed(chalk.green('Changes retrieved'));

        // Optional: gather context
        let context = undefined;
        if (options.context) {
          // Vector manager (optional)
          let vector = undefined;
          if (openaiApiKey && config.vector) {
            try {
              vector = createVectorManager(
                config.vector.url,
                openaiApiKey,
                config.vector.collections
              );
              await vector.connect();
            } catch (error) {
              console.log(chalk.gray('  ⚠ Could not connect to vector DB'));
            }
          }

          // Graph manager
          const graph = createGraphManager(config.graph.url, config.graph.database);
          await graph.connect();

          // AI manager for context gathering
          const contextAI = createAIManager(
            {
              provider: 'anthropic',
              model: config.ai.model,
              apiKey: anthropicApiKey
            },
            vector,
            graph,
            git
          );

          spinner = ora('Gathering code context...').start();
          context = await contextAI.gatherContext('code review');
          spinner.succeed(chalk.green('Context gathered'));

          await graph.close();
          if (vector) await vector.close();
        }

        // AI manager for review
        const ai = createAIManager(
          {
            provider: 'anthropic',
            model: config.ai.model,
            apiKey: anthropicApiKey
          },
          undefined,
          undefined,
          git
        );

        // Generate review
        console.log();
        console.log(chalk.bold.cyan('Code Review:'));
        console.log(chalk.gray('─'.repeat(80)));
        console.log();

        spinner = ora('Analyzing changes...').start();
        const review = await ai.reviewCode(diff, context);
        spinner.stop();

        console.log(review);
        console.log();
        console.log(chalk.gray('─'.repeat(80)));
        console.log();

        // Summary
        console.log(chalk.bold('Review complete! 🎉'));
        console.log();
        console.log(chalk.gray('Next steps:'));
        console.log(chalk.gray('  • Address any issues raised'));
        console.log(chalk.gray('  • Run tests: npm test / pytest'));
        console.log(chalk.gray('  • Commit if ready: git commit'));
        console.log();

      } catch (error: any) {
        if (spinner) {
          spinner.fail(chalk.red('Review failed'));
        }

        console.error(chalk.red(`Error: ${error.message}`));

        if (error.message.includes('API key')) {
          console.error();
          console.error(chalk.yellow('Check your API key configuration'));
        }

        if (error.message.includes('rate limit')) {
          console.error();
          console.error(chalk.yellow('Rate limit exceeded - try again in a moment'));
        }

        if (error.message.includes('git')) {
          console.error();
          console.error(chalk.yellow('Make sure you are in a git repository'));
        }

        if (process.env.CV_DEBUG) {
          console.error(chalk.gray(error.stack));
        }

        process.exit(1);
      }
    });

  return cmd;
}

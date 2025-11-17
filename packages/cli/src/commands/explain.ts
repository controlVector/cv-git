/**
 * cv explain command
 * Explain code or concepts using Claude
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

export function explainCommand(): Command {
  const cmd = new Command('explain');

  cmd
    .description('Explain code, files, or concepts using AI')
    .argument('<target>', 'What to explain (symbol name, file path, or concept)')
    .option('--no-stream', 'Disable streaming output')
    .action(async (target: string, options) => {
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

        // Vector manager (optional but recommended)
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
            console.log(chalk.gray('  ⚠ Could not connect to vector DB - continuing without semantic search'));
          }
        }

        // Graph manager
        const graph = createGraphManager(config.graph.url, config.graph.database);
        await graph.connect();

        // Git manager
        const git = createGitManager(repoRoot);

        // AI manager
        const ai = createAIManager(
          {
            provider: 'anthropic',
            model: config.ai.model,
            apiKey: anthropicApiKey
          },
          vector,
          graph,
          git
        );

        spinner.text = 'Gathering context...';

        // Gather context for the target
        const context = await ai.gatherContext(target);

        if (context.chunks.length === 0 && context.symbols.length === 0) {
          spinner.warn(chalk.yellow('No relevant code found'));
          console.log();
          console.log(chalk.gray('Tips:'));
          console.log(chalk.gray('  • Make sure you have run `cv sync`'));
          console.log(chalk.gray('  • Try a different query or symbol name'));
          console.log(chalk.gray('  • Use `cv find` to search for code first'));
          console.log();

          await graph.close();
          if (vector) await vector.close();
          process.exit(1);
        }

        spinner.succeed(
          chalk.green(
            `Found ${context.chunks.length} code chunks and ${context.symbols.length} symbols`
          )
        );

        // Show context summary
        console.log();
        console.log(chalk.bold.cyan('Context:'));
        if (context.chunks.length > 0) {
          console.log(chalk.gray(`  📄 ${context.chunks.length} relevant code sections`));
          context.chunks.slice(0, 3).forEach(chunk => {
            console.log(
              chalk.gray(
                `     • ${chunk.payload.symbolName || 'code'} in ${chunk.payload.file}`
              )
            );
          });
        }
        if (context.symbols.length > 0) {
          console.log(chalk.gray(`  🔗 ${context.symbols.length} related symbols`));
        }
        console.log();

        // Generate explanation
        console.log(chalk.bold.cyan('Explanation:'));
        console.log(chalk.gray('─'.repeat(80)));
        console.log();

        if (options.stream) {
          // Stream the response
          await ai.explain(target, context, {
            onToken: (token) => {
              process.stdout.write(token);
            },
            onComplete: (fullText) => {
              console.log();
              console.log();
              console.log(chalk.gray('─'.repeat(80)));
            },
            onError: (error) => {
              console.error(chalk.red(`\nError: ${error.message}`));
            }
          });
        } else {
          // Non-streaming
          spinner = ora('Asking Claude...').start();
          const explanation = await ai.explain(target, context);
          spinner.stop();

          console.log(explanation);
          console.log();
          console.log(chalk.gray('─'.repeat(80)));
        }

        // Close connections
        await graph.close();
        if (vector) await vector.close();

      } catch (error: any) {
        if (spinner) {
          spinner.fail(chalk.red('Explanation failed'));
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

        if (process.env.CV_DEBUG) {
          console.error(chalk.gray(error.stack));
        }

        process.exit(1);
      }
    });

  return cmd;
}

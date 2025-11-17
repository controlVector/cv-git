/**
 * cv do command
 * AI-driven task execution with Claude
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import {
  configManager,
  createAIManager,
  createVectorManager,
  createGraphManager,
  createGitManager
} from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';
import { Plan } from '@cv-git/shared';
import { addGlobalOptions } from '../utils/output.js';

export function doCommand(): Command {
  const cmd = new Command('do');

  cmd
    .description('Execute a task with AI assistance')
    .argument('<task>', 'Task description in natural language')
    .option('--plan-only', 'Only generate the plan, do not generate code')
    .option('--yes', 'Skip approval prompts');

  addGlobalOptions(cmd);

  cmd.action(async (task: string, options) => {
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

        // Step 1: Gather context
        spinner.text = 'Gathering context...';
        const context = await ai.gatherContext(task, { includeGitStatus: true });

        spinner.succeed(
          chalk.green(
            `Found ${context.chunks.length} code chunks and ${context.symbols.length} symbols`
          )
        );

        // Step 2: Generate plan
        spinner = ora('Generating plan...').start();
        const plan = await ai.generatePlan(task, context);
        spinner.succeed(chalk.green('Plan generated'));

        // Display plan
        displayPlan(plan);

        // Step 3: Get user approval
        if (!options.yes && !options.planOnly) {
          const approved = await askForApproval('Proceed with code generation?');
          if (!approved) {
            console.log(chalk.yellow('Task cancelled'));
            await graph.close();
            if (vector) await vector.close();
            process.exit(0);
          }
        }

        if (options.planOnly) {
          console.log();
          console.log(chalk.cyan('Plan generated. Use `cv do` without --plan-only to generate code.'));
          await graph.close();
          if (vector) await vector.close();
          return;
        }

        // Step 4: Generate code
        console.log();
        console.log(chalk.bold.cyan('Generated Code:'));
        console.log(chalk.gray('─'.repeat(80)));
        console.log();

        spinner = ora('Generating code...').start();

        const generatedCode = await ai.generateCode(task, context, {
          onToken: (token) => {
            if (!spinner.isSpinning) {
              process.stdout.write(token);
            }
          },
          onComplete: () => {
            if (spinner.isSpinning) {
              spinner.stop();
            }
            console.log();
            console.log();
            console.log(chalk.gray('─'.repeat(80)));
          }
        });

        if (spinner.isSpinning) {
          spinner.stop();
          console.log(generatedCode);
          console.log();
          console.log(chalk.gray('─'.repeat(80)));
        }

        console.log();
        console.log(chalk.green('✓ Code generated successfully'));
        console.log();
        console.log(chalk.bold('Next steps:'));
        console.log(chalk.gray('  1. Review the generated code above'));
        console.log(chalk.gray('  2. Apply the changes manually to your files'));
        console.log(chalk.gray('  3. Test the changes'));
        console.log(chalk.gray('  4. Commit when ready: git commit -m "..."'));
        console.log();

        // Close connections
        await graph.close();
        if (vector) await vector.close();

      } catch (error: any) {
        if (spinner) {
          spinner.fail(chalk.red('Task execution failed'));
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

/**
 * Display a plan
 */
function displayPlan(plan: Plan): void {
  console.log();
  console.log(chalk.bold.cyan('Generated Plan:'));
  console.log(chalk.gray('─'.repeat(80)));
  console.log();

  console.log(chalk.bold('Task:'), plan.task);
  console.log(chalk.bold('Complexity:'), getComplexityColor(plan.estimatedComplexity)(plan.estimatedComplexity));
  console.log();

  console.log(chalk.bold('Steps:'));
  plan.steps.forEach((step, idx) => {
    const typeColor = getTypeColor(step.type);
    console.log(
      chalk.white(`  ${idx + 1}. `) +
      typeColor(`[${step.type.toUpperCase()}]`) +
      chalk.white(` ${step.description}`)
    );
    console.log(chalk.gray(`     File: ${step.file}`));
    if (step.details) {
      console.log(chalk.gray(`     ${step.details}`));
    }
  });

  if (plan.risks && plan.risks.length > 0) {
    console.log();
    console.log(chalk.yellow('⚠  Risks:'));
    plan.risks.forEach(risk => {
      console.log(chalk.yellow(`  • ${risk}`));
    });
  }

  console.log();
  console.log(chalk.gray('─'.repeat(80)));
}

/**
 * Get color for complexity
 */
function getComplexityColor(complexity: string): (text: string) => string {
  switch (complexity) {
    case 'low':
      return chalk.green;
    case 'medium':
      return chalk.yellow;
    case 'high':
      return chalk.red;
    default:
      return chalk.white;
  }
}

/**
 * Get color for step type
 */
function getTypeColor(type: string): (text: string) => string {
  switch (type) {
    case 'create':
      return chalk.green;
    case 'modify':
      return chalk.yellow;
    case 'delete':
      return chalk.red;
    case 'rename':
      return chalk.cyan;
    default:
      return chalk.white;
  }
}

/**
 * Ask for user approval
 */
async function askForApproval(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(chalk.cyan(`${question} (y/N): `), answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

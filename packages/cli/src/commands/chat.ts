/**
 * cv chat command
 * Interactive AI chat with knowledge graph context
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import {
  configManager,
  createVectorManager,
  createGraphManager,
  createOpenRouterClient,
  OPENROUTER_MODELS,
  OpenRouterMessage,
  VectorManager,
  GraphManager,
} from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';
import { CredentialManager } from '@cv-git/credentials';
import { addGlobalOptions, createOutput } from '../utils/output.js';

interface ChatOptions {
  model?: string;
  noContext?: boolean;
  contextLimit?: string;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

// System prompt for code-aware chat
const SYSTEM_PROMPT = `You are an expert software engineer assistant with access to a codebase knowledge graph.

When answering questions:
1. Reference specific files and line numbers when discussing code
2. Explain how components relate to each other
3. Suggest concrete improvements when asked
4. Be concise but thorough

The user's codebase context will be provided with each message when relevant.`;

export function chatCommand(): Command {
  const cmd = new Command('chat');

  cmd
    .description('Interactive AI chat with codebase context')
    .argument('[question]', 'One-shot question (omit for interactive mode)')
    .option('-m, --model <model>', 'Model to use (e.g., claude-3.5-sonnet, gpt-4o, llama-3.1-70b)')
    .option('--no-context', 'Disable automatic context injection')
    .option('-c, --context-limit <n>', 'Max code chunks to include', '5');

  addGlobalOptions(cmd);

  cmd.action(async (question: string | undefined, options: ChatOptions) => {
    const output = createOutput(options as any);

    try {
      // Find repository root
      const repoRoot = await findRepoRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a CV-Git repository. Run `cv init` first.'));
        process.exit(1);
      }

      // Load configuration
      const config = await configManager.load(repoRoot);

      // Get API keys
      let openrouterApiKey = process.env.OPENROUTER_API_KEY;
      let openaiApiKey = process.env.OPENAI_API_KEY;

      try {
        const credentials = new CredentialManager();
        await credentials.init();

        if (!openrouterApiKey) {
          openrouterApiKey = await credentials.getOpenRouterKey() || undefined;
        }
        if (!openaiApiKey) {
          openaiApiKey = await credentials.getOpenAIKey() || undefined;
        }
      } catch {
        // Credential manager not available
      }

      if (!openrouterApiKey) {
        console.error(chalk.red('OpenRouter API key not found.'));
        console.error(chalk.gray('Run: cv auth setup openrouter'));
        console.error(chalk.gray('Or set: export OPENROUTER_API_KEY=sk-or-...'));
        process.exit(1);
      }

      // Initialize OpenRouter client
      const model = options.model || 'claude-3.5-sonnet';
      const client = createOpenRouterClient({
        apiKey: openrouterApiKey,
        model,
      });

      // Initialize vector manager for context (if available)
      let vector: VectorManager | null = null;
      let graph: GraphManager | null = null;

      if (options.noContext !== true) {
        // Set OpenRouter key for vector embeddings if no OpenAI key
        if (!openaiApiKey && openrouterApiKey) {
          process.env.OPENROUTER_API_KEY = openrouterApiKey;
        }

        const embeddingKey = openaiApiKey || openrouterApiKey;
        if (embeddingKey && config.vector) {
          try {
            vector = createVectorManager(
              config.vector.url,
              openaiApiKey,
              config.vector.collections
            );
            await vector.connect();
          } catch (e) {
            output.debug?.('Vector DB not available, continuing without semantic search');
          }
        }

        if (config.graph) {
          try {
            graph = createGraphManager(config.graph.url, config.graph.database);
            await graph.connect();
          } catch (e) {
            output.debug?.('Graph DB not available, continuing without relationships');
          }
        }
      }

      // Show startup info
      console.log();
      console.log(chalk.bold.cyan('cv chat') + chalk.gray(` - using ${client.getModel()}`));
      if (vector) {
        console.log(chalk.green('✓') + chalk.gray(' Knowledge graph context enabled'));
      } else {
        console.log(chalk.yellow('○') + chalk.gray(' No context (run `cv sync` first)'));
      }
      console.log();

      // One-shot mode
      if (question) {
        await handleSingleQuestion(question, client, vector, graph, parseInt(options.contextLimit || '5', 10));
        await cleanup(vector, graph);
        return;
      }

      // Interactive mode
      await interactiveChat(client, vector, graph, parseInt(options.contextLimit || '5', 10));
      await cleanup(vector, graph);

    } catch (error: any) {
      console.error(chalk.red(`Error: ${error.message}`));
      if (process.env.CV_DEBUG) {
        console.error(chalk.gray(error.stack));
      }
      process.exit(1);
    }
  });

  // Add subcommand to list available models
  cmd
    .command('models')
    .description('List available models')
    .action(() => {
      console.log(chalk.bold('\nAvailable Models:\n'));

      const categories: Record<string, string[]> = {
        'Anthropic': ['claude-3.5-sonnet', 'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
        'OpenAI': ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
        'Google': ['gemini-pro', 'gemini-flash'],
        'Meta': ['llama-3.1-70b', 'llama-3.1-8b'],
        'Mistral': ['mixtral-8x7b', 'mistral-large'],
        'DeepSeek': ['deepseek-chat', 'deepseek-coder'],
      };

      for (const [provider, models] of Object.entries(categories)) {
        console.log(chalk.cyan(`  ${provider}:`));
        for (const model of models) {
          const fullName = OPENROUTER_MODELS[model as keyof typeof OPENROUTER_MODELS];
          console.log(chalk.white(`    ${model}`) + chalk.gray(` → ${fullName}`));
        }
        console.log();
      }

      console.log(chalk.gray('Use with: cv chat -m <model>'));
      console.log(chalk.gray('Example: cv chat -m gpt-4o "explain the auth flow"'));
      console.log();
    });

  return cmd;
}

/**
 * Handle a single question (one-shot mode)
 */
async function handleSingleQuestion(
  question: string,
  client: ReturnType<typeof createOpenRouterClient>,
  vector: VectorManager | null,
  graph: GraphManager | null,
  contextLimit: number
): Promise<void> {
  // Gather context
  let context = '';
  if (vector) {
    const spinner = ora('Searching codebase...').start();
    context = await gatherContext(question, vector, graph, contextLimit);
    spinner.stop();
  }

  // Build message with context
  const userMessage = context
    ? `<codebase_context>\n${context}\n</codebase_context>\n\n${question}`
    : question;

  // Stream response
  process.stdout.write(chalk.cyan('Assistant: '));

  await client.chatStream(
    [{ role: 'user', content: userMessage }],
    SYSTEM_PROMPT,
    {
      onToken: (token) => process.stdout.write(token),
      onComplete: () => console.log('\n'),
    }
  );
}

/**
 * Interactive chat mode
 */
async function interactiveChat(
  client: ReturnType<typeof createOpenRouterClient>,
  vector: VectorManager | null,
  graph: GraphManager | null,
  contextLimit: number
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const messages: OpenRouterMessage[] = [];

  console.log(chalk.gray('Type your questions. Commands: /help, /clear, /model <name>, /quit\n'));

  const askQuestion = (): void => {
    rl.question(chalk.green('You: '), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        askQuestion();
        return;
      }

      // Handle commands
      if (trimmed.startsWith('/')) {
        await handleCommand(trimmed, client, messages, rl);
        if (trimmed === '/quit' || trimmed === '/exit') {
          return;
        }
        askQuestion();
        return;
      }

      // Gather context for this message
      let context = '';
      if (vector) {
        const spinner = ora('Searching...').start();
        context = await gatherContext(trimmed, vector, graph, contextLimit);
        spinner.stop();
        // Clear spinner line
        process.stdout.write('\r\x1b[K');
      }

      // Build message with context
      const userMessage = context
        ? `<codebase_context>\n${context}\n</codebase_context>\n\n${trimmed}`
        : trimmed;

      messages.push({ role: 'user', content: userMessage });

      // Stream response
      process.stdout.write(chalk.cyan('Assistant: '));

      try {
        const response = await client.chatStream(
          messages,
          SYSTEM_PROMPT,
          {
            onToken: (token) => process.stdout.write(token),
          }
        );

        console.log('\n');
        messages.push({ role: 'assistant', content: response });
      } catch (error: any) {
        console.log();
        console.error(chalk.red(`Error: ${error.message}`));
      }

      askQuestion();
    });
  };

  askQuestion();

  // Handle Ctrl+C gracefully
  rl.on('close', () => {
    console.log(chalk.gray('\nGoodbye!'));
    process.exit(0);
  });
}

/**
 * Handle chat commands
 */
async function handleCommand(
  command: string,
  client: ReturnType<typeof createOpenRouterClient>,
  messages: OpenRouterMessage[],
  rl: readline.Interface
): Promise<void> {
  const parts = command.split(' ');
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case '/help':
      console.log(chalk.gray(`
Commands:
  /help           Show this help
  /clear          Clear conversation history
  /model <name>   Switch model (e.g., /model gpt-4o)
  /models         List available models
  /quit           Exit chat
`));
      break;

    case '/clear':
      messages.length = 0;
      console.log(chalk.gray('Conversation cleared.\n'));
      break;

    case '/model':
      if (parts[1]) {
        client.setModel(parts[1]);
        console.log(chalk.gray(`Switched to ${client.getModel()}\n`));
      } else {
        console.log(chalk.gray(`Current model: ${client.getModel()}\n`));
      }
      break;

    case '/models':
      console.log(chalk.gray('\nAvailable models:'));
      for (const [alias, full] of Object.entries(OPENROUTER_MODELS)) {
        console.log(chalk.gray(`  ${alias} → ${full}`));
      }
      console.log();
      break;

    case '/quit':
    case '/exit':
      console.log(chalk.gray('Goodbye!'));
      rl.close();
      break;

    default:
      console.log(chalk.yellow(`Unknown command: ${cmd}. Type /help for commands.\n`));
  }
}

/**
 * Gather relevant context from the knowledge graph
 */
async function gatherContext(
  query: string,
  vector: VectorManager,
  graph: GraphManager | null,
  limit: number
): Promise<string> {
  const parts: string[] = [];

  // Search for relevant code
  try {
    const chunks = await vector.searchCode(query, limit, { minScore: 0.5 });

    if (chunks.length > 0) {
      parts.push('## Relevant Code\n');

      for (const chunk of chunks) {
        const { payload, score } = chunk;
        parts.push(`### ${payload.file}:${payload.startLine}-${payload.endLine} (${(score * 100).toFixed(0)}% match)`);
        if (payload.symbolName) {
          parts.push(`Symbol: ${payload.symbolName} (${payload.symbolKind})`);
        }
        parts.push('```' + (payload.language || ''));
        parts.push(payload.text);
        parts.push('```\n');
      }

      // Get relationships if graph available
      if (graph) {
        const symbolNames = chunks
          .map(c => c.payload.symbolName)
          .filter((name): name is string => !!name)
          .slice(0, 3);

        if (symbolNames.length > 0) {
          parts.push('## Code Relationships\n');

          for (const symbolName of symbolNames) {
            try {
              const callers = await graph.getCallers(symbolName);
              const callees = await graph.getCallees(symbolName);

              if (callers.length > 0 || callees.length > 0) {
                parts.push(`### ${symbolName}`);
                if (callers.length > 0) {
                  parts.push(`Called by: ${callers.slice(0, 3).map(s => s.name).join(', ')}`);
                }
                if (callees.length > 0) {
                  parts.push(`Calls: ${callees.slice(0, 3).map(s => s.name).join(', ')}`);
                }
                parts.push('');
              }
            } catch {
              // Skip on error
            }
          }
        }
      }
    }
  } catch (error) {
    // Return empty context on error
  }

  return parts.join('\n');
}

/**
 * Cleanup resources
 */
async function cleanup(vector: VectorManager | null, graph: GraphManager | null): Promise<void> {
  if (vector) await vector.close();
  if (graph) await graph.close();
}

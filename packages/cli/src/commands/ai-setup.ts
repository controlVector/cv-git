/**
 * cv ai — Local AI provider configuration and status
 *
 * Subcommands:
 *   cv ai setup   — Interactive wizard to detect and configure local AI providers
 *   cv ai status  — Show current AI provider configuration and connectivity
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  isOllamaRunning,
  createOllamaClient,
} from '@cv-git/core';
import {
  isLMStudioRunning,
  createLMStudioClient,
} from '@cv-git/core';
import { getOllamaUrl, getLMStudioUrl } from '@cv-git/core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface AISetupConfig {
  provider: string;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
}

function getConfigPath(): string {
  const configDir = process.env.XDG_CONFIG_HOME
    || (process.platform === 'win32'
      ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
      : path.join(os.homedir(), '.config'));
  return path.join(configDir, 'cv-git', 'ai-config.json');
}

function loadAIConfig(): AISetupConfig | null {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

function saveAIConfig(config: AISetupConfig): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

interface ProviderStatus {
  name: string;
  available: boolean;
  url: string;
  modelCount: number;
}

async function detectProviders(): Promise<ProviderStatus[]> {
  const ollamaUrl = getOllamaUrl();
  const lmstudioUrl = getLMStudioUrl();

  const results = await Promise.allSettled([
    (async (): Promise<ProviderStatus> => {
      const available = await isOllamaRunning(ollamaUrl);
      let modelCount = 0;
      if (available) {
        const client = createOllamaClient({ baseUrl: ollamaUrl });
        const models = await client.listModels();
        modelCount = models.length;
      }
      return { name: 'Ollama', available, url: ollamaUrl, modelCount };
    })(),
    (async (): Promise<ProviderStatus> => {
      const available = await isLMStudioRunning(lmstudioUrl);
      let modelCount = 0;
      if (available) {
        const client = createLMStudioClient({ baseUrl: lmstudioUrl });
        const models = await client.listModels();
        modelCount = models.length;
      }
      return { name: 'LM Studio', available, url: lmstudioUrl, modelCount };
    })(),
  ]);

  return results.map(r => r.status === 'fulfilled'
    ? r.value
    : { name: '?', available: false, url: '', modelCount: 0 }
  );
}

async function runSetupWizard(): Promise<void> {
  console.log();
  console.log(chalk.bold('  CV-Git Local AI Configuration'));
  console.log();
  console.log('  Detecting local AI providers...');
  console.log();

  const providers = await detectProviders();
  const openaiKey = process.env.OPENAI_API_KEY || process.env.CV_OPENAI_KEY;

  for (const p of providers) {
    const icon = p.available ? chalk.green('✓') : chalk.red('✗');
    const detail = p.available
      ? chalk.gray(`running at ${p.url.replace(/^https?:\/\//, '')}   (${p.modelCount} models)`)
      : chalk.gray('(not running)');
    console.log(`  ${icon} ${chalk.bold(p.name.padEnd(16))} ${detail}`);
  }

  const openaiIcon = openaiKey ? chalk.green('✓') : chalk.red('✗');
  const openaiDetail = openaiKey ? chalk.gray('(API key set)') : chalk.gray('(no OPENAI_API_KEY set)');
  console.log(`  ${openaiIcon} ${chalk.bold('OpenAI API'.padEnd(16))} ${openaiDetail}`);
  console.log();

  const availableProviders = providers.filter(p => p.available);

  if (availableProviders.length === 0 && !openaiKey) {
    console.log(chalk.yellow('  No local AI providers detected.'));
    console.log();
    console.log('  To use local AI with CV-Git:');
    console.log(`    ${chalk.cyan('Ollama')}:     https://ollama.ai  (run: ollama serve)`);
    console.log(`    ${chalk.cyan('LM Studio')}:  https://lmstudio.ai  (start server from app or: lms server start)`);
    console.log();
    console.log('  Or configure a cloud provider:');
    console.log(`    ${chalk.cyan('OpenAI')}: set OPENAI_API_KEY and re-run cv ai setup`);
    console.log();
    return;
  }

  // Build provider choices
  const choices: Array<{ name: string; value: string }> = [];
  for (const p of availableProviders) {
    choices.push({
      name: `${p.name}   (local, no API key needed)`,
      value: p.name.toLowerCase().replace(' ', ''),
    });
  }
  if (openaiKey) {
    choices.push({ name: 'OpenAI   (cloud, requires API key)', value: 'openai' });
  }
  choices.push({ name: 'Skip / configure later', value: 'skip' });

  const { selectedProvider } = await inquirer.prompt([{
    type: 'list',
    name: 'selectedProvider',
    message: 'Select your preferred AI provider for CV-Git:',
    choices,
  }]);

  if (selectedProvider === 'skip') {
    console.log(chalk.gray('\n  You can configure AI later with: cv ai setup'));
    return;
  }

  if (selectedProvider === 'openai') {
    const config: AISetupConfig = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      chatModel: 'gpt-4o',
      embeddingModel: 'text-embedding-3-small',
    };
    saveAIConfig(config);
    console.log(chalk.green('\n  ✓ Configuration saved.'));
    printConfig(config);
    return;
  }

  // LM Studio or Ollama — fetch models and let user pick
  if (selectedProvider === 'lmstudio') {
    await configureLMStudio();
  } else if (selectedProvider === 'ollama') {
    await configureOllama();
  }
}

async function configureLMStudio(): Promise<void> {
  const url = getLMStudioUrl();
  const client = createLMStudioClient({ baseUrl: url });

  console.log(chalk.gray('\n  Fetching available models from LM Studio...'));

  const { chat, embedding } = await client.listModelsByType();

  let chatModel = '';
  let embeddingModel = '';

  if (chat.length > 0) {
    const { model } = await inquirer.prompt([{
      type: 'list',
      name: 'model',
      message: 'Select chat model for CV-Git (code analysis, summaries):',
      choices: chat.map((m, i) => ({ name: `${i + 1}. ${m}`, value: m })),
    }]);
    chatModel = model;
  } else {
    console.log(chalk.yellow('  No chat models loaded. Load a model in LM Studio first.'));
  }

  if (embedding.length > 0) {
    const { model } = await inquirer.prompt([{
      type: 'list',
      name: 'model',
      message: 'Select embedding model for CV-Git (code search, RAG):',
      choices: embedding.map((m, i) => ({ name: `${i + 1}. ${m}`, value: m })),
    }]);
    embeddingModel = model;
  } else {
    console.log(chalk.yellow('  No embedding models loaded. Load an embedding model in LM Studio for vector search.'));
  }

  const config: AISetupConfig = {
    provider: 'lmstudio',
    baseUrl: url,
    chatModel,
    embeddingModel,
  };
  saveAIConfig(config);
  console.log(chalk.green('\n  ✓ Configuration saved.'));
  printConfig(config);

  // Connectivity test
  await runConnectivityTest(config);
}

async function configureOllama(): Promise<void> {
  const url = getOllamaUrl();
  const client = createOllamaClient({ baseUrl: url });

  console.log(chalk.gray('\n  Fetching available models from Ollama...'));

  const models = await client.listModels();

  let chatModel = '';
  let embeddingModel = '';

  const chatModels = models.filter(m => !m.includes('embed'));
  const embeddingModels = models.filter(m => m.includes('embed') || m.includes('nomic'));

  if (chatModels.length > 0) {
    const { model } = await inquirer.prompt([{
      type: 'list',
      name: 'model',
      message: 'Select chat model for CV-Git:',
      choices: chatModels.map((m, i) => ({ name: `${i + 1}. ${m}`, value: m })),
    }]);
    chatModel = model;
  }

  if (embeddingModels.length > 0) {
    const { model } = await inquirer.prompt([{
      type: 'list',
      name: 'model',
      message: 'Select embedding model for CV-Git:',
      choices: embeddingModels.map((m, i) => ({ name: `${i + 1}. ${m}`, value: m })),
    }]);
    embeddingModel = model;
  } else {
    embeddingModel = 'nomic-embed-text';
    console.log(chalk.gray(`  Using default embedding model: ${embeddingModel}`));
  }

  const config: AISetupConfig = {
    provider: 'ollama',
    baseUrl: url,
    chatModel,
    embeddingModel,
  };
  saveAIConfig(config);
  console.log(chalk.green('\n  ✓ Configuration saved.'));
  printConfig(config);
}

function printConfig(config: AISetupConfig): void {
  console.log();
  console.log(`  Provider:        ${chalk.cyan(config.provider)}`);
  console.log(`  Chat model:      ${config.chatModel || chalk.gray('(none)')}`);
  console.log(`  Embedding model: ${config.embeddingModel || chalk.gray('(none)')}`);
  console.log(`  Server URL:      ${chalk.gray(config.baseUrl)}`);
}

async function runConnectivityTest(config: AISetupConfig): Promise<void> {
  console.log(chalk.gray('\n  Running connectivity test...'));

  try {
    if (config.provider === 'lmstudio') {
      const ok = await isLMStudioRunning(config.baseUrl);
      console.log(ok
        ? chalk.green('  ✓ LM Studio server reachable')
        : chalk.red('  ✗ LM Studio server not reachable'));
    } else if (config.provider === 'ollama') {
      const ok = await isOllamaRunning(config.baseUrl);
      console.log(ok
        ? chalk.green('  ✓ Ollama server reachable')
        : chalk.red('  ✗ Ollama server not reachable'));
    }
  } catch {
    console.log(chalk.yellow('  ⚠ Connectivity test failed'));
  }

  console.log();
  console.log(`  CV-Git is ready. Run ${chalk.cyan('cv doctor')} to check full system status.`);
  console.log();
}

async function showStatus(): Promise<void> {
  const config = loadAIConfig();

  if (!config) {
    console.log();
    console.log(chalk.yellow('  No AI provider configured.'));
    console.log(`  Run ${chalk.cyan('cv ai setup')} to configure.`);
    console.log();
    return;
  }

  console.log();
  console.log(`  AI Provider:     ${chalk.cyan(config.provider)}  (${config.baseUrl})`);

  // Check connectivity
  let reachable = false;
  if (config.provider === 'lmstudio') {
    reachable = await isLMStudioRunning(config.baseUrl);
  } else if (config.provider === 'ollama') {
    reachable = await isOllamaRunning(config.baseUrl);
  } else {
    reachable = true; // cloud providers assumed reachable
  }

  const chatStatus = reachable ? chalk.green('[available]') : chalk.red('[unreachable]');
  const embedStatus = reachable ? chalk.green('[available]') : chalk.red('[unreachable]');

  console.log(`  Chat model:      ${config.chatModel || chalk.gray('(none)')}   ${chatStatus}`);
  console.log(`  Embedding model: ${config.embeddingModel || chalk.gray('(none)')}   ${embedStatus}`);
  console.log(`  Status:          ${reachable ? chalk.green('✓ Ready') : chalk.red('✗ Not reachable')}`);

  if (!reachable && config.provider === 'lmstudio') {
    console.log();
    console.log(chalk.yellow(`  Start LM Studio server: lms server start`));
  } else if (!reachable && config.provider === 'ollama') {
    console.log();
    console.log(chalk.yellow(`  Start Ollama: ollama serve`));
  }

  console.log();
}

export { loadAIConfig, runSetupWizard as runAISetupWizard };

export function aiCommand(): Command {
  const cmd = new Command('ai');
  cmd.description('Local AI provider configuration and status');

  cmd
    .command('setup')
    .description('Interactive wizard to configure local AI providers')
    .action(async () => {
      await runSetupWizard();
    });

  cmd
    .command('status')
    .description('Show current AI provider configuration and connectivity')
    .action(async () => {
      await showStatus();
    });

  return cmd;
}

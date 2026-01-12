/**
 * Preference Picker UI
 *
 * Interactive prompts for selecting user preferences during init
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import {
  AIProvider,
  EmbeddingProvider,
  GitPlatformType,
  UserPreferences,
  getPreferences,
} from '../config.js';

export interface PreferenceChoices {
  gitPlatform: GitPlatformType;
  aiProvider: AIProvider;
  embeddingProvider: EmbeddingProvider;
}

/**
 * Display welcome message for first-time setup
 */
function displayWelcome(): void {
  console.log();
  console.log(chalk.bold.blue('Welcome to CV-Git!'));
  console.log(chalk.gray('Let\'s set up your preferences to customize the experience.'));
  console.log();
}

/**
 * Run the preference picker flow
 */
export async function runPreferencePicker(
  existingPrefs?: Partial<UserPreferences>
): Promise<PreferenceChoices> {
  displayWelcome();

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'gitPlatform',
      message: 'Which git platform do you primarily use?',
      choices: [
        {
          name: `${chalk.white('GitHub')} ${chalk.gray('- github.com')}`,
          value: 'github',
        },
        {
          name: `${chalk.white('GitLab')} ${chalk.gray('- gitlab.com or self-hosted')}`,
          value: 'gitlab',
        },
        {
          name: `${chalk.white('Bitbucket')} ${chalk.gray('- bitbucket.org')}`,
          value: 'bitbucket',
        },
      ],
      default: existingPrefs?.gitPlatform || 'github',
    },
    {
      type: 'list',
      name: 'aiProvider',
      message: 'Which AI provider do you prefer for code assistance?',
      choices: [
        {
          name: `${chalk.white('Anthropic')} ${chalk.gray('- Claude models (recommended)')}`,
          value: 'anthropic',
        },
        {
          name: `${chalk.white('OpenAI')} ${chalk.gray('- GPT models')}`,
          value: 'openai',
        },
        {
          name: `${chalk.white('OpenRouter')} ${chalk.gray('- Access multiple models')}`,
          value: 'openrouter',
        },
      ],
      default: existingPrefs?.aiProvider || 'anthropic',
    },
    {
      type: 'list',
      name: 'embeddingProvider',
      message: 'Which provider should generate embeddings for code search?',
      choices: [
        {
          name: `${chalk.white('Ollama')} ${chalk.gray('- Local, free, runs via Docker (recommended)')}`,
          value: 'ollama',
        },
        {
          name: `${chalk.white('OpenRouter')} ${chalk.gray('- Cloud-based, requires API key')}`,
          value: 'openrouter',
        },
        {
          name: `${chalk.white('OpenAI')} ${chalk.gray('- text-embedding-3-small, requires API key')}`,
          value: 'openai',
        },
      ],
      default: existingPrefs?.embeddingProvider || 'ollama',
    },
  ]);

  return answers as PreferenceChoices;
}

/**
 * Display a summary of selected preferences
 */
export function displayPreferenceSummary(prefs: PreferenceChoices): void {
  console.log();
  console.log(chalk.bold('Your preferences:'));
  console.log(chalk.gray('─'.repeat(40)));

  const platformNames: Record<GitPlatformType, string> = {
    github: 'GitHub',
    gitlab: 'GitLab',
    bitbucket: 'Bitbucket',
  };

  const aiNames: Record<AIProvider, string> = {
    anthropic: 'Anthropic (Claude)',
    openai: 'OpenAI (GPT)',
    openrouter: 'OpenRouter',
  };

  const embeddingNames: Record<EmbeddingProvider, string> = {
    ollama: 'Ollama (Local)',
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
  };

  console.log(`  ${chalk.cyan('Git Platform:')}    ${platformNames[prefs.gitPlatform]}`);
  console.log(`  ${chalk.cyan('AI Provider:')}     ${aiNames[prefs.aiProvider]}`);
  console.log(`  ${chalk.cyan('Embeddings:')}      ${embeddingNames[prefs.embeddingProvider]}`);
  console.log(chalk.gray('─'.repeat(40)));
  console.log();
}

/**
 * Save preferences and return them
 */
export async function savePreferences(choices: PreferenceChoices): Promise<UserPreferences> {
  const prefsManager = getPreferences();
  return await prefsManager.init(choices);
}

/**
 * Get required API keys based on preferences
 */
export function getRequiredServices(prefs: PreferenceChoices): string[] {
  const services: string[] = [];

  // Git platform
  services.push(prefs.gitPlatform);

  // AI provider
  services.push(prefs.aiProvider);

  // Embedding provider (if different from AI provider)
  // Note: Ollama runs locally so it doesn't need an API key
  if (prefs.embeddingProvider !== prefs.aiProvider && prefs.embeddingProvider !== 'ollama') {
    // OpenAI embeddings require OpenAI key
    if (prefs.embeddingProvider === 'openai' && prefs.aiProvider !== 'openai') {
      services.push('openai');
    }
    // OpenRouter embeddings require OpenRouter key
    if (prefs.embeddingProvider === 'openrouter' && prefs.aiProvider !== 'openrouter') {
      services.push('openrouter');
    }
  }

  return services;
}

/**
 * Display which API keys will be needed
 */
export function displayRequiredKeys(prefs: PreferenceChoices): void {
  const services = getRequiredServices(prefs);

  console.log(chalk.bold('API keys needed:'));
  console.log();

  for (const service of services) {
    switch (service) {
      case 'github':
        console.log(`  ${chalk.cyan('•')} GitHub Personal Access Token`);
        break;
      case 'gitlab':
        console.log(`  ${chalk.cyan('•')} GitLab Personal Access Token`);
        break;
      case 'bitbucket':
        console.log(`  ${chalk.cyan('•')} Bitbucket App Password`);
        break;
      case 'anthropic':
        console.log(`  ${chalk.cyan('•')} Anthropic API Key`);
        break;
      case 'openai':
        console.log(`  ${chalk.cyan('•')} OpenAI API Key`);
        break;
      case 'openrouter':
        console.log(`  ${chalk.cyan('•')} OpenRouter API Key`);
        break;
    }
  }

  console.log();
}

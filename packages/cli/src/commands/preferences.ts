/**
 * cv preferences - Manage user preferences
 *
 * View and update user preferences for git platforms, AI providers, etc.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  getPreferences,
  AIProvider,
  EmbeddingProvider,
  GitPlatformType,
} from '../config.js';
import {
  runPreferencePicker,
  displayPreferenceSummary,
  savePreferences,
} from '../utils/preference-picker.js';
import { addGlobalOptions, createOutput } from '../utils/output.js';

export function preferencesCommand(): Command {
  const cmd = new Command('preferences')
    .alias('prefs')
    .description('Manage user preferences');

  // cv preferences list
  cmd
    .command('list')
    .alias('ls')
    .description('Show current preferences')
    .action(async () => {
      const prefsManager = getPreferences();
      const hasPrefs = await prefsManager.exists();

      if (!hasPrefs) {
        console.log(chalk.yellow('\nNo preferences set yet.'));
        console.log(chalk.gray('Run ') + chalk.cyan('cv init') + chalk.gray(' to set up your preferences.'));
        return;
      }

      const prefs = await prefsManager.load();

      console.log(chalk.bold('\nUser Preferences:\n'));

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
        openai: 'OpenAI',
        openrouter: 'OpenRouter',
      };

      const table = new Table({
        head: [chalk.cyan('Setting'), chalk.cyan('Value')],
        colWidths: [25, 35],
      });

      table.push(
        ['Git Platform', platformNames[prefs.gitPlatform]],
        ['AI Provider', aiNames[prefs.aiProvider]],
        ['Embedding Provider', embeddingNames[prefs.embeddingProvider]],
        ['Setup Complete', prefs.setupComplete ? chalk.green('Yes') : chalk.yellow('No')],
        ['Last Updated', new Date(prefs.updatedAt).toLocaleString()],
      );

      console.log(table.toString());
      console.log();
      console.log(chalk.gray('Preferences file: ') + chalk.white(prefsManager.getPath()));
      console.log();
    });

  // cv preferences get <key>
  cmd
    .command('get <key>')
    .description('Get a specific preference value')
    .action(async (key: string) => {
      const prefsManager = getPreferences();
      const hasPrefs = await prefsManager.exists();

      if (!hasPrefs) {
        console.log(chalk.yellow('No preferences set yet.'));
        console.log(chalk.gray('Run ') + chalk.cyan('cv init') + chalk.gray(' to set up preferences.'));
        process.exit(1);
      }

      const prefs = await prefsManager.load();
      let value: string | undefined;

      switch (key) {
        case 'git-platform':
        case 'gitPlatform':
          value = prefs.gitPlatform;
          break;
        case 'ai-provider':
        case 'aiProvider':
          value = prefs.aiProvider;
          break;
        case 'embedding-provider':
        case 'embeddingProvider':
          value = prefs.embeddingProvider;
          break;
        case 'setup-complete':
        case 'setupComplete':
          value = prefs.setupComplete ? 'true' : 'false';
          break;
        case 'updated-at':
        case 'updatedAt':
          value = new Date(prefs.updatedAt).toISOString();
          break;
        default:
          console.log(chalk.red(`Unknown preference: ${key}`));
          console.log(chalk.gray('Valid keys: git-platform, ai-provider, embedding-provider, setup-complete, updated-at'));
          process.exit(1);
      }

      // Output just the value (good for scripting)
      console.log(value);
    });

  // cv preferences set <key> <value>
  cmd
    .command('set <key> <value>')
    .description('Set a preference (git-platform, ai-provider, embedding-provider)')
    .action(async (key: string, value: string) => {
      const prefsManager = getPreferences();
      const hasPrefs = await prefsManager.exists();

      if (!hasPrefs) {
        console.log(chalk.yellow('\nNo preferences file yet.'));
        console.log(chalk.gray('Run ') + chalk.cyan('cv init') + chalk.gray(' first to set up preferences.'));
        return;
      }

      const prefs = await prefsManager.load();

      switch (key) {
        case 'git-platform':
        case 'gitPlatform':
          if (!['github', 'gitlab', 'bitbucket'].includes(value)) {
            console.log(chalk.red(`Invalid git platform: ${value}`));
            console.log(chalk.gray('Valid options: github, gitlab, bitbucket'));
            return;
          }
          prefs.gitPlatform = value as GitPlatformType;
          break;

        case 'ai-provider':
        case 'aiProvider':
          if (!['anthropic', 'openai', 'openrouter'].includes(value)) {
            console.log(chalk.red(`Invalid AI provider: ${value}`));
            console.log(chalk.gray('Valid options: anthropic, openai, openrouter'));
            return;
          }
          prefs.aiProvider = value as AIProvider;
          break;

        case 'embedding-provider':
        case 'embeddingProvider':
          if (!['openai', 'openrouter'].includes(value)) {
            console.log(chalk.red(`Invalid embedding provider: ${value}`));
            console.log(chalk.gray('Valid options: openai, openrouter'));
            return;
          }
          prefs.embeddingProvider = value as EmbeddingProvider;
          break;

        default:
          console.log(chalk.red(`Unknown preference: ${key}`));
          console.log(chalk.gray('Valid keys: git-platform, ai-provider, embedding-provider'));
          return;
      }

      await prefsManager.save(prefs);
      console.log(chalk.green(`\nUpdated ${key} to ${value}`));
    });

  // cv preferences reset
  cmd
    .command('reset')
    .description('Reset preferences and run setup again')
    .action(async () => {
      console.log(chalk.bold('\nReset Preferences\n'));

      const prefs = await runPreferencePicker();
      displayPreferenceSummary(prefs);
      await savePreferences(prefs);

      console.log(chalk.green('Preferences updated!'));
    });

  // cv preferences path
  cmd
    .command('path')
    .description('Show preferences file path')
    .action(() => {
      const prefsManager = getPreferences();
      console.log(prefsManager.getPath());
    });

  // Default action (show list)
  addGlobalOptions(cmd);

  cmd.action(async (options) => {
    const output = createOutput(options);
    const prefsManager = getPreferences();
    const hasPrefs = await prefsManager.exists();

    if (!hasPrefs) {
      if (output.isJson) {
        output.json({ exists: false, preferences: null });
      } else {
        console.log(chalk.yellow('\nNo preferences set yet.'));
        console.log(chalk.gray('Run ') + chalk.cyan('cv init') + chalk.gray(' to set up your preferences.'));
      }
      return;
    }

    const prefs = await prefsManager.load();

    if (output.isJson) {
      output.json({ exists: true, preferences: prefs });
    } else {
      // Run list command
      const listCmd = cmd.commands.find(c => c.name() === 'list');
      if (listCmd) {
        await listCmd.parseAsync([], { from: 'user' });
      }
    }
  });

  return cmd;
}

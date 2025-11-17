/**
 * Config Command
 * Manage CV-Git configuration
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { getConfig } from '../config.js';
import { spawn } from 'child_process';
import Table from 'cli-table3';

export function configCommand(): Command {
  const cmd = new Command('config');
  cmd.description('Manage CV-Git configuration');

  // cv config get <key>
  cmd
    .command('get')
    .description('Get a configuration value')
    .argument('<key>', 'Configuration key (e.g., platform.type, ai.model)')
    .option('--json', 'Output as JSON')
    .action(async (key: string, options) => {
      try {
        const config = getConfig();
        const value = await config.getNested(key);

        if (value === undefined) {
          console.error(chalk.red(`✗ Configuration key '${key}' not found`));
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify({ key, value }, null, 2));
        } else {
          console.log(chalk.cyan(key + ':'), formatValue(value));
        }
      } catch (error: any) {
        console.error(chalk.red('✗ Error getting config:'), error.message);
        process.exit(1);
      }
    });

  // cv config set <key> <value>
  cmd
    .command('set')
    .description('Set a configuration value')
    .argument('<key>', 'Configuration key')
    .argument('<value>', 'Value to set')
    .option('--json', 'Treat value as JSON')
    .action(async (key: string, value: string, options) => {
      try {
        const config = getConfig();

        // Parse value
        let parsedValue: any = value;
        if (options.json) {
          try {
            parsedValue = JSON.parse(value);
          } catch {
            console.error(chalk.red('✗ Invalid JSON value'));
            process.exit(1);
          }
        } else {
          // Auto-detect type
          if (value === 'true') parsedValue = true;
          else if (value === 'false') parsedValue = false;
          else if (!isNaN(Number(value)) && value !== '') parsedValue = Number(value);
        }

        await config.setNested(key, parsedValue);
        console.log(chalk.green('✓'), `Set ${chalk.cyan(key)} = ${formatValue(parsedValue)}`);
      } catch (error: any) {
        console.error(chalk.red('✗ Error setting config:'), error.message);
        process.exit(1);
      }
    });

  // cv config list
  cmd
    .command('list')
    .description('List all configuration values')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const config = getConfig();
        const fullConfig = await config.load();

        if (options.json) {
          console.log(JSON.stringify(fullConfig, null, 2));
        } else {
          console.log(chalk.bold('\n📋 CV-Git Configuration\n'));

          // Platform
          console.log(chalk.bold.cyan('Platform:'));
          printKeyValue('  type', fullConfig.platform.type);
          if (fullConfig.platform.url) printKeyValue('  url', fullConfig.platform.url);
          if (fullConfig.platform.api) printKeyValue('  api', fullConfig.platform.api);

          // Credentials
          console.log(chalk.bold.cyan('\nCredentials:'));
          printKeyValue('  storage', fullConfig.credentials.storage);
          printKeyValue('  masterPasswordRequired', fullConfig.credentials.masterPasswordRequired);

          // AI
          console.log(chalk.bold.cyan('\nAI:'));
          printKeyValue('  provider', fullConfig.ai.provider);
          printKeyValue('  model', fullConfig.ai.model);
          printKeyValue('  maxTokens', fullConfig.ai.maxTokens);
          printKeyValue('  temperature', fullConfig.ai.temperature);

          // Graph
          console.log(chalk.bold.cyan('\nKnowledge Graph:'));
          printKeyValue('  url', fullConfig.graph.url);
          printKeyValue('  database', fullConfig.graph.database);

          // Vector
          console.log(chalk.bold.cyan('\nVector Search:'));
          printKeyValue('  url', fullConfig.vector.url);
          printKeyValue('  collection', fullConfig.vector.collection);

          // Features
          console.log(chalk.bold.cyan('\nFeatures:'));
          printKeyValue('  aiCommitMessages', fullConfig.features.aiCommitMessages);
          printKeyValue('  aiPRDescriptions', fullConfig.features.aiPRDescriptions);
          printKeyValue('  aiCodeReview', fullConfig.features.aiCodeReview);
          printKeyValue('  autoMerge', fullConfig.features.autoMerge);

          console.log();
        }
      } catch (error: any) {
        console.error(chalk.red('✗ Error listing config:'), error.message);
        process.exit(1);
      }
    });

  // cv config reset
  cmd
    .command('reset')
    .description('Reset configuration to defaults')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options) => {
      try {
        if (!options.yes) {
          console.log(chalk.yellow('⚠️  This will reset all configuration to defaults.'));
          console.log(chalk.yellow('   Press Ctrl+C to cancel, or Enter to continue...'));
          await new Promise((resolve) => {
            process.stdin.once('data', resolve);
          });
        }

        const config = getConfig();
        await config.reset();
        console.log(chalk.green('✓'), 'Configuration reset to defaults');
      } catch (error: any) {
        console.error(chalk.red('✗ Error resetting config:'), error.message);
        process.exit(1);
      }
    });

  // cv config edit
  cmd
    .command('edit')
    .description('Open configuration in editor')
    .action(async () => {
      try {
        const config = getConfig();
        const configPath = (config as any).configPath;

        // Ensure config exists
        const exists = await config.exists();
        if (!exists) {
          await config.init();
          console.log(chalk.green('✓'), 'Created configuration file');
        }

        // Determine editor
        const editor = process.env.VISUAL || process.env.EDITOR || 'vi';

        console.log(chalk.cyan('Opening configuration in'), chalk.bold(editor));
        console.log(chalk.gray(`File: ${configPath}\n`));

        // Spawn editor
        const child = spawn(editor, [configPath], {
          stdio: 'inherit',
        });

        child.on('exit', (code) => {
          if (code === 0) {
            console.log(chalk.green('\n✓'), 'Configuration updated');
          } else {
            console.log(chalk.yellow('\n⚠️ '), 'Editor exited with code', code);
          }
        });
      } catch (error: any) {
        console.error(chalk.red('✗ Error editing config:'), error.message);
        process.exit(1);
      }
    });

  // cv config path
  cmd
    .command('path')
    .description('Show configuration file path')
    .action(async () => {
      const config = getConfig();
      const configPath = (config as any).configPath;
      console.log(configPath);
    });

  return cmd;
}

/**
 * Format value for display
 */
function formatValue(value: any): string {
  if (typeof value === 'boolean') {
    return value ? chalk.green('true') : chalk.red('false');
  }
  if (typeof value === 'number') {
    return chalk.yellow(value.toString());
  }
  if (typeof value === 'object') {
    return chalk.gray(JSON.stringify(value, null, 2));
  }
  return chalk.white(value);
}

/**
 * Print key-value pair
 */
function printKeyValue(key: string, value: any): void {
  console.log(`${chalk.gray(key + ':')} ${formatValue(value)}`);
}

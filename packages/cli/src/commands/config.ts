/**
 * Config Command
 * Manage CV-Git configuration
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { getConfig } from '../config.js';
import { spawn } from 'child_process';
import Table from 'cli-table3';
import {
  loadCVGitConfig,
  saveCVGitConfig,
  detectPrivilegeMode,
  getDefaultPaths,
  getRecommendedRuntime,
  getContainerService
} from '@cv-git/core';

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

  // cv config privilege
  cmd
    .command('privilege')
    .description('Show privilege mode configuration')
    .action(async () => {
      try {
        const globalConfig = await loadCVGitConfig();
        const detectedMode = detectPrivilegeMode();
        const paths = getDefaultPaths(globalConfig.privilege.mode);
        const containerService = getContainerService();
        const status = await containerService.getStatus();

        console.log(chalk.bold('\n🔐 Privilege Configuration\n'));

        console.log(chalk.cyan('Configured Mode:'), formatValue(globalConfig.privilege.mode));
        console.log(chalk.cyan('Detected Mode:'), formatValue(detectedMode));
        console.log(chalk.cyan('Running as Root:'), process.getuid?.() === 0 ? chalk.yellow('Yes') : chalk.green('No'));
        console.log(chalk.cyan('Allow Sudo:'), formatValue(globalConfig.privilege.allowSudo));
        console.log(chalk.cyan('Warn on Root:'), formatValue(globalConfig.privilege.warnOnRoot));

        console.log(chalk.bold('\n📂 Paths\n'));
        console.log(chalk.cyan('Data:'), paths.data);
        console.log(chalk.cyan('Config:'), paths.config);
        console.log(chalk.cyan('Cache:'), paths.cache);
        console.log(chalk.cyan('Logs:'), paths.logs);
        console.log(chalk.cyan('Bin:'), paths.bin);

        console.log(chalk.bold('\n🐳 Container Runtime\n'));
        console.log(chalk.cyan('Runtime:'), status.runtime);
        console.log(chalk.cyan('Rootless:'), status.rootless ? chalk.green('Yes') : chalk.yellow('No'));
        console.log(chalk.cyan('Recommended:'), getRecommendedRuntime());

        console.log();
      } catch (error: any) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    });

  // cv config global-init
  cmd
    .command('global-init')
    .description('Initialize global CV-Git configuration interactively')
    .action(async () => {
      try {
        // Dynamic import inquirer
        const inquirerModule = await import('inquirer');
        const inquirer = inquirerModule.default;

        console.log(chalk.bold('\n🔧 CV-Git Global Configuration Setup\n'));
        console.log(chalk.gray('This wizard will help you configure CV-Git for your system.\n'));

        interface GlobalConfigAnswers {
          mode: 'auto' | 'user' | 'root';
          runtime: 'docker' | 'podman' | 'external';
          rootless?: boolean;
          credentials: 'keychain' | 'file' | 'env';
          warnOnRoot: boolean;
        }

        const answers: GlobalConfigAnswers = await inquirer.prompt([
          {
            type: 'list',
            name: 'mode',
            message: 'Privilege mode:',
            choices: [
              { name: 'Auto-detect (recommended)', value: 'auto' },
              { name: 'User mode (no root required)', value: 'user' },
              { name: 'Root/System mode', value: 'root' },
            ],
            default: 'auto',
          },
          {
            type: 'list',
            name: 'runtime',
            message: 'Container runtime:',
            choices: [
              { name: 'Docker', value: 'docker' },
              { name: 'Podman', value: 'podman' },
              { name: 'External (use existing databases)', value: 'external' },
            ],
            default: getRecommendedRuntime(),
          },
          {
            type: 'confirm',
            name: 'rootless',
            message: 'Use rootless containers?',
            default: true,
            when: (ans: GlobalConfigAnswers) => ans.runtime !== 'external',
          },
          {
            type: 'list',
            name: 'credentials',
            message: 'Credential storage:',
            choices: [
              { name: 'System keychain (secure, recommended)', value: 'keychain' },
              { name: 'Encrypted file', value: 'file' },
              { name: 'Environment variables only', value: 'env' },
            ],
            default: 'keychain',
          },
          {
            type: 'confirm',
            name: 'warnOnRoot',
            message: 'Warn when running as root?',
            default: true,
          },
        ]);

        const globalConfig = await loadCVGitConfig();
        globalConfig.privilege.mode = answers.mode;
        globalConfig.privilege.warnOnRoot = answers.warnOnRoot;
        globalConfig.containers.runtime = answers.runtime;
        globalConfig.containers.rootless = answers.rootless ?? true;
        globalConfig.credentials.storage = answers.credentials;

        await saveCVGitConfig(globalConfig);

        console.log(chalk.green('\n✓ Global configuration saved!'));
        console.log(chalk.gray('Run `cv config privilege` to view current settings.'));
        console.log(chalk.gray('Run `cv doctor` to verify your setup.\n'));
      } catch (error: any) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
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

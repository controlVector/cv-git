/**
 * cv deploy — Tagged deployment configurations
 *
 * Commands:
 *   cv deploy list                     List all deploy targets
 *   cv deploy push <target>            Deploy target
 *   cv deploy rollback <target>        Rollback target
 *   cv deploy status <target>          Health check target
 *   cv deploy diff <target>            Show what would change
 *   cv deploy init <target>            Create deploy config template
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { DeployOrchestrator } from '@cv-git/core';
import { findRepoRoot } from '@cv-git/shared';
import type { DeployProvider } from '@cv-git/shared';
import { addGlobalOptions, createOutput } from '../utils/output.js';

export function deployCommand(): Command {
  const cmd = new Command('deploy');
  cmd.description('Manage deployments via tagged YAML configurations');

  // ── cv deploy list ──

  const listCmd = new Command('list');
  listCmd.description('List all deploy targets from deploy/*.yaml');
  addGlobalOptions(listCmd);

  listCmd.action(async (options: any) => {
    const output = createOutput(options);

    try {
      const repoRoot = await findRepoRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      const orchestrator = new DeployOrchestrator();
      const configs = await orchestrator.list(repoRoot);

      if (configs.length === 0) {
        output.info('No deploy targets found. Create one with: cv deploy init <target> --provider <provider>');
        return;
      }

      if (options.json) {
        output.json(configs.map((c) => ({
          target: c.target,
          provider: c.provider,
          services: c.services.map((s) => s.name),
        })));
        return;
      }

      console.log(chalk.bold('\nDeploy Targets (from deploy/*.yaml)\n'));
      console.log(
        `  ${chalk.gray('Target'.padEnd(24))}${chalk.gray('Provider'.padEnd(18))}${chalk.gray('Services')}`,
      );
      console.log(chalk.gray('  ' + '─'.repeat(60)));

      for (const config of configs) {
        const services = config.services.map((s) => s.name).join(', ');
        console.log(
          `  ${chalk.cyan(config.target.padEnd(24))}${config.provider.padEnd(18)}${services}`,
        );
      }
      console.log();
    } catch (error: any) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

  cmd.addCommand(listCmd);

  // ── cv deploy push <target> ──

  const pushCmd = new Command('push');
  pushCmd
    .description('Deploy a target through the full lifecycle')
    .argument('<target>', 'Deploy target name')
    .option('--ref <ref>', 'Git ref to deploy (default: HEAD)')
    .option('--dry-run', 'Preview without executing', false)
    .option('--verbose', 'Extra logging');
  addGlobalOptions(pushCmd);

  pushCmd.action(async (target: string, options: any) => {
    const output = createOutput(options);

    try {
      const repoRoot = await findRepoRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      const orchestrator = new DeployOrchestrator();

      const onEvent = options.json
        ? undefined
        : (event: any) => {
            const icon =
              event.status === 'start'
                ? chalk.blue('→')
                : event.status === 'success'
                  ? chalk.green('✓')
                  : event.status === 'error'
                    ? chalk.red('✗')
                    : chalk.gray('·');
            const svc = event.service ? chalk.gray(` [${event.service}]`) : '';
            console.log(`  ${icon} ${event.message}${svc}`);
          };

      if (!options.json && options.dryRun) {
        console.log(chalk.yellow('\n  [DRY RUN] No changes will be made\n'));
      }

      const result = await orchestrator.push(target, repoRoot, {
        dryRun: options.dryRun,
        ref: options.ref,
        verbose: options.verbose,
        onEvent,
      });

      if (options.json) {
        output.json(result);
      } else {
        console.log();
        const allDeployed = result.services.every((s) => s.status === 'deployed');
        if (allDeployed) {
          console.log(
            chalk.green(`  ✓ Deployed ${target} (${result.version}) in ${(result.durationMs / 1000).toFixed(1)}s`),
          );
        } else {
          const failed = result.services.filter((s) => s.status === 'failed');
          console.log(
            chalk.red(`  ✗ Deploy partially failed: ${failed.map((f) => f.name).join(', ')}`),
          );
        }
        console.log();
      }
    } catch (error: any) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

  cmd.addCommand(pushCmd);

  // ── cv deploy rollback <target> ──

  const rollbackCmd = new Command('rollback');
  rollbackCmd
    .description('Rollback a target to a previous version')
    .argument('<target>', 'Deploy target name')
    .option('--to <version>', 'Specific version to rollback to', 'previous')
    .option('--dry-run', 'Preview without executing', false)
    .option('--verbose', 'Extra logging');
  addGlobalOptions(rollbackCmd);

  rollbackCmd.action(async (target: string, options: any) => {
    const output = createOutput(options);

    try {
      const repoRoot = await findRepoRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      const orchestrator = new DeployOrchestrator();

      const onEvent = options.json
        ? undefined
        : (event: any) => {
            const icon = event.status === 'success' ? chalk.green('✓') : event.status === 'error' ? chalk.red('✗') : chalk.blue('→');
            console.log(`  ${icon} ${event.message}`);
          };

      const result = await orchestrator.rollback(target, repoRoot, options.to, {
        dryRun: options.dryRun,
        verbose: options.verbose,
        onEvent,
      });

      if (options.json) {
        output.json(result);
      } else {
        const allRolledBack = result.services.every((s) => s.status === 'rolled_back');
        if (allRolledBack) {
          console.log(
            chalk.green(`  ✓ Rolled back ${target} from ${result.fromVersion} to ${result.toVersion}`),
          );
        } else {
          console.log(chalk.red(`  ✗ Rollback partially failed`));
        }
      }
    } catch (error: any) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

  cmd.addCommand(rollbackCmd);

  // ── cv deploy status <target> ──

  const statusCmd = new Command('status');
  statusCmd
    .description('Show health status of a deploy target')
    .argument('<target>', 'Deploy target name');
  addGlobalOptions(statusCmd);

  statusCmd.action(async (target: string, options: any) => {
    const output = createOutput(options);

    try {
      const repoRoot = await findRepoRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      const orchestrator = new DeployOrchestrator();
      const health = await orchestrator.status(target, repoRoot);

      if (options.json) {
        output.json(health);
        return;
      }

      console.log(chalk.bold(`\nTarget: ${target}`));
      console.log(
        `Health: ${health.healthy ? chalk.green('healthy') : chalk.red('unhealthy')}`,
      );
      console.log(`Checked: ${health.checkedAt}\n`);

      console.log(
        `  ${chalk.gray('Service'.padEnd(20))}${chalk.gray('Healthy'.padEnd(12))}${chalk.gray('Latency')}`,
      );
      console.log(chalk.gray('  ' + '─'.repeat(44)));

      for (const svc of health.services) {
        const healthIcon = svc.healthy ? chalk.green('✓') : chalk.red('✗');
        const latency = svc.latencyMs ? `${svc.latencyMs}ms` : '-';
        console.log(`  ${svc.name.padEnd(20)}${healthIcon.padEnd(12)}${latency}`);
      }
      console.log();
    } catch (error: any) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

  cmd.addCommand(statusCmd);

  // ── cv deploy diff <target> ──

  const diffCmd = new Command('diff');
  diffCmd
    .description('Show current state and what would change on deploy')
    .argument('<target>', 'Deploy target name');
  addGlobalOptions(diffCmd);

  diffCmd.action(async (target: string, options: any) => {
    const output = createOutput(options);

    try {
      const repoRoot = await findRepoRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      const orchestrator = new DeployOrchestrator();
      const { config, currentHealth } = await orchestrator.diff(target, repoRoot);

      if (options.json) {
        output.json({ config, currentHealth });
        return;
      }

      console.log(chalk.bold(`\nDeploy Diff: ${target}`));
      console.log(`Provider: ${config.provider}`);
      console.log(`Services: ${config.services.map((s) => s.name).join(', ')}`);
      console.log(
        `Current health: ${currentHealth.healthy ? chalk.green('healthy') : chalk.red('unhealthy')}`,
      );
      console.log();
    } catch (error: any) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

  cmd.addCommand(diffCmd);

  // ── cv deploy init <target> ──

  const initCmd = new Command('init');
  initCmd
    .description('Create a deploy config template')
    .argument('<target>', 'Deploy target name')
    .option('-p, --provider <provider>', 'Deploy provider', 'doks');
  addGlobalOptions(initCmd);

  initCmd.action(async (target: string, options: any) => {
    const output = createOutput(options);

    try {
      const repoRoot = await findRepoRoot();
      if (!repoRoot) {
        console.error(chalk.red('Not in a git repository'));
        process.exit(1);
      }

      const provider = options.provider as DeployProvider;
      const validProviders: DeployProvider[] = ['doks', 'ssh', 'fly', 'docker-compose', 'cloudflare'];
      if (!validProviders.includes(provider)) {
        console.error(chalk.red(`Invalid provider: ${provider}. Must be one of: ${validProviders.join(', ')}`));
        process.exit(1);
      }

      const orchestrator = new DeployOrchestrator();
      const filePath = await orchestrator.init(target, provider, repoRoot);

      if (options.json) {
        output.json({ target, provider, file: filePath });
      } else {
        output.success(`Created deploy config: ${filePath}`);
        console.log(chalk.gray(`  Edit the file to configure your ${provider} deployment`));
      }
    } catch (error: any) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

  cmd.addCommand(initCmd);

  return cmd;
}

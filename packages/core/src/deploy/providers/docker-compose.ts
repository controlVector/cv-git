/**
 * Docker Compose deploy provider for local/dev environments.
 *
 * Uses: docker compose (v2)
 *
 * Simplest provider — wraps docker compose commands.
 */

import type {
  DeployConfig,
  DeployProvider,
  PreflightResult,
  BuildResult,
  PushResult,
  DeployResult,
  HealthResult,
  RollbackResult,
  DeployHistory,
} from '@cv-git/shared';
import { BaseDeployProvider, type DeployOptions } from '../provider.js';

export class DockerComposeProvider extends BaseDeployProvider {
  name: DeployProvider = 'docker-compose';

  async preflight(config: DeployConfig, options: DeployOptions): Promise<PreflightResult> {
    const checks: PreflightResult['checks'] = [];

    try {
      await this.execCommand('docker compose version', options);
      checks.push({ name: 'docker compose', passed: true, message: 'Available' });
    } catch {
      checks.push({ name: 'docker compose', passed: false, message: 'docker compose not found' });
    }

    const composeFile = config.composeFile ?? 'docker-compose.yml';
    try {
      await this.execCommand(`test -f ${composeFile}`, options);
      checks.push({ name: 'compose file', passed: true, message: composeFile });
    } catch {
      checks.push({ name: 'compose file', passed: false, message: `${composeFile} not found` });
    }

    return { ready: checks.every((c) => c.passed), checks };
  }

  async build(config: DeployConfig, options: DeployOptions): Promise<BuildResult[]> {
    const composeFile = config.composeFile ?? 'docker-compose.yml';
    const start = Date.now();

    await this.execCommand(
      `docker compose -f ${composeFile} build`,
      options,
      'Building services',
    );

    return config.services.map((s) => ({
      service: s.name,
      image: s.image ?? s.name,
      tag: 'latest',
      durationMs: Date.now() - start,
    }));
  }

  async push(
    _config: DeployConfig,
    _builds: BuildResult[],
    _options: DeployOptions,
  ): Promise<PushResult[]> {
    return []; // Local, no push needed
  }

  async deploy(
    config: DeployConfig,
    _images: PushResult[],
    options: DeployOptions,
  ): Promise<DeployResult> {
    const composeFile = config.composeFile ?? 'docker-compose.yml';
    const start = Date.now();

    await this.runHook(config.hooks?.preDeploy, config, options);

    await this.execCommand(
      `docker compose -f ${composeFile} up -d --remove-orphans`,
      options,
      'Starting services',
    );

    await this.runHook(config.hooks?.postDeploy, config, options);

    const ref = await this.getGitRef(process.cwd());
    return {
      target: config.target,
      provider: 'docker-compose',
      services: config.services.map((s) => ({ name: s.name, status: 'deployed' as const })),
      version: ref.sha.slice(0, 7),
      durationMs: Date.now() - start,
      dryRun: options.dryRun,
    };
  }

  async healthCheck(config: DeployConfig): Promise<HealthResult> {
    const composeFile = config.composeFile ?? 'docker-compose.yml';
    const { stdout } = await this.execCommand(
      `docker compose -f ${composeFile} ps --format json`,
      { dryRun: false },
    );

    const services = config.services.map((s) => {
      const running = stdout.includes(s.name) && stdout.includes('running');
      return { name: s.name, healthy: running, message: running ? 'Running' : 'Not running' };
    });

    return {
      target: config.target,
      healthy: services.every((s) => s.healthy),
      services,
      checkedAt: new Date().toISOString(),
    };
  }

  async rollback(
    config: DeployConfig,
    toVersion: string,
    options: DeployOptions,
  ): Promise<RollbackResult> {
    const composeFile = config.composeFile ?? 'docker-compose.yml';
    const start = Date.now();

    await this.execCommand(`docker compose -f ${composeFile} down`, options);
    await this.execCommand(`docker compose -f ${composeFile} up -d`, options);

    return {
      target: config.target,
      fromVersion: 'current',
      toVersion,
      services: config.services.map((s) => ({ name: s.name, status: 'rolled_back' as const })),
      durationMs: Date.now() - start,
    };
  }

  async getDeployHistory(config: DeployConfig): Promise<DeployHistory> {
    return { target: config.target, deploys: [] };
  }
}

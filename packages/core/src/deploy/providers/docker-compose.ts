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

  /** Check docker compose availability and compose file existence. */
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

  /** Build all services via docker compose build. */
  async build(config: DeployConfig, options: DeployOptions): Promise<BuildResult[]> {
    const composeFile = config.composeFile ?? 'docker-compose.yml';
    const start = Date.now();

    try {
      await this.execCommand(
        `docker compose -f ${composeFile} build`,
        options,
        'Building services',
      );
    } catch (error: any) {
      throw new Error(`Docker Compose build failed: ${error.message}`);
    }

    return config.services.map((s) => ({
      service: s.name,
      image: s.image ?? s.name,
      tag: 'latest',
      durationMs: Date.now() - start,
    }));
  }

  /** Local provider — no push needed. */
  async push(
    _config: DeployConfig,
    _builds: BuildResult[],
    _options: DeployOptions,
  ): Promise<PushResult[]> {
    return [];
  }

  /** Start services via docker compose up. */
  async deploy(
    config: DeployConfig,
    _images: PushResult[],
    options: DeployOptions,
  ): Promise<DeployResult> {
    const composeFile = config.composeFile ?? 'docker-compose.yml';
    const start = Date.now();

    await this.runHook(config.hooks?.preDeploy, config, options);

    try {
      await this.execCommand(
        `docker compose -f ${composeFile} up -d --remove-orphans`,
        options,
        'Starting services',
      );
    } catch (error: any) {
      throw new Error(`Docker Compose deploy failed: ${error.message}`);
    }

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

  /** Check service status via docker compose ps. */
  async healthCheck(config: DeployConfig): Promise<HealthResult> {
    const composeFile = config.composeFile ?? 'docker-compose.yml';

    let stdout = '';
    try {
      const result = await this.execCommand(
        `docker compose -f ${composeFile} ps --format json`,
        { dryRun: false },
      );
      stdout = result.stdout;
    } catch {
      return {
        target: config.target,
        healthy: false,
        services: config.services.map((s) => ({ name: s.name, healthy: false, message: 'Failed to check' })),
        checkedAt: new Date().toISOString(),
      };
    }

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

  /** Rollback by restarting services (down + up). */
  async rollback(
    config: DeployConfig,
    toVersion: string,
    options: DeployOptions,
  ): Promise<RollbackResult> {
    const composeFile = config.composeFile ?? 'docker-compose.yml';
    const start = Date.now();

    try {
      await this.execCommand(`docker compose -f ${composeFile} down`, options, 'Stopping services');
      await this.execCommand(`docker compose -f ${composeFile} up -d`, options, 'Restarting services');
    } catch (error: any) {
      throw new Error(`Docker Compose rollback failed: ${error.message}`);
    }

    return {
      target: config.target,
      fromVersion: 'current',
      toVersion,
      services: config.services.map((s) => ({ name: s.name, status: 'rolled_back' as const })),
      durationMs: Date.now() - start,
    };
  }

  /** Deploy history not available for docker-compose. */
  async getDeployHistory(config: DeployConfig): Promise<DeployHistory> {
    return { target: config.target, deploys: [] };
  }
}

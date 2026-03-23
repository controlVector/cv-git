/**
 * Fly.io deploy provider.
 *
 * Used for: lightweight services (tastytrade-mcp, static sites)
 *
 * Uses: flyctl
 *
 * Lifecycle:
 *   preflight → check flyctl auth, app exists
 *   build     → fly deploy handles build internally
 *   push      → fly deploy handles push internally
 *   deploy    → flyctl deploy
 *   health    → flyctl status + HTTP check
 *   rollback  → flyctl releases rollback
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

export class FlyProvider extends BaseDeployProvider {
  name: DeployProvider = 'fly';

  async preflight(config: DeployConfig, options: DeployOptions): Promise<PreflightResult> {
    const checks: PreflightResult['checks'] = [];

    // Check flyctl
    try {
      await this.execCommand('flyctl auth whoami', options);
      checks.push({ name: 'flyctl auth', passed: true, message: 'Authenticated' });
    } catch {
      checks.push({
        name: 'flyctl auth',
        passed: false,
        message: 'flyctl not authenticated. Run: flyctl auth login',
      });
    }

    // Check app exists
    try {
      await this.execCommand(`flyctl apps list --json | grep '"${config.app}"'`, options);
      checks.push({ name: 'app', passed: true, message: `App ${config.app} exists` });
    } catch {
      checks.push({ name: 'app', passed: false, message: `App ${config.app} not found` });
    }

    return { ready: checks.every((c) => c.passed), checks };
  }

  async build(_config: DeployConfig, _options: DeployOptions): Promise<BuildResult[]> {
    // Fly handles builds internally
    return [];
  }

  async push(
    _config: DeployConfig,
    _builds: BuildResult[],
    _options: DeployOptions,
  ): Promise<PushResult[]> {
    // Fly handles push internally
    return [];
  }

  async deploy(
    config: DeployConfig,
    _images: PushResult[],
    options: DeployOptions,
  ): Promise<DeployResult> {
    const start = Date.now();
    const ref = await this.getGitRef(process.cwd());

    await this.runHook(config.hooks?.preDeploy, config, options);

    this.emit(
      { phase: 'deploy', message: `Deploying to Fly.io: ${config.app}`, status: 'start' },
      options,
    );

    try {
      const regionFlag = config.region ? `--region ${config.region}` : '';
      await this.execCommand(
        `flyctl deploy --app ${config.app} ${regionFlag} --strategy rolling`,
        { ...options, timeout: 600_000 }, // 10 min for fly deploy
        `Deploying ${config.app}`,
      );

      await this.runHook(config.hooks?.postDeploy, config, options);

      return {
        target: config.target,
        provider: 'fly',
        services: [{ name: config.app!, status: 'deployed' }],
        version: ref.sha.slice(0, 7),
        durationMs: Date.now() - start,
        dryRun: options.dryRun,
      };
    } catch (err: any) {
      return {
        target: config.target,
        provider: 'fly',
        services: [{ name: config.app!, status: 'failed', message: err.message }],
        version: ref.sha.slice(0, 7),
        durationMs: Date.now() - start,
        dryRun: options.dryRun,
      };
    }
  }

  async healthCheck(config: DeployConfig): Promise<HealthResult> {
    try {
      const { stdout } = await this.execCommand(
        `flyctl status --app ${config.app} --json`,
        { dryRun: false, timeout: 15_000 },
      );
      const status = JSON.parse(stdout);
      const deployed = status.Deployed || status.deployed;

      return {
        target: config.target,
        healthy: !!deployed,
        services: [
          { name: config.app!, healthy: !!deployed, message: stdout.slice(0, 200) },
        ],
        checkedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        target: config.target,
        healthy: false,
        services: [{ name: config.app!, healthy: false, message: err.message }],
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async rollback(
    config: DeployConfig,
    toVersion: string,
    options: DeployOptions,
  ): Promise<RollbackResult> {
    const start = Date.now();
    this.emit(
      { phase: 'rollback', message: `Rolling back ${config.app}`, status: 'start' },
      options,
    );

    try {
      if (toVersion === 'previous') {
        await this.execCommand(
          `flyctl releases rollback --app ${config.app}`,
          options,
          'Rolling back to previous release',
        );
      } else {
        await this.execCommand(
          `flyctl releases rollback ${toVersion} --app ${config.app}`,
          options,
          `Rolling back to release ${toVersion}`,
        );
      }

      return {
        target: config.target,
        fromVersion: 'current',
        toVersion,
        services: [{ name: config.app!, status: 'rolled_back' }],
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        target: config.target,
        fromVersion: 'current',
        toVersion,
        services: [{ name: config.app!, status: 'failed', message: err.message }],
        durationMs: Date.now() - start,
      };
    }
  }

  async getDeployHistory(config: DeployConfig, limit = 10): Promise<DeployHistory> {
    try {
      const { stdout } = await this.execCommand(
        `flyctl releases --app ${config.app} --json`,
        { dryRun: false },
      );
      const releases = JSON.parse(stdout).slice(0, limit);
      return {
        target: config.target,
        deploys: releases.map((r: any) => ({
          version: r.Version ?? r.version ?? 'unknown',
          commitSha: '',
          timestamp: r.CreatedAt ?? r.created_at ?? '',
          status: r.Status === 'complete' ? ('success' as const) : ('failed' as const),
          durationMs: 0,
        })),
      };
    } catch {
      return { target: config.target, deploys: [] };
    }
  }
}

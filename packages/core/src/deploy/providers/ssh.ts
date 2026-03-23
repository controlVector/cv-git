/**
 * SSH deploy provider for direct server deployment.
 *
 * Used for: KV260 drones, dev machines, any host accessible via SSH/Tailscale
 *
 * Uses: ssh, rsync
 *
 * Lifecycle:
 *   preflight → check SSH connectivity, disk space
 *   build     → (optional) local build step
 *   push      → rsync files to target
 *   deploy    → run install/start scripts via SSH
 *   health    → run health command via SSH
 *   rollback  → stop service, restore previous version, restart
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

export class SSHProvider extends BaseDeployProvider {
  name: DeployProvider = 'ssh';

  private sshCmd(config: DeployConfig, command: string): string {
    const user = config.user ?? 'root';
    return `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${user}@${config.host} "${command.replace(/"/g, '\\"')}"`;
  }

  async preflight(config: DeployConfig, options: DeployOptions): Promise<PreflightResult> {
    const checks: PreflightResult['checks'] = [];

    // Check SSH connectivity
    try {
      await this.execCommand(this.sshCmd(config, 'echo ok'), options, 'Testing SSH connection');
      checks.push({ name: 'ssh', passed: true, message: `Connected to ${config.host}` });
    } catch {
      checks.push({ name: 'ssh', passed: false, message: `Cannot SSH to ${config.host}` });
    }

    // Check disk space
    try {
      const { stdout } = await this.execCommand(
        this.sshCmd(config, "df -h / | tail -1 | awk '{print $5}'"),
        options,
      );
      const usage = parseInt(stdout);
      checks.push({
        name: 'disk',
        passed: usage < 90,
        message: `Disk usage: ${stdout}`,
      });
    } catch {
      checks.push({ name: 'disk', passed: false, message: 'Cannot check disk space' });
    }

    return { ready: checks.every((c) => c.passed), checks };
  }

  async build(_config: DeployConfig, _options: DeployOptions): Promise<BuildResult[]> {
    // SSH provider typically doesn't build locally
    return [];
  }

  async push(
    config: DeployConfig,
    _builds: BuildResult[],
    options: DeployOptions,
  ): Promise<PushResult[]> {
    const results: PushResult[] = [];
    const user = config.user ?? 'root';

    this.emit(
      { phase: 'push', message: `Syncing files to ${config.host}`, status: 'start' },
      options,
    );
    const start = Date.now();

    await this.execCommand(
      `rsync -avz --delete --exclude node_modules --exclude .git --exclude dist ./ ${user}@${config.host}:~/deploy/${config.target}/`,
      options,
      `Syncing to ${config.host}`,
    );

    results.push({
      service: 'all',
      image: 'rsync',
      registry: config.host!,
      durationMs: Date.now() - start,
    });

    return results;
  }

  async deploy(
    config: DeployConfig,
    _images: PushResult[],
    options: DeployOptions,
  ): Promise<DeployResult> {
    const start = Date.now();
    const serviceResults: DeployResult['services'] = [];

    await this.runHook(config.hooks?.preDeploy, config, options);

    for (const service of config.services) {
      this.emit(
        { phase: 'deploy', message: `Deploying ${service.name}`, status: 'start', service: service.name },
        options,
      );

      try {
        // Run install script if provided
        if (service.install) {
          await this.execCommand(
            this.sshCmd(config, `cd ~/deploy/${config.target} && bash ${service.install}`),
            options,
            `Installing ${service.name}`,
          );
        }

        // Stop existing service
        if (service.stop) {
          await this.execCommand(this.sshCmd(config, service.stop), { ...options, timeout: 30_000 }, `Stopping ${service.name}`).catch(
            () => {},
          ); // Ignore if not running
        }

        // Start service
        if (service.start) {
          await this.execCommand(
            this.sshCmd(config, service.start),
            options,
            `Starting ${service.name}`,
          );
        }

        serviceResults.push({ name: service.name, status: 'deployed' });
        this.emit(
          { phase: 'deploy', message: `Deployed ${service.name}`, status: 'success', service: service.name },
          options,
        );
      } catch (err: any) {
        serviceResults.push({ name: service.name, status: 'failed', message: err.message });
        this.emit(
          { phase: 'deploy', message: `Failed ${service.name}: ${err.message}`, status: 'error', service: service.name },
          options,
        );
      }
    }

    await this.runHook(config.hooks?.postDeploy, config, options);

    const ref = await this.getGitRef(process.cwd());
    return {
      target: config.target,
      provider: 'ssh',
      services: serviceResults,
      version: ref.sha.slice(0, 7),
      durationMs: Date.now() - start,
      dryRun: options.dryRun,
    };
  }

  async healthCheck(config: DeployConfig): Promise<HealthResult> {
    const services: HealthResult['services'] = [];

    for (const service of config.services) {
      if (!service.health) {
        services.push({ name: service.name, healthy: true, message: 'No health check configured' });
        continue;
      }

      try {
        const start = Date.now();
        await this.execCommand(this.sshCmd(config, service.health), {
          dryRun: false,
          timeout: 15_000,
        });
        services.push({ name: service.name, healthy: true, latencyMs: Date.now() - start });
      } catch (err: any) {
        services.push({ name: service.name, healthy: false, message: err.message });
      }
    }

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
    this.emit(
      { phase: 'rollback', message: 'SSH rollback: redeploying previous version', status: 'start' },
      options,
    );

    const start = Date.now();
    await this.execCommand(
      this.sshCmd(config, `cd ~/deploy/${config.target} && git checkout ${toVersion}`),
      options,
      `Checking out ${toVersion}`,
    );

    const deployResult = await this.deploy(config, [], options);

    return {
      target: config.target,
      fromVersion: 'current',
      toVersion,
      services: deployResult.services.map((s) => ({
        name: s.name,
        status: s.status === 'deployed' ? ('rolled_back' as const) : ('failed' as const),
        message: s.message,
      })),
      durationMs: Date.now() - start,
    };
  }

  async getDeployHistory(config: DeployConfig, _limit?: number): Promise<DeployHistory> {
    return { target: config.target, deploys: [] };
  }
}

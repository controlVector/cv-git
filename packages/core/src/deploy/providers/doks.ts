/**
 * DigitalOcean Kubernetes (DOKS) deploy provider.
 *
 * Uses: doctl, docker, kubectl
 *
 * Lifecycle:
 *   preflight → check doctl auth, kubectl context, registry access
 *   build     → docker build for each service
 *   push      → docker push to DigitalOcean Container Registry (DOCR)
 *   deploy    → kubectl set image + rollout status
 *   health    → kubectl pod status + HTTP health check
 *   rollback  → kubectl rollout undo
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

export class DOKSProvider extends BaseDeployProvider {
  name: DeployProvider = 'doks';

  async preflight(config: DeployConfig, options: DeployOptions): Promise<PreflightResult> {
    const checks: PreflightResult['checks'] = [];

    // Check doctl is installed and authenticated
    try {
      await this.execCommand('doctl account get -o json', options, 'Checking doctl auth');
      checks.push({ name: 'doctl auth', passed: true, message: 'Authenticated' });
    } catch {
      checks.push({
        name: 'doctl auth',
        passed: false,
        message: 'doctl not authenticated. Run: doctl auth init',
      });
    }

    // Check kubectl context matches target cluster
    try {
      const { stdout } = await this.execCommand('kubectl config current-context', options);
      const matches = stdout.includes(config.cluster!);
      checks.push({
        name: 'kubectl context',
        passed: matches,
        message: matches
          ? `Context: ${stdout}`
          : `Current context ${stdout} doesn't match ${config.cluster}`,
      });
    } catch {
      checks.push({ name: 'kubectl context', passed: false, message: 'kubectl not configured' });
    }

    // Check namespace exists
    try {
      await this.execCommand(`kubectl get namespace ${config.namespace}`, options);
      checks.push({ name: 'namespace', passed: true, message: `${config.namespace} exists` });
    } catch {
      checks.push({
        name: 'namespace',
        passed: false,
        message: `Namespace ${config.namespace} not found`,
      });
    }

    // Check registry access
    if (config.registry) {
      try {
        await this.execCommand('doctl registry login', options, 'Checking registry access');
        checks.push({ name: 'registry', passed: true, message: config.registry });
      } catch {
        checks.push({ name: 'registry', passed: false, message: 'Cannot access registry' });
      }
    }

    // Check Docker is running
    try {
      await this.execCommand('docker info --format "{{.ServerVersion}}"', options);
      checks.push({ name: 'docker', passed: true, message: 'Docker running' });
    } catch {
      checks.push({ name: 'docker', passed: false, message: 'Docker not running' });
    }

    return { ready: checks.every((c) => c.passed), checks };
  }

  async build(config: DeployConfig, options: DeployOptions): Promise<BuildResult[]> {
    const ref = await this.getGitRef(process.cwd());
    const tag = ref.sha.slice(0, 7);
    const results: BuildResult[] = [];

    for (const service of config.services) {
      if (!service.dockerfile) continue;

      const image = `${config.registry}/${service.image ?? service.name}`;
      const fullTag = `${image}:${tag}`;

      this.emit(
        { phase: 'build', message: `Building ${service.name}`, status: 'start', service: service.name },
        options,
      );
      const start = Date.now();

      await this.execCommand(
        `docker build -t ${fullTag} -t ${image}:latest -f ${service.dockerfile} .`,
        options,
        `Building ${service.name} from ${service.dockerfile}`,
      );

      results.push({
        service: service.name,
        image: fullTag,
        tag,
        durationMs: Date.now() - start,
      });

      this.emit(
        { phase: 'build', message: `Built ${service.name} (${tag})`, status: 'success', service: service.name },
        options,
      );
    }

    return results;
  }

  async push(
    config: DeployConfig,
    builds: BuildResult[],
    options: DeployOptions,
  ): Promise<PushResult[]> {
    const results: PushResult[] = [];

    for (const build of builds) {
      this.emit(
        { phase: 'push', message: `Pushing ${build.service}`, status: 'start', service: build.service },
        options,
      );
      const start = Date.now();

      await this.execCommand(`docker push ${build.image}`, options, `Pushing ${build.image}`);
      // Also push :latest tag
      const latestTag = build.image.replace(`:${build.tag}`, ':latest');
      await this.execCommand(`docker push ${latestTag}`, options);

      results.push({
        service: build.service,
        image: build.image,
        registry: config.registry!,
        durationMs: Date.now() - start,
      });

      this.emit(
        { phase: 'push', message: `Pushed ${build.service}`, status: 'success', service: build.service },
        options,
      );
    }

    return results;
  }

  async deploy(
    config: DeployConfig,
    images: PushResult[],
    options: DeployOptions,
  ): Promise<DeployResult> {
    const ref = await this.getGitRef(process.cwd());
    const tag = ref.sha.slice(0, 7);
    const ns = config.namespace!;
    const start = Date.now();
    const serviceResults: DeployResult['services'] = [];

    // Run pre-deploy hook
    await this.runHook(config.hooks?.preDeploy, config, options);

    for (const service of config.services) {
      const image = images.find((i) => i.service === service.name);
      if (!image) {
        serviceResults.push({ name: service.name, status: 'skipped', message: 'No image built' });
        continue;
      }

      this.emit(
        { phase: 'deploy', message: `Deploying ${service.name}`, status: 'start', service: service.name },
        options,
      );

      try {
        // Update image on existing deployment
        await this.execCommand(
          `kubectl -n ${ns} set image deployment/${service.name} ${service.name}=${image.image}`,
          options,
          `Setting image for ${service.name}`,
        );

        // Wait for rollout
        await this.execCommand(
          `kubectl -n ${ns} rollout status deployment/${service.name} --timeout=300s`,
          { ...options, timeout: 310_000 },
          `Waiting for ${service.name} rollout`,
        );

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

    // Run post-deploy hook
    await this.runHook(config.hooks?.postDeploy, config, options);

    return {
      target: config.target,
      provider: 'doks',
      services: serviceResults,
      version: tag,
      durationMs: Date.now() - start,
      dryRun: options.dryRun,
    };
  }

  async healthCheck(config: DeployConfig): Promise<HealthResult> {
    const ns = config.namespace!;
    const services: HealthResult['services'] = [];

    for (const service of config.services) {
      try {
        // Check pod status
        const { stdout } = await this.execCommand(
          `kubectl -n ${ns} get pods -l app=${service.name} -o jsonpath='{.items[0].status.phase}'`,
          { dryRun: false },
        );

        let healthy = stdout.includes('Running');
        let latencyMs: number | undefined;

        // HTTP health check if endpoint configured
        if (service.health && healthy) {
          const healthStart = Date.now();
          try {
            await this.execCommand(
              `kubectl -n ${ns} exec deployment/${service.name} -- curl -sf http://localhost:${service.port ?? 3000}${service.health}`,
              { dryRun: false, timeout: 10_000 },
            );
            latencyMs = Date.now() - healthStart;
          } catch {
            healthy = false;
          }
        }

        services.push({ name: service.name, healthy, latencyMs, message: stdout });
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
    const ns = config.namespace!;
    const start = Date.now();
    const services: RollbackResult['services'] = [];
    const currentVersion = (await this.getGitRef(process.cwd())).sha.slice(0, 7);

    // Run rollback hook
    await this.runHook(config.hooks?.rollback, config, options);

    for (const service of config.services) {
      this.emit(
        { phase: 'rollback', message: `Rolling back ${service.name}`, status: 'start', service: service.name },
        options,
      );

      try {
        if (toVersion === 'previous') {
          await this.execCommand(
            `kubectl -n ${ns} rollout undo deployment/${service.name}`,
            options,
            `Rolling back ${service.name} to previous`,
          );
        } else {
          const image = `${config.registry}/${service.image ?? service.name}:${toVersion}`;
          await this.execCommand(
            `kubectl -n ${ns} set image deployment/${service.name} ${service.name}=${image}`,
            options,
            `Rolling back ${service.name} to ${toVersion}`,
          );
        }

        await this.execCommand(
          `kubectl -n ${ns} rollout status deployment/${service.name} --timeout=120s`,
          { ...options, timeout: 130_000 },
        );

        services.push({ name: service.name, status: 'rolled_back' });
        this.emit(
          { phase: 'rollback', message: `Rolled back ${service.name}`, status: 'success', service: service.name },
          options,
        );
      } catch (err: any) {
        services.push({ name: service.name, status: 'failed', message: err.message });
        this.emit(
          { phase: 'rollback', message: `Rollback failed for ${service.name}`, status: 'error', service: service.name },
          options,
        );
      }
    }

    return {
      target: config.target,
      fromVersion: currentVersion,
      toVersion,
      services,
      durationMs: Date.now() - start,
    };
  }

  async getDeployHistory(config: DeployConfig, _limit = 10): Promise<DeployHistory> {
    // Best-effort from kubectl rollout history
    try {
      await this.execCommand(
        `kubectl -n ${config.namespace} rollout history deployment/${config.services[0]?.name} --output=json`,
        { dryRun: false },
      );
    } catch {
      // Ignore parse errors
    }

    return { target: config.target, deploys: [] };
  }
}

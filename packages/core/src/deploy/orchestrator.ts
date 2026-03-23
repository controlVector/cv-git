/**
 * Deploy Orchestrator
 *
 * Selects the right provider, runs the full lifecycle,
 * records outcomes in the context manifold, and emits events.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  DeployConfig,
  DeployProvider,
  DeployResult,
  HealthResult,
  RollbackResult,
} from '@cv-git/shared';
import { DeployConfigLoader } from './config-loader.js';
import { BaseDeployProvider, type DeployOptions, type DeployEvent } from './provider.js';
import { DOKSProvider } from './providers/doks.js';
import { SSHProvider } from './providers/ssh.js';
import { FlyProvider } from './providers/fly.js';
import { DockerComposeProvider } from './providers/docker-compose.js';
import type { GraphManager } from '../graph/index.js';

export class DeployOrchestrator {
  private configLoader: DeployConfigLoader;
  private providers: Map<DeployProvider, BaseDeployProvider>;
  private graph?: GraphManager;

  constructor(graph?: GraphManager) {
    this.configLoader = new DeployConfigLoader();
    this.providers = new Map();
    this.providers.set('doks', new DOKSProvider());
    this.providers.set('ssh', new SSHProvider());
    this.providers.set('fly', new FlyProvider());
    this.providers.set('docker-compose', new DockerComposeProvider());
    this.graph = graph;
  }

  /**
   * Full deploy lifecycle: preflight → build → push → deploy → health check.
   */
  async push(target: string, repoRoot: string, options: DeployOptions): Promise<DeployResult> {
    // 1. Load config
    const config = await this.configLoader.load(repoRoot, target);
    const errors = this.configLoader.validate(config);
    if (errors.length) throw new Error(`Config validation failed:\n${errors.join('\n')}`);

    // 2. Get provider
    const provider = this.providers.get(config.provider);
    if (!provider) throw new Error(`Unknown provider: ${config.provider}`);

    // 3. Preflight
    this.emitEvent(
      { phase: 'preflight', message: `Running preflight for ${target}`, status: 'start' },
      options,
    );
    const preflight = await provider.preflight(config, options);
    if (!preflight.ready) {
      const failures = preflight.checks
        .filter((c) => !c.passed)
        .map((c) => `  - ${c.name}: ${c.message}`);
      throw new Error(`Preflight failed:\n${failures.join('\n')}`);
    }

    // 4. Build
    const builds = await provider.build(config, options);

    // 5. Push
    const images = await provider.push(config, builds, options);

    // 6. Deploy
    const result = await provider.deploy(config, images, options);

    // 7. Health check (unless dry run)
    if (!options.dryRun) {
      const health = await provider.healthCheck(config);
      if (!health.healthy) {
        this.emitEvent(
          { phase: 'healthcheck', message: 'Health check failed — consider rollback', status: 'error' },
          options,
        );
      }
    }

    // 8. Record in manifold
    if (this.graph) {
      await this.recordDeployDecision(result, config).catch(() => {});
    }

    return result;
  }

  /**
   * Rollback a target to a previous version.
   */
  async rollback(
    target: string,
    repoRoot: string,
    toVersion: string,
    options: DeployOptions,
  ): Promise<RollbackResult> {
    const config = await this.configLoader.load(repoRoot, target);
    const provider = this.providers.get(config.provider);
    if (!provider) throw new Error(`Unknown provider: ${config.provider}`);

    const result = await provider.rollback(config, toVersion, options);

    if (this.graph) {
      await this.recordDeployDecision(result, config).catch(() => {});
    }

    return result;
  }

  /**
   * Health check a target.
   */
  async status(target: string, repoRoot: string): Promise<HealthResult> {
    const config = await this.configLoader.load(repoRoot, target);
    const provider = this.providers.get(config.provider);
    if (!provider) throw new Error(`Unknown provider: ${config.provider}`);

    return provider.healthCheck(config);
  }

  /**
   * List all deploy targets from config files.
   */
  async list(repoRoot: string): Promise<DeployConfig[]> {
    return this.configLoader.loadAll(repoRoot);
  }

  /**
   * Show what would change without deploying.
   */
  async diff(
    target: string,
    repoRoot: string,
  ): Promise<{ config: DeployConfig; currentHealth: HealthResult }> {
    const config = await this.configLoader.load(repoRoot, target);
    const provider = this.providers.get(config.provider);
    if (!provider) throw new Error(`Unknown provider: ${config.provider}`);

    let currentHealth: HealthResult;
    try {
      currentHealth = await provider.healthCheck(config);
    } catch {
      currentHealth = {
        target,
        healthy: false,
        services: [],
        checkedAt: new Date().toISOString(),
      };
    }

    return { config, currentHealth };
  }

  /**
   * Initialize a deploy config template.
   */
  async init(target: string, provider: DeployProvider, repoRoot: string): Promise<string> {
    const deployDir = path.join(repoRoot, 'deploy');
    await fs.mkdir(deployDir, { recursive: true });

    const template = this.configLoader.generateTemplate(provider, target);
    const filePath = path.join(deployDir, `${target}.yaml`);
    await fs.writeFile(filePath, template, 'utf-8');

    return filePath;
  }

  /**
   * Record a deploy outcome as a :DevOps node in the context manifold.
   */
  private async recordDeployDecision(
    result: DeployResult | RollbackResult,
    config: DeployConfig,
  ): Promise<void> {
    if (!this.graph) return;

    const isRollback = 'fromVersion' in result;
    const status = isRollback
      ? (result as RollbackResult).services.every((s) => s.status === 'rolled_back')
        ? 'active'
        : 'failed'
      : (result as DeployResult).services.every((s) => s.status === 'deployed')
        ? 'active'
        : 'failed';

    const cypher = `
      MERGE (d:DevOps {name: $name})
      SET d.type = 'devops',
          d.kind = 'deployment',
          d.status = $status,
          d.lastRun = $timestamp,
          d.config = $config
    `;

    await this.graph.query(cypher, {
      name: config.target,
      status,
      timestamp: new Date().toISOString(),
      config: JSON.stringify({
        provider: config.provider,
        version: 'version' in result ? result.version : (result as RollbackResult).toVersion,
        durationMs: result.durationMs,
        isRollback,
      }),
    });
  }

  private emitEvent(event: Omit<DeployEvent, 'timestamp'>, options: DeployOptions): void {
    options.onEvent?.({
      ...event,
      timestamp: new Date().toISOString(),
    });
  }
}

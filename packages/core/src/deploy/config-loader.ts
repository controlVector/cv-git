/**
 * Deploy Config Loader
 *
 * Loads and validates deploy configuration from YAML files.
 * Deploy configs live in deploy/*.yaml in the repo root.
 * Each file defines one deploy target.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { parse, stringify } from 'yaml';
import type { DeployConfig, DeployProvider } from '@cv-git/shared';

const VALID_PROVIDERS: DeployProvider[] = ['doks', 'ssh', 'fly', 'docker-compose', 'cloudflare'];
const TARGET_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export class DeployConfigLoader {
  /**
   * Load a specific deploy config by target name.
   * Looks for deploy/{target}.yaml in the repo root.
   */
  async load(repoRoot: string, target: string): Promise<DeployConfig> {
    const filePath = path.join(repoRoot, 'deploy', `${target}.yaml`);
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      throw new Error(`Deploy config not found: ${filePath}`);
    }

    let config: DeployConfig;
    try {
      config = parse(content) as DeployConfig;
    } catch (parseError: any) {
      throw new Error(`Invalid YAML in ${filePath}: ${parseError.message}`);
    }
    if (!config || typeof config !== 'object') {
      throw new Error(`Empty or invalid config in ${filePath}`);
    }

    return config;
  }

  /**
   * Load all deploy configs from the deploy/ directory.
   */
  async loadAll(repoRoot: string): Promise<DeployConfig[]> {
    const deployDir = path.join(repoRoot, 'deploy');
    let entries: string[];
    try {
      entries = await fs.readdir(deployDir);
    } catch {
      return [];
    }

    const configs: DeployConfig[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;
      const target = entry.replace(/\.ya?ml$/, '');
      try {
        const config = await this.load(repoRoot, target);
        configs.push(config);
      } catch {
        // Skip invalid configs
      }
    }
    return configs;
  }

  /**
   * Validate a deploy config. Returns errors if invalid.
   */
  validate(config: DeployConfig): string[] {
    const errors: string[] = [];

    // target
    if (!config.target) {
      errors.push('target is required');
    } else if (!TARGET_PATTERN.test(config.target) && config.target.length > 1) {
      // Allow single-char targets but check pattern for multi-char
      if (!/^[a-z0-9-]+$/.test(config.target)) {
        errors.push('target must be alphanumeric with hyphens');
      }
    }

    // provider
    if (!config.provider) {
      errors.push('provider is required');
    } else if (!VALID_PROVIDERS.includes(config.provider)) {
      errors.push(`provider must be one of: ${VALID_PROVIDERS.join(', ')}`);
    }

    // services
    if (!config.services || !Array.isArray(config.services) || config.services.length === 0) {
      errors.push('services is required and must have at least one entry');
    } else {
      for (const svc of config.services) {
        if (!svc.name) errors.push('each service must have a name');
      }
    }

    // Provider-specific validation
    if (config.provider === 'doks') {
      if (!config.cluster) errors.push('doks provider requires cluster');
      if (!config.namespace) errors.push('doks provider requires namespace');
    }

    if (config.provider === 'ssh') {
      if (!config.host) errors.push('ssh provider requires host');
    }

    if (config.provider === 'fly') {
      if (!config.app) errors.push('fly provider requires app');
    }

    // Token validation
    if (config.tokens) {
      for (const [key, ref] of Object.entries(config.tokens)) {
        const source = typeof ref === 'string' ? ref : ref.source;
        if (!source.startsWith('vault://') && !source.startsWith('env://')) {
          errors.push(`token "${key}" source must start with vault:// or env://`);
        }
      }
    }

    // Hook validation
    if (config.hooks) {
      const hookKeys = ['preDeploy', 'postDeploy', 'rollback', 'healthCheck'] as const;
      for (const key of hookKeys) {
        const hookPath = config.hooks[key];
        if (hookPath && (path.isAbsolute(hookPath) || hookPath.includes('..'))) {
          errors.push(`hook "${key}" must be a relative path without "..""`);
        }
      }
    }

    return errors;
  }

  /**
   * Create a deploy config template for a given provider.
   */
  generateTemplate(provider: DeployProvider, target: string): string {
    const templates: Record<DeployProvider, DeployConfig> = {
      'doks': {
        target,
        provider: 'doks',
        cluster: 'my-cluster',
        namespace: 'my-namespace',
        registry: 'registry.digitalocean.com/my-registry',
        services: [
          {
            name: 'api',
            image: 'my-api',
            dockerfile: 'Dockerfile',
            replicas: 2,
            health: '/health',
            port: 3000,
          },
        ],
        tokens: {
          DIGITALOCEAN_TOKEN: 'env://DIGITALOCEAN_TOKEN',
        },
      },
      'ssh': {
        target,
        provider: 'ssh',
        host: 'my-server',
        user: 'ubuntu',
        services: [
          {
            name: 'app',
            install: 'scripts/install.sh',
            start: 'systemctl start app',
            stop: 'systemctl stop app',
            health: 'curl -sf http://localhost:3000/health',
          },
        ],
      },
      'fly': {
        target,
        provider: 'fly',
        app: target,
        region: 'iad',
        services: [
          {
            name: target,
            health: '/health',
            port: 3000,
          },
        ],
      },
      'docker-compose': {
        target,
        provider: 'docker-compose',
        composeFile: 'docker-compose.yml',
        services: [
          { name: 'api' },
          { name: 'web' },
        ],
      },
      'cloudflare': {
        target,
        provider: 'cloudflare',
        services: [
          {
            name: 'worker',
            health: '/health',
          },
        ],
      },
    };

    return stringify(templates[provider], { lineWidth: 120 });
  }
}

/**
 * Configuration Management
 *
 * Manages CV-Git configuration including platform settings, credentials, and features.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GitPlatform } from '@cv-git/credentials';

export interface CVGitConfig {
  version: string;
  platform: PlatformConfig;
  credentials: CredentialsConfig;
  ai: AIConfig;
  graph: GraphConfig;
  vector: VectorConfig;
  features: FeaturesConfig;
}

export interface PlatformConfig {
  type: GitPlatform;
  url?: string;
  api?: string;
}

export interface CredentialsConfig {
  storage: 'keychain' | 'encrypted-file';
  masterPasswordRequired: boolean;
}

export interface AIConfig {
  provider: 'anthropic' | 'openai';
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface GraphConfig {
  url: string;
  database: string;
}

export interface VectorConfig {
  url: string;
  collection: string;
}

export interface FeaturesConfig {
  aiCommitMessages: boolean;
  aiPRDescriptions: boolean;
  aiCodeReview: boolean;
  autoMerge: boolean;
}

const DEFAULT_CONFIG: CVGitConfig = {
  version: '0.2.0',
  platform: {
    type: GitPlatform.GITHUB,
    url: 'https://github.com',
    api: 'https://api.github.com',
  },
  credentials: {
    storage: 'keychain',
    masterPasswordRequired: false,
  },
  ai: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 4096,
    temperature: 0.7,
  },
  graph: {
    url: 'redis://localhost:6379',
    database: 'cv-graph',
  },
  vector: {
    url: 'http://localhost:6333',
    collection: 'cv-vectors',
  },
  features: {
    aiCommitMessages: true,
    aiPRDescriptions: true,
    aiCodeReview: true,
    autoMerge: false,
  },
};

export class ConfigManager {
  private configPath: string;
  private config: CVGitConfig | null = null;

  constructor(configPath?: string) {
    this.configPath =
      configPath || path.join(os.homedir(), '.cv', 'config.json');
  }

  /**
   * Load configuration from file
   */
  async load(): Promise<CVGitConfig> {
    if (this.config) return this.config;

    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(data);
      return this.config!;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Config doesn't exist, return default
        this.config = { ...DEFAULT_CONFIG };
        return this.config;
      }
      throw error;
    }
  }

  /**
   * Save configuration to file
   */
  async save(config: CVGitConfig): Promise<void> {
    this.config = config;

    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
  }

  /**
   * Update configuration
   */
  async update(updates: Partial<CVGitConfig>): Promise<CVGitConfig> {
    const current = await this.load();
    const updated = { ...current, ...updates };
    await this.save(updated);
    return updated;
  }

  /**
   * Get a configuration value
   */
  async get<K extends keyof CVGitConfig>(key: K): Promise<CVGitConfig[K]> {
    const config = await this.load();
    return config[key];
  }

  /**
   * Set a configuration value
   */
  async set<K extends keyof CVGitConfig>(
    key: K,
    value: CVGitConfig[K]
  ): Promise<void> {
    const config = await this.load();
    config[key] = value;
    await this.save(config);
  }

  /**
   * Get nested configuration value
   */
  async getNested(path: string): Promise<any> {
    const config = await this.load();
    const parts = path.split('.');
    let value: any = config;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Set nested configuration value
   */
  async setNested(path: string, value: any): Promise<void> {
    const config = await this.load();
    const parts = path.split('.');
    const lastPart = parts.pop()!;
    let current: any = config;

    for (const part of parts) {
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    }

    current[lastPart] = value;
    await this.save(config);
  }

  /**
   * Reset to default configuration
   */
  async reset(): Promise<CVGitConfig> {
    this.config = { ...DEFAULT_CONFIG };
    await this.save(this.config);
    return this.config;
  }

  /**
   * Check if config exists
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize configuration (create with defaults)
   */
  async init(): Promise<CVGitConfig> {
    const config = { ...DEFAULT_CONFIG };
    await this.save(config);
    return config;
  }
}

/**
 * Get global config instance
 */
let globalConfig: ConfigManager | null = null;

export function getConfig(): ConfigManager {
  if (!globalConfig) {
    globalConfig = new ConfigManager();
  }
  return globalConfig;
}

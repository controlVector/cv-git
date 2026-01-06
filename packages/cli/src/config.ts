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
  hub?: HubConfig;
}

export interface HubConfig {
  url: string;
  token?: string;
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

/**
 * User Preferences - stored separately from config
 * These are the user's preferred choices for interfaces/providers
 */
export type AIProvider = 'anthropic' | 'openai' | 'openrouter';
export type EmbeddingProvider = 'openai' | 'openrouter';
export type GitPlatformType = 'github' | 'gitlab' | 'bitbucket';

export interface UserPreferences {
  version: string;
  gitPlatform: GitPlatformType;
  aiProvider: AIProvider;
  embeddingProvider: EmbeddingProvider;
  setupComplete: boolean;
  createdAt: string;
  updatedAt: string;
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
    model: 'claude-sonnet-4-5-20250514',
    maxTokens: 128000,
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
  hub: {
    url: 'https://api.hub.controlvector.io/api',
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

// ============================================================================
// Preferences Manager
// ============================================================================

const DEFAULT_PREFERENCES: UserPreferences = {
  version: '1.0.0',
  gitPlatform: 'github',
  aiProvider: 'anthropic',
  embeddingProvider: 'openrouter',
  setupComplete: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export class PreferencesManager {
  private prefsPath: string;
  private preferences: UserPreferences | null = null;

  constructor(prefsPath?: string) {
    this.prefsPath =
      prefsPath || path.join(os.homedir(), '.cv', 'preferences.json');
  }

  /**
   * Load preferences from file
   */
  async load(): Promise<UserPreferences> {
    if (this.preferences) return this.preferences;

    try {
      const data = await fs.readFile(this.prefsPath, 'utf8');
      this.preferences = JSON.parse(data);
      return this.preferences!;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Prefs don't exist yet
        return { ...DEFAULT_PREFERENCES };
      }
      throw error;
    }
  }

  /**
   * Save preferences to file
   */
  async save(prefs: UserPreferences): Promise<void> {
    this.preferences = {
      ...prefs,
      updatedAt: new Date().toISOString(),
    };

    const dir = path.dirname(this.prefsPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.prefsPath, JSON.stringify(this.preferences, null, 2), {
      mode: 0o600,
    });
  }

  /**
   * Check if preferences exist
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.prefsPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize preferences with user choices
   */
  async init(choices: {
    gitPlatform: GitPlatformType;
    aiProvider: AIProvider;
    embeddingProvider: EmbeddingProvider;
  }): Promise<UserPreferences> {
    const prefs: UserPreferences = {
      ...DEFAULT_PREFERENCES,
      ...choices,
      setupComplete: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.save(prefs);
    return prefs;
  }

  /**
   * Update a single preference
   */
  async set<K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ): Promise<void> {
    const prefs = await this.load();
    prefs[key] = value;
    await this.save(prefs);
  }

  /**
   * Get a single preference
   */
  async get<K extends keyof UserPreferences>(key: K): Promise<UserPreferences[K]> {
    const prefs = await this.load();
    return prefs[key];
  }

  /**
   * Reset to defaults
   */
  async reset(): Promise<UserPreferences> {
    this.preferences = {
      ...DEFAULT_PREFERENCES,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.save(this.preferences);
    return this.preferences;
  }

  /**
   * Get preferences file path
   */
  getPath(): string {
    return this.prefsPath;
  }
}

/**
 * Get global preferences instance
 */
let globalPreferences: PreferencesManager | null = null;

export function getPreferences(): PreferencesManager {
  if (!globalPreferences) {
    globalPreferences = new PreferencesManager();
  }
  return globalPreferences;
}

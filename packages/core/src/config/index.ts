/**
 * Configuration management for CV-Git
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { CVConfig, ConfigError } from '@cv-git/shared';
import { getCVDir, ensureDir, loadSharedCredentials } from '@cv-git/shared';
import { generateRepoId, getGraphDatabaseName } from '../storage/repo-id.js';

// Re-export service URL utilities
export * from './service-urls.js';

import { getFalkorDbUrl, getQdrantUrl, getOllamaUrl } from './service-urls.js';

const DEFAULT_CONFIG: CVConfig = {
  version: '0.1.0',
  repository: {
    root: '',
    name: '',
    initDate: new Date().toISOString()
  },
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: process.env.CV_ANTHROPIC_KEY,
    maxTokens: 4096,
    temperature: 0.2
  },
  ai: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: process.env.CV_ANTHROPIC_KEY,
    maxTokens: 4096,
    temperature: 0.2
  },
  embedding: {
    provider: 'ollama',
    model: 'nomic-embed-text',
    url: getOllamaUrl(),
    dimensions: 768
  },
  graph: {
    provider: 'falkordb',
    url: getFalkorDbUrl(),
    embedded: true,
    database: 'cv-git'
  },
  vector: {
    provider: 'qdrant',
    url: getQdrantUrl(),
    embedded: true,
    collections: {
      codeChunks: 'code_chunks',
      docstrings: 'docstrings',
      commits: 'commits',
      documentChunks: 'document_chunks'
    }
  },
  sync: {
    autoSync: true,
    syncOnCommit: true,
    excludePatterns: [
      // JavaScript/Node
      'node_modules/**',
      '.next/**',
      '.nuxt/**',
      '*.min.js',
      '*.bundle.js',

      // Python virtualenvs
      'venv/**',
      '.venv/**',
      'env/**',
      '.env/**',
      '**/lib/python*/**',
      '**/site-packages/**',
      '__pycache__/**',
      '*.pyc',
      '.pytest_cache/**',
      '*.egg-info/**',

      // Build outputs
      'dist/**',
      'build/**',
      'out/**',
      'target/**',
      '.build/**',

      // Test files
      '*.test.ts',
      '*.test.js',
      '*.spec.ts',
      '*.spec.js',
      'coverage/**',

      // Version control & cache
      '.git/**',
      '.cache/**',
      '.tmp/**',
      'tmp/**',

      // IDE/Editor
      '.idea/**',
      '.vscode/**',

      // Vendor directories
      'vendor/**',
      'third_party/**',
    ],
    includeLanguages: ['typescript', 'javascript', 'python', 'go', 'rust', 'c', 'cpp']
  },
  docs: {
    enabled: true,
    patterns: ['**/*.md'],
    excludePatterns: ['node_modules/**', 'dist/**', 'build/**', '.git/**'],
    chunkByHeading: 2,
    inferTypes: true
  },
  features: {
    enableChat: true,
    enableAutoCommit: false,
    enableTelemetry: false
  }
};

export class ConfigManager {
  private config: CVConfig | null = null;
  private configPath: string | null = null;

  /**
   * Initialize configuration for a repository
   */
  async init(repoRoot: string, repoName: string): Promise<CVConfig> {
    const cvDir = getCVDir(repoRoot);
    await ensureDir(cvDir);

    const repoId = generateRepoId(repoRoot);

    const config: CVConfig = {
      ...DEFAULT_CONFIG,
      repository: {
        root: repoRoot,
        name: repoName,
        initDate: new Date().toISOString(),
        repoId,
      },
      graph: {
        ...DEFAULT_CONFIG.graph,
        database: getGraphDatabaseName(repoId),
      },
    };

    const configPath = path.join(cvDir, 'config.json');
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    this.config = config;
    this.configPath = configPath;

    return config;
  }

  /**
   * Load configuration from repository
   */
  async load(repoRoot: string): Promise<CVConfig> {
    const cvDir = getCVDir(repoRoot);
    const configPath = path.join(cvDir, 'config.json');

    try {
      const data = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(data) as CVConfig;

      // Merge with defaults to handle missing fields
      this.config = this.mergeWithDefaults(config);
      this.configPath = configPath;

      // Auto-migrate legacy configs that use hardcoded 'cv-git' database
      if (this.config.graph.database === 'cv-git') {
        const repoId = this.config.repository.repoId || generateRepoId(repoRoot);
        this.config.repository.repoId = repoId;
        this.config.graph.database = getGraphDatabaseName(repoId);
        // Persist the migration
        await this.save();
      } else if (!this.config.repository.repoId) {
        // Config has a custom database name but no repoId — store repoId
        this.config.repository.repoId = generateRepoId(repoRoot);
        await this.save();
      }

      return this.config;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new ConfigError(`CV-Git not initialized in ${repoRoot}. Run 'cv init' first.`);
      }
      throw new ConfigError(`Failed to load config: ${error.message}`, error);
    }
  }

  /**
   * Save configuration to disk
   */
  async save(): Promise<void> {
    if (!this.config || !this.configPath) {
      throw new ConfigError('No configuration loaded');
    }

    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
  }

  /**
   * Get current configuration
   */
  get(): CVConfig {
    if (!this.config) {
      throw new ConfigError('Configuration not loaded. Call load() first.');
    }
    return this.config;
  }

  /**
   * Update configuration
   */
  async update(updates: Partial<CVConfig>): Promise<CVConfig> {
    if (!this.config) {
      throw new ConfigError('Configuration not loaded');
    }

    this.config = this.deepMerge(this.config, updates);
    await this.save();

    return this.config!;
  }

  /**
   * Get API key for a service
   * Checks: repo config > shared ControlVector credentials > environment variables
   */
  getApiKey(service: 'anthropic' | 'openai' | 'openrouter'): string {
    const config = this.get();

    if (service === 'anthropic') {
      const key = config.llm.apiKey || process.env.CV_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
      if (!key) {
        throw new ConfigError('Anthropic API key not configured. Set CV_ANTHROPIC_KEY env var or run `cv config set llm.apiKey <key>`');
      }
      return key;
    }

    if (service === 'openai') {
      const key = config.embedding.apiKey || process.env.CV_OPENAI_KEY || process.env.OPENAI_API_KEY;
      if (!key) {
        throw new ConfigError('OpenAI API key not configured. Set CV_OPENAI_KEY env var or run `cv config set embedding.apiKey <key>`');
      }
      return key;
    }

    if (service === 'openrouter') {
      const key = config.embedding.apiKey || process.env.CV_OPENROUTER_KEY || process.env.OPENROUTER_API_KEY;
      if (!key) {
        throw new ConfigError('OpenRouter API key not configured. Set CV_OPENROUTER_KEY env var or run `cv config set embedding.apiKey <key>`');
      }
      return key;
    }

    throw new ConfigError(`Unknown service: ${service}`);
  }

  /**
   * Get API key for a service (async version that checks shared credentials)
   * Priority: repo config > shared ControlVector credentials > environment variables
   */
  async getApiKeyAsync(service: 'anthropic' | 'openai' | 'openrouter'): Promise<string> {
    const config = this.get();
    const sharedCreds = await loadSharedCredentials();

    if (service === 'anthropic') {
      const key = config.llm.apiKey
        || sharedCreds.anthropic_key
        || process.env.CV_ANTHROPIC_KEY
        || process.env.ANTHROPIC_API_KEY;
      if (!key) {
        throw new ConfigError('Anthropic API key not configured. Set in cvPRD Settings or run `cv config set llm.apiKey <key>`');
      }
      return key;
    }

    if (service === 'openai' || service === 'openrouter') {
      const key = config.embedding.apiKey
        || sharedCreds.openrouter_key
        || process.env.CV_OPENROUTER_KEY
        || process.env.OPENROUTER_API_KEY;
      if (!key) {
        throw new ConfigError('OpenRouter API key not configured. Set in cvPRD Settings or run `cv config set embedding.apiKey <key>`');
      }
      return key;
    }

    throw new ConfigError(`Unknown service: ${service}`);
  }

  /**
   * Merge configuration with defaults
   */
  private mergeWithDefaults(config: Partial<CVConfig>): CVConfig {
    return this.deepMerge(DEFAULT_CONFIG, config) as CVConfig;
  }

  /**
   * Deep merge two objects
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }
}

// Export singleton instance
export const configManager = new ConfigManager();

// Re-export privilege configuration utilities
export {
  type PrivilegeMode,
  type PrivilegeConfig,
  detectPrivilegeMode,
  getEffectivePrivilegeMode,
  getDefaultPaths,
  isDockerAvailable,
  isPodmanAvailable,
  getRecommendedRuntime,
  isCI,
  isInContainer,
} from './privilege-config.js';

// Re-export global CV-Git configuration utilities
export {
  type CVGitConfig,
  type PrivilegeSettings,
  type ContainerSettings,
  type DatabaseSettings,
  type DatabasesSettings,
  type CredentialSettings,
  type AISettings,
  getConfigFilePath,
  loadCVGitConfig,
  saveCVGitConfig,
  updateCVGitConfig,
  setConfigValue,
  getConfigValue,
} from './cv-git-config.js';

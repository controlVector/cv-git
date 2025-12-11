/**
 * Configuration management for CV-Git
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { CVConfig, ConfigError } from '@cv-git/shared';
import { getCVDir, ensureDir } from '@cv-git/shared';

const DEFAULT_CONFIG: CVConfig = {
  version: '0.1.0',
  repository: {
    root: '',
    name: '',
    initDate: new Date().toISOString()
  },
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    apiKey: process.env.CV_ANTHROPIC_KEY,
    maxTokens: 4096,
    temperature: 0.2
  },
  ai: {
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    apiKey: process.env.CV_ANTHROPIC_KEY,
    maxTokens: 4096,
    temperature: 0.2
  },
  embedding: {
    provider: 'openrouter',
    model: 'openai/text-embedding-3-small',
    apiKey: process.env.CV_OPENROUTER_KEY || process.env.OPENROUTER_API_KEY,
    dimensions: 1536
  },
  graph: {
    provider: 'falkordb',
    url: 'redis://localhost:6379',
    embedded: true,
    database: 'cv-git'
  },
  vector: {
    provider: 'qdrant',
    url: 'http://localhost:6333',
    embedded: true,
    collections: {
      codeChunks: 'code_chunks',
      docstrings: 'docstrings',
      commits: 'commits'
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
    includeLanguages: ['typescript', 'javascript', 'python', 'go', 'rust']
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

    const config: CVConfig = {
      ...DEFAULT_CONFIG,
      repository: {
        root: repoRoot,
        name: repoName,
        initDate: new Date().toISOString()
      }
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
   */
  getApiKey(service: 'anthropic' | 'openai'): string {
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

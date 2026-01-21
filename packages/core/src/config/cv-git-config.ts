/**
 * CV-Git Configuration Schema and Management
 * Manages global CV-Git configuration including privilege settings
 */

import * as fs from 'fs';
import * as path from 'path';
import { detectPrivilegeMode, getDefaultPaths, PrivilegeMode } from './privilege-config.js';

// Configuration Types

export interface PrivilegeSettings {
  mode: PrivilegeMode;
  allowSudo: boolean;    // Allow sudo escalation when needed
  warnOnRoot: boolean;   // Warn when running as root
}

export interface ContainerSettings {
  runtime: 'docker' | 'podman' | 'external';
  rootless: boolean;     // Prefer rootless
  socketPath?: string;
  composeFile?: string;
}

export interface DatabaseSettings {
  host: string;
  port: number;
  external: boolean;     // Use external instance
}

export interface DatabasesSettings {
  falkordb: DatabaseSettings;
  qdrant: DatabaseSettings;
}

export interface CredentialSettings {
  storage: 'keychain' | 'file' | 'env';
  keyringService: string;
}

export interface AISettings {
  provider: 'anthropic' | 'openai';
  model?: string;
}

export interface CVGitConfig {
  version: string;
  privilege: PrivilegeSettings;
  containers: ContainerSettings;
  databases: DatabasesSettings;
  credentials: CredentialSettings;
  ai: AISettings;
}

// Default Configuration

function getDefaultConfig(): CVGitConfig {
  return {
    version: '1',
    privilege: {
      mode: 'auto',
      allowSudo: false,
      warnOnRoot: true,
    },
    containers: {
      runtime: 'docker',
      rootless: true,
    },
    databases: {
      falkordb: {
        host: 'localhost',
        port: 6379,
        external: false,
      },
      qdrant: {
        host: 'localhost',
        port: 6333,
        external: false,
      },
    },
    credentials: {
      storage: 'keychain',
      keyringService: 'cv-git',
    },
    ai: {
      provider: 'anthropic',
    },
  };
}

// Validation

function validateConfig(config: unknown): CVGitConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Configuration must be an object');
  }

  const raw = config as Record<string, unknown>;
  const defaults = getDefaultConfig();

  // Deep merge with defaults
  const result: CVGitConfig = {
    version: typeof raw.version === 'string' ? raw.version : defaults.version,
    privilege: validatePrivilegeSettings(raw.privilege, defaults.privilege),
    containers: validateContainerSettings(raw.containers, defaults.containers),
    databases: validateDatabasesSettings(raw.databases, defaults.databases),
    credentials: validateCredentialSettings(raw.credentials, defaults.credentials),
    ai: validateAISettings(raw.ai, defaults.ai),
  };

  return result;
}

function validatePrivilegeSettings(value: unknown, defaults: PrivilegeSettings): PrivilegeSettings {
  if (!value || typeof value !== 'object') return defaults;
  const raw = value as Record<string, unknown>;

  return {
    mode: isValidPrivilegeMode(raw.mode) ? raw.mode : defaults.mode,
    allowSudo: typeof raw.allowSudo === 'boolean' ? raw.allowSudo : defaults.allowSudo,
    warnOnRoot: typeof raw.warnOnRoot === 'boolean' ? raw.warnOnRoot : defaults.warnOnRoot,
  };
}

function isValidPrivilegeMode(value: unknown): value is PrivilegeMode {
  return value === 'root' || value === 'user' || value === 'auto';
}

function validateContainerSettings(value: unknown, defaults: ContainerSettings): ContainerSettings {
  if (!value || typeof value !== 'object') return defaults;
  const raw = value as Record<string, unknown>;

  const runtime = raw.runtime;
  const validRuntime = runtime === 'docker' || runtime === 'podman' || runtime === 'external'
    ? runtime
    : defaults.runtime;

  return {
    runtime: validRuntime,
    rootless: typeof raw.rootless === 'boolean' ? raw.rootless : defaults.rootless,
    socketPath: typeof raw.socketPath === 'string' ? raw.socketPath : undefined,
    composeFile: typeof raw.composeFile === 'string' ? raw.composeFile : undefined,
  };
}

function validateDatabasesSettings(value: unknown, defaults: DatabasesSettings): DatabasesSettings {
  if (!value || typeof value !== 'object') return defaults;
  const raw = value as Record<string, unknown>;

  return {
    falkordb: validateDatabaseSettings(raw.falkordb, defaults.falkordb),
    qdrant: validateDatabaseSettings(raw.qdrant, defaults.qdrant),
  };
}

function validateDatabaseSettings(value: unknown, defaults: DatabaseSettings): DatabaseSettings {
  if (!value || typeof value !== 'object') return defaults;
  const raw = value as Record<string, unknown>;

  return {
    host: typeof raw.host === 'string' ? raw.host : defaults.host,
    port: typeof raw.port === 'number' ? raw.port : defaults.port,
    external: typeof raw.external === 'boolean' ? raw.external : defaults.external,
  };
}

function validateCredentialSettings(value: unknown, defaults: CredentialSettings): CredentialSettings {
  if (!value || typeof value !== 'object') return defaults;
  const raw = value as Record<string, unknown>;

  const storage = raw.storage;
  const validStorage = storage === 'keychain' || storage === 'file' || storage === 'env'
    ? storage
    : defaults.storage;

  return {
    storage: validStorage,
    keyringService: typeof raw.keyringService === 'string' ? raw.keyringService : defaults.keyringService,
  };
}

function validateAISettings(value: unknown, defaults: AISettings): AISettings {
  if (!value || typeof value !== 'object') return defaults;
  const raw = value as Record<string, unknown>;

  const provider = raw.provider;
  const validProvider = provider === 'anthropic' || provider === 'openai'
    ? provider
    : defaults.provider;

  return {
    provider: validProvider,
    model: typeof raw.model === 'string' ? raw.model : undefined,
  };
}

// File Operations

/**
 * Get the path to the global config file
 */
export function getConfigFilePath(mode?: PrivilegeMode): string {
  const privilegeMode = mode || detectPrivilegeMode();
  const paths = getDefaultPaths(privilegeMode);
  return path.join(paths.config, 'config.json');
}

/**
 * Load the global CV-Git configuration
 */
export async function loadCVGitConfig(configPath?: string): Promise<CVGitConfig> {
  const filePath = configPath || getConfigFilePath();

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const raw = JSON.parse(content);
      return validateConfig(raw);
    }
  } catch (error) {
    console.warn(`Warning: Could not load config from ${filePath}:`, error);
  }

  return getDefaultConfig();
}

/**
 * Save the global CV-Git configuration
 */
export async function saveCVGitConfig(config: CVGitConfig, configPath?: string): Promise<void> {
  const filePath = configPath || getConfigFilePath(config.privilege.mode);
  const dir = path.dirname(filePath);

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Validate before saving
  const validated = validateConfig(config);

  fs.writeFileSync(filePath, JSON.stringify(validated, null, 2), 'utf8');
}

/**
 * Update specific configuration values
 */
export async function updateCVGitConfig(
  updates: Partial<CVGitConfig>,
  configPath?: string
): Promise<CVGitConfig> {
  const current = await loadCVGitConfig(configPath);
  const merged = deepMerge(current, updates);
  const validated = validateConfig(merged);
  await saveCVGitConfig(validated, configPath);
  return validated;
}

/**
 * Deep merge utility
 */
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (
        sourceValue !== undefined &&
        typeof sourceValue === 'object' &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof targetValue === 'object' &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(targetValue, sourceValue as Partial<typeof targetValue>) as T[Extract<keyof T, string>];
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue as T[Extract<keyof T, string>];
      }
    }
  }

  return result;
}

/**
 * Set a nested config value using dot notation
 * e.g., setConfigValue(config, 'privilege.mode', 'user')
 */
export function setConfigValue(config: CVGitConfig, key: string, value: unknown): CVGitConfig {
  const keys = key.split('.');
  const result = JSON.parse(JSON.stringify(config)) as CVGitConfig;

  let obj: Record<string, unknown> = result as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof obj[k] !== 'object' || obj[k] === null) {
      throw new Error(`Invalid config key: ${key}`);
    }
    obj = obj[k] as Record<string, unknown>;
  }

  const finalKey = keys[keys.length - 1];
  obj[finalKey] = value;

  return validateConfig(result);
}

/**
 * Get a nested config value using dot notation
 */
export function getConfigValue(config: CVGitConfig, key: string): unknown {
  const keys = key.split('.');
  let obj: unknown = config;

  for (const k of keys) {
    if (typeof obj !== 'object' || obj === null) {
      return undefined;
    }
    obj = (obj as Record<string, unknown>)[k];
  }

  return obj;
}

// Re-export types
export type { PrivilegeMode } from './privilege-config.js';

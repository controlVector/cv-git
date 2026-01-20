/**
 * Service URL Configuration
 *
 * Provides configurable service URLs with environment variable overrides.
 * Priority: Environment Variables > Config File > Defaults
 */

/**
 * Default service URLs
 */
const DEFAULT_URLS = {
  falkordb: 'redis://localhost:6379',
  qdrant: 'http://localhost:6333',
  ollama: 'http://localhost:11434'
} as const;

/**
 * Service URL configuration options
 */
export interface ServiceUrlConfig {
  falkordb?: string;
  qdrant?: string;
  ollama?: string;
}

/**
 * Get the FalkorDB connection URL
 *
 * Priority: CV_FALKORDB_URL env var > config.graph.url > default
 *
 * @param configUrl - URL from config file (optional)
 */
export function getFalkorDbUrl(configUrl?: string): string {
  // Environment variable takes highest priority (CV_ prefix for consistency)
  const envUrl = process.env.CV_FALKORDB_URL || process.env.FALKORDB_URL;
  if (envUrl) {
    return envUrl;
  }

  // Config file URL takes second priority
  if (configUrl) {
    return configUrl;
  }

  // Default fallback
  return DEFAULT_URLS.falkordb;
}

/**
 * Get the Qdrant connection URL
 *
 * Priority: CV_QDRANT_URL env var > config.vector.url > default
 *
 * @param configUrl - URL from config file (optional)
 */
export function getQdrantUrl(configUrl?: string): string {
  // Environment variable takes highest priority (CV_ prefix for consistency)
  const envUrl = process.env.CV_QDRANT_URL || process.env.QDRANT_URL;
  if (envUrl) {
    return envUrl;
  }

  // Config file URL takes second priority
  if (configUrl) {
    return configUrl;
  }

  // Default fallback
  return DEFAULT_URLS.qdrant;
}

/**
 * Get the Ollama API URL
 *
 * Priority: CV_OLLAMA_URL env var > config.embedding.url > default
 *
 * @param configUrl - URL from config file (optional)
 */
export function getOllamaUrl(configUrl?: string): string {
  // Environment variable takes highest priority (CV_ prefix, also support OLLAMA_HOST)
  const envUrl = process.env.CV_OLLAMA_URL || process.env.OLLAMA_HOST || process.env.OLLAMA_URL;
  if (envUrl) {
    // Remove trailing slash for consistency
    return envUrl.replace(/\/$/, '');
  }

  // Config file URL takes second priority
  if (configUrl) {
    return configUrl.replace(/\/$/, '');
  }

  // Default fallback
  return DEFAULT_URLS.ollama;
}

/**
 * Get all service URLs
 *
 * @param config - Service URL configuration from config file
 */
export function getServiceUrls(config: ServiceUrlConfig = {}): {
  falkordb: string;
  qdrant: string;
  ollama: string;
} {
  return {
    falkordb: getFalkorDbUrl(config.falkordb),
    qdrant: getQdrantUrl(config.qdrant),
    ollama: getOllamaUrl(config.ollama)
  };
}

/**
 * Log service URL sources for debugging
 */
export function logServiceUrlSources(): void {
  console.log('Service URL Configuration:');
  console.log('  FalkorDB:');
  console.log(`    - CV_FALKORDB_URL: ${process.env.CV_FALKORDB_URL || '(not set)'}`);
  console.log(`    - FALKORDB_URL: ${process.env.FALKORDB_URL || '(not set)'}`);
  console.log(`    - Resolved: ${getFalkorDbUrl()}`);

  console.log('  Qdrant:');
  console.log(`    - CV_QDRANT_URL: ${process.env.CV_QDRANT_URL || '(not set)'}`);
  console.log(`    - QDRANT_URL: ${process.env.QDRANT_URL || '(not set)'}`);
  console.log(`    - Resolved: ${getQdrantUrl()}`);

  console.log('  Ollama:');
  console.log(`    - CV_OLLAMA_URL: ${process.env.CV_OLLAMA_URL || '(not set)'}`);
  console.log(`    - OLLAMA_HOST: ${process.env.OLLAMA_HOST || '(not set)'}`);
  console.log(`    - Resolved: ${getOllamaUrl()}`);
}

/**
 * Default URLs export for reference
 */
export { DEFAULT_URLS };

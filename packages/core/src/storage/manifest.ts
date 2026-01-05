/**
 * Storage Manifest Management
 *
 * Handles reading/writing the manifest.json file that tracks
 * repository metadata, sync stats, and schema version.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  StorageManifest,
  RepositoryInfo,
  SyncStats,
  EmbeddingConfig,
  NodeType,
  EdgeType
} from './types.js';
import { getRepositoryInfo } from './repo-id.js';

const CURRENT_VERSION = '1.0.0';
const FORMAT_ID = 'cv-git-storage';

/**
 * Create a new manifest for a repository
 */
export function createManifest(
  repoRoot: string,
  embeddingConfig?: Partial<EmbeddingConfig>
): StorageManifest {
  const now = new Date().toISOString();
  const repoInfo = getRepositoryInfo(repoRoot);

  return {
    version: CURRENT_VERSION,
    format: FORMAT_ID,
    created: now,
    updated: now,
    repository: repoInfo,
    stats: {
      files: 0,
      symbols: 0,
      relationships: 0,
      vectors: 0,
      lastSync: now,
      syncDuration: 0
    },
    embedding: {
      provider: embeddingConfig?.provider || 'openrouter',
      model: embeddingConfig?.model || 'openai/text-embedding-3-small',
      dimensions: embeddingConfig?.dimensions || 1536
    },
    nodeTypes: ['file', 'symbol'],
    edgeTypes: ['imports', 'calls', 'contains']
  };
}

/**
 * Read manifest from .cv/manifest.json
 */
export async function readManifest(cvDir: string): Promise<StorageManifest | null> {
  const manifestPath = path.join(cvDir, 'manifest.json');

  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content) as StorageManifest;

    // Validate format
    if (manifest.format !== FORMAT_ID) {
      console.warn(`Unknown manifest format: ${manifest.format}`);
      return null;
    }

    // Apply migrations if needed
    return migrateManifest(manifest);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Write manifest to .cv/manifest.json
 */
export async function writeManifest(cvDir: string, manifest: StorageManifest): Promise<void> {
  const manifestPath = path.join(cvDir, 'manifest.json');

  // Update timestamp
  manifest.updated = new Date().toISOString();

  // Ensure directory exists
  await fs.mkdir(cvDir, { recursive: true });

  // Write with pretty formatting for readability
  await fs.writeFile(
    manifestPath,
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );
}

/**
 * Update manifest stats after sync
 */
export function updateManifestStats(
  manifest: StorageManifest,
  stats: Partial<SyncStats>
): StorageManifest {
  return {
    ...manifest,
    stats: {
      ...manifest.stats,
      ...stats,
      lastSync: new Date().toISOString()
    },
    updated: new Date().toISOString()
  };
}

/**
 * Add node types to manifest
 */
export function addNodeTypes(manifest: StorageManifest, types: NodeType[]): StorageManifest {
  const existingTypes = new Set(manifest.nodeTypes);
  types.forEach(t => existingTypes.add(t));

  return {
    ...manifest,
    nodeTypes: Array.from(existingTypes)
  };
}

/**
 * Add edge types to manifest
 */
export function addEdgeTypes(manifest: StorageManifest, types: EdgeType[]): StorageManifest {
  const existingTypes = new Set(manifest.edgeTypes);
  types.forEach(t => existingTypes.add(t));

  return {
    ...manifest,
    edgeTypes: Array.from(existingTypes)
  };
}

/**
 * Migrate manifest to current version
 */
function migrateManifest(manifest: StorageManifest): StorageManifest {
  const originalVersion = manifest.version || '0.0.0';
  const migrations: string[] = [];

  // Migration from pre-1.0.0 (e.g., 0.3.2 format)
  if (compareVersions(originalVersion, '1.0.0') < 0) {
    manifest = migrateToV1_0_0(manifest);
    migrations.push(`v${originalVersion} -> v1.0.0`);
  }

  // Future migrations would go here:
  // if (compareVersions(manifest.version, '1.1.0') < 0) {
  //   manifest = migrateToV1_1_0(manifest);
  //   migrations.push('v1.0.0 -> v1.1.0');
  // }

  // Log migrations if any occurred
  if (migrations.length > 0) {
    console.log(`Manifest migrated: ${migrations.join(' -> ')}`);
  }

  return manifest;
}

/**
 * Migrate manifest from pre-1.0.0 versions to 1.0.0
 * Handles missing fields that may not exist in older versions
 */
function migrateToV1_0_0(manifest: any): StorageManifest {
  const now = new Date().toISOString();

  // Ensure all required fields exist with sensible defaults
  return {
    version: '1.0.0',
    format: manifest.format || FORMAT_ID,
    created: manifest.created || now,
    updated: now,
    repository: manifest.repository || {
      id: 'unknown',
      name: 'unknown',
      root: process.cwd()
    },
    stats: {
      files: manifest.stats?.files ?? 0,
      symbols: manifest.stats?.symbols ?? 0,
      relationships: manifest.stats?.relationships ?? 0,
      vectors: manifest.stats?.vectors ?? 0,
      lastSync: manifest.stats?.lastSync || now,
      syncDuration: manifest.stats?.syncDuration ?? 0
    },
    embedding: {
      provider: manifest.embedding?.provider || 'openrouter',
      model: manifest.embedding?.model || 'openai/text-embedding-3-small',
      dimensions: manifest.embedding?.dimensions || 1536
    },
    nodeTypes: manifest.nodeTypes || ['file', 'symbol'],
    edgeTypes: manifest.edgeTypes || ['imports', 'calls', 'contains']
  };
}

/**
 * Compare semantic versions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const va = partsA[i] || 0;
    const vb = partsB[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }

  return 0;
}

/**
 * Check if manifest needs sync (based on file changes)
 */
export function needsSync(manifest: StorageManifest): boolean {
  // If never synced, needs sync
  if (manifest.stats.files === 0) {
    return true;
  }

  // Could add more sophisticated change detection here
  // (e.g., compare git HEAD with lastSync commit)

  return false;
}

/**
 * Backend Factory — platform-routed graph database selection for CV-Git.
 *
 * Routing:
 *   Windows  → LadybugDB  (@ladybugdb/core, embedded, no server)
 *   Linux    → falkordblite (embedded) with redis fallback
 *   Server   → redis (FalkorDB remote, CV-Hub)
 *
 * Override via CV_GIT_GRAPH_BACKEND=redis|falkordblite|ladybugdb
 * When FalkorDB ships native Windows binaries, update this file only.
 */

import type { IGraphBackend, BackendType } from './backend.js';
import { RedisBackend } from './backends/redis-backend.js';

export interface CreateBackendOptions {
  /** Redis/FalkorDB URL for remote mode (default: redis://localhost:6379) */
  url?: string;
  /** Graph/database name */
  graphName: string;
  /** Data directory for embedded DBs (auto-detected if omitted) */
  dataDir?: string;
}

export interface BackendResult {
  backend: IGraphBackend;
  type: BackendType;
}

/**
 * Determine which backend to use based on env var override or platform.
 */
export function resolveBackendType(): BackendType {
  const override = process.env.CV_GIT_GRAPH_BACKEND?.toLowerCase();
  if (override === 'redis' || override === 'falkordblite' || override === 'ladybugdb') {
    return override;
  }

  if (process.platform === 'win32') {
    return 'ladybugdb';
  }

  // Linux/macOS: prefer embedded, but we check availability at create time
  return 'falkordblite';
}

/**
 * Create the appropriate backend for the current platform.
 *
 * Falls back to redis if the preferred embedded backend is not installed.
 */
export async function createBackend(options: CreateBackendOptions): Promise<BackendResult> {
  const preferred = resolveBackendType();

  if (preferred === 'falkordblite') {
    try {
      const { FalkorDbLiteBackend } = await import('./backends/falkordblite-backend.js');
      return {
        backend: new FalkorDbLiteBackend({ dataDir: options.dataDir }),
        type: 'falkordblite',
      };
    } catch {
      // falkordblite not installed — fall back to redis
      if (process.env.CV_DEBUG) {
        console.log('[BackendFactory] falkordblite not available, falling back to redis');
      }
    }
  }

  if (preferred === 'ladybugdb') {
    try {
      const { LadybugBackend } = await import('./backends/ladybug-backend.js');
      return {
        backend: new LadybugBackend({ dataDir: options.dataDir }),
        type: 'ladybugdb',
      };
    } catch {
      // @ladybugdb/core not installed — fall back to redis
      if (process.env.CV_DEBUG) {
        console.log('[BackendFactory] @ladybugdb/core not available, falling back to redis');
      }
    }
  }

  // redis is always available (it's a direct dependency)
  const url = options.url || process.env.CV_FALKORDB_URL || process.env.FALKORDB_URL || 'redis://localhost:6379';
  return {
    backend: new RedisBackend({ url }),
    type: 'redis',
  };
}

/**
 * Check if a backend type uses an embedded database (no server needed).
 */
export function isEmbeddedBackend(type: BackendType): boolean {
  return type === 'falkordblite' || type === 'ladybugdb';
}

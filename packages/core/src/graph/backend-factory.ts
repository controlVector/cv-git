/**
 * Backend Factory — platform-routed graph database selection for CV-Git.
 *
 * Routing:
 *   Windows      → redis (containerized FalkorDB; the CLI auto-starts a
 *                  falkordb/falkordb Docker container via ensureFalkorDB()).
 *                  falkordblite has no win32 prebuild and the @ladybugdb/core
 *                  embedded backend is non-functional (API/dialect mismatch,
 *                  see ladybug-backend.ts), so the client-server path is the
 *                  Windows graph route.
 *   Linux/macOS  → falkordblite (embedded) with redis fallback. When the host
 *                  lacks a system redis-server >= 8 that falkordblite needs,
 *                  connect() fails and we fall back to the same containerized
 *                  redis path (ensureFalkorDB() supplies the URL).
 *   Server       → redis (FalkorDB remote, CV-Hub / Docker)
 *
 * Override via CV_GIT_GRAPH_BACKEND=redis|falkordblite|ladybugdb
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
  /** True if the factory has already called connect() on the backend. */
  preConnected: boolean;
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
    // Windows has no working embedded backend: falkordblite ships no win32
    // prebuild, and @ladybugdb/core is API/dialect-incompatible (see
    // ladybug-backend.ts). Use the containerized FalkorDB (redis) path; the
    // CLI auto-starts the container via ensureFalkorDB().
    return 'redis';
  }

  // Linux/macOS: prefer embedded, but we check availability at create time.
  // If the embedded binary is unusable (e.g. no system redis-8), createBackend
  // falls back to the containerized redis path below.
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
      const backend = new FalkorDbLiteBackend({ dataDir: options.dataDir });
      await backend.connect();
      return {
        backend,
        type: 'falkordblite',
        preConnected: true,
      };
    } catch (err: any) {
      console.warn(`[BackendFactory] falkordblite unavailable: ${err.message}`);
      console.warn('[BackendFactory] Falling back to redis backend');
    }
  }

  if (preferred === 'ladybugdb') {
    try {
      const { LadybugBackend } = await import('./backends/ladybug-backend.js');
      const backend = new LadybugBackend({ dataDir: options.dataDir });
      await backend.connect();
      return {
        backend,
        type: 'ladybugdb',
        preConnected: true,
      };
    } catch (err: any) {
      console.warn(`[BackendFactory] @ladybugdb/core unavailable: ${err.message}`);
      console.warn('[BackendFactory] Falling back to redis backend');
    }
  }

  // redis is always available (it's a direct dependency)
  const url = options.url || process.env.CV_FALKORDB_URL || process.env.FALKORDB_URL || 'redis://localhost:6379';
  return {
    backend: new RedisBackend({ url }),
    type: 'redis',
    preConnected: false,
  };
}

/**
 * Check if a backend type uses an embedded database (no server needed).
 */
export function isEmbeddedBackend(type: BackendType): boolean {
  return type === 'falkordblite' || type === 'ladybugdb';
}

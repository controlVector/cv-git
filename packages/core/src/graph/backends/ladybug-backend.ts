/**
 * LadybugBackend — embedded LadybugDB for Windows.
 *
 * Uses `@ladybugdb/core` npm package. LadybugDB is a C++ native addon
 * that provides an embedded property graph database with Cypher support.
 *
 * Key differences from FalkorDB:
 *   - Requires explicit schema creation (CREATE NODE TABLE / CREATE REL TABLE)
 *   - Uses a connection-based API instead of Redis protocol
 *   - Result format differs — normalized to FalkorDB compact shape here
 *
 * This backend is Windows-only. When FalkorDB ships native Windows binaries,
 * this backend will be replaced by falkordblite.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { IGraphBackend } from '../backend.js';

export interface LadybugBackendOptions {
  /** Directory to store the embedded database files */
  dataDir?: string;
}

export class LadybugBackend implements IGraphBackend {
  private db: any = null;
  private conn: any = null;
  private dataDir: string;

  constructor(options: LadybugBackendOptions) {
    this.dataDir = options.dataDir ?? LadybugBackend.defaultDataDir();
  }

  private static defaultDataDir(): string {
    try {
      // Dynamic import of env-paths for cross-platform app data dirs
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const envPaths = require('env-paths');
      const paths = envPaths('cv-git', { suffix: '' });
      return path.join(paths.data, 'graph');
    } catch {
      // Fallback for Windows
      const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
      return path.join(appData, 'cv-git', 'graph');
    }
  }

  async connect(): Promise<void> {
    const ladybug = await import('@ladybugdb/core');
    const Database = ladybug.Database ?? ladybug.default?.Database ?? ladybug.default;

    fs.mkdirSync(this.dataDir, { recursive: true });
    this.db = new Database(this.dataDir);
    this.conn = this.db.connect();
  }

  async close(): Promise<void> {
    if (this.conn) {
      try { this.conn.close(); } catch { /* ignore */ }
      this.conn = null;
    }
    if (this.db) {
      try { this.db.close(); } catch { /* ignore */ }
      this.db = null;
    }
  }

  async ping(): Promise<boolean> {
    if (!this.conn) return false;
    try {
      this.conn.execute('RETURN 1');
      return true;
    } catch {
      return false;
    }
  }

  async rawQuery(_graphName: string, cypher: string): Promise<unknown> {
    if (!this.conn) {
      throw new Error('LadybugBackend: not connected');
    }

    const result = this.conn.execute(cypher);

    // Normalize LadybugDB result to FalkorDB compact format:
    // [headers, rows, statistics]
    // headers: [[type, name], ...]
    // rows: [[[type, value], ...], ...]
    // statistics: [string, ...]
    return this.normalizeResult(result);
  }

  /**
   * Convert LadybugDB query result to FalkorDB compact format
   * so GraphManager.parseQueryResult() works unchanged.
   */
  private normalizeResult(result: any): unknown {
    // LadybugDB may return results via getAll(), getAsDF(), or similar.
    // Try common API patterns:

    if (!result) {
      return [[], [], []];
    }

    // If result has getColumnNames/getAll pattern
    if (typeof result.getColumnNames === 'function') {
      const colNames: string[] = result.getColumnNames();
      const headers: [number, string][] = colNames.map((name: string) => [1, name]);

      let rows: [number, unknown][][] = [];
      if (typeof result.getAll === 'function') {
        const allRows: Record<string, unknown>[] = result.getAll();
        rows = allRows.map((row: Record<string, unknown>) =>
          colNames.map((col: string) => [1, row[col]] as [number, unknown])
        );
      }

      return [headers, rows, []];
    }

    // If result is array-like with header/data shape
    if (result.header && result.data) {
      const headers: [number, string][] = result.header.map((h: string) => [1, h]);
      const rows: [number, unknown][][] = (result.data ?? []).map((row: unknown[]) =>
        row.map((val: unknown) => [1, val] as [number, unknown])
      );
      return [headers, rows, result.metadata ?? []];
    }

    // Fallback: empty result
    return [[], [], []];
  }
}

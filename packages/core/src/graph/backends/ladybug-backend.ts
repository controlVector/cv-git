/**
 * LadybugBackend — NON-FUNCTIONAL STUB. Do not route to this backend.
 *
 * This was intended as an embedded Windows backend via `@ladybugdb/core`, but
 * it does not work against the published `@ladybugdb/core` (verified @0.19.0)
 * on two independent levels:
 *
 *   1. API mismatch: this code calls `db.connect()` and passes a directory it
 *      mkdir's as the DB path. The real API is Kùzu-style: `new Connection(db)`
 *      (there is no `db.connect()`), `db.init()`, and the DB path must be a
 *      file, not a directory. connect() below throws immediately.
 *   2. Dialect mismatch: `@ladybugdb/core` (Kùzu) requires schema-first DDL
 *      (`CREATE NODE TABLE ...`) before any insert, whereas GraphManager emits
 *      schemaless FalkorDB-dialect Cypher (`CREATE (:File {...})` / `MERGE`).
 *      Those queries fail with "Binder exception: Table ... does not exist".
 *
 * Windows therefore uses the containerized FalkorDB (redis) path instead; see
 * backend-factory.ts. Making a native Windows embedded backend work would be a
 * full rewrite (correct Connection API + schema-table generation + FalkorDB ->
 * Kùzu query translation), tracked in issue #19. This file is retained only so
 * an explicit CV_GIT_GRAPH_BACKEND=ladybugdb override fails loudly rather than
 * silently; it is not on any default code path.
 */

import * as path from 'path';
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
    // Non-functional stub (see file header). Fail loudly and actionably rather
    // than throwing an obscure TypeError deep in the graph path.
    throw new Error(
      'The @ladybugdb/core embedded backend is not supported (API/dialect ' +
        'incompatible with the published @ladybugdb/core; see issue #19). ' +
        'On Windows the graph uses containerized FalkorDB via Docker; do not ' +
        'set CV_GIT_GRAPH_BACKEND=ladybugdb.'
    );
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

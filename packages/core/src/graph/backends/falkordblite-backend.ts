/**
 * FalkorDbLiteBackend — embedded FalkorDB for Linux/macOS.
 *
 * Uses the `falkordblite` npm package which bundles FalkorDB binaries
 * for Linux x64 and macOS arm64. No server process needed.
 *
 * The query result format matches FalkorDB's compact format, so
 * GraphManager.parseQueryResult() works without modification.
 */

import type { IGraphBackend } from '../backend.js';

export interface FalkorDbLiteBackendOptions {
  /** Directory to store the embedded database files */
  dataDir?: string;
}

export class FalkorDbLiteBackend implements IGraphBackend {
  private db: any = null;
  private dataDir?: string;

  constructor(options: FalkorDbLiteBackendOptions) {
    this.dataDir = options.dataDir;
  }

  async connect(): Promise<void> {
    let falkordblite;
    try {
      falkordblite = await import('falkordblite');
    } catch (err: any) {
      throw new Error(`falkordblite not available: ${err.message}. Install with: npm install falkordblite, or set graph backend to redis.`);
    }
    const FalkorDB = falkordblite.FalkorDB ?? falkordblite.default?.FalkorDB ?? falkordblite.default;

    const openOptions: Record<string, unknown> = {};
    if (this.dataDir) {
      openOptions.path = this.dataDir;
    }

    this.db = await FalkorDB.open(openOptions);
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        await this.db.close();
      } catch {
        // Ignore close errors
      }
      this.db = null;
    }
  }

  async ping(): Promise<boolean> {
    if (!this.db) return false;
    try {
      const graph = this.db.selectGraph('_ping');
      await graph.query('RETURN 1');
      return true;
    } catch {
      return false;
    }
  }

  async rawQuery(graphName: string, cypher: string): Promise<unknown> {
    if (!this.db) {
      throw new Error('FalkorDbLiteBackend: not connected');
    }

    const graph = this.db.selectGraph(graphName);
    const result: any = await graph.query(cypher);

    // GraphManager.parseQueryResult expects FalkorDB's compact format:
    //   [ headerPairs, rowArrays, statistics ]
    //   headerPairs: [[type, name], ...]
    //   rowArrays:   [[[type, value], ...], ...]   (positional, one per column)
    //   statistics:  string[]
    //
    // If falkordblite already handed us that compact shape, pass it through.
    if (Array.isArray(result)) {
      return result;
    }

    // Otherwise the underlying falkordb client returned a parsed reply:
    //   { headers?, data: Array<Record<column, value>>, metadata: string[] }
    // Note the field is `headers` (not `header`), and each row is an OBJECT
    // keyed by column name, not a positional array.
    const data: unknown[] = Array.isArray(result?.data) ? result.data : [];
    const stats: string[] = result?.metadata ?? result?.statistics ?? [];

    // Determine ordered column names: prefer explicit headers, otherwise
    // derive from the keys of the first row object (insertion order matches
    // the RETURN/column order in the falkordb client).
    let columns: string[] = [];
    if (Array.isArray(result?.headers) && result.headers.length > 0) {
      columns = result.headers.map((h: any) =>
        Array.isArray(h) ? String(h[1]) : String(h?.name ?? h)
      );
    } else if (
      data.length > 0 &&
      data[0] &&
      typeof data[0] === 'object' &&
      !Array.isArray(data[0])
    ) {
      columns = Object.keys(data[0] as Record<string, unknown>);
    }

    const headers: [number, string][] = columns.map((name) => [1, name]);
    const rows: [number, unknown][][] = data.map((row: any) => {
      if (Array.isArray(row)) {
        return row.map((val: unknown) => [1, val] as [number, unknown]);
      }
      if (row && typeof row === 'object') {
        return columns.map((col) => [1, row[col]] as [number, unknown]);
      }
      // Scalar row (single unnamed column)
      return [[1, row] as [number, unknown]];
    });

    return [headers, rows, stats];
  }
}

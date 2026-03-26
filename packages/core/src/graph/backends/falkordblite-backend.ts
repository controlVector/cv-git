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
    const falkordblite = await import('falkordblite');
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
    const result = await graph.query(cypher);

    // falkordblite wraps the falkordb client, which may return pre-parsed
    // results. Normalize to the compact format that parseQueryResult expects:
    // [headers, rows, statistics]
    //
    // The falkordb client returns { header, data, metadata } or similar.
    // If result already has the [headers, rows, stats] shape (raw mode),
    // return as-is. Otherwise, convert.
    if (Array.isArray(result) && result.length >= 2) {
      // Already in raw format
      return result;
    }

    // Convert from falkordb client's parsed format
    const headers: [number, string][] = (result.header ?? []).map((h: string, i: number) => [1, h]);
    const rows: [number, unknown][][] = (result.data ?? []).map((row: unknown[]) =>
      row.map((val: unknown, i: number) => [1, val] as [number, unknown])
    );
    const stats: string[] = result.metadata ?? result.statistics ?? [];

    return [headers, rows, stats];
  }
}

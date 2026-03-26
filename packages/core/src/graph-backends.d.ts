/**
 * Ambient type declarations for optional graph backend packages.
 * These packages are loaded via dynamic import() and may not be installed.
 */

declare module 'falkordblite' {
  export class FalkorDB {
    static open(options?: { path?: string }): Promise<FalkorDB>;
    selectGraph(name: string): FalkorGraph;
    close(): Promise<void>;
  }

  interface FalkorGraph {
    query(cypher: string, options?: { params?: Record<string, unknown> }): Promise<FalkorResult>;
    roQuery(cypher: string, options?: { params?: Record<string, unknown> }): Promise<FalkorResult>;
  }

  interface FalkorResult {
    header?: string[];
    data?: unknown[][];
    metadata?: string[];
    statistics?: string[];
  }
}

declare module '@ladybugdb/core' {
  export class Database {
    constructor(path: string);
    connect(): Connection;
    close(): void;
  }

  interface Connection {
    execute(cypher: string, params?: Record<string, unknown>): QueryResult;
    close(): void;
  }

  interface QueryResult {
    getColumnNames(): string[];
    getAll(): Record<string, unknown>[];
    header?: string[];
    data?: unknown[][];
    metadata?: string[];
  }
}

declare module 'env-paths' {
  interface EnvPaths {
    data: string;
    config: string;
    cache: string;
    log: string;
    temp: string;
  }

  function envPaths(name: string, options?: { suffix?: string }): EnvPaths;
  export = envPaths;
}

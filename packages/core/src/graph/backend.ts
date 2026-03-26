/**
 * IGraphBackend — internal abstraction for graph database connections.
 *
 * GraphManager delegates connection lifecycle and raw query execution
 * to an IGraphBackend implementation. Three backends exist:
 *
 *   RedisBackend       — FalkorDB via redis client (remote / CV-Hub server)
 *   FalkorDbLiteBackend — FalkorDB embedded via falkordblite (Linux/macOS)
 *   LadybugBackend     — LadybugDB embedded via @ladybugdb/core (Windows)
 *
 * This interface is internal to @cv-git/core and is NOT exported publicly.
 */

export interface IGraphBackend {
  /** Open a connection (or initialize embedded DB). */
  connect(): Promise<void>;

  /** Gracefully close the connection / release resources. */
  close(): Promise<void>;

  /** Health-check ping. Returns true if alive. */
  ping(): Promise<boolean>;

  /**
   * Execute a Cypher query against a named graph.
   *
   * The return value is backend-specific but MUST be normalizable by
   * GraphManager.parseQueryResult(). For FalkorDB-based backends this
   * is the native compact format: [headers, rows, statistics].
   * LadybugBackend normalizes its result into the same shape internally.
   */
  rawQuery(graphName: string, cypher: string): Promise<unknown>;
}

export type BackendType = 'redis' | 'falkordblite' | 'ladybugdb';

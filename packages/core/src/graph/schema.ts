/**
 * Graph schema initialization for LadybugDB.
 *
 * FalkorDB is schema-flexible and creates node/rel types implicitly.
 * LadybugDB requires explicit CREATE NODE TABLE / CREATE REL TABLE statements.
 *
 * This schema is derived from auditing the existing GraphManager code:
 * - Node labels from upsertFileNode, upsertSymbolNode, upsertModuleNode,
 *   upsertCommitNode, upsertDocumentNode, upsertSessionKnowledgeNode,
 *   ensureOwnership, saveBanditState, ensureSchemaVersion
 * - Relationship types from createImportsEdge, createDefinesEdge,
 *   createCallsEdge, createInheritsEdge, createModifiesEdge,
 *   createTouchesEdge, createDescribesEdge, createReferencesDocEdge,
 *   createSupersedesEdge, createAboutFileEdge, createFollowsEdge
 *
 * Run once on first `cv init`. Safe to re-run (IF NOT EXISTS).
 */

import type { BackendType } from './backend.js';

// Node table definitions — properties match what GraphManager actually stores.
// LadybugDB requires a PRIMARY KEY on each node table.
const NODE_TABLES: string[] = [
  `CREATE NODE TABLE IF NOT EXISTS File(
     path STRING, absolutePath STRING, language STRING,
     lastModified INT64, size INT64, gitHash STRING,
     linesOfCode INT64, complexity INT64, ext STRING, name STRING,
     updatedAt INT64,
     PRIMARY KEY (path)
   )`,

  `CREATE NODE TABLE IF NOT EXISTS Symbol(
     qualifiedName STRING, name STRING, kind STRING, file STRING,
     startLine INT64, endLine INT64, signature STRING, docstring STRING,
     doc STRING, returnType STRING, visibility STRING,
     isAsync BOOLEAN, isStatic BOOLEAN, complexity INT64,
     vectorId STRING, vectorIds STRING[],
     src_start INT64, src_end INT64, updatedAt INT64,
     PRIMARY KEY (qualifiedName)
   )`,

  `CREATE NODE TABLE IF NOT EXISTS Module(
     path STRING, name STRING, type STRING, language STRING,
     description STRING, version STRING,
     fileCount INT64, symbolCount INT64, updatedAt INT64,
     PRIMARY KEY (path)
   )`,

  `CREATE NODE TABLE IF NOT EXISTS Commit(
     sha STRING, message STRING, author STRING, authorEmail STRING,
     committer STRING, timestamp INT64, branch STRING,
     filesChanged INT64, insertions INT64, deletions INT64,
     vectorId STRING, createdAt INT64,
     PRIMARY KEY (sha)
   )`,

  `CREATE NODE TABLE IF NOT EXISTS Document(
     path STRING, absolutePath STRING, title STRING,
     type STRING, status STRING, wordCount INT64,
     gitHash STRING, lastModified INT64,
     tags STRING[], priority STRING, author STRING,
     createdAt INT64, updatedAt INT64,
     PRIMARY KEY (path)
   )`,

  `CREATE NODE TABLE IF NOT EXISTS SessionKnowledge(
     sessionId STRING, turnNumber INT64,
     timestamp INT64, summary STRING, concern STRING,
     source STRING, filesTouched STRING[],
     symbolsReferenced STRING[], updatedAt INT64,
     PRIMARY KEY (sessionId)
   )`,

  // Internal metadata nodes
  `CREATE NODE TABLE IF NOT EXISTS _Meta(
     key STRING, version STRING, updatedAt INT64,
     PRIMARY KEY (key)
   )`,

  `CREATE NODE TABLE IF NOT EXISTS CVGitMeta(
     key STRING, repoId STRING, graphName STRING, createdAt INT64,
     PRIMARY KEY (key)
   )`,

  `CREATE NODE TABLE IF NOT EXISTS BanditState(
     id STRING, data STRING, updatedAt INT64,
     PRIMARY KEY (id)
   )`,
];

// Relationship table definitions
const REL_TABLES: string[] = [
  `CREATE REL TABLE IF NOT EXISTS IMPORTS(FROM File TO File, line INT64, importedSymbols STRING[], alias STRING)`,
  `CREATE REL TABLE IF NOT EXISTS DEFINES(FROM File TO Symbol, line INT64)`,
  `CREATE REL TABLE IF NOT EXISTS CALLS(FROM Symbol TO Symbol, line INT64, callCount INT64, isConditional BOOLEAN)`,
  `CREATE REL TABLE IF NOT EXISTS INHERITS(FROM Symbol TO Symbol, type STRING)`,
  `CREATE REL TABLE IF NOT EXISTS MODIFIES(FROM Commit TO File, changeType STRING, linesAdded INT64, linesDeleted INT64)`,
  `CREATE REL TABLE IF NOT EXISTS TOUCHES(FROM Commit TO Symbol, changeType STRING)`,
  `CREATE REL TABLE IF NOT EXISTS DESCRIBES(FROM Document TO File, section STRING, line INT64)`,
  `CREATE REL TABLE IF NOT EXISTS REFERENCES_DOC(FROM Document TO Document, anchor STRING)`,
  `CREATE REL TABLE IF NOT EXISTS SUPERSEDES(FROM Document TO Document)`,
  `CREATE REL TABLE IF NOT EXISTS ABOUT(FROM SessionKnowledge TO File, role STRING)`,
  `CREATE REL TABLE IF NOT EXISTS FOLLOWS(FROM SessionKnowledge TO SessionKnowledge)`,
];

/**
 * Initialize the graph schema for LadybugDB.
 * No-op on FalkorDB backends (both redis and falkordblite).
 *
 * @param backendType - The active backend type
 * @param executeQuery - Function to execute a Cypher/DDL statement
 */
export async function initSchema(
  backendType: BackendType,
  executeQuery: (cypher: string) => Promise<void>,
): Promise<void> {
  if (backendType !== 'ladybugdb') return;

  for (const stmt of [...NODE_TABLES, ...REL_TABLES]) {
    try {
      await executeQuery(stmt);
    } catch (err: any) {
      // Skip "already exists" errors — makes this idempotent
      if (!err.message?.includes('already exists') && !err.message?.includes('duplicate')) {
        console.warn(`[schema] Warning creating table: ${err.message}`);
      }
    }
  }

  if (process.env.CV_DEBUG) {
    console.log('[schema] LadybugDB schema initialized');
  }
}

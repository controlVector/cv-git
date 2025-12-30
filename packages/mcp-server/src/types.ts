/**
 * MCP Server Types
 * Type definitions for CV-Git MCP Server
 */

/**
 * Tool arguments for cv_find
 */
export interface FindArgs {
  query: string;
  limit?: number;
  minScore?: number;
  language?: string;
  file?: string;
}

/**
 * Tool arguments for cv_explain
 */
export interface ExplainArgs {
  target: string;
  noStream?: boolean;
}

/**
 * Tool arguments for cv_graph_query
 */
export interface GraphQueryArgs {
  queryType: 'calls' | 'called-by' | 'imports' | 'exports' | 'functions' | 'classes' | 'files';
  target?: string;
  language?: string;
  file?: string;
}

/**
 * Tool arguments for cv_do
 */
export interface DoArgs {
  task: string;
  planOnly?: boolean;
  autoApprove?: boolean;
}

/**
 * Tool arguments for cv_review
 */
export interface ReviewArgs {
  ref?: string;
  staged?: boolean;
  context?: boolean;
}

/**
 * Tool arguments for cv_sync
 */
export interface SyncArgs {
  incremental?: boolean;
  force?: boolean;
}

/**
 * Tool arguments for cv_pr_create
 */
export interface PRCreateArgs {
  title?: string;
  body?: string;
  base?: string;
  draft?: boolean;
}

/**
 * Tool arguments for cv_pr_list
 */
export interface PRListArgs {
  state?: 'open' | 'closed' | 'all';
  limit?: number;
}

/**
 * Tool arguments for cv_release_create
 */
export interface ReleaseCreateArgs {
  version: string;
  title?: string;
  notes?: string;
  draft?: boolean;
  prerelease?: boolean;
}

/**
 * Tool arguments for cv_config_get
 */
export interface ConfigGetArgs {
  key: string;
}

/**
 * Tool result format
 */
export interface ToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * Search result from cv_find
 */
export interface SearchResult {
  file: string;
  startLine: number;
  endLine: number;
  symbolName?: string;
  language?: string;
  text: string;
  score: number;
  docstring?: string;
}

/**
 * Graph query result
 */
export interface GraphResult {
  nodes: Array<{
    id: string;
    type: string;
    name: string;
    file?: string;
    line?: number;
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: string;
  }>;
}

/**
 * Tool arguments for cv_commits
 */
export interface CommitsArgs {
  limit?: number;
  file?: string;
  author?: string;
}

/**
 * Tool arguments for cv_file_history
 */
export interface FileHistoryArgs {
  file: string;
  limit?: number;
  showDiff?: boolean;
}

/**
 * Tool arguments for cv_blame
 */
export interface BlameArgs {
  target: string;
}

/**
 * Tool arguments for cv_commit_analyze
 */
export interface CommitAnalyzeArgs {
  // No arguments needed - analyzes staged changes
}

/**
 * Tool arguments for cv_commit_generate
 */
export interface CommitGenerateArgs {
  type?: string;   // Override commit type (feat, fix, refactor, etc.)
  scope?: string;  // Override commit scope
}

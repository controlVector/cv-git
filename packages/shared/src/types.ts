/**
 * Shared type definitions for CV-Git
 */

// ========== Graph Types ==========

export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'constant'
  | 'enum'
  | 'struct';

export type Visibility = 'public' | 'private' | 'protected';

export type ChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

export type ImportType = 'default' | 'named' | 'namespace' | 'side-effect';

export interface Range {
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
}

export interface Parameter {
  name: string;
  type?: string;
  default?: string;
  optional?: boolean;
}

export interface CallInfo {
  callee: string;        // Name of called function/method
  line: number;          // Line number of call
  isConditional: boolean; // Inside if/try/catch block
}

// ========== Graph Node Types ==========

export interface FileNode {
  path: string;
  absolutePath: string;
  language: string;
  lastModified: number;
  size: number;
  gitHash: string;
  linesOfCode: number;
  complexity: number;
  createdAt: number;
  updatedAt: number;
}

export interface SymbolNode {
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  file: string;
  startLine: number;
  endLine: number;
  signature?: string;
  docstring?: string;
  returnType?: string;
  parameters?: Parameter[];
  visibility: Visibility;
  isAsync: boolean;
  isStatic: boolean;
  complexity: number;
  vectorId?: string;
  calls?: CallInfo[];      // Functions/methods this symbol calls
  createdAt: number;
  updatedAt: number;
}

export interface ModuleNode {
  name: string;
  path: string;
  type: 'package' | 'namespace' | 'directory';
  language: string;
  description?: string;
  version?: string;
  fileCount: number;
  symbolCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CommitNode {
  sha: string;
  message: string;
  author: string;
  authorEmail: string;
  committer: string;
  timestamp: number;
  branch: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  vectorId?: string;
  createdAt: number;
}

// ========== Document Types ==========

/**
 * Document classification types for markdown files
 * Includes PRD-compatible types and cv-git specific types
 */
export type DocumentType =
  // PRD types (for compatibility with cvPRD)
  | 'technical_spec'
  | 'design_spec'
  | 'user_manual'
  | 'api_doc'
  | 'release_note'
  // cv-git specific types
  | 'roadmap'
  | 'session_notes'
  | 'phase_doc'
  | 'adr'           // Architecture Decision Record
  | 'changelog'
  | 'readme'
  | 'guide'
  | 'tutorial'
  | 'reference'
  | 'unknown';

export type DocumentStatus = 'draft' | 'active' | 'archived' | 'deprecated';

export type DocumentPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * YAML frontmatter structure for markdown documents
 */
export interface DocumentFrontmatter {
  type?: DocumentType;
  status?: DocumentStatus;
  tags?: string[];
  relates_to?: string[];       // Paths to code files or other docs
  priority?: DocumentPriority;
  author?: string;
  created?: string;            // ISO date string
  updated?: string;            // ISO date string
  version?: string;
  custom_fields?: Record<string, unknown>;
}

/**
 * Heading extracted from a markdown document
 */
export interface DocumentHeading {
  level: number;               // 1-6 (h1-h6)
  text: string;                // Heading text content
  line: number;                // Line number in document
  anchor: string;              // URL-friendly slug
}

/**
 * Link extracted from a markdown document
 */
export interface DocumentLink {
  text: string;                // Link display text
  target: string;              // URL or relative path
  line: number;                // Line number in document
  isInternal: boolean;         // Links to files in repo
  isCodeRef: boolean;          // Links to code (e.g., src/foo.ts)
}

/**
 * A section of a markdown document (chunked by heading)
 */
export interface DocumentSection {
  id: string;                  // Format: "doc:path:startLine-endLine"
  heading?: DocumentHeading;
  content: string;
  startLine: number;
  endLine: number;
  links: DocumentLink[];
}

/**
 * Document node for the knowledge graph
 */
export interface DocumentNode {
  path: string;
  absolutePath: string;
  title: string;               // First H1 or filename
  type: DocumentType;
  status: DocumentStatus;
  frontmatter: DocumentFrontmatter;
  headings: DocumentHeading[];
  links: DocumentLink[];
  sections: DocumentSection[];
  wordCount: number;
  gitHash: string;
  lastModified: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Result of parsing a markdown document
 */
export interface ParsedDocument {
  path: string;
  absolutePath: string;
  content: string;
  frontmatter: DocumentFrontmatter;
  headings: DocumentHeading[];
  links: DocumentLink[];
  sections: DocumentSection[];
  inferredType: DocumentType;
}

/**
 * Chunk of a document for vector embedding
 */
export interface DocumentChunk {
  id: string;                  // Format: "doc:file:startLine-endLine"
  file: string;
  startLine: number;
  endLine: number;
  text: string;
  heading?: string;
  headingLevel?: number;
  documentType: DocumentType;
  tags: string[];
}

/**
 * Vector payload for document chunks
 */
export interface DocumentChunkPayload extends VectorPayload {
  documentType: DocumentType;
  heading?: string;
  headingLevel?: number;
  startLine: number;
  endLine: number;
  text: string;
  tags: string[];
  status: DocumentStatus;
  priority?: DocumentPriority;
  lastModified: number;
}

// ========== Graph Edge Types ==========

export interface ImportsEdge {
  line: number;
  importedSymbols: string[];
  alias?: string;
}

export interface DefinesEdge {
  line: number;
}

export interface CallsEdge {
  line: number;
  callCount: number;
  isConditional: boolean;
}

export interface InheritsEdge {
  type: 'extends' | 'implements';
}

export interface ReferencesEdge {
  line: number;
  referenceType: 'read' | 'write' | 'call';
}

export interface ModifiesEdge {
  changeType: ChangeType;
  insertions: number;
  deletions: number;
}

export interface TouchesEdge {
  changeType: ChangeType;
  lineDelta: number;
}

// ========== AST/Parser Types ==========

export interface ParsedFile {
  path: string;
  absolutePath: string;
  language: string;
  content: string;
  symbols: SymbolNode[];
  imports: Import[];
  exports: Export[];
  chunks: CodeChunk[];
}

export interface Import {
  source: string;
  importedSymbols: string[];
  importType: ImportType;
  isExternal: boolean;
  packageName?: string;
  line: number;
}

export interface Export {
  name: string;
  type: 'default' | 'named';
  line: number;
}

export interface CodeChunk {
  id: string; // Format: "file:startLine:endLine"
  file: string;
  language: string;
  startLine: number;
  endLine: number;
  text: string;
  symbolName?: string;
  symbolKind?: SymbolKind;
  summary?: string;
  docstring?: string;
  complexity?: number;
}

// ========== Vector Types ==========

export interface VectorPayload {
  id: string;
  file: string;
  language: string;
  [key: string]: any;
}

export interface VectorSearchResult<T extends VectorPayload = VectorPayload> {
  id: string;
  score: number;
  payload: T;
}

export interface CodeChunkPayload extends VectorPayload {
  symbolName?: string;
  symbolKind?: SymbolKind;
  startLine: number;
  endLine: number;
  text: string;
  summary?: string;
  docstring?: string;
  imports: string[];
  complexity?: number;
  lastModified: number;
}

export interface DocstringPayload extends VectorPayload {
  symbolName: string;
  symbolKind: SymbolKind;
  text: string;
  signature?: string;
  parameters: Parameter[];
}

export interface CommitPayload extends VectorPayload {
  sha: string;
  message: string;
  author: string;
  timestamp: number;
  filesChanged: string[];
  symbolsChanged: string[];
}

// ========== AI/LLM Types ==========

export interface Context {
  chunks: VectorSearchResult<CodeChunkPayload>[];
  symbols: SymbolNode[];
  files: FileNode[];
  commits?: CommitNode[];
  workingTreeStatus?: WorkingTreeStatus;
  prdContext?: any; // PRD context from cvPRD (AIContext type)
}

export interface Plan {
  task: string;
  steps: PlanStep[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  affectedFiles: string[];
  risks?: string[];
}

export interface PlanStep {
  description: string;
  type: 'create' | 'modify' | 'delete' | 'rename';
  file: string;
  details?: string;
}

export interface Diff {
  file: string;
  type: ChangeType;
  oldContent?: string;
  newContent?: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  context?: Partial<Context>;
}

export interface ChatSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  branch: string;
  commitAtStart: string;
  messages: ChatMessage[];
  metadata: {
    totalMessages: number;
    tokensUsed: number;
    cost: number;
  };
}

// ========== Git Types ==========

export interface WorkingTreeStatus {
  modified: string[];
  added: string[];
  deleted: string[];
  renamed: Array<{ from: string; to: string }>;
  untracked: string[];
  staged: string[];
}

export interface GitCommit {
  sha: string;
  message: string;
  author: string;
  authorEmail: string;
  date: number;
  files: string[];
}

export interface GitDiff {
  file: string;
  insertions: number;
  deletions: number;
  changes: string;
}

// ========== Workspace Types ==========

/**
 * Workspace configuration for multi-repo setups
 * Stored in .cv/workspace.json at the workspace root
 */
export interface CVWorkspace {
  version: string;
  name: string;
  /** Workspace root directory (absolute path) */
  root: string;
  /** List of repositories in this workspace */
  repos: WorkspaceRepo[];
  /** When the workspace was created */
  createdAt: string;
  /** Last time workspace was synced */
  lastSyncedAt?: string;
  /** Graph database name for this workspace */
  graphDatabase: string;
}

export interface WorkspaceRepo {
  /** Repo name (directory name) */
  name: string;
  /** Relative path from workspace root */
  path: string;
  /** Absolute path to the repo */
  absolutePath: string;
  /** Whether this repo has been synced */
  synced: boolean;
  /** Last commit that was synced */
  lastSyncedCommit?: string;
  /** Primary language detected */
  primaryLanguage?: string;
}

// ========== Config Types ==========

export interface CVConfig {
  version: string;
  repository: {
    root: string;
    name: string;
    initDate: string;
  };
  llm: {
    provider: 'anthropic' | 'openai' | 'ollama';
    model: string;
    apiKey?: string;
    maxTokens: number;
    temperature: number;
  };
  // Alias for llm (for backward compatibility)
  ai: {
    provider: 'anthropic' | 'openai' | 'ollama';
    model: string;
    apiKey?: string;
    maxTokens: number;
    temperature: number;
  };
  embedding: {
    provider: 'openrouter' | 'openai' | 'ollama';
    model: string;
    apiKey?: string;
    url?: string;
    dimensions: number;
  };
  graph: {
    provider: 'falkordb';
    url: string;
    embedded: boolean;
    database: string;
  };
  vector: {
    provider: 'qdrant' | 'chroma';
    url: string;
    embedded: boolean;
    collections: {
      codeChunks: string;
      docstrings: string;
      commits: string;
      documentChunks: string;
    };
  };
  sync: {
    autoSync: boolean;
    syncOnCommit: boolean;
    excludePatterns: string[];
    includeLanguages: string[];
  };
  docs: {
    enabled: boolean;
    patterns: string[];
    excludePatterns: string[];
    chunkByHeading: 1 | 2 | 3;
    inferTypes: boolean;
  };
  features: {
    enableChat: boolean;
    enableAutoCommit: boolean;
    enableTelemetry: boolean;
  };
  cvprd?: {
    url: string;
    apiKey?: string;
    enabled?: boolean;
  };
}

export interface SyncState {
  lastFullSync?: number;
  lastIncrementalSync?: number;
  lastCommitSynced?: string;
  fileCount: number;
  symbolCount: number;
  nodeCount: number;
  edgeCount: number;
  vectorCount: number;
  languages: Record<string, number>;
  syncDuration?: number;
  errors: string[];
  // Document sync state
  documentCount?: number;
  documentSectionCount?: number;
  documentVectorCount?: number;
}

// ========== Error Types ==========

export class CVError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'CVError';
  }
}

export class GitError extends CVError {
  constructor(message: string, details?: any) {
    super(message, 'GIT_ERROR', details);
    this.name = 'GitError';
  }
}

export class GraphError extends CVError {
  constructor(message: string, details?: any) {
    super(message, 'GRAPH_ERROR', details);
    this.name = 'GraphError';
  }
}

export class VectorError extends CVError {
  constructor(message: string, details?: any) {
    super(message, 'VECTOR_ERROR', details);
    this.name = 'VectorError';
  }
}

export class AIError extends CVError {
  constructor(message: string, details?: any) {
    super(message, 'AI_ERROR', details);
    this.name = 'AIError';
  }
}

export class ConfigError extends CVError {
  constructor(message: string, details?: any) {
    super(message, 'CONFIG_ERROR', details);
    this.name = 'ConfigError';
  }
}

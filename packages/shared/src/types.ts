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
  vectorId?: string;       // Primary chunk ID (backwards compat)
  vectorIds?: string[];    // All chunk IDs for this symbol
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

// ========== Hierarchical Summary Types ==========

/**
 * Hierarchy level for summaries
 * 0: Code chunks (raw code, existing)
 * 1: Symbol summary (function/class summary)
 * 2: File summary (aggregated symbol summaries)
 * 3: Directory summary (aggregated file summaries)
 * 4: Repo summary (codebase overview)
 */
export type HierarchyLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Payload for hierarchical summaries stored in vector DB
 */
export interface HierarchicalSummaryPayload extends VectorPayload {
  /** Unique ID: chunk:{file}:{line}, symbol:{qn}, file:{path}, dir:{path}, repo:{id} */
  id: string;
  /** Hierarchy level (0-4) */
  level: HierarchyLevel;
  /** Path or qualified name depending on level */
  path: string;
  /** Parent summary ID (e.g., file summary for a symbol) */
  parent?: string;
  /** Child summary IDs (e.g., symbols in a file) */
  children?: string[];
  /** LLM-generated or aggregated summary text */
  summary: string;
  /** Keywords extracted from the summary */
  keywords: string[];
  /** Content hash for cache invalidation */
  contentHash: string;
  /** Symbol kind (for level 1) */
  symbolKind?: SymbolKind;
  /** Number of symbols (for level 2+) */
  symbolCount?: number;
  /** Number of files (for level 3+) */
  fileCount?: number;
  /** Languages present (for level 2+) */
  languages?: string[];
  /** Last modification timestamp */
  lastModified: number;
}

/**
 * Options for hierarchical summary generation
 */
export interface HierarchicalSummaryOptions {
  /** Maximum symbols per file to summarize (default: 50) */
  maxSymbolsPerFile?: number;
  /** Maximum files per directory to summarize (default: 100) */
  maxFilesPerDirectory?: number;
  /** Whether to skip unchanged content (default: true) */
  skipUnchanged?: boolean;
  /** LLM model to use for summarization */
  model?: string;
  /** Maximum tokens for summaries */
  maxTokens?: number;
}

/**
 * Result of summary generation
 */
export interface SummaryGenerationResult {
  /** Number of summaries generated */
  count: number;
  /** Summaries by level */
  byLevel: Record<HierarchyLevel, number>;
  /** Number skipped (unchanged) */
  skipped: number;
  /** Errors encountered */
  errors: string[];
}

// ========== Traversal Types ==========

/**
 * Position in the codebase during traversal
 */
export interface TraversalPosition {
  /** Current file path */
  file?: string;
  /** Current symbol qualified name */
  symbol?: string;
  /** Current module/directory path */
  module?: string;
  /** Depth in hierarchy (0 = repo level) */
  depth: number;
  /** Last updated timestamp */
  timestamp: number;
}

/**
 * Direction for traversal navigation
 */
export type TraversalDirection = 'in' | 'out' | 'lateral' | 'jump' | 'stay';

/**
 * Arguments for the traverse_context tool
 */
export interface TraverseContextArgs {
  /** Target file path */
  file?: string;
  /** Target symbol name */
  symbol?: string;
  /** Target module/directory */
  module?: string;
  /** Navigation direction */
  direction: TraversalDirection;
  /** Session ID for stateful navigation */
  sessionId?: string;
  /** Include callers in context */
  includeCallers?: boolean;
  /** Include callees in context */
  includeCallees?: boolean;
  /** Include semantically related symbols */
  includeRelated?: boolean;
  /** Output format */
  format?: 'xml' | 'markdown' | 'json';
  /** Token budget for context */
  budget?: number;
}

/**
 * Result from traversal with context
 */
export interface TraversalContextResult {
  /** Current position after navigation */
  position: TraversalPosition;
  /** Session ID */
  sessionId: string;
  /** Context at current position */
  context: {
    /** Summary for current level */
    summary?: string;
    /** Code content (for symbol level) */
    code?: string;
    /** List of files (for module level) */
    files?: Array<{ path: string; summary?: string }>;
    /** List of symbols (for file level) */
    symbols?: Array<{ name: string; kind: SymbolKind; summary?: string }>;
    /** Callers of current symbol */
    callers?: Array<{ name: string; file: string }>;
    /** Callees of current symbol */
    callees?: Array<{ name: string; file: string }>;
    /** Import relationships */
    imports?: string[];
    /** Semantically related symbols (based on vector similarity) */
    relatedSymbols?: Array<{ name: string; file: string; score: number; summary?: string }>;
  };
  /** Navigation hints for next steps */
  hints: string[];
}

/**
 * Session state for traversal
 */
export interface TraversalSession {
  /** Unique session ID */
  id: string;
  /** Current position */
  position: TraversalPosition;
  /** Navigation history */
  history: TraversalPosition[];
  /** Created timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
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

// ========== Dependency Management Types ==========

/**
 * Supported build systems
 */
export type BuildSystem =
  | 'cmake'
  | 'meson'
  | 'scons'
  | 'autotools'
  | 'make'
  | 'npm'
  | 'pip'
  | 'cargo'
  | 'go'
  | 'gradle'
  | 'maven'
  | 'bazel'
  | 'unknown';

/**
 * Supported package managers for system dependencies
 */
export type PackageManager =
  | 'apt'
  | 'yum'
  | 'dnf'
  | 'pacman'
  | 'brew'
  | 'port'
  | 'apk'
  | 'zypper'
  | 'pkg'
  | 'choco'
  | 'scoop'
  | 'unknown';

/**
 * Dependency status
 */
export type DependencyStatus =
  | 'found'
  | 'not_found'
  | 'version_mismatch'
  | 'unknown';

/**
 * Where the dependency was detected from
 */
export type DependencySource =
  | 'cmake_find_package'
  | 'cmake_pkg_config'
  | 'meson_dependency'
  | 'meson_find_library'
  | 'meson_find_program'
  | 'autotools_check_lib'
  | 'autotools_pkg_check'
  | 'autoconf_check'
  | 'scons_configure'
  | 'bazel_bzlmod'
  | 'bazel_http_archive'
  | 'bazel_http_file'
  | 'bazel_git_repository'
  | 'bazel_new_git_repository'
  | 'bazel_local_repository'
  | 'bazel_new_local_repository'
  | 'pkg_config'
  | 'header_include'
  | 'linker_flag'
  | 'npm_package'
  | 'pip_requirement'
  | 'cargo_dependency'
  | 'go_module'
  | 'manual';

/**
 * A detected build dependency
 */
export interface BuildDependency {
  /** Dependency name as referenced in build system */
  name: string;

  /** Type of dependency */
  type: 'library' | 'tool' | 'header' | 'package' | 'module';

  /** Whether this dependency is required or optional */
  required: boolean;

  /** Version constraint (e.g., ">=1.0.0", "^2.0") */
  versionConstraint?: string;

  /** Where this dependency was detected */
  source: DependencySource;

  /** File where dependency was declared */
  sourceFile: string;

  /** Line number in source file */
  sourceLine?: number;

  /** Current status on system */
  status?: DependencyStatus;

  /** Installed version if found */
  installedVersion?: string;

  /** pkg-config name if different from dependency name */
  pkgConfigName?: string;

  /** CMake package name if different */
  cmakeName?: string;

  /** System package names by package manager */
  systemPackages?: Partial<Record<PackageManager, string>>;

  /** Header files to check for */
  headers?: string[];

  /** Library files to check for */
  libraries?: string[];
}

/**
 * Detected build system in a project
 */
export interface DetectedBuildSystem {
  /** Type of build system */
  type: BuildSystem;

  /** Primary build file */
  primaryFile: string;

  /** All related build files */
  buildFiles: string[];

  /** Confidence score (0-1) */
  confidence: number;

  /** Version of build system if detectable */
  version?: string;
}

/**
 * Result of dependency analysis
 */
export interface DependencyAnalysis {
  /** Detected build systems */
  buildSystems: DetectedBuildSystem[];

  /** All detected dependencies */
  dependencies: BuildDependency[];

  /** Required dependencies (filtered) */
  requiredDependencies?: BuildDependency[];

  /** Optional dependencies (filtered) */
  optionalDependencies?: BuildDependency[];

  /** System information */
  system?: {
    platform: NodeJS.Platform;
    arch: string;
    packageManager?: PackageManager;
  };

  /** Summary statistics */
  summary?: {
    total: number;
    found: number;
    missing: number;
    versionMismatch: number;
    unknown: number;
  };

  /** Generated install commands */
  installCommands?: string[];

  /** Analysis timestamp (ISO string or Unix timestamp) */
  analyzedAt: string | number;
}

/**
 * Package mapping for a dependency
 */
export interface PackageMapping {
  /** Canonical name */
  name: string;

  /** Alternative names (pkg-config, cmake, etc.) */
  aliases: string[];

  /** System packages by package manager */
  packages: Partial<Record<PackageManager, string | string[]>>;

  /** Header files that indicate presence */
  headers?: string[];

  /** Library files that indicate presence */
  libraries?: string[];

  /** pkg-config module name */
  pkgConfig?: string;

  /** CMake find_package name */
  cmake?: string;

  /** Description */
  description?: string;
}

/**
 * System package availability information
 */
export interface SystemPackageInfo {
  /** Package/dependency name */
  name: string;

  /** Whether package is available on system */
  available: boolean;

  /** Installed version if available */
  version?: string;

  /** How availability was determined */
  source: 'pkg_config' | 'library_file' | 'header_file' | 'path' | 'unknown';

  /** Installation path if found */
  installPath?: string;

  /** pkg-config module name */
  pkgConfigName?: string;
}

/**
 * CV Code - Type Definitions
 *
 * Core data structures for the AI coding assistant
 */

import { SymbolKind } from '@cv-git/shared';

// ============================================================================
// Session Types
// ============================================================================

/**
 * A coding session with conversation history and edit tracking
 */
export interface CodeSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  repoRoot: string;
  branch: string;
  commitAtStart: string;

  /** Conversation history */
  messages: CodeMessage[];

  /** Active context (files/symbols being worked on) */
  activeContext: ActiveContext;

  /** Pending edits awaiting confirmation */
  pendingEdits: Edit[];

  /** Applied edits (for undo) */
  appliedEdits: EditResult[];

  /** Session metadata */
  metadata: SessionMetadata;
}

export interface SessionMetadata {
  totalTokens: number;
  totalEdits: number;
  filesModified: string[];
}

/**
 * A message in the conversation
 */
export interface CodeMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;

  /** Context snapshot included with this message */
  contextSnapshot?: ContextSnapshot;

  /** Edits extracted from assistant response */
  extractedEdits?: Edit[];
}

// ============================================================================
// Context Types
// ============================================================================

/**
 * Active context being worked on
 */
export interface ActiveContext {
  /** Files explicitly added by user (/add command) */
  explicitFiles: string[];

  /** Files discovered through search/graph */
  discoveredFiles: string[];

  /** Symbols being worked on */
  activeSymbols: string[];

  /** Current token count */
  tokenCount: number;

  /** Max tokens before localization */
  tokenLimit: number;
}

/**
 * Snapshot of context included in a message
 */
export interface ContextSnapshot {
  /** Full file contents (explicit files) */
  files: FileContext[];

  /** Code symbols from search/graph */
  symbols: SymbolContext[];

  /** Relationships between symbols */
  relationships: Relationship[];

  /** Total estimated tokens */
  tokenCount: number;
}

/**
 * File content context
 */
export interface FileContext {
  path: string;
  content: string;
  startLine?: number;
  endLine?: number;
  relevanceScore: number;
  source: 'explicit' | 'vector' | 'graph' | 'dependency' | 'related' | 'fallback';
}

/**
 * Symbol context from vector/graph search
 */
export interface SymbolContext {
  name: string;
  qualifiedName: string;
  file: string;
  kind: SymbolKind | string;
  code: string;
  startLine?: number;
  endLine?: number;
  docstring?: string;
  signature?: string;
  relevanceScore: number;
}

/**
 * Relationship between symbols
 */
export interface Relationship {
  from: string;
  to: string;
  type: 'calls' | 'imports' | 'implements' | 'extends' | 'defines' | 'uses';
}

// ============================================================================
// Edit Types
// ============================================================================

/**
 * An edit to be applied to a file
 */
export interface Edit {
  id: string;
  file: string;
  type: 'create' | 'modify' | 'delete' | 'rename';

  /** Original content (for modifications) */
  originalContent?: string;

  /** New content (for create/full replace) */
  newContent?: string;

  /** Search/replace blocks for partial edits */
  searchReplaceBlocks?: SearchReplaceBlock[];

  /** New path for renames */
  newPath?: string;

  /** Edit status */
  status: 'pending' | 'approved' | 'applied' | 'rejected';

  /** Description of the change */
  description?: string;

  /** ID of the message that generated this edit */
  messageId: string;

  /** Timestamp */
  createdAt: number;
}

/**
 * A search/replace block within a file edit
 */
export interface SearchReplaceBlock {
  /** Exact text to search for */
  search: string;

  /** Text to replace with */
  replace: string;

  /** Optional line hints for disambiguation */
  startLine?: number;
  endLine?: number;
}

/**
 * Result of applying an edit
 */
export interface EditResult {
  edit: Edit;
  success: boolean;
  error?: string;

  /** Path to backup file (for revert) */
  backupPath?: string;

  /** Timestamp of application */
  appliedAt?: number;
}

// ============================================================================
// Options Types
// ============================================================================

/**
 * Options for the code command
 */
export interface CodeOptions {
  /** AI model to use */
  model?: string;

  /** Auto-apply edits without confirmation */
  yes?: boolean;

  /** Architect mode (design before code) */
  architect?: boolean;

  /** Max context tokens */
  contextLimit?: number;

  /** Disable automatic context */
  noContext?: boolean;

  /** Files to explicitly include */
  files?: string[];

  /** Resume a previous session */
  resumeSession?: string;

  /** Output options */
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}

/**
 * Options for context building
 */
export interface ContextOptions {
  /** Max code chunks from vector search */
  maxChunks?: number;

  /** Max graph traversal depth */
  maxDepth?: number;

  /** Min relevance score (0-1) */
  minScore?: number;

  /** Symbols to focus on */
  focusSymbols?: string[];
}

// ============================================================================
// Assistant Types
// ============================================================================

/**
 * Result of processing a user message
 */
export interface ProcessResult {
  /** Full AI response */
  response: string;

  /** Edits extracted from response */
  edits: Edit[];

  /** Context that was used */
  contextSnapshot: ContextSnapshot;
}

/**
 * Status phases for progress reporting
 */
export type CodePhase =
  | 'searching'    // Searching codebase for context
  | 'thinking'     // Waiting for AI to start responding
  | 'generating'   // AI is streaming response
  | 'parsing'      // Parsing edits from response
  | 'done';        // Processing complete

/**
 * Callbacks for streaming and events
 */
export interface CodeCallbacks {
  /** Called for each streamed token */
  onToken?: (token: string) => void;

  /** Called when response is complete */
  onComplete?: (response: string) => void;

  /** Called when an edit is extracted */
  onEdit?: (edit: Edit) => void;

  /** Called on error */
  onError?: (error: Error) => void;

  /** Called when processing phase changes */
  onStatus?: (phase: CodePhase, message?: string) => void;
}

// ============================================================================
// Diff Display Types
// ============================================================================

/**
 * A unified diff hunk for display
 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

/**
 * A single line in a diff
 */
export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

/**
 * File diff for display
 */
export interface FileDiff {
  path: string;
  type: 'create' | 'modify' | 'delete' | 'rename';
  hunks: DiffHunk[];
  newPath?: string;
}

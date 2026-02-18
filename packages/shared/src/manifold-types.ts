/**
 * Context Manifold Types
 *
 * The manifold unifies 9 dimensions of development context into a single
 * queryable state. It stores metadata and pointers, not content.
 */

// ========== Dimension Kinds ==========

export type DimensionKind =
  | 'structural'
  | 'semantic'
  | 'temporal'
  | 'requirements'
  | 'summary'
  | 'navigational'
  | 'session'
  | 'intent'
  | 'impact';

export const ALL_DIMENSIONS: DimensionKind[] = [
  'structural', 'semantic', 'temporal', 'requirements', 'summary',
  'navigational', 'session', 'intent', 'impact'
];

// ========== Per-Dimension State Interfaces ==========

/** Dimension 1: Structural (calls, inherits) — from FalkorDB graph */
export interface StructuralState {
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  hubSymbols: string[];       // Top-connected symbols
  lastUpdated: number;
}

/** Dimension 2: Semantic (code similarity) — from Qdrant vectors */
export interface SemanticState {
  collectionSize: number;     // Points in code_chunks collection
  embeddingModel: string;
  lastUpdated: number;
}

/** Dimension 3: Temporal (git history, hot files) — from git + graph */
export interface TemporalState {
  recentCommits: Array<{
    sha: string;
    message: string;
    author: string;
    timestamp: string;
    filesChanged: number;
  }>;
  hotFiles: Array<{           // Files changed most in recent history
    path: string;
    changeCount: number;
    lastModified: string;
  }>;
  lastUpdated: number;
}

/** Dimension 4: Requirements (PRD) — from PRD context */
export interface RequirementsState {
  prdCount: number;
  chunkCount: number;
  implementationLinks: number;
  lastUpdated: number;
}

/** Dimension 5: Summary (pre-generated docs) — from Qdrant summaries */
export interface SummaryState {
  summaryCount: number;
  byLevel: Record<number, number>;  // level -> count
  hasCachedSummaries: boolean;
  lastUpdated: number;
}

/** Dimension 6: Navigational (traversal state) — from sessions */
export interface NavigationalState {
  activeSessions: Array<{
    sessionId: string;
    currentLevel: string;     // 'repo' | 'module' | 'file' | 'symbol'
    currentTarget?: string;
    lastActivity: number;
  }>;
  lastUpdated: number;
}

/** Dimension 7: Session (active dev state) — from git status, working tree */
export interface DevSessionState {
  modifiedFiles: string[];
  stagedFiles: string[];
  untrackedFiles: string[];
  currentBranch: string;
  symbolsInModifiedFiles: string[];
  lastUpdated: number;
}

/** Dimension 8: Intent (why changes happen) — from commit messages, branch names */
export interface IntentState {
  branchIntent?: {
    type: string;             // 'feat', 'fix', 'refactor', etc.
    description: string;
    raw: string;
  };
  recentIntents: Array<{
    type: string;
    scope?: string;
    description: string;
    sha: string;
  }>;
  lastUpdated: number;
}

/** Dimension 9: Impact (change surface) — from cv_graph_impact */
export interface ImpactState {
  changedSymbols: string[];
  affectedCallers: string[];
  riskLevel: 'low' | 'medium' | 'high';
  lastUpdated: number;
}

// ========== Top-Level Manifold State ==========

export interface ManifoldState {
  version: number;
  repoId: string;
  createdAt: number;
  lastRefreshed: number;

  dimensions: {
    structural: StructuralState;
    semantic: SemanticState;
    temporal: TemporalState;
    requirements: RequirementsState;
    summary: SummaryState;
    navigational: NavigationalState;
    session: DevSessionState;
    intent: IntentState;
    impact: ImpactState;
  };
}

// ========== Query Types ==========

/** Relevance signal for a single dimension */
export interface DimensionSignal {
  dimension: DimensionKind;
  score: number;              // 0-1 relevance score
  tokenBudget: number;        // Allocated tokens
  refs: string[];             // Pointers into underlying stores
  available: boolean;         // Whether dimension has data
}

/** Result from manifold context assembly */
export interface ManifoldContextResult {
  query: string;
  format: string;
  totalTokens: number;
  dimensions: DimensionSignal[];
  context: string;            // The assembled context string
  metadata: {
    generatedAt: string;
    manifoldVersion: number;
    dimensionsUsed: DimensionKind[];
    fallback: boolean;        // True if fell back to non-manifold path
  };
}

/** Per-dimension health status */
export type DimensionHealth = 'active' | 'stale' | 'missing' | 'unavailable';

/** Overall manifold health report */
export interface ManifoldHealth {
  overall: 'healthy' | 'degraded' | 'unavailable';
  dimensions: Record<DimensionKind, {
    status: DimensionHealth;
    lastUpdated: number | null;
    details?: string;
  }>;
  stateFile: {
    exists: boolean;
    sizeBytes: number;
    path: string;
  };
}

/** Default dimension base weights */
export const DEFAULT_DIMENSION_WEIGHTS: Record<DimensionKind, number> = {
  semantic: 0.25,
  structural: 0.20,
  summary: 0.15,
  session: 0.10,
  temporal: 0.10,
  navigational: 0.05,
  requirements: 0.05,
  intent: 0.05,
  impact: 0.05,
};

/** Options for manifold context assembly */
export interface ManifoldAssembleOptions {
  format?: 'xml' | 'markdown' | 'json';
  budget?: number;
  weights?: Partial<Record<DimensionKind, number>>;
  currentFile?: string;
  sessionId?: string;
  includeDimensions?: DimensionKind[];
  excludeDimensions?: DimensionKind[];
}

/**
 * Context Manifold Service
 *
 * Coordination layer that unifies 9 dimensions of development context
 * into a single queryable state persisted in .cv/manifold/state.json.
 *
 * The manifold stores metadata and pointers, not content. No LLM calls —
 * heuristic scoring only (keyword matching, frequency, staleness).
 */

import {
  ManifoldState,
  ManifoldHealth,
  ManifoldContextResult,
  ManifoldAssembleOptions,
  DimensionKind,
  DimensionSignal,
  DimensionHealth,
  StructuralState,
  SemanticState,
  TemporalState,
  RequirementsState,
  SummaryState,
  NavigationalState,
  DevSessionState,
  IntentState,
  ImpactState,
  ALL_DIMENSIONS,
  DEFAULT_DIMENSION_WEIGHTS,
} from '@cv-git/shared';
import { withLock } from '../sync/file-lock.js';
import { promises as fs } from 'fs';
import * as path from 'path';

/** Staleness threshold: 10 minutes */
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

/** Conventional commit regex */
const CONVENTIONAL_COMMIT_RE = /^(feat|fix|refactor|docs|test|chore|style|perf|build|ci|revert)(?:\(([^)]+)\))?!?:\s*(.+)/;

/** Branch intent regex */
const BRANCH_INTENT_RE = /^(feat|fix|refactor|hotfix|release|chore|docs|test)[/\-_](.+)/;

export interface ManifoldServiceDeps {
  repoRoot: string;
  repoId: string;
  graph?: any;     // GraphManager — optional
  vector?: any;    // VectorManager — optional
  git?: any;       // GitManager — optional
  session?: any;   // SessionService — optional
}

export class ManifoldService {
  private state: ManifoldState | null = null;
  private deps: ManifoldServiceDeps;
  private statePath: string;
  private stateDir: string;

  constructor(deps: ManifoldServiceDeps) {
    this.deps = deps;
    this.stateDir = path.join(deps.repoRoot, '.cv', 'manifold');
    this.statePath = path.join(this.stateDir, 'state.json');
  }

  // ========== Lifecycle ==========

  async initialize(): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });

    try {
      const data = await fs.readFile(this.statePath, 'utf-8');
      this.state = JSON.parse(data) as ManifoldState;
    } catch {
      // Create fresh state
      this.state = this.createFreshState();
    }
  }

  async save(): Promise<void> {
    if (!this.state) return;

    await withLock(this.statePath, async () => {
      const tmpPath = this.statePath + '.tmp';
      await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2));
      await fs.rename(tmpPath, this.statePath);
    }, { timeout: 5000, staleTimeout: 10000 });
  }

  async close(): Promise<void> {
    await this.save();
    this.state = null;
  }

  getState(): ManifoldState | null {
    return this.state;
  }

  // ========== Dimension Updates ==========

  async updateStructural(): Promise<void> {
    if (!this.state || !this.deps.graph) return;

    try {
      const stats = await this.deps.graph.getStats();

      // Get hub symbols (most connected)
      let hubSymbols: string[] = [];
      try {
        const hotspots = await this.deps.graph.getHotspots?.(5);
        if (hotspots) {
          hubSymbols = hotspots.map((h: any) => h.name || h.qualifiedName).filter(Boolean);
        }
      } catch {
        // Hotspots not available
      }

      this.state.dimensions.structural = {
        fileCount: stats.fileCount || 0,
        symbolCount: stats.symbolCount || 0,
        edgeCount: stats.relationshipCount || stats.edgeCount || 0,
        hubSymbols,
        lastUpdated: Date.now(),
      };
    } catch {
      // Graph unavailable
    }
  }

  async updateSemantic(): Promise<void> {
    if (!this.state || !this.deps.vector) return;

    try {
      const collections = this.deps.vector.getCollectionNames();
      let collectionSize = 0;
      try {
        const info = await this.deps.vector.getCollectionInfo(collections.codeChunks);
        collectionSize = info?.points_count || 0;
      } catch {
        // Collection may not exist
      }

      const embeddingInfo = this.deps.vector.getEmbeddingInfo();

      this.state.dimensions.semantic = {
        collectionSize,
        embeddingModel: embeddingInfo?.model || 'unknown',
        lastUpdated: Date.now(),
      };
    } catch {
      // Vector unavailable
    }
  }

  async updateTemporal(): Promise<void> {
    if (!this.state || !this.deps.git) return;

    try {
      const commits = await this.deps.git.getRecentCommits(20);

      // Count file changes to find hot files
      const fileChangeCounts = new Map<string, { count: number; lastModified: string }>();

      for (const commit of commits.slice(0, 10)) {
        try {
          const detailed = await this.deps.git.getCommit(commit.sha);
          for (const file of detailed.files || []) {
            const existing = fileChangeCounts.get(file) || { count: 0, lastModified: commit.date };
            existing.count++;
            fileChangeCounts.set(file, existing);
          }
        } catch {
          // Skip commits we can't read
        }
      }

      const hotFiles = [...fileChangeCounts.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([filePath, info]) => ({
          path: filePath,
          changeCount: info.count,
          lastModified: info.lastModified,
        }));

      this.state.dimensions.temporal = {
        recentCommits: commits.slice(0, 10).map((c: any) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          timestamp: c.date,
          filesChanged: 0, // Will be enriched if available
        })),
        hotFiles,
        lastUpdated: Date.now(),
      };
    } catch {
      // Git unavailable
    }
  }

  async updateRequirements(): Promise<void> {
    if (!this.state || !this.deps.graph) return;

    try {
      let prdCount = 0;
      let chunkCount = 0;
      let implementationLinks = 0;

      try {
        const prdResult = await this.deps.graph.query('MATCH (p:PRD) RETURN count(p) as c');
        prdCount = prdResult?.[0]?.c || 0;
      } catch { /* PRDs may not exist */ }

      try {
        const chunkResult = await this.deps.graph.query('MATCH (c:Chunk) RETURN count(c) as c');
        chunkCount = chunkResult?.[0]?.c || 0;
      } catch { /* Chunks may not exist */ }

      try {
        const linkResult = await this.deps.graph.query('MATCH ()-[r:IMPLEMENTS]->() RETURN count(r) as c');
        implementationLinks = linkResult?.[0]?.c || 0;
      } catch { /* Links may not exist */ }

      this.state.dimensions.requirements = {
        prdCount,
        chunkCount,
        implementationLinks,
        lastUpdated: Date.now(),
      };
    } catch {
      // Graph unavailable
    }
  }

  async updateSummary(): Promise<void> {
    if (!this.state) return;

    try {
      let summaryCount = 0;
      const byLevel: Record<number, number> = {};

      if (this.deps.vector) {
        try {
          const collections = this.deps.vector.getCollectionNames();
          const info = await this.deps.vector.getCollectionInfo(collections.summaries);
          summaryCount = info?.points_count || 0;
        } catch {
          // Summaries collection may not exist
        }
      }

      // Check for codebase-summary.json
      let hasCachedSummaries = false;
      try {
        await fs.access(path.join(this.deps.repoRoot, '.cv', 'codebase-summary.json'));
        hasCachedSummaries = true;
      } catch {
        // No cached summary
      }

      this.state.dimensions.summary = {
        summaryCount,
        byLevel,
        hasCachedSummaries,
        lastUpdated: Date.now(),
      };
    } catch {
      // Unavailable
    }
  }

  async updateNavigational(sessionId?: string): Promise<void> {
    if (!this.state) return;

    const activeSessions: NavigationalState['activeSessions'] = [];

    if (this.deps.session) {
      try {
        const sessions = await this.deps.session.listSessions?.();
        if (sessions) {
          for (const s of sessions) {
            activeSessions.push({
              sessionId: s.id || s.sessionId,
              currentLevel: s.position?.level || 'repo',
              currentTarget: s.position?.target,
              lastActivity: s.lastActivity || Date.now(),
            });
          }
        }
      } catch {
        // Session service unavailable
      }
    }

    this.state.dimensions.navigational = {
      activeSessions,
      lastUpdated: Date.now(),
    };
  }

  async updateDevSession(): Promise<void> {
    if (!this.state || !this.deps.git) return;

    try {
      let modifiedFiles: string[] = [];
      let stagedFiles: string[] = [];
      let untrackedFiles: string[] = [];
      let currentBranch = 'unknown';

      try {
        currentBranch = await this.deps.git.getCurrentBranch();
      } catch { /* Detached HEAD */ }

      try {
        const status = await this.deps.git.getStatus?.();
        if (status) {
          modifiedFiles = status.modified || [];
          stagedFiles = status.staged || [];
          untrackedFiles = status.not_added || status.untracked || [];
        }
      } catch {
        // Status not available, try diff
        try {
          const diffs = await this.deps.git.getDiff?.('HEAD');
          if (diffs) {
            modifiedFiles = diffs.map((d: any) => d.file);
          }
        } catch { /* No diffs available */ }
      }

      // Find symbols in modified files
      let symbolsInModifiedFiles: string[] = [];
      if (this.deps.graph && modifiedFiles.length > 0) {
        for (const file of modifiedFiles.slice(0, 10)) {
          try {
            const results = await this.deps.graph.query(
              `MATCH (f:File {path: '${file}'})-[:DEFINES]->(s:Symbol) RETURN s.name as name LIMIT 10`
            );
            symbolsInModifiedFiles.push(...results.map((r: any) => r.name));
          } catch { /* Skip */ }
        }
      }

      this.state.dimensions.session = {
        modifiedFiles,
        stagedFiles,
        untrackedFiles,
        currentBranch,
        symbolsInModifiedFiles,
        lastUpdated: Date.now(),
      };
    } catch {
      // Git unavailable
    }
  }

  async updateIntent(): Promise<void> {
    if (!this.state || !this.deps.git) return;

    try {
      // Parse branch name
      let branchIntent: IntentState['branchIntent'];
      try {
        const branch = await this.deps.git.getCurrentBranch();
        const branchMatch = branch.match(BRANCH_INTENT_RE);
        if (branchMatch) {
          branchIntent = {
            type: branchMatch[1],
            description: branchMatch[2].replace(/[-_]/g, ' '),
            raw: branch,
          };
        }
      } catch { /* Detached HEAD */ }

      // Parse recent commit messages
      const recentIntents: IntentState['recentIntents'] = [];
      try {
        const commits = await this.deps.git.getRecentCommits(10);
        for (const commit of commits) {
          const match = commit.message.match(CONVENTIONAL_COMMIT_RE);
          if (match) {
            recentIntents.push({
              type: match[1],
              scope: match[2] || undefined,
              description: match[3],
              sha: commit.sha,
            });
          }
        }
      } catch { /* No commits available */ }

      this.state.dimensions.intent = {
        branchIntent,
        recentIntents,
        lastUpdated: Date.now(),
      };
    } catch {
      // Git unavailable
    }
  }

  async updateImpact(changedFiles?: string[]): Promise<void> {
    if (!this.state) return;

    const files = changedFiles || this.state.dimensions.session?.modifiedFiles || [];
    if (files.length === 0) {
      this.state.dimensions.impact = {
        changedSymbols: [],
        affectedCallers: [],
        riskLevel: 'low',
        lastUpdated: Date.now(),
      };
      return;
    }

    const changedSymbols: string[] = [];
    const affectedCallers: string[] = [];

    if (this.deps.graph) {
      for (const file of files.slice(0, 10)) {
        try {
          // Get symbols in this file
          const symbols = await this.deps.graph.query(
            `MATCH (f:File {path: '${file}'})-[:DEFINES]->(s:Symbol) RETURN s.qualified_name as qn, s.name as name LIMIT 20`
          );

          for (const sym of symbols) {
            const symName = sym.qn || sym.name;
            changedSymbols.push(symName);

            // Get callers of this symbol
            try {
              const callers = await this.deps.graph.getCallers(symName);
              for (const caller of callers.slice(0, 5)) {
                const callerName = caller.qualifiedName || caller.name;
                if (!affectedCallers.includes(callerName)) {
                  affectedCallers.push(callerName);
                }
              }
            } catch { /* Skip */ }
          }
        } catch { /* Skip */ }
      }
    }

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (affectedCallers.length > 10) riskLevel = 'high';
    else if (affectedCallers.length > 3) riskLevel = 'medium';

    this.state.dimensions.impact = {
      changedSymbols: changedSymbols.slice(0, 20),
      affectedCallers: affectedCallers.slice(0, 20),
      riskLevel,
      lastUpdated: Date.now(),
    };
  }

  async refreshAll(): Promise<void> {
    await this.updateStructural();
    await this.updateSemantic();
    await this.updateTemporal();
    await this.updateRequirements();
    await this.updateSummary();
    await this.updateNavigational();
    await this.updateDevSession();
    await this.updateIntent();
    await this.updateImpact();

    if (this.state) {
      this.state.lastRefreshed = Date.now();
    }
  }

  // ========== Query Methods ==========

  /**
   * Score dimensions using keyword matching, session boosts, staleness penalties.
   * Returns DimensionSignal[] ordered by relevance.
   */
  rankDimensions(
    query: string,
    context?: { currentFile?: string; sessionId?: string },
    budget: number = 20000,
    weights?: Partial<Record<DimensionKind, number>>
  ): DimensionSignal[] {
    if (!this.state) return [];

    const mergedWeights = { ...DEFAULT_DIMENSION_WEIGHTS, ...weights };
    const queryLower = query.toLowerCase();
    const signals: DimensionSignal[] = [];

    for (const dim of ALL_DIMENSIONS) {
      const dimState = this.state.dimensions[dim];
      const baseWeight = mergedWeights[dim] || 0;
      const available = this.isDimensionAvailable(dim);

      let score = available ? baseWeight : 0;

      if (!available) {
        signals.push({ dimension: dim, score: 0, tokenBudget: 0, refs: [], available: false });
        continue;
      }

      // Keyword boosts
      score += this.keywordBoost(dim, queryLower);

      // Session boost: if user has active files, boost session/impact
      if (context?.currentFile) {
        if (dim === 'session' || dim === 'impact') score *= 1.5;
      }

      // Navigational boost: if sessionId matches active traversal
      if (context?.sessionId && dim === 'navigational') {
        const hasActiveSession = this.state.dimensions.navigational.activeSessions
          .some(s => s.sessionId === context.sessionId);
        if (hasActiveSession) score *= 2.0;
      }

      // Staleness penalty
      const lastUpdated = (dimState as any)?.lastUpdated || 0;
      const age = Date.now() - lastUpdated;
      if (age > STALE_THRESHOLD_MS) {
        score *= 0.7;
      }

      // Requirements boost for PRD-related queries
      if (dim === 'requirements' &&
          (queryLower.includes('requirement') || queryLower.includes('prd') || queryLower.includes('spec'))) {
        score *= 2.0;
      }

      // Impact boost for refactoring queries
      if (dim === 'impact' &&
          (queryLower.includes('refactor') || queryLower.includes('change') || queryLower.includes('break'))) {
        score *= 2.0;
      }

      const refs = this.getDimensionRefs(dim);
      signals.push({ dimension: dim, score, tokenBudget: 0, refs, available });
    }

    // Sort by score descending
    signals.sort((a, b) => b.score - a.score);

    // Distribute budget proportionally to scores
    const totalScore = signals.reduce((sum, s) => sum + s.score, 0);
    if (totalScore > 0) {
      for (const signal of signals) {
        signal.tokenBudget = Math.floor(budget * (signal.score / totalScore));
      }
    }

    return signals;
  }

  /**
   * Fetch actual data from underlying store for one dimension.
   * Returns formatted context string.
   */
  async getDimensionContext(
    dimension: DimensionKind,
    refs: string[],
    maxTokens: number
  ): Promise<string> {
    if (!this.state) return '';

    const dimState = this.state.dimensions[dimension];
    const maxChars = maxTokens * 4; // Rough token estimate

    switch (dimension) {
      case 'structural': {
        const s = dimState as StructuralState;
        const lines = [
          `Graph: ${s.fileCount} files, ${s.symbolCount} symbols, ${s.edgeCount} relationships`,
        ];
        if (s.hubSymbols.length > 0) {
          lines.push(`Hub symbols: ${s.hubSymbols.join(', ')}`);
        }
        return lines.join('\n').slice(0, maxChars);
      }

      case 'semantic': {
        // Actual semantic search happens in assembleContext via vector search
        const s = dimState as SemanticState;
        return `Semantic index: ${s.collectionSize} code chunks (${s.embeddingModel})`.slice(0, maxChars);
      }

      case 'temporal': {
        const s = dimState as TemporalState;
        const lines: string[] = [];
        if (s.hotFiles.length > 0) {
          lines.push('Hot files (most changed recently):');
          for (const f of s.hotFiles.slice(0, 5)) {
            lines.push(`  ${f.path} (${f.changeCount} changes)`);
          }
        }
        if (s.recentCommits.length > 0) {
          lines.push('Recent commits:');
          for (const c of s.recentCommits.slice(0, 5)) {
            lines.push(`  ${c.sha.slice(0, 7)} ${c.message.slice(0, 80)}`);
          }
        }
        return lines.join('\n').slice(0, maxChars);
      }

      case 'requirements': {
        const s = dimState as RequirementsState;
        if (s.prdCount === 0) return '';
        return `PRDs: ${s.prdCount} documents, ${s.chunkCount} requirements, ${s.implementationLinks} linked implementations`.slice(0, maxChars);
      }

      case 'summary': {
        const s = dimState as SummaryState;
        if (!s.hasCachedSummaries && s.summaryCount === 0) return '';
        const lines = [`Cached summaries: ${s.summaryCount} entries`];
        if (s.hasCachedSummaries) {
          // Load the codebase summary if available
          try {
            const summaryPath = path.join(this.deps.repoRoot, '.cv', 'codebase-summary.json');
            const content = await fs.readFile(summaryPath, 'utf-8');
            const summary = JSON.parse(content);
            if (summary.overview) {
              lines.push(summary.overview.slice(0, maxChars - 200));
            }
          } catch { /* No summary available */ }
        }
        return lines.join('\n').slice(0, maxChars);
      }

      case 'navigational': {
        const s = dimState as NavigationalState;
        if (s.activeSessions.length === 0) return '';
        const lines = ['Active navigation:'];
        for (const session of s.activeSessions) {
          lines.push(`  Session ${session.sessionId}: ${session.currentLevel}${session.currentTarget ? ` → ${session.currentTarget}` : ''}`);
        }
        return lines.join('\n').slice(0, maxChars);
      }

      case 'session': {
        const s = dimState as DevSessionState;
        const lines = [`Branch: ${s.currentBranch}`];
        if (s.modifiedFiles.length > 0) {
          lines.push(`Modified: ${s.modifiedFiles.slice(0, 10).join(', ')}`);
        }
        if (s.stagedFiles.length > 0) {
          lines.push(`Staged: ${s.stagedFiles.slice(0, 10).join(', ')}`);
        }
        if (s.symbolsInModifiedFiles.length > 0) {
          lines.push(`Affected symbols: ${s.symbolsInModifiedFiles.slice(0, 10).join(', ')}`);
        }
        return lines.join('\n').slice(0, maxChars);
      }

      case 'intent': {
        const s = dimState as IntentState;
        const lines: string[] = [];
        if (s.branchIntent) {
          lines.push(`Branch intent: ${s.branchIntent.type} — ${s.branchIntent.description}`);
        }
        if (s.recentIntents.length > 0) {
          lines.push('Recent intents:');
          for (const i of s.recentIntents.slice(0, 5)) {
            lines.push(`  ${i.type}${i.scope ? `(${i.scope})` : ''}: ${i.description}`);
          }
        }
        return lines.join('\n').slice(0, maxChars);
      }

      case 'impact': {
        const s = dimState as ImpactState;
        if (s.changedSymbols.length === 0) return '';
        const lines = [`Risk level: ${s.riskLevel}`];
        lines.push(`Changed symbols: ${s.changedSymbols.slice(0, 10).join(', ')}`);
        if (s.affectedCallers.length > 0) {
          lines.push(`Affected callers: ${s.affectedCallers.slice(0, 10).join(', ')}`);
        }
        return lines.join('\n').slice(0, maxChars);
      }

      default:
        return '';
    }
  }

  /**
   * Top-level: rank → fetch → concatenate → respect budget.
   * Returns ManifoldContextResult with formatted string + metadata.
   */
  async assembleContext(
    query: string,
    options?: ManifoldAssembleOptions
  ): Promise<ManifoldContextResult> {
    const {
      format = 'xml',
      budget = 20000,
      weights,
      currentFile,
      sessionId,
      includeDimensions,
      excludeDimensions,
    } = options || {};

    // Rank dimensions
    const signals = this.rankDimensions(
      query,
      { currentFile, sessionId },
      budget,
      weights
    );

    // Filter dimensions
    const filteredSignals = signals.filter(s => {
      if (!s.available || s.score === 0) return false;
      if (includeDimensions && !includeDimensions.includes(s.dimension)) return false;
      if (excludeDimensions && excludeDimensions.includes(s.dimension)) return false;
      return true;
    });

    // Fetch context for each dimension
    const contextParts: Array<{ dimension: DimensionKind; content: string }> = [];
    const dimensionsUsed: DimensionKind[] = [];

    for (const signal of filteredSignals) {
      if (signal.tokenBudget < 50) continue; // Skip dimensions with tiny budgets

      const content = await this.getDimensionContext(
        signal.dimension,
        signal.refs,
        signal.tokenBudget
      );

      if (content && content.trim().length > 0) {
        contextParts.push({ dimension: signal.dimension, content });
        dimensionsUsed.push(signal.dimension);
      }
    }

    // Format the context
    const context = this.formatContext(query, contextParts, format);

    return {
      query,
      format,
      totalTokens: Math.ceil(context.length / 4),
      dimensions: filteredSignals,
      context,
      metadata: {
        generatedAt: new Date().toISOString(),
        manifoldVersion: this.state?.version || 1,
        dimensionsUsed,
        fallback: false,
      },
    };
  }

  // ========== Health ==========

  async getHealth(): Promise<ManifoldHealth> {
    const dimensions: ManifoldHealth['dimensions'] = {} as any;

    for (const dim of ALL_DIMENSIONS) {
      const available = this.isDimensionAvailable(dim);
      const lastUpdated = this.state?.dimensions?.[dim]
        ? (this.state.dimensions[dim] as any).lastUpdated || null
        : null;

      let status: DimensionHealth;
      if (!available || !this.state) {
        status = this.state ? 'missing' : 'unavailable';
      } else if (!lastUpdated) {
        status = 'missing';
      } else if (Date.now() - lastUpdated > STALE_THRESHOLD_MS) {
        status = 'stale';
      } else {
        status = 'active';
      }

      dimensions[dim] = { status, lastUpdated };
    }

    // Check state file
    let exists = false;
    let sizeBytes = 0;
    try {
      const stat = await fs.stat(this.statePath);
      exists = true;
      sizeBytes = stat.size;
    } catch { /* File doesn't exist */ }

    const activeCount = Object.values(dimensions).filter(d => d.status === 'active').length;
    const overall = activeCount >= 5 ? 'healthy' : activeCount >= 2 ? 'degraded' : 'unavailable';

    return {
      overall,
      dimensions,
      stateFile: { exists, sizeBytes, path: this.statePath },
    };
  }

  // ========== Private Helpers ==========

  private createFreshState(): ManifoldState {
    const now = Date.now();
    return {
      version: 1,
      repoId: this.deps.repoId,
      createdAt: now,
      lastRefreshed: 0,
      dimensions: {
        structural: { fileCount: 0, symbolCount: 0, edgeCount: 0, hubSymbols: [], lastUpdated: 0 },
        semantic: { collectionSize: 0, embeddingModel: 'unknown', lastUpdated: 0 },
        temporal: { recentCommits: [], hotFiles: [], lastUpdated: 0 },
        requirements: { prdCount: 0, chunkCount: 0, implementationLinks: 0, lastUpdated: 0 },
        summary: { summaryCount: 0, byLevel: {}, hasCachedSummaries: false, lastUpdated: 0 },
        navigational: { activeSessions: [], lastUpdated: 0 },
        session: { modifiedFiles: [], stagedFiles: [], untrackedFiles: [], currentBranch: 'unknown', symbolsInModifiedFiles: [], lastUpdated: 0 },
        intent: { recentIntents: [], lastUpdated: 0 },
        impact: { changedSymbols: [], affectedCallers: [], riskLevel: 'low', lastUpdated: 0 },
      },
    };
  }

  private isDimensionAvailable(dim: DimensionKind): boolean {
    if (!this.state) return false;
    const dimState = this.state.dimensions[dim];
    if (!dimState) return false;
    return (dimState as any).lastUpdated > 0;
  }

  private keywordBoost(dim: DimensionKind, queryLower: string): number {
    const keywordMap: Record<DimensionKind, string[]> = {
      structural: ['call', 'depend', 'import', 'inherit', 'graph', 'relationship'],
      semantic: ['similar', 'search', 'find', 'like', 'related'],
      temporal: ['recent', 'history', 'change', 'commit', 'hot', 'active'],
      requirements: ['requirement', 'prd', 'spec', 'feature', 'user story'],
      summary: ['overview', 'summary', 'explain', 'what does', 'purpose'],
      navigational: ['navigate', 'explore', 'traverse', 'drill', 'zoom'],
      session: ['working', 'modified', 'staged', 'current', 'branch'],
      intent: ['why', 'intent', 'purpose', 'goal', 'motivation'],
      impact: ['impact', 'break', 'affect', 'refactor', 'risk', 'caller'],
    };

    const keywords = keywordMap[dim] || [];
    let boost = 0;
    for (const kw of keywords) {
      if (queryLower.includes(kw)) boost += 0.05;
    }
    return Math.min(boost, 0.15); // Cap boost
  }

  private getDimensionRefs(dim: DimensionKind): string[] {
    if (!this.state) return [];

    switch (dim) {
      case 'structural':
        return this.state.dimensions.structural.hubSymbols;
      case 'temporal':
        return this.state.dimensions.temporal.hotFiles.map(f => f.path);
      case 'session':
        return this.state.dimensions.session.modifiedFiles;
      case 'impact':
        return this.state.dimensions.impact.changedSymbols;
      default:
        return [];
    }
  }

  private formatContext(
    query: string,
    parts: Array<{ dimension: DimensionKind; content: string }>,
    format: string
  ): string {
    if (parts.length === 0) return '';

    if (format === 'xml') {
      const lines: string[] = ['<manifold_context>'];
      lines.push(`  <query>${this.escapeXML(query)}</query>`);
      lines.push(`  <generated>${new Date().toISOString()}</generated>`);
      lines.push(`  <dimensions count="${parts.length}">`);
      for (const part of parts) {
        lines.push(`    <dimension name="${part.dimension}">`);
        lines.push(`      <![CDATA[${part.content}]]>`);
        lines.push(`    </dimension>`);
      }
      lines.push('  </dimensions>');
      lines.push('</manifold_context>');
      return lines.join('\n');
    }

    if (format === 'json') {
      return JSON.stringify({
        query,
        generated: new Date().toISOString(),
        dimensions: Object.fromEntries(parts.map(p => [p.dimension, p.content])),
      }, null, 2);
    }

    // Markdown (default)
    const lines: string[] = ['# Context Manifold'];
    lines.push(`**Query**: ${query}`);
    lines.push('');
    for (const part of parts) {
      lines.push(`## ${part.dimension.charAt(0).toUpperCase() + part.dimension.slice(1)}`);
      lines.push(part.content);
      lines.push('');
    }
    return lines.join('\n');
  }

  private escapeXML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

export function createManifoldService(deps: ManifoldServiceDeps): ManifoldService {
  return new ManifoldService(deps);
}

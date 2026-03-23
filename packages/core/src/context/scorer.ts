/**
 * Context Scorer
 *
 * Uses the ContextualBandit to rank context nodes by predicted usefulness.
 * Integrates with GraphManager for persistent bandit state.
 */

import { GraphManager } from '../graph/index.js';
import { ContextualBandit, BanditContext, BanditState } from './contextual-bandit.js';

export interface ScoredNode {
  nodeId: string;
  score: number;
}

export class ContextScorer {
  private bandit: ContextualBandit;
  private graph: GraphManager;
  private dirty: boolean = false;

  constructor(graph: GraphManager, state?: BanditState) {
    this.graph = graph;
    this.bandit = new ContextualBandit(state ?? undefined);
  }

  /**
   * Load bandit state from FalkorDB. Returns true if state was found.
   */
  async load(): Promise<boolean> {
    const state = await this.graph.loadBanditState();
    if (state) {
      this.bandit = new ContextualBandit(state as BanditState);
      this.dirty = false;
      return true;
    }
    return false;
  }

  /**
   * Persist bandit state to FalkorDB.
   */
  async save(): Promise<void> {
    if (!this.dirty) return;
    await this.graph.saveBanditState(this.bandit.exportState());
    this.dirty = false;
  }

  /**
   * Score a list of candidate node IDs and return them sorted by score (descending).
   */
  rank(nodeIds: string[], context: BanditContext): ScoredNode[] {
    return nodeIds
      .map(nodeId => ({ nodeId, score: this.bandit.score(nodeId, context) }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Record feedback: a reward for a node in a given context.
   */
  reward(nodeId: string, context: BanditContext, value: number): void {
    this.bandit.update(nodeId, context, value);
    this.dirty = true;
  }

  /**
   * Get summary statistics.
   */
  getStats() {
    return this.bandit.getStats();
  }
}

/**
 * Transition Model
 *
 * Learns phase-transition patterns from task event sequences.
 * Tracks how often one event type follows another, building a
 * probability matrix that can predict likely next phases.
 *
 * Uses a simple count-based Markov model stored as an adjacency
 * matrix in FalkorDB for cross-session persistence.
 */

import type { GraphManager } from '../graph/index.js';

export type EventPhase =
  | 'thinking'
  | 'decision'
  | 'question'
  | 'progress'
  | 'file_change'
  | 'error'
  | 'completed';

const PHASES: EventPhase[] = [
  'thinking', 'decision', 'question', 'progress',
  'file_change', 'error', 'completed',
];

export interface TransitionState {
  /** transitions[from][to] = count */
  transitions: Record<string, Record<string, number>>;
  totalSequences: number;
}

export class TransitionModel {
  private transitions: Record<string, Record<string, number>>;
  private totalSequences: number;

  constructor(state?: TransitionState) {
    this.transitions = state?.transitions ?? {};
    this.totalSequences = state?.totalSequences ?? 0;
  }

  /**
   * Record a sequence of event phases (from a completed task).
   */
  recordSequence(phases: EventPhase[]): void {
    for (let i = 0; i < phases.length - 1; i++) {
      const from = phases[i];
      const to = phases[i + 1];
      if (!this.transitions[from]) this.transitions[from] = {};
      this.transitions[from][to] = (this.transitions[from][to] ?? 0) + 1;
    }
    this.totalSequences++;
  }

  /**
   * Get transition probabilities from a given phase.
   * Returns sorted array of (phase, probability) pairs.
   */
  predict(from: EventPhase): Array<{ phase: EventPhase; probability: number }> {
    const counts = this.transitions[from];
    if (!counts) {
      // Uniform distribution as fallback
      return PHASES.map((p) => ({ phase: p, probability: 1 / PHASES.length }));
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) {
      return PHASES.map((p) => ({ phase: p, probability: 1 / PHASES.length }));
    }

    return PHASES
      .map((phase) => ({
        phase,
        probability: (counts[phase] ?? 0) / total,
      }))
      .sort((a, b) => b.probability - a.probability);
  }

  /**
   * Get the most likely next phase.
   */
  mostLikely(from: EventPhase): EventPhase {
    return this.predict(from)[0].phase;
  }

  /** Export the current transition counts for persistence. */
  exportState(): TransitionState {
    return {
      transitions: this.transitions,
      totalSequences: this.totalSequences,
    };
  }

  /** Return summary statistics: distinct phases, total transitions, total sequences. */
  getStats(): { phases: number; totalTransitions: number; totalSequences: number } {
    let totalTransitions = 0;
    for (const counts of Object.values(this.transitions)) {
      for (const count of Object.values(counts)) {
        totalTransitions += count;
      }
    }
    return {
      phases: Object.keys(this.transitions).length,
      totalTransitions,
      totalSequences: this.totalSequences,
    };
  }
}

// ==================== Persistence ====================

/**
 * Persist transition state to FalkorDB. Logs and swallows errors.
 */
export async function saveTransitionState(
  graph: GraphManager,
  state: TransitionState,
): Promise<void> {
  try {
    const json = JSON.stringify(state);
    await graph.query(`
      MERGE (t:TransitionModel {id: 'phase-transitions'})
      SET t.data = $data, t.updatedAt = $ts
    `, { data: json, ts: new Date().toISOString() });
  } catch (error) {
    console.warn('[TransitionModel] Failed to save state:', error);
  }
}

/**
 * Load transition state from FalkorDB. Returns null on error or if absent.
 */
export async function loadTransitionState(
  graph: GraphManager,
): Promise<TransitionState | null> {
  try {
    const results = await graph.query(`
      MATCH (t:TransitionModel {id: 'phase-transitions'})
      RETURN t.data as data
    `);

    if (results.length === 0 || !results[0].data) return null;
    return JSON.parse(results[0].data as string);
  } catch (error) {
    console.warn('[TransitionModel] Failed to load state:', error);
    return null;
  }
}

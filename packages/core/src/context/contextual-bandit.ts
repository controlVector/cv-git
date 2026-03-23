/**
 * Contextual Bandit (LinUCB)
 *
 * Learns which context nodes are most useful to inject into task prompts
 * based on workflow phase, file count, and other contextual signals.
 *
 * Each "arm" is a context node (file, symbol, decision, constraint).
 * The bandit learns to predict reward (usefulness) given a context vector.
 */

export interface BanditContext {
  phase: number;             // 0-1 encoding of workflow phase
  fileCount: number;         // normalized count of files in task
  sessionAge: number;        // how far into session (0-1)
  errorRate: number;         // recent error frequency
  phaseTransitions: number;  // how many phase changes so far
  uniquePhases: number;      // diversity of phases visited
  avgTurnLength: number;     // average turns per phase
  concernDiversity: number;  // how many different concerns touched
}

export const CONTEXT_DIM = 8; // matches BanditContext field count

export interface BanditArm {
  nodeId: string;
  pulls: number;
  totalReward: number;
  /** LinUCB: A matrix (d x d) stored as flat array */
  A: number[];
  /** LinUCB: b vector (d x 1) stored as flat array */
  b: number[];
}

export interface BanditState {
  arms: Map<string, BanditArm>;
  alpha: number; // exploration parameter
  dimension: number;
}

/**
 * Convert BanditContext to a feature vector.
 */
function contextToVector(ctx: BanditContext): number[] {
  return [
    ctx.phase,
    ctx.fileCount,
    ctx.sessionAge,
    ctx.errorRate,
    ctx.phaseTransitions,
    ctx.uniquePhases,
    ctx.avgTurnLength,
    ctx.concernDiversity,
  ];
}

/**
 * Identity matrix of size d as a flat array.
 */
function identityFlat(d: number): number[] {
  const m = new Array(d * d).fill(0);
  for (let i = 0; i < d; i++) m[i * d + i] = 1;
  return m;
}

/**
 * Solve A * theta = b using simple Gaussian elimination.
 * A is d×d flat, b is d×1 flat. Returns theta (d×1).
 */
function solve(A: number[], b: number[], d: number): number[] {
  // Create augmented matrix
  const aug: number[][] = [];
  for (let i = 0; i < d; i++) {
    const row: number[] = [];
    for (let j = 0; j < d; j++) row.push(A[i * d + j]);
    row.push(b[i]);
    aug.push(row);
  }

  // Forward elimination
  for (let col = 0; col < d; col++) {
    let maxRow = col;
    for (let row = col + 1; row < d; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    if (Math.abs(aug[col][col]) < 1e-12) continue;

    for (let row = col + 1; row < d; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= d; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back substitution
  const theta = new Array(d).fill(0);
  for (let i = d - 1; i >= 0; i--) {
    if (Math.abs(aug[i][i]) < 1e-12) continue;
    theta[i] = aug[i][d];
    for (let j = i + 1; j < d; j++) {
      theta[i] -= aug[i][j] * theta[j];
    }
    theta[i] /= aug[i][i];
  }
  return theta;
}

/**
 * x^T * A^{-1} * x — used for UCB confidence bound.
 * We approximate by solving A * z = x, then dot(x, z).
 */
function quadForm(A: number[], x: number[], d: number): number {
  const z = solve(A, x, d);
  let result = 0;
  for (let i = 0; i < d; i++) result += x[i] * z[i];
  return Math.max(result, 0); // ensure non-negative
}

export class ContextualBandit {
  private arms: Map<string, BanditArm>;
  private alpha: number;
  private dimension: number;

  constructor(state?: BanditState) {
    this.arms = state?.arms ?? new Map();
    this.alpha = state?.alpha ?? 1.0;
    this.dimension = state?.dimension ?? CONTEXT_DIM;
  }

  private getOrCreateArm(nodeId: string): BanditArm {
    let arm = this.arms.get(nodeId);
    if (!arm) {
      arm = {
        nodeId,
        pulls: 0,
        totalReward: 0,
        A: identityFlat(this.dimension),
        b: new Array(this.dimension).fill(0),
      };
      this.arms.set(nodeId, arm);
    }
    return arm;
  }

  /**
   * Score a node given context. Returns expected reward + UCB bonus.
   */
  score(nodeId: string, context: BanditContext): number {
    const arm = this.getOrCreateArm(nodeId);
    const x = contextToVector(context);
    const d = this.dimension;

    // theta = A^{-1} * b
    const theta = solve(arm.A, arm.b, d);

    // Expected reward: x^T * theta
    let expected = 0;
    for (let i = 0; i < d; i++) expected += x[i] * theta[i];

    // UCB bonus: alpha * sqrt(x^T * A^{-1} * x)
    const ucb = this.alpha * Math.sqrt(quadForm(arm.A, x, d));

    return expected + ucb;
  }

  /**
   * Update the bandit after observing a reward.
   */
  update(nodeId: string, context: BanditContext, reward: number): void {
    const arm = this.getOrCreateArm(nodeId);
    const x = contextToVector(context);
    const d = this.dimension;

    // A += x * x^T
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        arm.A[i * d + j] += x[i] * x[j];
      }
    }

    // b += reward * x
    for (let i = 0; i < d; i++) {
      arm.b[i] += reward * x[i];
    }

    arm.pulls++;
    arm.totalReward += reward;
  }

  /**
   * Export state for persistence.
   */
  exportState(): BanditState {
    return {
      arms: this.arms,
      alpha: this.alpha,
      dimension: this.dimension,
    };
  }

  /**
   * Get stats about the bandit.
   */
  getStats(): { totalArms: number; totalPulls: number; avgReward: number } {
    let totalPulls = 0;
    let totalReward = 0;
    for (const arm of this.arms.values()) {
      totalPulls += arm.pulls;
      totalReward += arm.totalReward;
    }
    return {
      totalArms: this.arms.size,
      totalPulls,
      avgReward: totalPulls > 0 ? totalReward / totalPulls : 0,
    };
  }
}

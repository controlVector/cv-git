/**
 * Typed error classes for cv-git operations.
 */

/** Base error class for all cv-git operations. Carries a machine-readable code and optional context. */
export class CVError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CVError';
  }
}

/** Error from FalkorDB knowledge-graph operations. */
export class GraphError extends CVError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'GRAPH_ERROR', context);
    this.name = 'GraphError';
  }
}

/** Error from deploy orchestration (build, push, rollback, health-check). */
export class DeployError extends CVError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'DEPLOY_ERROR', context);
    this.name = 'DeployError';
  }
}

/** Error from configuration loading or validation. */
export class ConfigError extends CVError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', context);
    this.name = 'ConfigError';
  }
}

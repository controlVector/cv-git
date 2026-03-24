/**
 * Typed error classes for cv-git operations.
 */

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

export class GraphError extends CVError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'GRAPH_ERROR', context);
    this.name = 'GraphError';
  }
}

export class DeployError extends CVError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'DEPLOY_ERROR', context);
    this.name = 'DeployError';
  }
}

export class ConfigError extends CVError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', context);
    this.name = 'ConfigError';
  }
}

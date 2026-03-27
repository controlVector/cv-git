/**
 * @cv-git/core
 * Core business logic for CV-Git
 */

export * from './git/index.js';
export * from './parser/index.js';
export * from './graph/index.js';
export * from './vector/index.js';
export * from './ai/index.js';
export * from './ai/openrouter.js';
export * from './ai/ollama.js';
export * from './ai/lmstudio.js';
export * from './ai/types.js';
export * from './ai/factory.js';
export * from './ai/system-capabilities.js';
export * from './sync/index.js';
export * from './config/index.js';
export * from './code/index.js';
export * from './storage/index.js';
export * from './context/index.js';
export * from './deps/index.js';
export * from './services/index.js';

// Gateway (CV-Hub client)
export * from './gateway/index.js';
// TODO: export * from './agent/index.js' — agent module not yet in core

// Deploy orchestration
export * from './deploy/index.js';

// Typed errors
export { CVError, GraphError, DeployError, ConfigError } from './errors.js';

// Stub modules (not yet implemented)
export * from './security/index.js';

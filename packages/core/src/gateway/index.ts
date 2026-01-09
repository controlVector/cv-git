/**
 * MCP Gateway Module
 *
 * STUB: Not yet implemented
 *
 * This module will provide centralized MCP tool routing and management.
 * Features planned:
 * - Multi-server aggregation (combine tools from multiple MCP servers)
 * - Rate limiting and quota management
 * - Tool access control (allow/block patterns)
 * - Request/response caching
 * - Distributed tracing and logging
 * - Health monitoring and failover
 *
 * @module @cv-git/core/gateway
 */

export * from './types.js';

/**
 * MCP Gateway placeholder class
 *
 * This class will implement the IMCPGateway interface when the feature is implemented.
 *
 * @example
 * ```typescript
 * // Future usage:
 * const gateway = new MCPGateway();
 * await gateway.init({
 *   upstreamServers: [
 *     { id: 'cv-git', name: 'CV-Git', type: 'stdio', command: 'cv-git-mcp' },
 *     { id: 'github', name: 'GitHub', type: 'http', url: 'http://localhost:3000' },
 *   ],
 *   rateLimit: { requestsPerMinute: 60, requestsPerHour: 1000, burstLimit: 10 },
 * });
 *
 * const result = await gateway.route({
 *   toolName: 'cv_find',
 *   arguments: { query: 'authentication' },
 * });
 * ```
 */
export class MCPGateway {
  static readonly NOT_IMPLEMENTED = 'MCP Gateway is not yet implemented';

  /**
   * Check if the gateway feature is available
   */
  static isAvailable(): boolean {
    return false;
  }

  /**
   * Get implementation status message
   */
  static getStatus(): string {
    return 'The MCP Gateway feature is planned for a future release. ' +
      'It will provide centralized routing, rate limiting, and multi-server aggregation for MCP tools.';
  }
}

/**
 * Create an MCP Gateway instance
 *
 * @throws {Error} Always throws as the feature is not yet implemented
 */
export function createMCPGateway(): never {
  throw new Error(MCPGateway.NOT_IMPLEMENTED);
}

/**
 * MCP Gateway Types
 * Stub interfaces for future MCP gateway functionality
 *
 * NOTE: These are placeholder interfaces - not yet implemented
 *
 * The MCP Gateway will provide:
 * - Centralized routing of MCP tool requests
 * - Rate limiting and quota management
 * - Tool access control (allow/block patterns)
 * - Request/response logging and auditing
 * - Multi-server aggregation
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * MCP Gateway configuration
 */
export interface MCPGatewayConfig {
  /** Gateway endpoint URL */
  endpoint?: string;

  /** Authentication method */
  authMethod?: 'token' | 'oauth' | 'mtls' | 'none';

  /** Rate limiting configuration */
  rateLimit?: RateLimitConfig;

  /** Allowed tool patterns (glob patterns) */
  allowedTools?: string[];

  /** Blocked tool patterns (glob patterns) */
  blockedTools?: string[];

  /** Upstream MCP servers to route to */
  upstreamServers?: MCPServerConfig[];

  /** Request timeout in milliseconds */
  timeout?: number;

  /** Enable request/response logging */
  logging?: boolean;

  /** Cache configuration */
  cache?: CacheConfig;
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  /** Maximum requests per minute */
  requestsPerMinute: number;

  /** Maximum requests per hour */
  requestsPerHour: number;

  /** Burst limit for short-term spikes */
  burstLimit: number;

  /** Rate limit strategy */
  strategy?: 'sliding-window' | 'fixed-window' | 'token-bucket';
}

/**
 * Upstream MCP server configuration
 */
export interface MCPServerConfig {
  /** Unique server identifier */
  id: string;

  /** Server name for display */
  name: string;

  /** Server type */
  type: 'stdio' | 'http' | 'ws';

  /** Command to start stdio server */
  command?: string;

  /** Arguments for stdio server */
  args?: string[];

  /** URL for HTTP/WebSocket server */
  url?: string;

  /** Tool prefix for namespacing */
  toolPrefix?: string;

  /** Server-specific environment variables */
  env?: Record<string, string>;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Enable caching */
  enabled: boolean;

  /** Cache TTL in seconds */
  ttl: number;

  /** Maximum cache size in MB */
  maxSize: number;

  /** Tools to cache (glob patterns) */
  cacheableTools?: string[];
}

// ============================================================================
// Request/Response Types
// ============================================================================

/**
 * MCP Gateway request
 */
export interface MCPGatewayRequest {
  /** Tool name to invoke */
  toolName: string;

  /** Tool arguments */
  arguments: Record<string, unknown>;

  /** Request context */
  context?: MCPRequestContext;

  /** Target server (optional, for routing) */
  targetServer?: string;
}

/**
 * Request context for tracking and auditing
 */
export interface MCPRequestContext {
  /** User identifier */
  userId?: string;

  /** Session identifier */
  sessionId?: string;

  /** Source IP address */
  sourceIp?: string;

  /** Request timestamp */
  timestamp: number;

  /** Trace ID for distributed tracing */
  traceId?: string;

  /** Parent span ID for tracing */
  parentSpanId?: string;

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * MCP Gateway response
 */
export interface MCPGatewayResponse {
  /** Whether the request succeeded */
  success: boolean;

  /** Tool result (if successful) */
  result?: unknown;

  /** Error details (if failed) */
  error?: MCPGatewayError;

  /** Response metadata */
  metadata?: ResponseMetadata;
}

/**
 * Gateway error details
 */
export interface MCPGatewayError {
  /** Error code */
  code: MCPErrorCode;

  /** Human-readable error message */
  message: string;

  /** Additional error details */
  details?: Record<string, unknown>;

  /** Stack trace (if available) */
  stack?: string;
}

/**
 * Standard error codes
 */
export type MCPErrorCode =
  | 'GATEWAY_ERROR'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_BLOCKED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'AUTHENTICATION_FAILED'
  | 'AUTHORIZATION_FAILED'
  | 'SERVER_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'INTERNAL_ERROR';

/**
 * Response metadata
 */
export interface ResponseMetadata {
  /** Unique request ID */
  requestId: string;

  /** Request duration in milliseconds */
  duration: number;

  /** Whether result was cached */
  cached: boolean;

  /** Server that handled the request */
  server?: string;

  /** Remaining rate limit */
  rateLimitRemaining?: number;

  /** Rate limit reset time */
  rateLimitReset?: number;
}

// ============================================================================
// Gateway Interface
// ============================================================================

/**
 * MCP Gateway Interface
 * Future implementation will provide centralized MCP tool routing
 */
export interface IMCPGateway {
  /**
   * Initialize the gateway with configuration
   */
  init(config: MCPGatewayConfig): Promise<void>;

  /**
   * Route a tool request to the appropriate server
   */
  route(request: MCPGatewayRequest): Promise<MCPGatewayResponse>;

  /**
   * Check if a tool is allowed by the gateway policy
   */
  isToolAllowed(toolName: string): boolean;

  /**
   * Get list of available tools across all servers
   */
  listTools(): Promise<MCPToolInfo[]>;

  /**
   * Get gateway health status
   */
  health(): Promise<GatewayHealth>;

  /**
   * Get gateway metrics
   */
  metrics(): Promise<GatewayMetrics>;

  /**
   * Gracefully shutdown the gateway
   */
  shutdown(): Promise<void>;
}

/**
 * Tool information
 */
export interface MCPToolInfo {
  /** Tool name */
  name: string;

  /** Tool description */
  description?: string;

  /** Server providing this tool */
  server: string;

  /** Input schema (JSON Schema) */
  inputSchema?: Record<string, unknown>;
}

/**
 * Gateway health status
 */
export interface GatewayHealth {
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'unhealthy';

  /** Gateway uptime in seconds */
  uptime: number;

  /** Total requests processed */
  requestCount: number;

  /** Error rate (0-1) */
  errorRate: number;

  /** Server-specific health */
  servers: ServerHealth[];
}

/**
 * Individual server health
 */
export interface ServerHealth {
  /** Server ID */
  id: string;

  /** Server name */
  name: string;

  /** Server status */
  status: 'online' | 'offline' | 'degraded';

  /** Last successful request time */
  lastSuccess?: number;

  /** Average response time in ms */
  avgResponseTime?: number;
}

/**
 * Gateway metrics
 */
export interface GatewayMetrics {
  /** Total requests */
  totalRequests: number;

  /** Successful requests */
  successfulRequests: number;

  /** Failed requests */
  failedRequests: number;

  /** Cached responses */
  cachedResponses: number;

  /** Rate-limited requests */
  rateLimitedRequests: number;

  /** Average response time in ms */
  avgResponseTime: number;

  /** Requests by tool */
  byTool: Record<string, number>;

  /** Requests by server */
  byServer: Record<string, number>;
}

// ============================================================================
// Event Types (for hooks/callbacks)
// ============================================================================

/**
 * Gateway event types
 */
export type GatewayEventType =
  | 'request'
  | 'response'
  | 'error'
  | 'rate-limited'
  | 'server-online'
  | 'server-offline';

/**
 * Gateway event
 */
export interface GatewayEvent {
  /** Event type */
  type: GatewayEventType;

  /** Event timestamp */
  timestamp: number;

  /** Event data */
  data: Record<string, unknown>;
}

/**
 * Gateway event listener
 */
export type GatewayEventListener = (event: GatewayEvent) => void | Promise<void>;

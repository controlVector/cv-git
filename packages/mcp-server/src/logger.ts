/**
 * MCP Server Logger
 * Structured logging for debugging and monitoring
 *
 * Log levels: error, warn, info, debug
 * Output goes to stderr to not interfere with MCP stdio protocol
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
  duration?: number;
}

// Log level priority (lower = more important)
const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// Get configured log level from environment
function getConfiguredLevel(): LogLevel {
  const level = process.env.CV_LOG_LEVEL?.toLowerCase();
  if (level && level in LOG_LEVELS) {
    return level as LogLevel;
  }
  // Default to 'info' in production, 'debug' if CV_DEBUG is set
  return process.env.CV_DEBUG ? 'debug' : 'info';
}

let configuredLevel = getConfiguredLevel();

/**
 * Set the minimum log level
 */
export function setLogLevel(level: LogLevel): void {
  configuredLevel = level;
}

/**
 * Check if a level should be logged
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] <= LOG_LEVELS[configuredLevel];
}

/**
 * Format and write a log entry
 */
function writeLog(entry: LogEntry): void {
  if (!shouldLog(entry.level)) return;

  // JSON format for machine parsing, or simple format for humans
  if (process.env.CV_LOG_JSON === 'true') {
    console.error(JSON.stringify(entry));
  } else {
    const levelStr = entry.level.toUpperCase().padEnd(5);
    const durationStr = entry.duration !== undefined ? ` (${entry.duration}ms)` : '';
    const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
    console.error(`[${entry.timestamp}] ${levelStr} [${entry.component}] ${entry.message}${durationStr}${dataStr}`);
  }
}

/**
 * Create a logger for a specific component
 */
export function createLogger(component: string) {
  const log = (level: LogLevel, message: string, data?: Record<string, unknown>) => {
    writeLog({
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      data,
    });
  };

  return {
    error: (message: string, data?: Record<string, unknown>) => log('error', message, data),
    warn: (message: string, data?: Record<string, unknown>) => log('warn', message, data),
    info: (message: string, data?: Record<string, unknown>) => log('info', message, data),
    debug: (message: string, data?: Record<string, unknown>) => log('debug', message, data),

    /**
     * Time an async operation
     */
    async time<T>(
      operation: string,
      fn: () => Promise<T>,
      level: LogLevel = 'debug'
    ): Promise<T> {
      const start = Date.now();
      try {
        const result = await fn();
        const duration = Date.now() - start;
        writeLog({
          timestamp: new Date().toISOString(),
          level,
          component,
          message: `${operation} completed`,
          duration,
        });
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        writeLog({
          timestamp: new Date().toISOString(),
          level: 'error',
          component,
          message: `${operation} failed`,
          duration,
          data: { error: error instanceof Error ? error.message : String(error) },
        });
        throw error;
      }
    },

    /**
     * Create a child logger with additional context
     */
    child(subComponent: string) {
      return createLogger(`${component}:${subComponent}`);
    },
  };
}

// Pre-configured loggers for common components
export const serverLogger = createLogger('server');
export const toolLogger = createLogger('tool');
export const resourceLogger = createLogger('resource');

/**
 * Output Utilities
 * Consistent output handling across all commands with --json, --quiet, --verbose support
 */

import chalk from 'chalk';
import ora from 'ora';

export interface OutputOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export class OutputManager {
  private options: OutputOptions;

  constructor(options: OutputOptions = {}) {
    this.options = options;
  }

  /**
   * Print success message
   */
  success(message: string, data?: any): void {
    if (this.options.quiet) return;

    if (this.options.json && data) {
      this.json({ success: true, message, data });
    } else {
      console.log(chalk.green('✓'), message);
      if (data && this.options.verbose) {
        console.log(chalk.gray(JSON.stringify(data, null, 2)));
      }
    }
  }

  /**
   * Print error message
   */
  error(message: string, error?: Error | any, code?: string): void {
    if (this.options.json) {
      this.json({
        success: false,
        error: message,
        code: code || 'ERROR',
        details: error?.message || error,
        stack: this.options.verbose ? error?.stack : undefined,
      });
    } else {
      console.error(chalk.red('✗'), message);
      if (error && this.options.verbose) {
        console.error(chalk.gray(error.stack || error.message || error));
      }
    }
  }

  /**
   * Print warning message
   */
  warn(message: string, data?: any): void {
    if (this.options.quiet) return;

    if (this.options.json && data) {
      this.json({ warning: true, message, data });
    } else {
      console.log(chalk.yellow('⚠'), message);
      if (data && this.options.verbose) {
        console.log(chalk.gray(JSON.stringify(data, null, 2)));
      }
    }
  }

  /**
   * Print info message
   */
  info(message: string, data?: any): void {
    if (this.options.quiet) return;

    if (this.options.json && data) {
      this.json({ info: true, message, data });
    } else {
      console.log(chalk.cyan('ℹ'), message);
      if (data && this.options.verbose) {
        console.log(chalk.gray(JSON.stringify(data, null, 2)));
      }
    }
  }

  /**
   * Print debug message (only in verbose mode)
   */
  debug(message: string, data?: any): void {
    if (!this.options.verbose) return;

    console.log(chalk.gray('→'), chalk.gray(message));
    if (data) {
      console.log(chalk.gray(JSON.stringify(data, null, 2)));
    }
  }

  /**
   * Print JSON output
   */
  json(data: any): void {
    console.log(JSON.stringify(data, null, 2));
  }

  /**
   * Print table (only in non-JSON, non-quiet mode)
   */
  table(data: any[], headers?: string[]): void {
    if (this.options.quiet) return;

    if (this.options.json) {
      this.json(data);
    } else {
      // Use cli-table3 for formatted output
      const Table = require('cli-table3');

      if (headers) {
        const table = new Table({ head: headers });
        data.forEach(row => table.push(row));
        console.log(table.toString());
      } else {
        console.table(data);
      }
    }
  }

  /**
   * Print data (auto-detect format)
   */
  print(data: any): void {
    if (this.options.quiet) return;

    if (this.options.json) {
      this.json(data);
    } else if (typeof data === 'string') {
      console.log(data);
    } else if (Array.isArray(data)) {
      this.table(data);
    } else if (typeof data === 'object') {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(data);
    }
  }

  /**
   * Create a spinner (only in non-JSON, non-quiet mode)
   */
  spinner(text: string): any {
    if (this.options.quiet || this.options.json) {
      return {
        start: () => {},
        succeed: () => {},
        fail: () => {},
        warn: () => {},
        info: () => {},
        stop: () => {},
      };
    }

    return ora(text);
  }

  /**
   * Check if should show output
   */
  get shouldShow(): boolean {
    return !this.options.quiet;
  }

  /**
   * Check if JSON mode
   */
  get isJson(): boolean {
    return !!this.options.json;
  }

  /**
   * Check if verbose mode
   */
  get isVerbose(): boolean {
    return !!this.options.verbose;
  }

  /**
   * Check if quiet mode
   */
  get isQuiet(): boolean {
    return !!this.options.quiet;
  }
}

/**
 * Add global output options to a command
 */
export function addGlobalOptions(command: any): any {
  return command
    .option('--json', 'Output as JSON')
    .option('--quiet', 'Suppress output')
    .option('--verbose', 'Show verbose output including debug info')
    .option('--options', 'Show available options for this command');
}

/**
 * Create output manager from command options
 */
export function createOutput(options: any): OutputManager {
  return new OutputManager({
    json: options.json,
    quiet: options.quiet,
    verbose: options.verbose,
  });
}

/**
 * Error codes for consistent error handling
 */
export enum ErrorCode {
  // General
  UNKNOWN = 'UNKNOWN',
  INVALID_INPUT = 'INVALID_INPUT',
  OPERATION_FAILED = 'OPERATION_FAILED',

  // Git
  NOT_GIT_REPO = 'NOT_GIT_REPO',
  GIT_ERROR = 'GIT_ERROR',

  // CV-Git
  NOT_INITIALIZED = 'NOT_INITIALIZED',
  SYNC_REQUIRED = 'SYNC_REQUIRED',
  CONFIG_ERROR = 'CONFIG_ERROR',

  // Services
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  FALKORDB_ERROR = 'FALKORDB_ERROR',
  QDRANT_ERROR = 'QDRANT_ERROR',

  // Credentials
  NO_CREDENTIALS = 'NO_CREDENTIALS',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  AUTH_FAILED = 'AUTH_FAILED',

  // Platform
  PLATFORM_ERROR = 'PLATFORM_ERROR',
  API_ERROR = 'API_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
}

/**
 * Create a consistent error with code
 */
export class CVError extends Error {
  constructor(
    message: string,
    public code: ErrorCode = ErrorCode.UNKNOWN,
    public details?: any
  ) {
    super(message);
    this.name = 'CVError';
  }
}

/**
 * Handle error consistently
 */
export function handleError(error: any, output: OutputManager): never {
  if (error instanceof CVError) {
    output.error(error.message, error, error.code);
  } else if (error instanceof Error) {
    output.error(error.message, error);
  } else {
    output.error('An unknown error occurred', error);
  }
  process.exit(1);
}

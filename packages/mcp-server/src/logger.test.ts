/**
 * Unit tests for MCP Server Logger
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, setLogLevel } from './logger.js';

describe('Logger', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Reset log level to default
    delete process.env.CV_LOG_LEVEL;
    delete process.env.CV_DEBUG;
    delete process.env.CV_LOG_JSON;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('createLogger', () => {
    it('should create a logger with the specified component', () => {
      const logger = createLogger('test-component');
      expect(logger).toHaveProperty('error');
      expect(logger).toHaveProperty('warn');
      expect(logger).toHaveProperty('info');
      expect(logger).toHaveProperty('debug');
      expect(logger).toHaveProperty('time');
      expect(logger).toHaveProperty('child');
    });

    it('should log at info level by default', () => {
      setLogLevel('info');
      const logger = createLogger('test');

      logger.info('info message');
      logger.debug('debug message');

      // Info should be logged, debug should not
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('info message');
    });

    it('should log at debug level when CV_DEBUG is set', () => {
      setLogLevel('debug');
      const logger = createLogger('test');

      logger.debug('debug message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('debug message');
    });

    it('should include component name in log output', () => {
      setLogLevel('info');
      const logger = createLogger('my-component');

      logger.info('test message');

      expect(consoleErrorSpy.mock.calls[0][0]).toContain('my-component');
    });

    it('should include data in log output when provided', () => {
      setLogLevel('info');
      const logger = createLogger('test');

      logger.info('message with data', { key: 'value' });

      expect(consoleErrorSpy.mock.calls[0][0]).toContain('"key":"value"');
    });
  });

  describe('log levels', () => {
    it('should log errors at all levels', () => {
      setLogLevel('error');
      const logger = createLogger('test');

      logger.error('error message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should log warnings at warn level and above', () => {
      setLogLevel('warn');
      const logger = createLogger('test');

      logger.error('error');
      logger.warn('warn');
      logger.info('info');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    });

    it('should log info at info level and above', () => {
      setLogLevel('info');
      const logger = createLogger('test');

      logger.error('error');
      logger.warn('warn');
      logger.info('info');
      logger.debug('debug');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('time', () => {
    it('should time async operations', async () => {
      setLogLevel('debug');
      const logger = createLogger('test');

      const result = await logger.time('test operation', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 42;
      });

      expect(result).toBe(42);
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('test operation completed');
    });

    it('should log errors on operation failure', async () => {
      setLogLevel('info');
      const logger = createLogger('test');

      await expect(
        logger.time('failing operation', async () => {
          throw new Error('test error');
        })
      ).rejects.toThrow('test error');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('failing operation failed');
    });
  });

  describe('child', () => {
    it('should create a child logger with combined component name', () => {
      setLogLevel('info');
      const parent = createLogger('parent');
      const child = parent.child('child');

      child.info('child message');

      expect(consoleErrorSpy.mock.calls[0][0]).toContain('parent:child');
    });
  });

  describe('JSON output', () => {
    it('should output JSON when CV_LOG_JSON is set', () => {
      process.env.CV_LOG_JSON = 'true';
      setLogLevel('info');
      const logger = createLogger('test');

      logger.info('json message', { foo: 'bar' });

      const output = consoleErrorSpy.mock.calls[0][0] as string;
      expect(() => JSON.parse(output)).not.toThrow();

      const parsed = JSON.parse(output);
      expect(parsed.message).toBe('json message');
      expect(parsed.component).toBe('test');
      expect(parsed.data.foo).toBe('bar');
    });
  });
});

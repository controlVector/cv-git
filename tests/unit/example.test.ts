/**
 * Example Unit Tests
 * These demonstrate how to write unit tests for CV-Git components
 */

import { describe, it, expect } from 'vitest';

describe('Example Test Suite', () => {
  describe('Basic assertions', () => {
    it('should pass a simple test', () => {
      expect(1 + 1).toBe(2);
    });

    it('should handle strings', () => {
      const greeting = 'Hello, CV-Git!';
      expect(greeting).toContain('CV-Git');
      expect(greeting).toHaveLength(14);
    });

    it('should handle arrays', () => {
      const arr = [1, 2, 3];
      expect(arr).toHaveLength(3);
      expect(arr).toContain(2);
    });
  });

  describe('Async operations', () => {
    it('should handle promises', async () => {
      const result = await Promise.resolve(42);
      expect(result).toBe(42);
    });

    it('should handle async functions', async () => {
      const getValue = async () => {
        return new Promise<string>((resolve) => {
          setTimeout(() => resolve('test'), 10);
        });
      };

      const value = await getValue();
      expect(value).toBe('test');
    });
  });

  describe('Object assertions', () => {
    it('should compare objects', () => {
      const obj = { name: 'test', value: 123 };
      expect(obj).toEqual({ name: 'test', value: 123 });
      expect(obj).toHaveProperty('name');
      expect(obj).toHaveProperty('value', 123);
    });
  });
});

/**
 * Example: Testing utility functions
 */
describe('Utility Functions', () => {
  const formatToken = (token: string): string => {
    if (token.length <= 10) return token;
    return `${token.substring(0, 10)}...`;
  };

  it('should format long tokens', () => {
    const token = 'ghp_verylongtoken12345678901234567890';
    const formatted = formatToken(token);
    expect(formatted).toBe('ghp_verylo...');
  });

  it('should not format short tokens', () => {
    const token = 'short';
    const formatted = formatToken(token);
    expect(formatted).toBe('short');
  });
});

/**
 * Example: Testing error handling
 */
describe('Error Handling', () => {
  const parseNumber = (value: string): number => {
    const num = parseInt(value, 10);
    if (isNaN(num)) {
      throw new Error(`Invalid number: ${value}`);
    }
    return num;
  };

  it('should parse valid numbers', () => {
    expect(parseNumber('42')).toBe(42);
    expect(parseNumber('0')).toBe(0);
    expect(parseNumber('-10')).toBe(-10);
  });

  it('should throw on invalid numbers', () => {
    expect(() => parseNumber('abc')).toThrow('Invalid number: abc');
    expect(() => parseNumber('not-a-number')).toThrow();
  });
});

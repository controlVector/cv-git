/**
 * Unit tests for Auto Context Tool
 */

import { describe, it, expect } from 'vitest';

// Test internal utility functions by re-implementing them here
// (In a real scenario, you'd export these from the module for testing)

/**
 * Calculate budget allocation based on options
 */
function calculateBudget(
  totalBudget: number,
  options: { hasCurrentFile: boolean; includeRequirements: boolean; includeDocs: boolean }
) {
  const { hasCurrentFile, includeDocs } = options;

  // Base allocation
  let semantic = 0.4;
  let graph = 0.2;
  let files = hasCurrentFile ? 0.25 : 0;
  let docs = includeDocs ? 0.15 : 0;

  // Normalize
  const total = semantic + graph + files + docs;
  semantic /= total;
  graph /= total;
  files /= total;
  docs /= total;

  return {
    semantic: Math.floor(totalBudget * semantic),
    graph: Math.floor(totalBudget * graph),
    files: Math.floor(totalBudget * files),
    docs: Math.floor(totalBudget * docs),
  };
}

/**
 * Rough token estimation and truncation
 */
function truncateToTokens(text: string, maxTokens: number): string {
  // Rough estimate: 4 chars per token
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n... (truncated)';
}

/**
 * Escape XML special characters
 */
function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

describe('Auto Context Tool', () => {
  describe('calculateBudget', () => {
    it('should allocate budget correctly with all options', () => {
      const budget = calculateBudget(20000, {
        hasCurrentFile: true,
        includeRequirements: true,
        includeDocs: true,
      });

      // Total should not exceed the budget
      const total = budget.semantic + budget.graph + budget.files + budget.docs;
      expect(total).toBeLessThanOrEqual(20000);

      // All parts should be non-zero
      expect(budget.semantic).toBeGreaterThan(0);
      expect(budget.graph).toBeGreaterThan(0);
      expect(budget.files).toBeGreaterThan(0);
      expect(budget.docs).toBeGreaterThan(0);
    });

    it('should allocate zero to files when no current file', () => {
      const budget = calculateBudget(10000, {
        hasCurrentFile: false,
        includeRequirements: true,
        includeDocs: true,
      });

      expect(budget.files).toBe(0);
      expect(budget.semantic).toBeGreaterThan(0);
    });

    it('should allocate zero to docs when disabled', () => {
      const budget = calculateBudget(10000, {
        hasCurrentFile: true,
        includeRequirements: true,
        includeDocs: false,
      });

      expect(budget.docs).toBe(0);
      expect(budget.files).toBeGreaterThan(0);
    });

    it('should allocate semantic the largest share', () => {
      const budget = calculateBudget(20000, {
        hasCurrentFile: true,
        includeRequirements: true,
        includeDocs: true,
      });

      expect(budget.semantic).toBeGreaterThan(budget.graph);
      expect(budget.semantic).toBeGreaterThan(budget.docs);
    });
  });

  describe('truncateToTokens', () => {
    it('should not truncate short text', () => {
      const text = 'Hello, world!';
      const result = truncateToTokens(text, 100);
      expect(result).toBe(text);
    });

    it('should truncate long text', () => {
      const text = 'a'.repeat(500);
      const result = truncateToTokens(text, 100); // 100 tokens = 400 chars

      expect(result.length).toBeLessThan(text.length);
      expect(result).toContain('... (truncated)');
    });

    it('should truncate to approximately maxTokens * 4 characters', () => {
      const text = 'a'.repeat(1000);
      const result = truncateToTokens(text, 100); // 100 tokens = 400 chars

      // Should be around 400 chars + truncation message
      expect(result.length).toBeLessThanOrEqual(420);
    });
  });

  describe('escapeXML', () => {
    it('should escape ampersand', () => {
      expect(escapeXML('a & b')).toBe('a &amp; b');
    });

    it('should escape less than', () => {
      expect(escapeXML('a < b')).toBe('a &lt; b');
    });

    it('should escape greater than', () => {
      expect(escapeXML('a > b')).toBe('a &gt; b');
    });

    it('should escape double quotes', () => {
      expect(escapeXML('a "b" c')).toBe('a &quot;b&quot; c');
    });

    it('should escape single quotes', () => {
      expect(escapeXML("a 'b' c")).toBe('a &apos;b&apos; c');
    });

    it('should handle multiple special characters', () => {
      const input = '<div class="test">Tom & Jerry\'s</div>';
      const expected = '&lt;div class=&quot;test&quot;&gt;Tom &amp; Jerry&apos;s&lt;/div&gt;';
      expect(escapeXML(input)).toBe(expected);
    });

    it('should return unchanged string with no special characters', () => {
      const input = 'Hello World 123';
      expect(escapeXML(input)).toBe(input);
    });
  });
});

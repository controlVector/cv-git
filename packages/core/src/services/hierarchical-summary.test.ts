/**
 * Hierarchical Summary Service Tests
 * Tests for multi-level code summary generation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HierarchicalSummaryService, createHierarchicalSummaryService, SummaryContext } from './hierarchical-summary.js';
import { ParsedFile, SymbolNode, HierarchicalSummaryPayload } from '@cv-git/shared';

// Mock VectorManager
const mockVectorManager = {
  getRepoId: vi.fn().mockReturnValue('test-repo'),
  embedBatch: vi.fn().mockImplementation((texts: string[]) =>
    Promise.resolve(texts.map(() => [0.1, 0.2, 0.3]))
  ),
  upsertSummaryBatch: vi.fn().mockResolvedValue(undefined)
};

// Mock GraphManager
const mockGraphManager = {
  query: vi.fn().mockResolvedValue([])
};

describe('HierarchicalSummaryService', () => {
  let service: HierarchicalSummaryService;
  let mockContext: SummaryContext;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mocks to default values
    mockVectorManager.getRepoId.mockReturnValue('test-repo');
    mockVectorManager.embedBatch.mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => [0.1, 0.2, 0.3]))
    );
    mockVectorManager.upsertSummaryBatch.mockResolvedValue(undefined);
    mockContext = {
      generateSummary: vi.fn().mockResolvedValue('SUMMARY: Test summary\nKEYWORDS: test, keyword'),
      useFallback: false
    };
    service = createHierarchicalSummaryService(
      mockVectorManager as any,
      mockGraphManager as any,
      mockContext
    );
  });

  describe('createHierarchicalSummaryService factory', () => {
    it('should create a HierarchicalSummaryService instance', () => {
      const svc = createHierarchicalSummaryService(
        mockVectorManager as any,
        mockGraphManager as any
      );
      expect(svc).toBeInstanceOf(HierarchicalSummaryService);
    });

    it('should work without context (fallback mode)', () => {
      const svc = createHierarchicalSummaryService(
        mockVectorManager as any,
        mockGraphManager as any
      );
      expect(svc).toBeDefined();
    });
  });

  describe('generateSymbolSummary', () => {
    const mockSymbol: SymbolNode = {
      name: 'testFunction',
      qualifiedName: 'src/test.ts:testFunction',
      kind: 'function',
      file: 'src/test.ts',
      startLine: 1,
      endLine: 10
    };

    const mockCode = `
function testFunction() {
  return 'hello';
}
`;

    it('should generate summary using LLM when available', async () => {
      const summary = await service.generateSymbolSummary(mockSymbol, mockCode);

      expect(summary).toBeDefined();
      expect(summary.id).toBe('symbol:src/test.ts:testFunction');
      expect(summary.level).toBe(1);
      expect(summary.summary).toBe('Test summary');
      expect(summary.keywords).toEqual(['test', 'keyword']);
      expect(mockContext.generateSummary).toHaveBeenCalled();
    });

    it('should use fallback when useFallback is true', async () => {
      const fallbackService = createHierarchicalSummaryService(
        mockVectorManager as any,
        mockGraphManager as any,
        { useFallback: true }
      );

      const summary = await fallbackService.generateSymbolSummary(mockSymbol, mockCode);

      expect(summary.summary).toContain('Function testFunction');
    });

    it('should use fallback when no generateSummary function provided', async () => {
      const fallbackService = createHierarchicalSummaryService(
        mockVectorManager as any,
        mockGraphManager as any,
        {}
      );

      const summary = await fallbackService.generateSymbolSummary(mockSymbol, mockCode);

      expect(summary.summary).toBeDefined();
    });

    it('should extract summary from docstring when available', async () => {
      const symbolWithDocstring: SymbolNode = {
        ...mockSymbol,
        docstring: 'This is a test function that does amazing things.'
      };

      const fallbackService = createHierarchicalSummaryService(
        mockVectorManager as any,
        mockGraphManager as any,
        { useFallback: true }
      );

      const summary = await fallbackService.generateSymbolSummary(symbolWithDocstring, mockCode);

      expect(summary.summary).toBe('This is a test function that does amazing things.');
    });

    it('should cache summaries and return cached version', async () => {
      const summary1 = await service.generateSymbolSummary(mockSymbol, mockCode);
      const summary2 = await service.generateSymbolSummary(mockSymbol, mockCode);

      expect(summary1).toEqual(summary2);
      expect(mockContext.generateSummary).toHaveBeenCalledTimes(1);
    });

    it('should regenerate when content changes', async () => {
      await service.generateSymbolSummary(mockSymbol, mockCode);
      await service.generateSymbolSummary(mockSymbol, mockCode + '// modified');

      expect(mockContext.generateSummary).toHaveBeenCalledTimes(2);
    });

    it('should set correct parent reference', async () => {
      const summary = await service.generateSymbolSummary(mockSymbol, mockCode);

      expect(summary.parent).toBe('file:src/test.ts');
    });

    it('should include symbolKind in payload', async () => {
      const summary = await service.generateSymbolSummary(mockSymbol, mockCode);

      expect(summary.symbolKind).toBe('function');
    });
  });

  describe('generateFileSummary', () => {
    const mockParsedFile: ParsedFile = {
      path: 'src/utils/helpers.ts',
      content: 'export function helper() { return 1; }',
      language: 'typescript',
      symbols: [],
      imports: [],
      exports: [{ name: 'helper', type: 'function' }]
    };

    const mockSymbolSummaries: HierarchicalSummaryPayload[] = [
      {
        id: 'symbol:src/utils/helpers.ts:helper',
        file: 'src/utils/helpers.ts',
        language: 'typescript',
        level: 1,
        path: 'src/utils/helpers.ts:helper',
        summary: 'Helper function',
        keywords: ['helper'],
        contentHash: 'abc123',
        lastModified: Date.now()
      }
    ];

    it('should generate file summary using LLM', async () => {
      const summary = await service.generateFileSummary(mockParsedFile, mockSymbolSummaries);

      expect(summary).toBeDefined();
      expect(summary.id).toBe('file:src/utils/helpers.ts');
      expect(summary.level).toBe(2);
      expect(summary.summary).toBe('Test summary');
      expect(mockContext.generateSummary).toHaveBeenCalled();
    });

    it('should use fallback for file summary', async () => {
      const fallbackService = createHierarchicalSummaryService(
        mockVectorManager as any,
        mockGraphManager as any,
        { useFallback: true }
      );

      const summary = await fallbackService.generateFileSummary(mockParsedFile, mockSymbolSummaries);

      expect(summary.summary).toContain('typescript');
      expect(summary.summary).toContain('helper');
    });

    it('should set correct parent for nested files', async () => {
      const summary = await service.generateFileSummary(mockParsedFile, mockSymbolSummaries);

      expect(summary.parent).toBe('dir:src/utils');
    });

    it('should set repo as parent for root files', async () => {
      const rootFile: ParsedFile = {
        ...mockParsedFile,
        path: 'index.ts'
      };

      const summary = await service.generateFileSummary(rootFile, mockSymbolSummaries);

      expect(summary.parent).toBe('repo:test-repo');
    });

    it('should include children references', async () => {
      const summary = await service.generateFileSummary(mockParsedFile, mockSymbolSummaries);

      expect(summary.children).toContain('symbol:src/utils/helpers.ts:helper');
    });

    it('should include symbolCount and languages', async () => {
      const summary = await service.generateFileSummary(mockParsedFile, mockSymbolSummaries);

      expect(summary.symbolCount).toBe(1);
      expect(summary.languages).toContain('typescript');
    });
  });

  describe('generateDirectorySummary', () => {
    const mockFileSummaries: HierarchicalSummaryPayload[] = [
      {
        id: 'file:src/utils/helpers.ts',
        file: 'src/utils/helpers.ts',
        language: 'typescript',
        level: 2,
        path: 'src/utils/helpers.ts',
        summary: 'Helper utilities',
        keywords: ['helper', 'utils'],
        contentHash: 'abc123',
        symbolCount: 5,
        languages: ['typescript'],
        lastModified: Date.now()
      },
      {
        id: 'file:src/utils/format.ts',
        file: 'src/utils/format.ts',
        language: 'typescript',
        level: 2,
        path: 'src/utils/format.ts',
        summary: 'Formatting utilities',
        keywords: ['format', 'utils'],
        contentHash: 'def456',
        symbolCount: 3,
        languages: ['typescript'],
        lastModified: Date.now()
      }
    ];

    it('should generate directory summary using LLM', async () => {
      const summary = await service.generateDirectorySummary('src/utils', mockFileSummaries);

      expect(summary).toBeDefined();
      expect(summary.id).toBe('dir:src/utils');
      expect(summary.level).toBe(3);
      expect(summary.summary).toBe('Test summary');
    });

    it('should use fallback for directory summary', async () => {
      const fallbackService = createHierarchicalSummaryService(
        mockVectorManager as any,
        mockGraphManager as any,
        { useFallback: true }
      );

      const summary = await fallbackService.generateDirectorySummary('src/utils', mockFileSummaries);

      expect(summary.summary).toContain('utils');
      expect(summary.summary).toContain('2');
    });

    it('should set correct parent directory', async () => {
      const summary = await service.generateDirectorySummary('src/utils', mockFileSummaries);

      expect(summary.parent).toBe('dir:src');
    });

    it('should set repo as parent for top-level dirs', async () => {
      const summary = await service.generateDirectorySummary('src', mockFileSummaries);

      expect(summary.parent).toBe('repo:test-repo');
    });

    it('should aggregate symbolCount and fileCount', async () => {
      const summary = await service.generateDirectorySummary('src/utils', mockFileSummaries);

      expect(summary.symbolCount).toBe(8); // 5 + 3
      expect(summary.fileCount).toBe(2);
    });

    it('should aggregate languages from files', async () => {
      const mixedFiles: HierarchicalSummaryPayload[] = [
        { ...mockFileSummaries[0], languages: ['typescript'] },
        { ...mockFileSummaries[1], languages: ['javascript'] }
      ];

      const summary = await service.generateDirectorySummary('src/utils', mixedFiles);

      expect(summary.languages).toContain('typescript');
      expect(summary.languages).toContain('javascript');
    });

    it('should aggregate keywords from child summaries', async () => {
      const fallbackService = createHierarchicalSummaryService(
        mockVectorManager as any,
        mockGraphManager as any,
        { useFallback: true }
      );

      const summary = await fallbackService.generateDirectorySummary('src/utils', mockFileSummaries);

      expect(summary.keywords).toContain('helper');
      expect(summary.keywords).toContain('format');
      expect(summary.keywords).toContain('utils');
    });
  });

  describe('generateAllSummaries', () => {
    const mockParsedFiles: ParsedFile[] = [
      {
        path: 'src/index.ts',
        content: 'export function main() { return 1; }',
        language: 'typescript',
        symbols: [
          {
            name: 'main',
            qualifiedName: 'src/index.ts:main',
            kind: 'function',
            file: 'src/index.ts',
            startLine: 1,
            endLine: 1
          }
        ],
        imports: [],
        exports: [{ name: 'main', type: 'function' }]
      },
      {
        path: 'src/utils/helper.ts',
        content: 'export function helper() { return 2; }',
        language: 'typescript',
        symbols: [
          {
            name: 'helper',
            qualifiedName: 'src/utils/helper.ts:helper',
            kind: 'function',
            file: 'src/utils/helper.ts',
            startLine: 1,
            endLine: 1
          }
        ],
        imports: [],
        exports: [{ name: 'helper', type: 'function' }]
      }
    ];

    it('should generate summaries at all levels', async () => {
      const result = await service.generateAllSummaries(mockParsedFiles);

      expect(result.count).toBeGreaterThan(0);
      expect(result.byLevel[1]).toBeGreaterThan(0); // Symbol summaries
      expect(result.byLevel[2]).toBeGreaterThan(0); // File summaries
      expect(result.byLevel[3]).toBeGreaterThan(0); // Directory summaries
    });

    it('should store summaries in vector database', async () => {
      await service.generateAllSummaries(mockParsedFiles);

      expect(mockVectorManager.embedBatch).toHaveBeenCalled();
      expect(mockVectorManager.upsertSummaryBatch).toHaveBeenCalled();
    });

    it('should report errors without failing', async () => {
      // Mock a failure for one symbol
      const errorContext: SummaryContext = {
        generateSummary: vi.fn()
          .mockResolvedValueOnce('SUMMARY: Good summary\nKEYWORDS: good')
          .mockRejectedValueOnce(new Error('LLM error'))
          .mockResolvedValue('SUMMARY: Good summary\nKEYWORDS: good'),
        useFallback: false
      };

      const errorService = createHierarchicalSummaryService(
        mockVectorManager as any,
        mockGraphManager as any,
        errorContext
      );

      const result = await errorService.generateAllSummaries(mockParsedFiles);

      // Should have some errors but still generate some summaries
      expect(result.count).toBeGreaterThan(0);
    });

    it('should process directories bottom-up', async () => {
      const result = await service.generateAllSummaries(mockParsedFiles);

      // Should have created a directory summary for src/utils
      expect(result.byLevel[3]).toBeGreaterThan(0);
    });

    it('should respect maxSymbolsPerFile option', async () => {
      const fileWithManySymbols: ParsedFile = {
        path: 'src/big.ts',
        content: 'many symbols',
        language: 'typescript',
        symbols: Array(100).fill(null).map((_, i) => ({
          name: `func${i}`,
          qualifiedName: `src/big.ts:func${i}`,
          kind: 'function',
          file: 'src/big.ts',
          startLine: i,
          endLine: i
        })),
        imports: [],
        exports: []
      };

      const result = await service.generateAllSummaries([fileWithManySymbols], {
        maxSymbolsPerFile: 10
      });

      // Should have limited to 10 symbol summaries
      expect(result.byLevel[1]).toBeLessThanOrEqual(10);
    });
  });

  describe('cache management', () => {
    it('should clear cache', async () => {
      const mockSymbol: SymbolNode = {
        name: 'test',
        qualifiedName: 'test:test',
        kind: 'function',
        file: 'test.ts',
        startLine: 1,
        endLine: 1
      };

      await service.generateSymbolSummary(mockSymbol, 'code');
      expect(service.getCacheStats().size).toBe(1);

      service.clearCache();

      expect(service.getCacheStats().size).toBe(0);
    });

    it('should report cache stats', async () => {
      const stats = service.getCacheStats();

      expect(stats).toHaveProperty('size');
      expect(typeof stats.size).toBe('number');
    });
  });

  describe('LLM response parsing', () => {
    it('should parse well-formatted response', async () => {
      vi.mocked(mockContext.generateSummary!).mockResolvedValueOnce(
        'SUMMARY: This is a well-formatted summary.\nKEYWORDS: auth, login, session'
      );

      const mockSymbol: SymbolNode = {
        name: 'login',
        qualifiedName: 'auth:login',
        kind: 'function',
        file: 'auth.ts',
        startLine: 1,
        endLine: 10
      };

      const summary = await service.generateSymbolSummary(mockSymbol, 'function login() {}');

      expect(summary.summary).toBe('This is a well-formatted summary.');
      expect(summary.keywords).toEqual(['auth', 'login', 'session']);
    });

    it('should handle malformed response gracefully', async () => {
      vi.mocked(mockContext.generateSummary!).mockResolvedValueOnce(
        'Just a plain response without markers'
      );

      const mockSymbol: SymbolNode = {
        name: 'test',
        qualifiedName: 'test:test',
        kind: 'function',
        file: 'test.ts',
        startLine: 1,
        endLine: 1
      };

      const summary = await service.generateSymbolSummary(mockSymbol, 'code');

      // Should use the raw response as summary
      expect(summary.summary).toBe('Just a plain response without markers');
      expect(summary.keywords).toEqual([]);
    });
  });
});

/**
 * Traversal Service Tests
 * Tests for traversal-aware context retrieval
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TraversalService, createTraversalService } from './traversal-service.js';
import { TraversalPosition, TraverseContextArgs, TraversalSession } from '@cv-git/shared';

// Default mock data
const defaultSymbols = [
  { name: 'func1', qualifiedName: 'src/index.ts:func1', kind: 'function', file: 'src/index.ts' },
  { name: 'func2', qualifiedName: 'src/index.ts:func2', kind: 'function', file: 'src/index.ts' }
];

const defaultFiles = [
  { path: 'src/index.ts' },
  { path: 'src/utils/helper.ts' },
  { path: 'lib/main.ts' }
];

// Mock GraphManager
const mockGraphManager = {
  query: vi.fn().mockResolvedValue(defaultFiles),
  getFileSymbols: vi.fn().mockResolvedValue(defaultSymbols),
  getCallers: vi.fn().mockResolvedValue([]),
  getCallees: vi.fn().mockResolvedValue([]),
  getFileDependencies: vi.fn().mockResolvedValue([]),
  getSymbolWithVectors: vi.fn().mockResolvedValue(null)
};

// Mock VectorManager
const mockVectorManager = {
  getRepoId: vi.fn().mockReturnValue('test-repo'),
  getSummary: vi.fn().mockResolvedValue(null)
};

// Mock GraphService
const mockGraphService = {
  getVectorsForSymbol: vi.fn().mockResolvedValue(null)
};

// Mock SessionService
const createMockSession = (): TraversalSession => ({
  id: 'test-session-123',
  position: { depth: 0, timestamp: Date.now() },
  history: [],
  createdAt: Date.now(),
  lastActivityAt: Date.now()
});

const mockSessionService = {
  getSession: vi.fn().mockResolvedValue(createMockSession()),
  updateSession: vi.fn().mockResolvedValue(undefined)
};

describe('TraversalService', () => {
  let service: TraversalService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock implementations to defaults
    mockGraphManager.query.mockResolvedValue(defaultFiles);
    mockGraphManager.getFileSymbols.mockResolvedValue(defaultSymbols);
    mockGraphManager.getCallers.mockResolvedValue([]);
    mockGraphManager.getCallees.mockResolvedValue([]);
    mockGraphManager.getFileDependencies.mockResolvedValue([]);
    mockGraphManager.getSymbolWithVectors.mockResolvedValue(null);
    mockVectorManager.getSummary.mockResolvedValue(null);
    mockGraphService.getVectorsForSymbol.mockResolvedValue(null);
    mockSessionService.getSession.mockResolvedValue(createMockSession());
    mockSessionService.updateSession.mockResolvedValue(undefined);

    service = createTraversalService(
      mockGraphManager as any,
      mockVectorManager as any,
      mockGraphService as any,
      mockSessionService as any
    );
  });

  describe('createTraversalService factory', () => {
    it('should create a TraversalService instance', () => {
      const svc = createTraversalService(
        mockGraphManager as any,
        mockVectorManager as any,
        mockGraphService as any,
        mockSessionService as any
      );
      expect(svc).toBeInstanceOf(TraversalService);
    });

    it('should accept custom options', () => {
      const svc = createTraversalService(
        mockGraphManager as any,
        mockVectorManager as any,
        mockGraphService as any,
        mockSessionService as any,
        { defaultBudget: 8000 }
      );
      expect(svc).toBeDefined();
    });
  });

  describe('traverse', () => {
    it('should create session if not provided', async () => {
      const result = await service.traverse({
        direction: 'jump'
      });

      expect(result.sessionId).toBe('test-session-123');
      expect(mockSessionService.getSession).toHaveBeenCalledWith(undefined);
    });

    it('should use existing session if provided', async () => {
      const result = await service.traverse({
        direction: 'jump',
        sessionId: 'existing-session'
      });

      expect(mockSessionService.getSession).toHaveBeenCalledWith('existing-session');
    });

    it('should update session with new position', async () => {
      await service.traverse({
        file: 'src/test.ts',
        direction: 'jump'
      });

      expect(mockSessionService.updateSession).toHaveBeenCalled();
      const updateCall = mockSessionService.updateSession.mock.calls[0];
      expect(updateCall[1].file).toBe('src/test.ts');
    });

    it('should return context and hints', async () => {
      const result = await service.traverse({
        direction: 'jump'
      });

      expect(result).toHaveProperty('position');
      expect(result).toHaveProperty('sessionId');
      expect(result).toHaveProperty('context');
      expect(result).toHaveProperty('hints');
    });
  });

  describe('direction: jump', () => {
    it('should jump to symbol level when symbol provided', async () => {
      const result = await service.traverse({
        symbol: 'myFunction',
        file: 'src/test.ts',
        direction: 'jump'
      });

      expect(result.position.depth).toBe(3);
      expect(result.position.symbol).toBe('myFunction');
      expect(result.position.file).toBe('src/test.ts');
    });

    it('should jump to file level when only file provided', async () => {
      const result = await service.traverse({
        file: 'src/test.ts',
        direction: 'jump'
      });

      expect(result.position.depth).toBe(2);
      expect(result.position.file).toBe('src/test.ts');
      expect(result.position.symbol).toBeUndefined();
    });

    it('should jump to module level when only module provided', async () => {
      const result = await service.traverse({
        module: 'src/utils',
        direction: 'jump'
      });

      expect(result.position.depth).toBe(1);
      expect(result.position.module).toBe('src/utils');
    });

    it('should jump to repo level when nothing provided', async () => {
      const result = await service.traverse({
        direction: 'jump'
      });

      expect(result.position.depth).toBe(0);
    });
  });

  describe('direction: in', () => {
    it('should drill from repo to module', async () => {
      mockSessionService.getSession.mockResolvedValueOnce({
        ...createMockSession(),
        position: { depth: 0, timestamp: Date.now() }
      });

      const result = await service.traverse({
        direction: 'in'
      });

      expect(result.position.depth).toBe(1);
      expect(result.position.module).toBeDefined();
    });

    it('should drill from module to file', async () => {
      mockSessionService.getSession.mockResolvedValueOnce({
        ...createMockSession(),
        position: { depth: 1, module: 'src', timestamp: Date.now() }
      });
      mockGraphManager.query.mockResolvedValueOnce([
        { path: 'src/index.ts' }
      ]);

      const result = await service.traverse({
        direction: 'in'
      });

      expect(result.position.depth).toBe(2);
      expect(result.position.file).toBeDefined();
    });

    it('should drill from file to symbol', async () => {
      mockSessionService.getSession.mockResolvedValueOnce({
        ...createMockSession(),
        position: { depth: 2, file: 'src/index.ts', module: 'src', timestamp: Date.now() }
      });

      const result = await service.traverse({
        direction: 'in'
      });

      expect(result.position.depth).toBe(3);
      expect(result.position.symbol).toBeDefined();
    });

    it('should stay at symbol level when already there', async () => {
      mockSessionService.getSession.mockResolvedValueOnce({
        ...createMockSession(),
        position: { depth: 3, symbol: 'func1', file: 'src/index.ts', module: 'src', timestamp: Date.now() }
      });

      const result = await service.traverse({
        direction: 'in'
      });

      expect(result.position.depth).toBe(3);
    });

    it('should use provided target when drilling in', async () => {
      mockSessionService.getSession.mockResolvedValueOnce({
        ...createMockSession(),
        position: { depth: 2, file: 'src/index.ts', module: 'src', timestamp: Date.now() }
      });

      const result = await service.traverse({
        direction: 'in',
        symbol: 'specificFunction'
      });

      expect(result.position.symbol).toBe('specificFunction');
    });
  });

  describe('direction: out', () => {
    it('should move from symbol to file', async () => {
      mockSessionService.getSession.mockResolvedValueOnce({
        ...createMockSession(),
        position: { depth: 3, symbol: 'func1', file: 'src/index.ts', module: 'src', timestamp: Date.now() }
      });

      const result = await service.traverse({
        direction: 'out'
      });

      expect(result.position.depth).toBe(2);
      expect(result.position.file).toBe('src/index.ts');
      expect(result.position.symbol).toBeUndefined();
    });

    it('should move from file to module', async () => {
      mockSessionService.getSession.mockResolvedValueOnce({
        ...createMockSession(),
        position: { depth: 2, file: 'src/index.ts', module: 'src', timestamp: Date.now() }
      });

      const result = await service.traverse({
        direction: 'out'
      });

      expect(result.position.depth).toBe(1);
      expect(result.position.module).toBe('src');
    });

    it('should move from module to repo', async () => {
      mockSessionService.getSession.mockResolvedValueOnce({
        ...createMockSession(),
        position: { depth: 1, module: 'src', timestamp: Date.now() }
      });

      const result = await service.traverse({
        direction: 'out'
      });

      expect(result.position.depth).toBe(0);
    });

    it('should stay at repo level when already there', async () => {
      mockSessionService.getSession.mockResolvedValueOnce({
        ...createMockSession(),
        position: { depth: 0, timestamp: Date.now() }
      });

      const result = await service.traverse({
        direction: 'out'
      });

      expect(result.position.depth).toBe(0);
    });
  });

  describe('direction: lateral', () => {
    it('should move to sibling symbol', async () => {
      mockSessionService.getSession.mockResolvedValueOnce({
        ...createMockSession(),
        position: { depth: 3, symbol: 'func1', file: 'src/index.ts', module: 'src', timestamp: Date.now() }
      });

      const result = await service.traverse({
        direction: 'lateral'
      });

      expect(result.position.depth).toBe(3);
      expect(result.position.symbol).toBe('src/index.ts:func2'); // Next symbol
    });

    it('should wrap around to first symbol', async () => {
      mockSessionService.getSession.mockResolvedValueOnce({
        ...createMockSession(),
        position: { depth: 3, symbol: 'src/index.ts:func2', file: 'src/index.ts', module: 'src', timestamp: Date.now() }
      });

      const result = await service.traverse({
        direction: 'lateral'
      });

      expect(result.position.symbol).toBe('src/index.ts:func1'); // Wrapped to first
    });

    it('should move to sibling file', async () => {
      mockSessionService.getSession.mockResolvedValueOnce({
        ...createMockSession(),
        position: { depth: 2, file: 'src/index.ts', module: 'src', timestamp: Date.now() }
      });
      mockGraphManager.query.mockResolvedValueOnce([
        { path: 'src/index.ts' },
        { path: 'src/other.ts' }
      ]);

      const result = await service.traverse({
        direction: 'lateral'
      });

      expect(result.position.depth).toBe(2);
      expect(result.position.file).toBe('src/other.ts');
    });

    it('should move to sibling module', async () => {
      mockSessionService.getSession.mockResolvedValueOnce({
        ...createMockSession(),
        position: { depth: 1, module: 'src', timestamp: Date.now() }
      });

      const result = await service.traverse({
        direction: 'lateral'
      });

      expect(result.position.depth).toBe(1);
      expect(result.position.module).toBeDefined();
    });
  });

  describe('direction: stay', () => {
    it('should stay at current position but update timestamp', async () => {
      const originalTimestamp = Date.now() - 1000;
      mockSessionService.getSession.mockResolvedValueOnce({
        ...createMockSession(),
        position: { depth: 2, file: 'src/test.ts', module: 'src', timestamp: originalTimestamp }
      });

      const result = await service.traverse({
        direction: 'stay'
      });

      expect(result.position.depth).toBe(2);
      expect(result.position.file).toBe('src/test.ts');
      expect(result.position.timestamp).toBeGreaterThan(originalTimestamp);
    });
  });

  describe('context retrieval', () => {
    describe('symbol context', () => {
      it('should include code when available', async () => {
        mockGraphManager.getSymbolWithVectors.mockResolvedValueOnce({
          symbol: { qualifiedName: 'test:func', name: 'func', kind: 'function', file: 'test.ts' }
        });
        mockGraphService.getVectorsForSymbol.mockResolvedValueOnce({
          vectors: [{ payload: { text: 'function code here' } }]
        });

        const result = await service.traverse({
          symbol: 'func',
          file: 'test.ts',
          direction: 'jump'
        });

        expect(result.context.code).toBe('function code here');
      });

      it('should include callers when requested', async () => {
        mockGraphManager.getSymbolWithVectors.mockResolvedValueOnce({
          symbol: { qualifiedName: 'test:func', name: 'func', kind: 'function', file: 'test.ts' }
        });
        mockGraphManager.getCallers.mockResolvedValueOnce([
          { name: 'caller1', file: 'other.ts' }
        ]);

        const result = await service.traverse({
          symbol: 'func',
          file: 'test.ts',
          direction: 'jump',
          includeCallers: true
        });

        expect(result.context.callers).toHaveLength(1);
        expect(result.context.callers![0].name).toBe('caller1');
      });

      it('should include callees when requested', async () => {
        mockGraphManager.getSymbolWithVectors.mockResolvedValueOnce({
          symbol: { qualifiedName: 'test:func', name: 'func', kind: 'function', file: 'test.ts' }
        });
        mockGraphManager.getCallees.mockResolvedValueOnce([
          { name: 'callee1', file: 'dep.ts' }
        ]);

        const result = await service.traverse({
          symbol: 'func',
          file: 'test.ts',
          direction: 'jump',
          includeCallees: true
        });

        expect(result.context.callees).toHaveLength(1);
        expect(result.context.callees![0].name).toBe('callee1');
      });

      it('should include summary when available', async () => {
        mockGraphManager.getSymbolWithVectors.mockResolvedValueOnce({
          symbol: { qualifiedName: 'test:func', name: 'func', kind: 'function', file: 'test.ts' }
        });
        mockVectorManager.getSummary.mockResolvedValueOnce({
          summary: 'This function does something important'
        });

        const result = await service.traverse({
          symbol: 'func',
          file: 'test.ts',
          direction: 'jump'
        });

        expect(result.context.summary).toBe('This function does something important');
      });
    });

    describe('file context', () => {
      it('should include symbol list', async () => {
        const result = await service.traverse({
          file: 'src/index.ts',
          direction: 'jump'
        });

        expect(result.context.symbols).toHaveLength(2);
        expect(result.context.symbols![0].name).toBe('func1');
      });

      it('should include imports', async () => {
        mockGraphManager.getFileDependencies.mockResolvedValueOnce([
          './helper',
          'lodash'
        ]);

        const result = await service.traverse({
          file: 'src/index.ts',
          direction: 'jump'
        });

        expect(result.context.imports).toContain('./helper');
        expect(result.context.imports).toContain('lodash');
      });

      it('should include file summary when available', async () => {
        mockVectorManager.getSummary.mockResolvedValueOnce({
          summary: 'Main entry point for the application'
        });

        const result = await service.traverse({
          file: 'src/index.ts',
          direction: 'jump'
        });

        expect(result.context.summary).toBe('Main entry point for the application');
      });
    });

    describe('module context', () => {
      it('should include file list', async () => {
        mockGraphManager.query.mockResolvedValueOnce([
          { path: 'src/index.ts' },
          { path: 'src/utils.ts' }
        ]);

        const result = await service.traverse({
          module: 'src',
          direction: 'jump'
        });

        expect(result.context.files).toBeDefined();
      });

      it('should include directory summary when available', async () => {
        mockVectorManager.getSummary.mockResolvedValueOnce({
          summary: 'Source code directory'
        });

        const result = await service.traverse({
          module: 'src',
          direction: 'jump'
        });

        expect(result.context.summary).toBe('Source code directory');
      });
    });

    describe('repo context', () => {
      it('should include top-level modules', async () => {
        const result = await service.traverse({
          direction: 'jump'
        });

        expect(result.context.files).toBeDefined();
      });

      it('should include repo summary when available', async () => {
        mockVectorManager.getSummary.mockResolvedValueOnce({
          summary: 'A TypeScript project for code analysis'
        });

        const result = await service.traverse({
          direction: 'jump'
        });

        expect(result.context.summary).toBe('A TypeScript project for code analysis');
      });
    });
  });

  describe('navigation hints', () => {
    it('should suggest modules at repo level', async () => {
      const result = await service.traverse({
        direction: 'jump'
      });

      expect(result.hints.some(h => h.includes('Navigate to modules'))).toBe(true);
    });

    it('should suggest files at module level', async () => {
      mockGraphManager.query.mockResolvedValueOnce([
        { path: 'src/index.ts' }
      ]);

      const result = await service.traverse({
        module: 'src',
        direction: 'jump'
      });

      expect(result.hints.some(h => h.includes('Files in'))).toBe(true);
    });

    it('should suggest symbols at file level', async () => {
      const result = await service.traverse({
        file: 'src/index.ts',
        direction: 'jump'
      });

      // Now shows "Public:" or "Functions:" or "Classes/Interfaces:" based on symbol types
      expect(result.hints.some(h =>
        h.includes('Public') || h.includes('Functions') || h.includes('Classes')
      )).toBe(true);
    });

    it('should suggest navigation options at symbol level', async () => {
      mockGraphManager.getSymbolWithVectors.mockResolvedValueOnce({
        symbol: { qualifiedName: 'test:func', name: 'func', kind: 'function', file: 'test.ts' }
      });

      const result = await service.traverse({
        symbol: 'func',
        file: 'test.ts',
        direction: 'jump'
      });

      expect(result.hints.some(h => h.includes('direction="out"'))).toBe(true);
    });
  });

  describe('options', () => {
    it('should use default budget when not specified', async () => {
      const serviceWithBudget = createTraversalService(
        mockGraphManager as any,
        mockVectorManager as any,
        mockGraphService as any,
        mockSessionService as any,
        { defaultBudget: 8000 }
      );

      const result = await serviceWithBudget.traverse({
        direction: 'jump'
      });

      expect(result).toBeDefined();
    });

    it('should include callers by default based on options', async () => {
      const serviceWithCallers = createTraversalService(
        mockGraphManager as any,
        mockVectorManager as any,
        mockGraphService as any,
        mockSessionService as any,
        { includeCallersByDefault: true }
      );

      mockGraphManager.getSymbolWithVectors.mockResolvedValueOnce({
        symbol: { qualifiedName: 'test:func', name: 'func', kind: 'function', file: 'test.ts' }
      });
      mockGraphManager.getCallers.mockResolvedValueOnce([
        { name: 'caller', file: 'other.ts' }
      ]);

      const result = await serviceWithCallers.traverse({
        symbol: 'func',
        file: 'test.ts',
        direction: 'jump'
      });

      expect(mockGraphManager.getCallers).toHaveBeenCalled();
    });
  });

  describe('caching', () => {
    it('should enable caching by default', () => {
      const stats = service.getCacheStats();
      expect(stats).not.toBeNull();
      expect(stats?.maxEntries).toBe(1000);
      expect(stats?.ttlMs).toBe(60000);
    });

    it('should respect enableCaching=false option', () => {
      const uncachedService = createTraversalService(
        mockGraphManager as any,
        mockVectorManager as any,
        mockGraphService as any,
        mockSessionService as any,
        { enableCaching: false }
      );

      expect(uncachedService.getCacheStats()).toBeNull();
    });

    it('should use custom cache options', () => {
      const customService = createTraversalService(
        mockGraphManager as any,
        mockVectorManager as any,
        mockGraphService as any,
        mockSessionService as any,
        { cacheTtlMs: 30000, maxCacheEntries: 500 }
      );

      const stats = customService.getCacheStats();
      expect(stats?.maxEntries).toBe(500);
      expect(stats?.ttlMs).toBe(30000);
    });

    it('should cache module list', async () => {
      // First call
      await service.traverse({ direction: 'jump' });

      // Second call - should use cache
      await service.traverse({ direction: 'jump' });

      // graph.query should only be called once for modules
      const queryCalls = mockGraphManager.query.mock.calls.filter(
        call => call[0].includes('MATCH (f:File)')
      );
      expect(queryCalls.length).toBe(1);
    });

    it('should cache file symbols', async () => {
      // First call - navigate to file
      await service.traverse({ file: 'src/index.ts', direction: 'jump' });

      // Second call - should use cached symbols
      await service.traverse({ file: 'src/index.ts', direction: 'jump' });

      // getFileSymbols should only be called once
      expect(mockGraphManager.getFileSymbols).toHaveBeenCalledTimes(1);
    });

    it('should cache summaries', async () => {
      mockVectorManager.getSummary.mockResolvedValue({
        summary: 'Test summary'
      });

      // First call
      await service.traverse({ file: 'src/index.ts', direction: 'jump' });

      // Second call - should use cached summary
      await service.traverse({ file: 'src/index.ts', direction: 'jump' });

      // getSummary should only be called once for file:src/index.ts
      const summaryCalls = mockVectorManager.getSummary.mock.calls.filter(
        call => call[0] === 'file:src/index.ts'
      );
      expect(summaryCalls.length).toBe(1);
    });

    it('should allow cache invalidation', async () => {
      // First call
      await service.traverse({ direction: 'jump' });

      // Invalidate cache
      service.invalidateCache();

      // Second call - should fetch again
      await service.traverse({ direction: 'jump' });

      // query should be called twice now
      const queryCalls = mockGraphManager.query.mock.calls.filter(
        call => call[0].includes('MATCH (f:File)')
      );
      expect(queryCalls.length).toBe(2);
    });

    it('should allow pattern-based cache invalidation', async () => {
      // Navigate to multiple files
      await service.traverse({ file: 'src/index.ts', direction: 'jump' });
      await service.traverse({ file: 'lib/main.ts', direction: 'jump' });

      // Invalidate only src files
      service.invalidateCache('src/');

      // Navigate again
      await service.traverse({ file: 'src/index.ts', direction: 'jump' });
      await service.traverse({ file: 'lib/main.ts', direction: 'jump' });

      // src/index.ts should have been re-fetched (2 calls)
      // lib/main.ts should still be cached (1 call)
      const srcCalls = mockGraphManager.getFileSymbols.mock.calls.filter(
        call => call[0] === 'src/index.ts'
      );
      const libCalls = mockGraphManager.getFileSymbols.mock.calls.filter(
        call => call[0] === 'lib/main.ts'
      );
      expect(srcCalls.length).toBe(2);
      expect(libCalls.length).toBe(1);
    });

    it('should track cache size', async () => {
      // Initial size is 0
      expect(service.getCacheStats()?.size).toBe(0);

      // Navigate and populate cache
      await service.traverse({ direction: 'jump' });

      // Cache should have entries now
      expect(service.getCacheStats()?.size).toBeGreaterThan(0);
    });
  });

  describe('enhanced hints', () => {
    it('should suggest entry point files in module', async () => {
      mockGraphManager.query.mockResolvedValueOnce([
        { path: 'src/index.ts' },
        { path: 'src/main.ts' },
        { path: 'src/utils.ts' }
      ]);

      const result = await service.traverse({
        module: 'src',
        direction: 'jump'
      });

      expect(result.hints.some(h => h.includes('Entry points'))).toBe(true);
    });

    it('should show caller/callee hints at symbol level', async () => {
      mockGraphManager.getSymbolWithVectors.mockResolvedValueOnce({
        symbol: { qualifiedName: 'test:func', name: 'func', kind: 'function', file: 'test.ts' }
      });
      mockGraphManager.getCallers.mockResolvedValue([
        { name: 'caller1', file: 'a.ts' },
        { name: 'caller2', file: 'b.ts' }
      ]);
      mockGraphManager.getCallees.mockResolvedValue([
        { name: 'callee1', file: 'c.ts' }
      ]);

      const result = await service.traverse({
        symbol: 'func',
        file: 'test.ts',
        direction: 'jump',
        includeCallers: true
      });

      expect(result.hints.some(h => h.includes('Called by'))).toBe(true);
      expect(result.hints.some(h => h.includes('Calls'))).toBe(true);
    });

    it('should show classes/interfaces when present', async () => {
      mockGraphManager.getFileSymbols.mockResolvedValueOnce([
        { name: 'MyClass', qualifiedName: 'test:MyClass', kind: 'class', file: 'test.ts', visibility: 'public' },
        { name: 'MyInterface', qualifiedName: 'test:MyInterface', kind: 'interface', file: 'test.ts', visibility: 'public' }
      ]);

      const result = await service.traverse({
        file: 'test.ts',
        direction: 'jump'
      });

      expect(result.hints.some(h => h.includes('Classes/Interfaces'))).toBe(true);
    });
  });

  describe('related symbols', () => {
    it('should not include related symbols by default', async () => {
      mockGraphManager.getSymbolWithVectors.mockResolvedValueOnce({
        symbol: { qualifiedName: 'test:func', name: 'func', kind: 'function', file: 'test.ts' }
      });
      mockVectorManager.getSummary.mockResolvedValueOnce({
        summary: 'Test function'
      });

      const result = await service.traverse({
        symbol: 'func',
        file: 'test.ts',
        direction: 'jump'
      });

      expect(result.context.relatedSymbols).toBeUndefined();
    });

    it('should include related symbols when requested via args', async () => {
      // Create service with related symbols search mocked
      const serviceWithRelated = createTraversalService(
        mockGraphManager as any,
        {
          ...mockVectorManager,
          searchByLevel: vi.fn().mockResolvedValue([
            {
              payload: { _id: 'symbol:other.ts:relatedFunc', file: 'other.ts', summary: 'Related function' },
              score: 0.85
            }
          ])
        } as any,
        mockGraphService as any,
        mockSessionService as any,
        { includeRelatedSymbols: false } // Default off
      );

      mockGraphManager.getSymbolWithVectors.mockResolvedValueOnce({
        symbol: { qualifiedName: 'test:func', name: 'func', kind: 'function', file: 'test.ts' }
      });
      mockVectorManager.getSummary.mockResolvedValueOnce({
        summary: 'Test function'
      });

      const result = await serviceWithRelated.traverse({
        symbol: 'func',
        file: 'test.ts',
        direction: 'jump',
        includeRelated: true
      });

      expect(result.context.relatedSymbols).toBeDefined();
      expect(result.context.relatedSymbols!.length).toBeGreaterThan(0);
      expect(result.context.relatedSymbols![0].name).toBe('relatedFunc');
    });

    it('should include related symbols when enabled in options', async () => {
      const serviceWithRelated = createTraversalService(
        mockGraphManager as any,
        {
          ...mockVectorManager,
          searchByLevel: vi.fn().mockResolvedValue([
            {
              payload: { _id: 'symbol:other.ts:helper', file: 'other.ts', summary: 'Helper function' },
              score: 0.9
            }
          ])
        } as any,
        mockGraphService as any,
        mockSessionService as any,
        { includeRelatedSymbols: true }
      );

      mockGraphManager.getSymbolWithVectors.mockResolvedValueOnce({
        symbol: { qualifiedName: 'test:func', name: 'func', kind: 'function', file: 'test.ts' }
      });
      mockVectorManager.getSummary.mockResolvedValueOnce({
        summary: 'Test function'
      });

      const result = await serviceWithRelated.traverse({
        symbol: 'func',
        file: 'test.ts',
        direction: 'jump'
      });

      expect(result.context.relatedSymbols).toBeDefined();
    });

    it('should respect maxRelatedSymbols option', async () => {
      const serviceWithMax = createTraversalService(
        mockGraphManager as any,
        {
          ...mockVectorManager,
          searchByLevel: vi.fn().mockResolvedValue([
            { payload: { _id: 'symbol:a.ts:func1', file: 'a.ts', summary: 'Func 1' }, score: 0.9 },
            { payload: { _id: 'symbol:b.ts:func2', file: 'b.ts', summary: 'Func 2' }, score: 0.8 },
            { payload: { _id: 'symbol:c.ts:func3', file: 'c.ts', summary: 'Func 3' }, score: 0.7 },
            { payload: { _id: 'symbol:d.ts:func4', file: 'd.ts', summary: 'Func 4' }, score: 0.6 }
          ])
        } as any,
        mockGraphService as any,
        mockSessionService as any,
        { includeRelatedSymbols: true, maxRelatedSymbols: 2 }
      );

      mockGraphManager.getSymbolWithVectors.mockResolvedValueOnce({
        symbol: { qualifiedName: 'test:func', name: 'func', kind: 'function', file: 'test.ts' }
      });
      mockVectorManager.getSummary.mockResolvedValueOnce({
        summary: 'Test function'
      });

      const result = await serviceWithMax.traverse({
        symbol: 'func',
        file: 'test.ts',
        direction: 'jump'
      });

      expect(result.context.relatedSymbols).toBeDefined();
      expect(result.context.relatedSymbols!.length).toBe(2);
    });
  });
});

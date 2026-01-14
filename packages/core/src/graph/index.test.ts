/**
 * Unit tests for GraphManager Repository Isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphManager, GraphManagerOptions, createGraphManager } from './index.js';

// Mock redis client to avoid actual connections
vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue('PONG'),
    sendCommand: vi.fn().mockResolvedValue([[], [], []]),
    on: vi.fn(),
    isOpen: true
  }))
}));

describe('GraphManager Repository Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor with options object', () => {
    it('should use repo-specific database when repoId is provided', () => {
      const manager = new GraphManager({
        url: 'redis://localhost:6379',
        repoId: 'abc123def456'
      });

      expect(manager.getDatabaseName()).toBe('cv_abc123def456');
      expect(manager.getRepoId()).toBe('abc123def456');
    });

    it('should use explicit database when database is provided without repoId', () => {
      const manager = new GraphManager({
        url: 'redis://localhost:6379',
        database: 'my-custom-db'
      });

      expect(manager.getDatabaseName()).toBe('my-custom-db');
      expect(manager.getRepoId()).toBeUndefined();
    });

    it('should prefer repoId over explicit database', () => {
      const manager = new GraphManager({
        url: 'redis://localhost:6379',
        repoId: 'abc123',
        database: 'should-be-ignored'
      });

      // repoId takes precedence
      expect(manager.getDatabaseName()).toBe('cv_abc123');
    });

    it('should use default database when neither repoId nor database is provided', () => {
      const manager = new GraphManager({
        url: 'redis://localhost:6379'
      });

      expect(manager.getDatabaseName()).toBe('cv-git');
      expect(manager.getRepoId()).toBeUndefined();
    });
  });

  describe('constructor with legacy signature', () => {
    it('should work with just URL (legacy)', () => {
      const manager = new GraphManager('redis://localhost:6379');

      expect(manager.getDatabaseName()).toBe('cv-git');
      expect(manager.getRepoId()).toBeUndefined();
    });

    it('should work with URL and database (legacy)', () => {
      const manager = new GraphManager('redis://localhost:6379', 'custom-db');

      expect(manager.getDatabaseName()).toBe('custom-db');
      expect(manager.getRepoId()).toBeUndefined();
    });
  });

  describe('createGraphManager factory', () => {
    it('should create manager with options object', () => {
      const manager = createGraphManager({
        url: 'redis://localhost:6379',
        repoId: 'test123'
      });

      expect(manager.getDatabaseName()).toBe('cv_test123');
    });

    it('should create manager with legacy signature', () => {
      const manager = createGraphManager('redis://localhost:6379', 'legacy-db');

      expect(manager.getDatabaseName()).toBe('legacy-db');
    });
  });

  describe('database isolation', () => {
    it('should create different databases for different repos', () => {
      const managerA = new GraphManager({
        url: 'redis://localhost:6379',
        repoId: 'repo-aaa'
      });

      const managerB = new GraphManager({
        url: 'redis://localhost:6379',
        repoId: 'repo-bbb'
      });

      expect(managerA.getDatabaseName()).not.toBe(managerB.getDatabaseName());
      expect(managerA.getDatabaseName()).toBe('cv_repo-aaa');
      expect(managerB.getDatabaseName()).toBe('cv_repo-bbb');
    });

    it('should create same database name for same repoId', () => {
      const manager1 = new GraphManager({
        url: 'redis://localhost:6379',
        repoId: 'same-repo'
      });

      const manager2 = new GraphManager({
        url: 'redis://localhost:6379',
        repoId: 'same-repo'
      });

      expect(manager1.getDatabaseName()).toBe(manager2.getDatabaseName());
    });
  });

  describe('getter methods', () => {
    it('getDatabaseName should return the current database name', () => {
      const manager = new GraphManager({
        url: 'redis://localhost:6379',
        repoId: 'getter-test'
      });

      expect(manager.getDatabaseName()).toBe('cv_getter-test');
    });

    it('getRepoId should return the repoId when set', () => {
      const manager = new GraphManager({
        url: 'redis://localhost:6379',
        repoId: 'my-repo-id'
      });

      expect(manager.getRepoId()).toBe('my-repo-id');
    });

    it('getRepoId should return undefined when not using isolation', () => {
      const manager = new GraphManager({
        url: 'redis://localhost:6379',
        database: 'shared-db'
      });

      expect(manager.getRepoId()).toBeUndefined();
    });
  });

  describe('backward compatibility', () => {
    it('should support all legacy usage patterns', () => {
      // Pattern 1: Just URL
      const m1 = new GraphManager('redis://localhost:6379');
      expect(m1.getDatabaseName()).toBe('cv-git');

      // Pattern 2: URL + database
      const m2 = new GraphManager('redis://localhost:6379', 'my-db');
      expect(m2.getDatabaseName()).toBe('my-db');

      // Pattern 3: Factory with URL
      const m3 = createGraphManager('redis://localhost:6379');
      expect(m3.getDatabaseName()).toBe('cv-git');

      // Pattern 4: Factory with URL + database
      const m4 = createGraphManager('redis://localhost:6379', 'another-db');
      expect(m4.getDatabaseName()).toBe('another-db');
    });
  });
});

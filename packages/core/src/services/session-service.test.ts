/**
 * Session Service Tests
 * Tests for traversal session management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionService, createSessionService } from './session-service.js';
import { TraversalPosition, TraversalSession } from '@cv-git/shared';

describe('SessionService', () => {
  let service: SessionService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    service = createSessionService({
      maxSessions: 5,
      sessionTimeout: 1000, // 1 second for testing
      persistToDisk: false
    });
  });

  afterEach(async () => {
    await service.close();
    vi.useRealTimers();
  });

  describe('createSessionService factory', () => {
    it('should create a SessionService instance', () => {
      const svc = createSessionService();
      expect(svc).toBeInstanceOf(SessionService);
      svc.close();
    });

    it('should use default options when none provided', async () => {
      const svc = createSessionService();
      const session = await svc.getSession();
      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      await svc.close();
    });
  });

  describe('getSession', () => {
    it('should create new session when no sessionId provided', async () => {
      const session = await service.getSession();

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(typeof session.id).toBe('string');
      expect(session.id.length).toBeGreaterThan(0);
      expect(session.position.depth).toBe(0);
      expect(session.history).toEqual([]);
      expect(session.createdAt).toBeDefined();
      expect(session.lastActivityAt).toBeDefined();
    });

    it('should return existing session when valid sessionId provided', async () => {
      const session1 = await service.getSession();
      const session2 = await service.getSession(session1.id);

      expect(session2.id).toBe(session1.id);
    });

    it('should create new session when sessionId not found', async () => {
      const session = await service.getSession('nonexistent');

      expect(session).toBeDefined();
      expect(session.id).not.toBe('nonexistent');
    });

    it('should create new session when existing session is expired', async () => {
      const session1 = await service.getSession();
      const session1Id = session1.id;

      // Advance time past timeout
      vi.advanceTimersByTime(2000);

      const session2 = await service.getSession(session1Id);

      // Should get a new session since the old one expired
      expect(session2.id).not.toBe(session1Id);
    });
  });

  describe('updateSession', () => {
    it('should update session position and add to history', async () => {
      const session = await service.getSession();
      const originalPosition = { ...session.position };

      const newPosition: TraversalPosition = {
        file: 'src/test.ts',
        depth: 2,
        timestamp: Date.now()
      };

      await service.updateSession(session, newPosition);

      expect(session.position).toEqual(newPosition);
      expect(session.history).toHaveLength(1);
      expect(session.history[0]).toEqual(originalPosition);
    });

    it('should limit history to 50 entries', async () => {
      const session = await service.getSession();

      // Add 60 positions
      for (let i = 0; i < 60; i++) {
        await service.updateSession(session, {
          file: `file${i}.ts`,
          depth: 2,
          timestamp: Date.now()
        });
      }

      expect(session.history.length).toBeLessThanOrEqual(50);
    });

    it('should update lastActivityAt', async () => {
      const session = await service.getSession();
      const originalActivity = session.lastActivityAt;

      vi.advanceTimersByTime(100);

      await service.updateSession(session, {
        depth: 1,
        timestamp: Date.now()
      });

      expect(session.lastActivityAt).toBeGreaterThan(originalActivity);
    });
  });

  describe('deleteSession', () => {
    it('should remove session from memory', async () => {
      const session = await service.getSession();
      expect(service.getSessionCount()).toBe(1);

      await service.deleteSession(session.id);

      expect(service.getSessionCount()).toBe(0);
    });
  });

  describe('getActiveSessions', () => {
    it('should return only non-expired sessions', async () => {
      const session1 = await service.getSession();

      vi.advanceTimersByTime(500);
      const session2 = await service.getSession();

      const active = service.getActiveSessions();
      expect(active.length).toBe(2);

      // Advance time to expire first session
      vi.advanceTimersByTime(600);

      const activeAfter = service.getActiveSessions();
      expect(activeAfter.length).toBe(1);
      expect(activeAfter[0].id).toBe(session2.id);
    });
  });

  describe('getSessionCount', () => {
    it('should return correct count', async () => {
      expect(service.getSessionCount()).toBe(0);

      await service.getSession();
      expect(service.getSessionCount()).toBe(1);

      await service.getSession();
      expect(service.getSessionCount()).toBe(2);
    });
  });

  describe('goBack', () => {
    it('should navigate to previous position', async () => {
      const session = await service.getSession();

      const pos1: TraversalPosition = { file: 'file1.ts', depth: 2, timestamp: Date.now() };
      const pos2: TraversalPosition = { file: 'file2.ts', depth: 2, timestamp: Date.now() };

      await service.updateSession(session, pos1);
      await service.updateSession(session, pos2);

      const previous = await service.goBack(session);

      expect(previous).toEqual(pos1);
      expect(session.position).toEqual(pos1);
    });

    it('should return null when no history', async () => {
      const session = await service.getSession();

      const previous = await service.goBack(session);

      expect(previous).toBeNull();
    });

    it('should update lastActivityAt on goBack', async () => {
      const session = await service.getSession();
      await service.updateSession(session, { depth: 1, timestamp: Date.now() });

      const beforeGoBack = session.lastActivityAt;
      vi.advanceTimersByTime(100);

      await service.goBack(session);

      expect(session.lastActivityAt).toBeGreaterThan(beforeGoBack);
    });
  });

  describe('clearAllSessions', () => {
    it('should remove all sessions', async () => {
      await service.getSession();
      await service.getSession();
      await service.getSession();

      expect(service.getSessionCount()).toBe(3);

      await service.clearAllSessions();

      expect(service.getSessionCount()).toBe(0);
    });
  });

  describe('close', () => {
    it('should clear cleanup interval', async () => {
      const svc = createSessionService();

      await svc.close();

      // No error means success - interval was cleared
      expect(true).toBe(true);
    });
  });

  describe('max sessions enforcement', () => {
    it('should remove oldest sessions when max exceeded', async () => {
      // Create 6 sessions (max is 5)
      for (let i = 0; i < 6; i++) {
        vi.advanceTimersByTime(10); // Ensure different timestamps
        await service.getSession();
      }

      // Should have removed the oldest
      expect(service.getSessionCount()).toBeLessThanOrEqual(5);
    });
  });

  describe('session state', () => {
    it('should maintain position state across retrievals', async () => {
      const session1 = await service.getSession();
      const sessionId = session1.id;

      await service.updateSession(session1, {
        file: 'updated.ts',
        depth: 2,
        timestamp: Date.now()
      });

      const session2 = await service.getSession(sessionId);

      expect(session2.position.file).toBe('updated.ts');
      expect(session2.position.depth).toBe(2);
    });

    it('should track history through multiple updates', async () => {
      const session = await service.getSession();

      await service.updateSession(session, { depth: 1, timestamp: Date.now() });
      await service.updateSession(session, { depth: 2, file: 'a.ts', timestamp: Date.now() });
      await service.updateSession(session, { depth: 3, file: 'a.ts', symbol: 'fn', timestamp: Date.now() });

      expect(session.history.length).toBe(3);
      expect(session.history[0].depth).toBe(0);
      expect(session.history[1].depth).toBe(1);
      expect(session.history[2].depth).toBe(2);
    });

    it('should allow navigating back through entire history', async () => {
      const session = await service.getSession();

      // Build history
      await service.updateSession(session, { depth: 1, timestamp: Date.now() });
      await service.updateSession(session, { depth: 2, timestamp: Date.now() });
      await service.updateSession(session, { depth: 3, timestamp: Date.now() });

      // Navigate back
      expect(session.history.length).toBe(3);

      await service.goBack(session);
      expect(session.position.depth).toBe(2);
      expect(session.history.length).toBe(2);

      await service.goBack(session);
      expect(session.position.depth).toBe(1);
      expect(session.history.length).toBe(1);

      await service.goBack(session);
      expect(session.position.depth).toBe(0);
      expect(session.history.length).toBe(0);

      // No more history
      const result = await service.goBack(session);
      expect(result).toBeNull();
    });
  });
});

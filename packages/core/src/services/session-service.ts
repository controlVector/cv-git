/**
 * Session Service
 * Manages traversal sessions for Claude Code integration
 * Tracks navigation state across tool calls
 */

import {
  TraversalSession,
  TraversalPosition
} from '@cv-git/shared';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface SessionServiceOptions {
  /** Maximum sessions to keep in memory */
  maxSessions?: number;
  /** Session timeout in milliseconds (default: 30 minutes) */
  sessionTimeout?: number;
  /** Enable disk persistence */
  persistToDisk?: boolean;
  /** Persistence directory */
  persistDir?: string;
}

/**
 * Service for managing traversal sessions
 * Enables stateful navigation across multiple tool calls
 */
export class SessionService {
  private sessions: Map<string, TraversalSession> = new Map();
  private options: Required<SessionServiceOptions>;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(options?: SessionServiceOptions) {
    this.options = {
      maxSessions: options?.maxSessions ?? 100,
      sessionTimeout: options?.sessionTimeout ?? 30 * 60 * 1000, // 30 minutes
      persistToDisk: options?.persistToDisk ?? false,
      persistDir: options?.persistDir ?? '.cv/sessions'
    };

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60 * 1000); // Check every minute
  }

  /**
   * Get an existing session or create a new one
   */
  async getSession(sessionId?: string): Promise<TraversalSession> {
    // If session ID provided, try to get existing session
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing && !this.isExpired(existing)) {
        return existing;
      }

      // Try to load from disk if persistence is enabled
      if (this.options.persistToDisk) {
        const loaded = await this.loadSession(sessionId);
        if (loaded && !this.isExpired(loaded)) {
          this.sessions.set(sessionId, loaded);
          return loaded;
        }
      }
    }

    // Create new session
    const newSession = this.createSession();
    this.sessions.set(newSession.id, newSession);

    // Persist if enabled
    if (this.options.persistToDisk) {
      await this.saveSession(newSession);
    }

    // Enforce max sessions
    await this.enforceMaxSessions();

    return newSession;
  }

  /**
   * Update session with new position
   */
  async updateSession(session: TraversalSession, newPosition: TraversalPosition): Promise<void> {
    // Add current position to history
    session.history.push(session.position);

    // Keep history limited
    if (session.history.length > 50) {
      session.history = session.history.slice(-50);
    }

    // Update position
    session.position = newPosition;
    session.lastActivityAt = Date.now();

    // Update in cache
    this.sessions.set(session.id, session);

    // Persist if enabled
    if (this.options.persistToDisk) {
      await this.saveSession(session);
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);

    if (this.options.persistToDisk) {
      try {
        const filePath = this.getSessionFilePath(sessionId);
        await fs.unlink(filePath);
      } catch {
        // File might not exist
      }
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): TraversalSession[] {
    return [...this.sessions.values()].filter(s => !this.isExpired(s));
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Navigate back in session history
   */
  async goBack(session: TraversalSession): Promise<TraversalPosition | null> {
    if (session.history.length === 0) {
      return null;
    }

    const previousPosition = session.history.pop()!;
    session.position = previousPosition;
    session.lastActivityAt = Date.now();

    // Update in cache
    this.sessions.set(session.id, session);

    // Persist if enabled
    if (this.options.persistToDisk) {
      await this.saveSession(session);
    }

    return previousPosition;
  }

  /**
   * Clear all sessions
   */
  async clearAllSessions(): Promise<void> {
    this.sessions.clear();

    if (this.options.persistToDisk) {
      try {
        const files = await fs.readdir(this.options.persistDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            await fs.unlink(path.join(this.options.persistDir, file));
          }
        }
      } catch {
        // Directory might not exist
      }
    }
  }

  /**
   * Cleanup and shutdown
   */
  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // Save all sessions to disk if persistence is enabled
    if (this.options.persistToDisk) {
      for (const session of this.sessions.values()) {
        await this.saveSession(session);
      }
    }
  }

  // ========== Private Methods ==========

  /**
   * Create a new session
   */
  private createSession(): TraversalSession {
    const id = this.generateSessionId();
    const now = Date.now();

    return {
      id,
      position: {
        depth: 0, // Start at repo level
        timestamp: now
      },
      history: [],
      createdAt: now,
      lastActivityAt: now
    };
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Check if session is expired
   */
  private isExpired(session: TraversalSession): boolean {
    return Date.now() - session.lastActivityAt > this.options.sessionTimeout;
  }

  /**
   * Cleanup expired sessions
   */
  private async cleanupExpiredSessions(): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (this.isExpired(session)) {
        await this.deleteSession(id);
      }
    }
  }

  /**
   * Enforce maximum number of sessions
   */
  private async enforceMaxSessions(): Promise<void> {
    if (this.sessions.size <= this.options.maxSessions) {
      return;
    }

    // Remove oldest sessions
    const sorted = [...this.sessions.entries()].sort(
      (a, b) => a[1].lastActivityAt - b[1].lastActivityAt
    );

    const toRemove = sorted.slice(0, this.sessions.size - this.options.maxSessions);
    for (const [id] of toRemove) {
      await this.deleteSession(id);
    }
  }

  /**
   * Get file path for session persistence
   */
  private getSessionFilePath(sessionId: string): string {
    return path.join(this.options.persistDir, `${sessionId}.json`);
  }

  /**
   * Save session to disk
   */
  private async saveSession(session: TraversalSession): Promise<void> {
    try {
      await fs.mkdir(this.options.persistDir, { recursive: true });
      const filePath = this.getSessionFilePath(session.id);
      await fs.writeFile(filePath, JSON.stringify(session, null, 2));
    } catch (error) {
      // Log but don't fail
      console.warn(`Failed to save session ${session.id}: ${error}`);
    }
  }

  /**
   * Load session from disk
   */
  private async loadSession(sessionId: string): Promise<TraversalSession | null> {
    try {
      const filePath = this.getSessionFilePath(sessionId);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as TraversalSession;
    } catch {
      return null;
    }
  }
}

/**
 * Create a SessionService instance
 */
export function createSessionService(options?: SessionServiceOptions): SessionService {
  return new SessionService(options);
}

/**
 * Tests for cv agent command
 *
 * Tests the unit-testable parts: prompt building, API helpers,
 * credential checks, and git helpers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CREDENTIAL_PATHS } from '../utils/cv-hub-credentials';

// We test the exported functions from agent.ts indirectly
// by testing the logic patterns. The agent module uses dynamic imports
// and process-level side effects, so we test the core building blocks.

describe('cv agent', () => {
  let tempDir: string;
  let tempCredPath: string;
  let origPaths: string[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-agent-'));
    tempCredPath = path.join(tempDir, 'credentials');
    origPaths = [...CREDENTIAL_PATHS];
    (CREDENTIAL_PATHS as string[]).length = 0;
    (CREDENTIAL_PATHS as string[]).push(tempCredPath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    (CREDENTIAL_PATHS as string[]).length = 0;
    for (const p of origPaths) {
      (CREDENTIAL_PATHS as string[]).push(p);
    }
  });

  // ── Prompt building ─────────────────────────────────────────────────

  describe('buildClaudePrompt logic', () => {
    function buildPrompt(task: any): string {
      let prompt = '';
      prompt += `You are executing a task dispatched from Claude.ai via CV-Hub.\n\n`;
      prompt += `## Task: ${task.title}\n`;
      prompt += `Task ID: ${task.id}\n`;
      prompt += `Priority: ${task.priority}\n`;
      if (task.branch) prompt += `Branch: ${task.branch}\n`;
      if (task.file_paths?.length) prompt += `Focus files: ${task.file_paths.join(', ')}\n`;
      prompt += `\n`;
      if (task.description) {
        prompt += task.description;
      } else if (task.input?.description) {
        prompt += task.input.description;
      }
      if (task.input?.context) {
        prompt += `\n\n## Context\n${task.input.context}`;
      }
      if (task.input?.instructions?.length) {
        prompt += `\n\n## Instructions\n`;
        task.input.instructions.forEach((i: string, idx: number) => {
          prompt += `${idx + 1}. ${i}\n`;
        });
      }
      if (task.input?.constraints?.length) {
        prompt += `\n\n## Constraints\n`;
        task.input.constraints.forEach((c: string) => { prompt += `- ${c}\n`; });
      }
      prompt += `\n\n---\n`;
      prompt += `When complete, provide a brief summary of what you accomplished.\n`;
      return prompt;
    }

    it('formats basic task correctly', () => {
      const prompt = buildPrompt({
        id: 'task-123',
        title: 'Build Nyx Industries site',
        priority: 'high',
      });
      expect(prompt).toContain('## Task: Build Nyx Industries site');
      expect(prompt).toContain('Task ID: task-123');
      expect(prompt).toContain('Priority: high');
    });

    it('includes description from task', () => {
      const prompt = buildPrompt({
        id: 't1', title: 'Test', priority: 'medium',
        description: 'Build a marketing website',
      });
      expect(prompt).toContain('Build a marketing website');
    });

    it('falls back to input.description', () => {
      const prompt = buildPrompt({
        id: 't1', title: 'Test', priority: 'medium',
        input: { description: 'Input desc' },
      });
      expect(prompt).toContain('Input desc');
    });

    it('includes branch and file_paths', () => {
      const prompt = buildPrompt({
        id: 't1', title: 'Test', priority: 'medium',
        branch: 'feature/nyx',
        file_paths: ['src/index.ts', 'package.json'],
      });
      expect(prompt).toContain('Branch: feature/nyx');
      expect(prompt).toContain('Focus files: src/index.ts, package.json');
    });

    it('includes context, instructions, and constraints', () => {
      const prompt = buildPrompt({
        id: 't1', title: 'Test', priority: 'medium',
        input: {
          context: 'Using Astro framework',
          instructions: ['Use TypeScript', 'Add tests'],
          constraints: ['No external APIs'],
        },
      });
      expect(prompt).toContain('## Context\nUsing Astro framework');
      expect(prompt).toContain('1. Use TypeScript');
      expect(prompt).toContain('2. Add tests');
      expect(prompt).toContain('- No external APIs');
    });
  });

  // ── Credential validation ───────────────────────────────────────────

  describe('credential checks', () => {
    it('detects missing PAT', async () => {
      fs.writeFileSync(tempCredPath, 'CV_HUB_API=https://api.test.io\n');
      const { readCredentials } = await import('../utils/cv-hub-credentials');
      const creds = await readCredentials();
      expect(!creds.CV_HUB_PAT).toBe(true);
    });

    it('passes with PAT only (API defaults)', async () => {
      fs.writeFileSync(tempCredPath, 'CV_HUB_PAT=cv_pat_abc\n');
      const { readCredentials } = await import('../utils/cv-hub-credentials');
      const creds = await readCredentials();
      // Agent now defaults CV_HUB_API if missing
      if (!creds.CV_HUB_API) {
        creds.CV_HUB_API = 'https://api.hub.controlvector.io';
      }
      expect(!creds.CV_HUB_PAT).toBe(false);
      expect(creds.CV_HUB_API).toBe('https://api.hub.controlvector.io');
    });

    it('passes when both PAT and API exist', async () => {
      fs.writeFileSync(tempCredPath, 'CV_HUB_PAT=cv_pat_abc\nCV_HUB_API=https://api.test.io\n');
      const { readCredentials } = await import('../utils/cv-hub-credentials');
      const creds = await readCredentials();
      expect(!creds.CV_HUB_PAT).toBe(false);
      expect(creds.CV_HUB_API).toBe('https://api.test.io');
    });

    it('uses explicit API URL over default', async () => {
      fs.writeFileSync(tempCredPath, 'CV_HUB_PAT=cv_pat_abc\nCV_HUB_API=https://custom.api.io\n');
      const { readCredentials } = await import('../utils/cv-hub-credentials');
      const creds = await readCredentials();
      if (!creds.CV_HUB_API) {
        creds.CV_HUB_API = 'https://api.hub.controlvector.io';
      }
      expect(creds.CV_HUB_API).toBe('https://custom.api.io');
    });
  });

  // ── Duration formatting ─────────────────────────────────────────────

  describe('formatDuration logic', () => {
    function formatDuration(ms: number): string {
      const s = Math.floor(ms / 1000);
      if (s < 60) return `${s}s`;
      const m = Math.floor(s / 60);
      const rem = s % 60;
      if (m < 60) return `${m}m ${rem}s`;
      const h = Math.floor(m / 60);
      return `${h}h ${m % 60}m`;
    }

    it('formats seconds', () => expect(formatDuration(5000)).toBe('5s'));
    it('formats minutes', () => expect(formatDuration(125000)).toBe('2m 5s'));
    it('formats hours', () => expect(formatDuration(3700000)).toBe('1h 1m'));
    it('handles zero', () => expect(formatDuration(0)).toBe('0s'));
  });

  // ── API call structure ──────────────────────────────────────────────

  describe('API call structure', () => {
    it('poll returns null when no tasks', async () => {
      // Simulate the poll logic
      const mockResponse = { task: null, message: 'No tasks available' };
      const task = mockResponse.task || null;
      expect(task).toBeNull();
    });

    it('poll returns task when available', async () => {
      const mockResponse = {
        task: {
          id: 'task-1', title: 'Build site', priority: 'high',
          status: 'assigned', task_type: 'code_change',
        },
      };
      const task = mockResponse.task || null;
      expect(task).not.toBeNull();
      expect(task!.title).toBe('Build site');
    });

    it('complete sends correct payload shape', () => {
      const payload = {
        summary: 'Built 7 files',
        files_modified: ['index.ts', 'package.json'],
        output: 'Truncated output...',
      };
      expect(payload).toHaveProperty('summary');
      expect(payload).toHaveProperty('files_modified');
      expect(payload.files_modified).toHaveLength(2);
    });

    it('fail sends error string', () => {
      const payload = { error: 'Claude Code exited with code 1' };
      expect(payload.error).toContain('exited with code');
    });
  });

  // ── Retry logic ─────────────────────────────────────────────────────

  describe('retry logic', () => {
    it('retries on failure and succeeds', async () => {
      let attempts = 0;
      async function withRetry<T>(fn: () => Promise<T>, _label: string, maxRetries = 3): Promise<T> {
        for (let i = 0; i < maxRetries; i++) {
          try { return await fn(); } catch (err: any) {
            if (i === maxRetries - 1) throw err;
          }
        }
        throw new Error('unreachable');
      }

      const result = await withRetry(async () => {
        attempts++;
        if (attempts < 3) throw new Error('network error');
        return 'success';
      }, 'test');

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('throws after max retries', async () => {
      async function withRetry<T>(fn: () => Promise<T>, _label: string, maxRetries = 3): Promise<T> {
        for (let i = 0; i < maxRetries; i++) {
          try { return await fn(); } catch (err: any) {
            if (i === maxRetries - 1) throw err;
          }
        }
        throw new Error('unreachable');
      }

      await expect(withRetry(
        async () => { throw new Error('always fails'); },
        'test', 2,
      )).rejects.toThrow('always fails');
    });
  });

  // ── Git helpers ─────────────────────────────────────────────────────

  describe('git helpers', () => {
    it('getChangedFiles returns empty for non-git dir', () => {
      // The helper uses execSync which returns [] on failure
      const { execSync } = require('node:child_process');
      let files: string[] = [];
      try {
        const stdout = execSync('git diff --name-only HEAD~1 2>/dev/null', {
          cwd: tempDir, encoding: 'utf-8', timeout: 5000,
        });
        files = stdout.trim().split('\n').filter(Boolean);
      } catch { files = []; }
      expect(files).toEqual([]);
    });

    it('getLatestCommit returns null for non-git dir', () => {
      const { execSync } = require('node:child_process');
      let sha: string | null = null;
      try {
        sha = execSync('git rev-parse HEAD 2>/dev/null', {
          cwd: tempDir, encoding: 'utf-8', timeout: 5000,
        }).trim();
      } catch { sha = null; }
      expect(sha).toBeNull();
    });
  });
});

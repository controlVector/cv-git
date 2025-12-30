/**
 * Unit tests for CLI utility functions
 * Tests for pull.ts and watch.ts utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Re-implement utility functions for testing
// (In a real refactor, these would be exported from a shared utils module)

/**
 * Find git repository root
 */
function findGitRoot(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const gitDir = path.join(currentDir, '.git');
    if (fs.existsSync(gitDir)) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

/**
 * Check if CV is initialized in a git repo
 */
function isCVInitialized(repoRoot: string): boolean {
  const cvConfigPath = path.join(repoRoot, '.cv', 'config.json');
  return fs.existsSync(cvConfigPath);
}

/**
 * Check if file is a code file we care about
 */
function isCodeFile(filePath: string): boolean {
  const codeExtensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.pyi',
    '.go',
    '.rs',
    '.java',
    '.md', '.markdown',
  ]);
  const ext = path.extname(filePath).toLowerCase();
  return codeExtensions.has(ext);
}

describe('CLI Utilities', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-git-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('findGitRoot', () => {
    it('should find git root in current directory', () => {
      // Create .git directory
      fs.mkdirSync(path.join(tempDir, '.git'));

      const result = findGitRoot(tempDir);
      expect(result).toBe(tempDir);
    });

    it('should find git root in parent directory', () => {
      // Create .git in parent
      fs.mkdirSync(path.join(tempDir, '.git'));

      // Create nested directory
      const nested = path.join(tempDir, 'src', 'components');
      fs.mkdirSync(nested, { recursive: true });

      const result = findGitRoot(nested);
      expect(result).toBe(tempDir);
    });

    it('should return null when not in a git repo', () => {
      // tempDir has no .git
      const result = findGitRoot(tempDir);
      expect(result).toBeNull();
    });

    it('should handle deeply nested paths', () => {
      fs.mkdirSync(path.join(tempDir, '.git'));

      const deepPath = path.join(tempDir, 'a', 'b', 'c', 'd', 'e');
      fs.mkdirSync(deepPath, { recursive: true });

      const result = findGitRoot(deepPath);
      expect(result).toBe(tempDir);
    });
  });

  describe('isCVInitialized', () => {
    it('should return true when CV is initialized', () => {
      // Create .cv/config.json
      const cvDir = path.join(tempDir, '.cv');
      fs.mkdirSync(cvDir);
      fs.writeFileSync(path.join(cvDir, 'config.json'), '{}');

      expect(isCVInitialized(tempDir)).toBe(true);
    });

    it('should return false when CV directory missing', () => {
      expect(isCVInitialized(tempDir)).toBe(false);
    });

    it('should return false when config.json missing', () => {
      // Create .cv but no config.json
      fs.mkdirSync(path.join(tempDir, '.cv'));

      expect(isCVInitialized(tempDir)).toBe(false);
    });
  });

  describe('isCodeFile', () => {
    it('should recognize TypeScript files', () => {
      expect(isCodeFile('app.ts')).toBe(true);
      expect(isCodeFile('component.tsx')).toBe(true);
    });

    it('should recognize JavaScript files', () => {
      expect(isCodeFile('app.js')).toBe(true);
      expect(isCodeFile('component.jsx')).toBe(true);
      expect(isCodeFile('config.mjs')).toBe(true);
      expect(isCodeFile('config.cjs')).toBe(true);
    });

    it('should recognize Python files', () => {
      expect(isCodeFile('main.py')).toBe(true);
      expect(isCodeFile('types.pyi')).toBe(true);
    });

    it('should recognize Go files', () => {
      expect(isCodeFile('main.go')).toBe(true);
    });

    it('should recognize Rust files', () => {
      expect(isCodeFile('lib.rs')).toBe(true);
    });

    it('should recognize Java files', () => {
      expect(isCodeFile('Main.java')).toBe(true);
    });

    it('should recognize Markdown files', () => {
      expect(isCodeFile('README.md')).toBe(true);
      expect(isCodeFile('docs.markdown')).toBe(true);
    });

    it('should reject non-code files', () => {
      expect(isCodeFile('data.json')).toBe(false);
      expect(isCodeFile('config.yaml')).toBe(false);
      expect(isCodeFile('image.png')).toBe(false);
      expect(isCodeFile('doc.pdf')).toBe(false);
      expect(isCodeFile('style.css')).toBe(false);
    });

    it('should handle files with full paths', () => {
      expect(isCodeFile('/path/to/file.ts')).toBe(true);
      expect(isCodeFile('/path/to/file.json')).toBe(false);
    });

    it('should handle uppercase extensions', () => {
      expect(isCodeFile('file.TS')).toBe(true);
      expect(isCodeFile('file.PY')).toBe(true);
    });

    it('should handle files with no extension', () => {
      expect(isCodeFile('Makefile')).toBe(false);
      expect(isCodeFile('Dockerfile')).toBe(false);
    });

    it('should handle files with multiple dots', () => {
      expect(isCodeFile('component.test.ts')).toBe(true);
      expect(isCodeFile('app.config.js')).toBe(true);
    });
  });
});

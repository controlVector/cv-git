/**
 * File Utilities Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  getMaxFileSize,
  formatBytes,
  isBinaryExtension,
  isBinaryContent,
  checkFileReadable,
  safeReadFile,
  setSkipLogger,
  logSkippedFile
} from '../../packages/core/src/sync/file-utils.js';

describe('File Utilities', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-file-utils-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
    // Reset environment variable
    delete process.env.CV_MAX_FILE_SIZE;
  });

  describe('getMaxFileSize', () => {
    it('should return default size of 1MB when env var not set', () => {
      const size = getMaxFileSize();
      expect(size).toBe(1024 * 1024); // 1MB
    });

    it('should return custom size from CV_MAX_FILE_SIZE env var', () => {
      process.env.CV_MAX_FILE_SIZE = '2097152'; // 2MB
      const size = getMaxFileSize();
      expect(size).toBe(2097152);
    });

    it('should return default size for invalid env var', () => {
      process.env.CV_MAX_FILE_SIZE = 'invalid';
      const size = getMaxFileSize();
      expect(size).toBe(1024 * 1024);
    });

    it('should return default size for negative env var', () => {
      process.env.CV_MAX_FILE_SIZE = '-100';
      const size = getMaxFileSize();
      expect(size).toBe(1024 * 1024);
    });
  });

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect(formatBytes(0)).toBe('0B');
      expect(formatBytes(500)).toBe('500B');
      expect(formatBytes(1024)).toBe('1.0KB');
      expect(formatBytes(1536)).toBe('1.5KB');
      expect(formatBytes(1024 * 1024)).toBe('1.0MB');
      expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5MB');
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0GB');
    });
  });

  describe('isBinaryExtension', () => {
    it('should identify binary extensions', () => {
      // Executables
      expect(isBinaryExtension('file.exe')).toBe(true);
      expect(isBinaryExtension('file.dll')).toBe(true);
      expect(isBinaryExtension('file.so')).toBe(true);

      // Archives
      expect(isBinaryExtension('file.zip')).toBe(true);
      expect(isBinaryExtension('file.tar')).toBe(true);
      expect(isBinaryExtension('file.gz')).toBe(true);

      // Images
      expect(isBinaryExtension('file.png')).toBe(true);
      expect(isBinaryExtension('file.jpg')).toBe(true);
      expect(isBinaryExtension('file.gif')).toBe(true);

      // Documents
      expect(isBinaryExtension('file.pdf')).toBe(true);
      expect(isBinaryExtension('file.docx')).toBe(true);

      // Fonts
      expect(isBinaryExtension('file.ttf')).toBe(true);
      expect(isBinaryExtension('file.woff')).toBe(true);

      // Lock files
      expect(isBinaryExtension('package-lock.json.lock')).toBe(true);
    });

    it('should not identify text extensions as binary', () => {
      expect(isBinaryExtension('file.ts')).toBe(false);
      expect(isBinaryExtension('file.js')).toBe(false);
      expect(isBinaryExtension('file.py')).toBe(false);
      expect(isBinaryExtension('file.go')).toBe(false);
      expect(isBinaryExtension('file.md')).toBe(false);
      expect(isBinaryExtension('file.json')).toBe(false);
      expect(isBinaryExtension('file.yaml')).toBe(false);
      expect(isBinaryExtension('file.txt')).toBe(false);
    });

    it('should handle case insensitivity', () => {
      expect(isBinaryExtension('FILE.PNG')).toBe(true);
      expect(isBinaryExtension('file.PDF')).toBe(true);
      expect(isBinaryExtension('file.Zip')).toBe(true);
    });
  });

  describe('isBinaryContent', () => {
    it('should detect binary content with null bytes', () => {
      const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57]);
      expect(isBinaryContent(buffer)).toBe(true);
    });

    it('should not detect text content as binary', () => {
      const buffer = Buffer.from('Hello, World! This is text content.');
      expect(isBinaryContent(buffer)).toBe(false);
    });

    it('should detect UTF-8 content as non-binary', () => {
      const buffer = Buffer.from('Unicode: 你好世界 🌍');
      expect(isBinaryContent(buffer)).toBe(false);
    });

    it('should handle empty buffer', () => {
      const buffer = Buffer.from([]);
      expect(isBinaryContent(buffer)).toBe(false);
    });
  });

  describe('checkFileReadable', () => {
    it('should return readable for valid text file', async () => {
      const testFile = path.join(tempDir, 'test.ts');
      await fs.writeFile(testFile, 'const x = 1;');

      const result = await checkFileReadable(testFile);
      expect(result.readable).toBe(true);
      expect(result.size).toBeGreaterThan(0);
      expect(result.sizeFormatted).toBeDefined();
    });

    it('should reject binary file extensions', async () => {
      const testFile = path.join(tempDir, 'test.png');
      await fs.writeFile(testFile, 'fake content');

      const result = await checkFileReadable(testFile);
      expect(result.readable).toBe(false);
      expect(result.reason).toContain('Binary file type');
    });

    it('should reject files larger than max size', async () => {
      const testFile = path.join(tempDir, 'large.ts');
      // Create a file larger than 100 bytes (our test limit)
      await fs.writeFile(testFile, 'x'.repeat(200));

      const result = await checkFileReadable(testFile, 100);
      expect(result.readable).toBe(false);
      expect(result.reason).toContain('File too large');
    });

    it('should reject binary content', async () => {
      const testFile = path.join(tempDir, 'binary.dat');
      // Create file with null bytes
      const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
      await fs.writeFile(testFile, buffer);

      const result = await checkFileReadable(testFile);
      expect(result.readable).toBe(false);
      expect(result.reason).toContain('Binary content');
    });

    it('should reject directories', async () => {
      const testDir = path.join(tempDir, 'subdir');
      await fs.mkdir(testDir);

      const result = await checkFileReadable(testDir);
      expect(result.readable).toBe(false);
      expect(result.reason).toBe('Not a regular file');
    });

    it('should return error for non-existent file', async () => {
      const testFile = path.join(tempDir, 'nonexistent.ts');

      const result = await checkFileReadable(testFile);
      expect(result.readable).toBe(false);
      expect(result.reason).toContain('Cannot stat file');
    });

    it('should use CV_MAX_FILE_SIZE env var', async () => {
      process.env.CV_MAX_FILE_SIZE = '50'; // 50 bytes
      const testFile = path.join(tempDir, 'medium.ts');
      await fs.writeFile(testFile, 'x'.repeat(100)); // 100 bytes

      const result = await checkFileReadable(testFile);
      expect(result.readable).toBe(false);
      expect(result.reason).toContain('File too large');
    });
  });

  describe('safeReadFile', () => {
    it('should read valid text file', async () => {
      const testFile = path.join(tempDir, 'test.ts');
      const content = 'const x = 1;\nconst y = 2;';
      await fs.writeFile(testFile, content);

      const result = await safeReadFile(testFile);
      expect('content' in result).toBe(true);
      if ('content' in result) {
        expect(result.content).toBe(content);
      }
    });

    it('should return error for binary file', async () => {
      const testFile = path.join(tempDir, 'image.png');
      await fs.writeFile(testFile, 'fake');

      const result = await safeReadFile(testFile);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('Binary file type');
      }
    });

    it('should return error for large file', async () => {
      const testFile = path.join(tempDir, 'large.ts');
      await fs.writeFile(testFile, 'x'.repeat(200));

      const result = await safeReadFile(testFile, 100);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('File too large');
      }
    });

    it('should return error for non-existent file', async () => {
      const testFile = path.join(tempDir, 'missing.ts');

      const result = await safeReadFile(testFile);
      expect('error' in result).toBe(true);
    });
  });

  describe('logSkippedFile', () => {
    it('should call custom logger', () => {
      const mockLogger = vi.fn();
      setSkipLogger(mockLogger);

      logSkippedFile('/path/to/file.ts', 'File too large');

      expect(mockLogger).toHaveBeenCalledWith('/path/to/file.ts', 'File too large');
    });
  });
});

/**
 * File Utilities for Safe File Reading
 *
 * Provides utilities to safely read files with size limits and binary detection.
 * Prevents memory issues when processing large repositories.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Default maximum file size in bytes (1MB)
 */
const DEFAULT_MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB

/**
 * Get max file size from environment or default
 */
export function getMaxFileSize(): number {
  const envSize = process.env.CV_MAX_FILE_SIZE;
  if (envSize) {
    const parsed = parseInt(envSize, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_MAX_FILE_SIZE;
}

/**
 * Known binary file extensions to skip
 */
const BINARY_EXTENSIONS = new Set([
  // Executables
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.obj', '.a', '.lib',
  // Archives
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar', '.jar', '.war', '.ear',
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg', '.tiff', '.psd',
  // Audio/Video
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.wav', '.ogg', '.webm',
  // Documents (binary)
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // Database
  '.db', '.sqlite', '.sqlite3', '.mdb',
  // Other binary
  '.pyc', '.pyo', '.class', '.wasm', '.node',
  // Lock files that shouldn't be parsed
  '.lock',
]);

/**
 * Result of checking a file for readability
 */
export interface FileCheckResult {
  /** Whether the file can be read */
  readable: boolean;
  /** Reason if not readable */
  reason?: string;
  /** File size in bytes */
  size?: number;
  /** Human-readable size */
  sizeFormatted?: string;
}

/**
 * Format bytes as human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/**
 * Check if a file extension indicates a binary file
 */
export function isBinaryExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Check if content appears to be binary (contains null bytes or non-UTF8)
 */
export function isBinaryContent(buffer: Buffer, sampleSize: number = 8192): boolean {
  // Check a sample of the file for null bytes (common in binary files)
  const sample = buffer.slice(0, Math.min(sampleSize, buffer.length));

  for (let i = 0; i < sample.length; i++) {
    // Null byte is a strong indicator of binary content
    if (sample[i] === 0) {
      return true;
    }
  }

  // Try to decode as UTF-8 - if it fails, it's likely binary
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decoder.decode(sample);
    return false;
  } catch {
    return true;
  }
}

/**
 * Check if a file can be safely read for processing
 *
 * @param filePath - Absolute path to the file
 * @param maxSize - Maximum file size in bytes (default from CV_MAX_FILE_SIZE or 1MB)
 */
export async function checkFileReadable(
  filePath: string,
  maxSize?: number
): Promise<FileCheckResult> {
  const limit = maxSize ?? getMaxFileSize();

  // Check extension first (fast path)
  if (isBinaryExtension(filePath)) {
    return {
      readable: false,
      reason: `Binary file type: ${path.extname(filePath)}`,
    };
  }

  // Check file stats
  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    return {
      readable: false,
      reason: `Cannot stat file: ${err.message}`,
    };
  }

  // Check if it's a file (not directory, symlink, etc.)
  if (!stats.isFile()) {
    return {
      readable: false,
      reason: 'Not a regular file',
    };
  }

  // Check size
  if (stats.size > limit) {
    return {
      readable: false,
      reason: `File too large: ${formatBytes(stats.size)} > ${formatBytes(limit)} limit`,
      size: stats.size,
      sizeFormatted: formatBytes(stats.size),
    };
  }

  // For small files, check if content is binary
  if (stats.size > 0) {
    try {
      // Read just the beginning to check for binary content
      const fd = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(Math.min(8192, stats.size));
      await fd.read(buffer, 0, buffer.length, 0);
      await fd.close();

      if (isBinaryContent(buffer)) {
        return {
          readable: false,
          reason: 'Binary content detected',
          size: stats.size,
          sizeFormatted: formatBytes(stats.size),
        };
      }
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      return {
        readable: false,
        reason: `Cannot read file: ${err.message}`,
      };
    }
  }

  return {
    readable: true,
    size: stats.size,
    sizeFormatted: formatBytes(stats.size),
  };
}

/**
 * Safely read a file with size and binary checks
 *
 * @param filePath - Absolute path to the file
 * @param maxSize - Maximum file size in bytes
 * @returns File content as string, or null if file cannot be read
 */
export async function safeReadFile(
  filePath: string,
  maxSize?: number
): Promise<{ content: string } | { error: string }> {
  const check = await checkFileReadable(filePath, maxSize);

  if (!check.readable) {
    return { error: check.reason || 'Unknown error' };
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { content };
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    return { error: `Read failed: ${err.message}` };
  }
}

/**
 * Logger for skipped files (can be overridden)
 */
export type SkipLogger = (filePath: string, reason: string) => void;

let skipLogger: SkipLogger = (filePath, reason) => {
  console.log(`Skipping ${path.basename(filePath)}: ${reason}`);
};

/**
 * Set custom logger for skipped files
 */
export function setSkipLogger(logger: SkipLogger): void {
  skipLogger = logger;
}

/**
 * Log that a file is being skipped
 */
export function logSkippedFile(filePath: string, reason: string): void {
  skipLogger(filePath, reason);
}

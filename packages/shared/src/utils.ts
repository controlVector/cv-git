/**
 * Utility functions shared across CV-Git packages
 */

import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Get the .cv directory path for a repository
 */
export function getCVDir(repoRoot: string): string {
  return path.join(repoRoot, '.cv');
}

/**
 * Check if a directory is a CV-Git repository
 */
export async function isCVRepo(dir: string): Promise<boolean> {
  try {
    const cvDir = getCVDir(dir);
    const configPath = path.join(cvDir, 'config.json');
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the root of the CV-Git repository
 */
export async function findRepoRoot(startDir: string = process.cwd()): Promise<string | null> {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    if (await isCVRepo(currentDir)) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

/**
 * Ensure a directory exists, create it if not
 */
export async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error: any) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Generate a unique ID for a code chunk
 */
export function generateChunkId(file: string, startLine: number, endLine: number): string {
  return `${file}:${startLine}:${endLine}`;
}

/**
 * Parse a chunk ID back into components
 */
export function parseChunkId(chunkId: string): { file: string; startLine: number; endLine: number } | null {
  const parts = chunkId.split(':');
  if (parts.length < 3) {
    return null;
  }

  const endLine = parseInt(parts.pop()!);
  const startLine = parseInt(parts.pop()!);
  const file = parts.join(':');

  if (isNaN(startLine) || isNaN(endLine)) {
    return null;
  }

  return { file, startLine, endLine };
}

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const languageMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.cpp': 'cpp',
    '.c': 'c',
    '.h': 'c',
    '.hpp': 'cpp',
    '.cs': 'csharp',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'zsh'
  };

  return languageMap[ext] || 'unknown';
}

/**
 * Check if a file should be synced based on patterns
 */
export function shouldSyncFile(
  filePath: string,
  excludePatterns: string[],
  includeLanguages: string[]
): boolean {
  // Check exclude patterns
  for (const pattern of excludePatterns) {
    if (matchGlob(filePath, pattern)) {
      return false;
    }
  }

  // Check language
  const language = detectLanguage(filePath);
  if (language === 'unknown') {
    return false;
  }

  // Check if language is in include list
  return includeLanguages.length === 0 || includeLanguages.includes(language);
}

/**
 * Simple glob pattern matching
 */
function matchGlob(str: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(str);
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Chunk an array into smaller arrays of specified size
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

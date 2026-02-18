/**
 * Repository ID Generation
 *
 * Generates unique, stable identifiers for repositories
 * based on git remote URL or absolute path.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Generate a unique repository ID
 *
 * Priority:
 * 1. Git remote origin URL (most stable across machines)
 * 2. Absolute path (fallback for local-only repos)
 *
 * @param repoRoot - Absolute path to repository root
 * @returns 16-character hex string (collision-resistant, compact for readability)
 */
export function generateRepoId(repoRoot: string): string {
  const identifier = getRepoIdentifier(repoRoot);
  const hash = crypto.createHash('sha256').update(identifier).digest('hex');
  return hash.substring(0, 16);
}

/**
 * Get the best identifier for the repository
 */
function getRepoIdentifier(repoRoot: string): string {
  // Try to get git remote origin URL
  try {
    const remote = execSync('git remote get-url origin', {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    if (remote) {
      // Normalize the URL (remove .git suffix, normalize SSH vs HTTPS)
      return normalizeGitUrl(remote);
    }
  } catch {
    // No git remote, fall through to path-based ID
  }

  // Fall back to absolute path
  return path.resolve(repoRoot);
}

/**
 * Normalize git URL for consistent hashing
 *
 * Handles:
 * - git@github.com:user/repo.git -> github.com/user/repo
 * - https://github.com/user/repo.git -> github.com/user/repo
 * - git://github.com/user/repo.git -> github.com/user/repo
 */
function normalizeGitUrl(url: string): string {
  let normalized = url;

  // Remove trailing .git
  normalized = normalized.replace(/\.git$/, '');

  // Convert SSH format to path format
  // git@github.com:user/repo -> github.com/user/repo
  if (normalized.includes('@') && normalized.includes(':')) {
    normalized = normalized.replace(/.*@([^:]+):/, '$1/');
  }

  // Remove protocol prefix
  normalized = normalized.replace(/^(https?|git|ssh):\/\//, '');

  // Remove authentication
  normalized = normalized.replace(/^[^@]+@/, '');

  // Lowercase for consistency
  normalized = normalized.toLowerCase();

  return normalized;
}

/**
 * Get repository info including ID
 */
export function getRepositoryInfo(repoRoot: string): {
  id: string;
  name: string;
  root: string;
  remote?: string;
} {
  const id = generateRepoId(repoRoot);
  const name = path.basename(repoRoot);

  let remote: string | undefined;
  try {
    remote = execSync('git remote get-url origin', {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    // No remote
  }

  return { id, name, root: repoRoot, remote };
}

/**
 * Generate database name for FalkorDB
 */
export function getGraphDatabaseName(repoId: string): string {
  return `cv_${repoId}`;
}

/**
 * Generate collection name for Qdrant
 */
export function getVectorCollectionName(repoId: string, collection: string): string {
  return `${repoId}_${collection}`;
}

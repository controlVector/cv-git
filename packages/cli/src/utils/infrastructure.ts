/**
 * Infrastructure Management
 * Auto-start and manage FalkorDB and Qdrant containers
 */

import { execSync } from 'child_process';
import { createClient } from 'redis';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getCVDir } from '@cv-git/shared';

export interface InfraStatus {
  falkordb: {
    available: boolean;
    url?: string;
    started?: boolean;
    error?: string;
  };
  qdrant: {
    available: boolean;
    url?: string;
    started?: boolean;
    error?: string;
  };
}

/**
 * Check if Docker is available
 */
export function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find an available port starting from the given port
 */
export function findAvailablePort(startPort: number): number {
  for (let port = startPort; port < startPort + 100; port++) {
    try {
      execSync(`lsof -i :${port}`, { stdio: 'ignore' });
      // Port is in use, try next
    } catch {
      // Port is available
      return port;
    }
  }
  return startPort; // Fallback
}

/**
 * Get cv-git-falkordb container info
 */
function getCVFalkorDBInfo(): { running: boolean; port?: number; stopped?: boolean; created?: boolean; exists: boolean } {
  try {
    const result = execSync('docker ps -a --filter name=^cv-git-falkordb$ --format "{{.Status}}|{{.Ports}}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    if (!result) {
      return { running: false, exists: false };
    }

    const [status, ports] = result.split('|');
    const statusLower = status.toLowerCase();
    const isRunning = statusLower.startsWith('up');
    const isStopped = statusLower.includes('exited');
    const isCreated = statusLower.includes('created'); // Container created but never started

    // Parse port from "0.0.0.0:6380->6379/tcp" format
    let port: number | undefined;
    if (ports) {
      const portMatch = ports.match(/:(\d+)->/);
      if (portMatch) {
        port = parseInt(portMatch[1], 10);
      }
    }

    return { running: isRunning, port, stopped: isStopped, created: isCreated, exists: true };
  } catch {
    return { running: false, exists: false };
  }
}

/**
 * Check if a Redis instance is actually FalkorDB (has graph module)
 */
async function isFalkorDBInstance(url: string): Promise<boolean> {
  try {
    const client = createClient({ url });
    await client.connect();
    // Use sendCommand to get raw MODULE LIST response
    const result = await client.sendCommand(['MODULE', 'LIST']);
    await client.disconnect();
    // Result should contain 'graph' module info
    const resultStr = JSON.stringify(result).toLowerCase();
    return resultStr.includes('graph');
  } catch {
    return false;
  }
}

/**
 * Wait for FalkorDB to be ready
 */
async function waitForFalkorDB(port: number, timeoutMs: number = 15000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = execSync(`redis-cli -p ${port} MODULE LIST`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 1000
      });

      if (result.toLowerCase().includes('graph')) {
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return false;
}

/**
 * Ensure FalkorDB is running, auto-starting if needed
 * Returns the URL to connect to, or null if unavailable
 */
export async function ensureFalkorDB(options?: {
  silent?: boolean;
  configUrl?: string;
}): Promise<{ url: string; started: boolean } | null> {
  if (!isDockerAvailable()) {
    return null;
  }

  const containerInfo = getCVFalkorDBInfo();

  // If our container is running, return its URL
  if (containerInfo.running && containerInfo.port) {
    const url = `redis://localhost:${containerInfo.port}`;
    if (await isFalkorDBInstance(url)) {
      return { url, started: false };
    }
  }

  // If our container exists but is stopped, start it
  if (containerInfo.stopped && containerInfo.port) {
    try {
      execSync('docker start cv-git-falkordb', { stdio: 'ignore' });

      if (await waitForFalkorDB(containerInfo.port)) {
        return { url: `redis://localhost:${containerInfo.port}`, started: true };
      }
    } catch {
      // Failed to start
    }
  }

  // If container is in "Created" state (never started successfully), remove it
  if (containerInfo.created || (containerInfo.exists && !containerInfo.running && !containerInfo.stopped)) {
    try {
      execSync('docker rm -f cv-git-falkordb', { stdio: 'ignore' });
    } catch {
      // Ignore removal errors
    }
  }

  // Need to create a new container - find available port
  const port = findAvailablePort(6379);

  try {
    execSync(`docker run -d --name cv-git-falkordb -p ${port}:6379 falkordb/falkordb:latest`, {
      stdio: 'ignore'
    });
  } catch (error: any) {
    // Container might already exist with wrong state - remove and retry
    if (error.message?.includes('already in use') || error.status === 125) {
      try {
        execSync('docker rm -f cv-git-falkordb', { stdio: 'ignore' });
        execSync(`docker run -d --name cv-git-falkordb -p ${port}:6379 falkordb/falkordb:latest`, {
          stdio: 'ignore'
        });
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  if (await waitForFalkorDB(port)) {
    return { url: `redis://localhost:${port}`, started: true };
  }

  return null;
}

/**
 * Get cv-git-qdrant container info
 */
function getCVQdrantInfo(): { running: boolean; port?: number; stopped?: boolean } {
  try {
    const result = execSync('docker ps -a --filter name=cv-git-qdrant --format "{{.Status}}|{{.Ports}}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    if (!result) {
      return { running: false };
    }

    const [status, ports] = result.split('|');
    const isRunning = status.toLowerCase().startsWith('up');
    const isStopped = status.toLowerCase().includes('exited');

    let port: number | undefined;
    if (ports) {
      const portMatch = ports.match(/:(\d+)->/);
      if (portMatch) {
        port = parseInt(portMatch[1], 10);
      }
    }

    return { running: isRunning, port, stopped: isStopped };
  } catch {
    return { running: false };
  }
}

/**
 * Wait for Qdrant to be ready
 */
async function waitForQdrant(port: number, timeoutMs: number = 15000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${port}/collections`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return false;
}

/**
 * Ensure Qdrant is running, auto-starting if needed
 */
export async function ensureQdrant(options?: {
  silent?: boolean;
}): Promise<{ url: string; started: boolean } | null> {
  if (!isDockerAvailable()) {
    return null;
  }

  const containerInfo = getCVQdrantInfo();

  // If our container is running, return its URL
  if (containerInfo.running && containerInfo.port) {
    const url = `http://localhost:${containerInfo.port}`;
    try {
      const response = await fetch(`${url}/collections`);
      if (response.ok) {
        return { url, started: false };
      }
    } catch {
      // Not responding
    }
  }

  // If our container exists but is stopped, start it
  if (containerInfo.stopped && containerInfo.port) {
    try {
      execSync('docker start cv-git-qdrant', { stdio: 'ignore' });

      if (await waitForQdrant(containerInfo.port)) {
        return { url: `http://localhost:${containerInfo.port}`, started: true };
      }
    } catch {
      // Failed to start
    }
  }

  // Need to create a new container
  const port = findAvailablePort(6333);

  try {
    execSync(`docker run -d --name cv-git-qdrant -p ${port}:6333 qdrant/qdrant:latest`, {
      stdio: 'ignore'
    });
  } catch (error: any) {
    if (error.message?.includes('already in use') || error.status === 125) {
      try {
        execSync('docker rm -f cv-git-qdrant', { stdio: 'ignore' });
        execSync(`docker run -d --name cv-git-qdrant -p ${port}:6333 qdrant/qdrant:latest`, {
          stdio: 'ignore'
        });
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  if (await waitForQdrant(port)) {
    return { url: `http://localhost:${port}`, started: true };
  }

  return null;
}

/**
 * Ensure all infrastructure is running
 */
export async function ensureInfrastructure(options?: {
  silent?: boolean;
  needGraph?: boolean;
  needVector?: boolean;
}): Promise<InfraStatus> {
  const status: InfraStatus = {
    falkordb: { available: false },
    qdrant: { available: false },
  };

  // Start FalkorDB if needed
  if (options?.needGraph !== false) {
    try {
      const result = await ensureFalkorDB({ silent: options?.silent });
      if (result) {
        status.falkordb = {
          available: true,
          url: result.url,
          started: result.started,
        };
      }
    } catch (e: any) {
      status.falkordb.error = e.message;
    }
  }

  // Start Qdrant if needed
  if (options?.needVector !== false) {
    try {
      const result = await ensureQdrant({ silent: options?.silent });
      if (result) {
        status.qdrant = {
          available: true,
          url: result.url,
          started: result.started,
        };
      }
    } catch (e: any) {
      status.qdrant.error = e.message;
    }
  }

  return status;
}

/**
 * Sync state information
 */
export interface SyncStatus {
  hasSynced: boolean;
  lastSyncCommit?: string;
  lastSyncTime?: string;
  fileCount?: number;
  symbolCount?: number;
  needsResync: boolean;
  currentCommit?: string;
}

/**
 * Check the sync state for a repository
 */
export async function checkSyncState(repoRoot: string): Promise<SyncStatus> {
  try {
    const cvDir = getCVDir(repoRoot);
    const statePath = path.join(cvDir, 'sync_state.json');

    // Check if sync state file exists
    try {
      const data = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(data);

      // Get current commit
      let currentCommit: string | undefined;
      try {
        currentCommit = execSync('git rev-parse HEAD', {
          cwd: repoRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
      } catch {
        // Not a git repo or git not available
      }

      const needsResync = currentCommit !== state.lastCommitSynced;

      return {
        hasSynced: true,
        lastSyncCommit: state.lastCommitSynced,
        lastSyncTime: state.lastSyncTime,
        fileCount: state.fileCount,
        symbolCount: state.symbolCount,
        needsResync,
        currentCommit,
      };
    } catch {
      // No sync state file
      return {
        hasSynced: false,
        needsResync: true,
      };
    }
  } catch {
    return {
      hasSynced: false,
      needsResync: true,
    };
  }
}

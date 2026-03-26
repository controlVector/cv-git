/**
 * Privilege Configuration for CV-Git
 * Handles user vs root mode detection and path configuration
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

export type PrivilegeMode = 'root' | 'user' | 'auto';

export interface PrivilegeConfig {
  mode: PrivilegeMode;

  // Paths based on mode
  paths: {
    data: string;      // .cv-git data
    config: string;    // Configuration files
    cache: string;     // Cache directory
    logs: string;      // Log files
    bin: string;       // Binary/script location
  };

  // Service configuration
  services: {
    docker: 'system' | 'rootless' | 'podman' | 'external';
    credentials: 'system-keychain' | 'user-keychain' | 'file' | 'env';
    autoStart: 'system-service' | 'user-service' | 'manual';
  };
}

/**
 * Detect the current privilege mode based on environment
 */
export function detectPrivilegeMode(): PrivilegeMode {
  // Check if running as root (getuid is not available on Windows)
  if (typeof process.getuid === 'function' && process.getuid() === 0) return 'root';

  // Check if rootless Docker is available
  if (hasRootlessDocker()) return 'user';

  // Check if user has Docker group membership
  if (isInDockerGroup()) return 'user';

  return 'auto';
}

/**
 * Get the effective privilege mode (resolves 'auto')
 */
export function getEffectivePrivilegeMode(configuredMode: PrivilegeMode): 'root' | 'user' {
  if (configuredMode === 'root') return 'root';
  if (configuredMode === 'user') return 'user';

  // Auto mode: use root if running as root, otherwise user
  // getuid is not available on Windows — always 'user' there
  return (typeof process.getuid === 'function' && process.getuid() === 0) ? 'root' : 'user';
}

/**
 * Get default paths based on privilege mode
 */
export function getDefaultPaths(mode: PrivilegeMode): PrivilegeConfig['paths'] {
  const home = os.homedir();
  const platform = process.platform;
  const effectiveMode = getEffectivePrivilegeMode(mode);

  if (effectiveMode === 'user') {
    // User-scoped paths
    if (platform === 'win32') {
      // Windows: use APPDATA / LOCALAPPDATA
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      return {
        data: path.join(appData, 'cv-git'),
        config: path.join(appData, 'cv-git', 'config'),
        cache: path.join(localAppData, 'cv-git', 'cache'),
        logs: path.join(localAppData, 'cv-git', 'logs'),
        bin: path.join(home, '.local', 'bin'),
      };
    } else if (platform === 'darwin') {
      return {
        data: path.join(home, 'Library', 'Application Support', 'cv-git'),
        config: path.join(home, 'Library', 'Application Support', 'cv-git', 'config'),
        cache: path.join(home, 'Library', 'Caches', 'cv-git'),
        logs: path.join(home, 'Library', 'Logs', 'cv-git'),
        bin: path.join(home, '.local', 'bin'),
      };
    } else {
      // Linux XDG compliance
      const dataHome = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
      const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
      const cacheHome = process.env.XDG_CACHE_HOME || path.join(home, '.cache');

      return {
        data: path.join(dataHome, 'cv-git'),
        config: path.join(configHome, 'cv-git'),
        cache: path.join(cacheHome, 'cv-git'),
        logs: path.join(dataHome, 'cv-git', 'logs'),
        bin: path.join(home, '.local', 'bin'),
      };
    }
  }

  // Root/system paths
  return {
    data: '/var/lib/cv-git',
    config: '/etc/cv-git',
    cache: '/var/cache/cv-git',
    logs: '/var/log/cv-git',
    bin: '/usr/local/bin',
  };
}

/**
 * Check if rootless Docker is available
 */
function hasRootlessDocker(): boolean {
  if (process.platform === 'win32') return false;
  try {
    const dockerHost = process.env.DOCKER_HOST;
    if (dockerHost?.includes('rootless')) return true;

    // Check for rootless Docker socket
    const home = os.homedir();
    const rootlessSocket = path.join(home, '.docker', 'run', 'docker.sock');
    return fs.existsSync(rootlessSocket);
  } catch {
    return false;
  }
}

/**
 * Check if user is in the docker group
 */
function isInDockerGroup(): boolean {
  if (process.platform === 'win32') return false;
  try {
    const groups = execSync('groups', { encoding: 'utf8' });
    return groups.includes('docker');
  } catch {
    return false;
  }
}

/**
 * Check if Docker is available (any mode)
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
 * Check if Podman is available
 */
export function isPodmanAvailable(): boolean {
  try {
    execSync('podman --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get recommended container runtime for the current environment
 */
export function getRecommendedRuntime(): 'docker' | 'podman' | 'external' {
  if (isDockerAvailable()) return 'docker';
  if (isPodmanAvailable()) return 'podman';
  return 'external';
}

/**
 * Check if running in a CI environment
 */
export function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.JENKINS_URL ||
    process.env.TRAVIS
  );
}

/**
 * Check if running in a container
 */
export function isInContainer(): boolean {
  try {
    // Check for Docker
    if (fs.existsSync('/.dockerenv')) return true;

    // Check for container cgroup
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    if (cgroup.includes('docker') || cgroup.includes('kubepods')) return true;

    return false;
  } catch {
    return false;
  }
}

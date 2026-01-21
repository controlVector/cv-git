/**
 * Container Service
 * Manages Docker/Podman containers for CV-Git services (FalkorDB, Qdrant)
 */

import { execSync, exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { loadCVGitConfig, CVGitConfig } from '../config/cv-git-config.js';
import { getDefaultPaths, detectPrivilegeMode } from '../config/privilege-config.js';

export interface ContainerStatus {
  falkordb: 'running' | 'stopped' | 'not-found' | 'external';
  qdrant: 'running' | 'stopped' | 'not-found' | 'external';
  runtime: string;
  rootless: boolean;
}

export interface ContainerServiceOptions {
  config?: CVGitConfig;
}

export class ContainerService {
  private config: CVGitConfig | null = null;
  private runtime: 'docker' | 'podman' | 'external' = 'docker';
  private initialized = false;

  constructor(options: ContainerServiceOptions = {}) {
    if (options.config) {
      this.config = options.config;
      this.runtime = options.config.containers.runtime;
      this.initialized = true;
    }
  }

  /**
   * Initialize the container service
   */
  async initialize(): Promise<void> {
    if (!this.initialized) {
      this.config = await loadCVGitConfig();
      this.runtime = this.config.containers.runtime;
      this.initialized = true;
    }
  }

  /**
   * Get the status of CV-Git containers
   */
  async getStatus(): Promise<ContainerStatus> {
    await this.ensureInitialized();

    const isRootless = await this.isRootless();

    // Check if using external databases
    if (this.config!.databases.falkordb.external && this.config!.databases.qdrant.external) {
      return {
        falkordb: 'external',
        qdrant: 'external',
        runtime: this.runtime,
        rootless: isRootless,
      };
    }

    return {
      falkordb: this.config!.databases.falkordb.external
        ? 'external'
        : await this.checkContainer('cv-git-falkordb'),
      qdrant: this.config!.databases.qdrant.external
        ? 'external'
        : await this.checkContainer('cv-git-qdrant'),
      runtime: this.runtime,
      rootless: isRootless,
    };
  }

  /**
   * Start CV-Git containers
   */
  async start(): Promise<void> {
    await this.ensureInitialized();

    if (this.runtime === 'external') {
      console.log('Using external databases - no containers to start');
      return;
    }

    if (this.config!.databases.falkordb.external && this.config!.databases.qdrant.external) {
      console.log('Using external databases - no containers to start');
      return;
    }

    const composePath = await this.getComposePath();
    const cmd = this.getComposeCommand();

    console.log(`Starting containers with ${this.runtime}...`);
    execSync(`${cmd} -f "${composePath}" up -d`, {
      stdio: 'inherit',
      env: this.getEnvironment(),
    });
  }

  /**
   * Stop CV-Git containers
   */
  async stop(): Promise<void> {
    await this.ensureInitialized();

    if (this.runtime === 'external') {
      console.log('Using external databases - no containers to stop');
      return;
    }

    const composePath = await this.getComposePath();
    const cmd = this.getComposeCommand();

    console.log('Stopping containers...');
    execSync(`${cmd} -f "${composePath}" down`, {
      stdio: 'inherit',
      env: this.getEnvironment(),
    });
  }

  /**
   * Restart CV-Git containers
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * Show container logs
   */
  async logs(service?: 'falkordb' | 'qdrant', follow = false): Promise<void> {
    await this.ensureInitialized();

    if (this.runtime === 'external') {
      console.log('Using external databases - no container logs available');
      return;
    }

    const composePath = await this.getComposePath();
    const cmd = this.getComposeCommand();
    const followFlag = follow ? '-f' : '';
    const serviceArg = service || '';

    execSync(`${cmd} -f "${composePath}" logs ${followFlag} ${serviceArg}`, {
      stdio: 'inherit',
      env: this.getEnvironment(),
    });
  }

  /**
   * Pull latest container images
   */
  async pull(): Promise<void> {
    await this.ensureInitialized();

    if (this.runtime === 'external') {
      console.log('Using external databases - no containers to pull');
      return;
    }

    const composePath = await this.getComposePath();
    const cmd = this.getComposeCommand();

    console.log('Pulling latest container images...');
    execSync(`${cmd} -f "${composePath}" pull`, {
      stdio: 'inherit',
      env: this.getEnvironment(),
    });
  }

  /**
   * Check if a specific container is running
   */
  private async checkContainer(name: string): Promise<'running' | 'stopped' | 'not-found'> {
    try {
      const result = execSync(
        `${this.runtime} inspect --format='{{.State.Running}}' ${name} 2>/dev/null`,
        { encoding: 'utf8', env: this.getEnvironment() }
      ).trim();

      return result === 'true' ? 'running' : 'stopped';
    } catch {
      return 'not-found';
    }
  }

  /**
   * Check if running in rootless mode
   */
  async isRootless(): Promise<boolean> {
    if (this.runtime === 'external') {
      return true; // External databases don't need privileged access
    }

    try {
      // Check Docker rootless
      const info = execSync(`${this.runtime} info --format '{{.SecurityOptions}}'`, {
        encoding: 'utf8',
        env: this.getEnvironment(),
        stdio: ['pipe', 'pipe', 'ignore'],
      });

      if (info.includes('rootless')) return true;

      // Check if running as non-root user without sudo
      if (process.getuid?.() !== 0) {
        // If docker works without sudo, it's effectively rootless for the user
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if container runtime is available
   */
  async isRuntimeAvailable(): Promise<boolean> {
    if (this.runtime === 'external') {
      return true;
    }

    try {
      execSync(`${this.runtime} --version`, {
        stdio: 'ignore',
        env: this.getEnvironment(),
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the docker-compose command based on runtime and version
   */
  private getComposeCommand(): string {
    if (this.runtime === 'podman') {
      return 'podman-compose';
    }

    // Check for docker compose v2 (plugin) vs v1 (standalone)
    try {
      execSync('docker compose version', { stdio: 'ignore' });
      return 'docker compose';
    } catch {
      return 'docker-compose';
    }
  }

  /**
   * Get the path to the docker-compose file
   */
  private async getComposePath(): Promise<string> {
    const paths = getDefaultPaths(this.config?.privilege.mode || detectPrivilegeMode());

    // Check for user override
    const overridePath = path.join(paths.data, 'docker-compose.override.yml');
    if (fs.existsSync(overridePath)) {
      // Just use the override path for now
      // In a full implementation, would merge base with override
      return overridePath;
    }

    // Use configured compose file if specified
    if (this.config?.containers.composeFile && fs.existsSync(this.config.containers.composeFile)) {
      return this.config.containers.composeFile;
    }

    // Generate default compose file
    return this.generateDefaultCompose();
  }

  /**
   * Generate a default docker-compose file
   */
  private async generateDefaultCompose(): Promise<string> {
    const paths = getDefaultPaths(this.config?.privilege.mode || detectPrivilegeMode());
    const composePath = path.join(paths.data, 'docker-compose.yml');

    const compose = `# CV-Git Docker Compose Configuration
# Generated automatically - customize docker-compose.override.yml instead
version: '3.8'

services:
  falkordb:
    image: falkordb/falkordb:latest
    container_name: cv-git-falkordb
    ports:
      - "${this.config?.databases.falkordb.port || 6379}:6379"
    volumes:
      - ${paths.data}/falkordb:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  qdrant:
    image: qdrant/qdrant:latest
    container_name: cv-git-qdrant
    ports:
      - "${this.config?.databases.qdrant.port || 6333}:6333"
    volumes:
      - ${paths.data}/qdrant:/qdrant/storage
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/health"]
      interval: 10s
      timeout: 5s
      retries: 5

networks:
  default:
    name: cv-git-network
`;

    const dir = path.dirname(composePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(composePath, compose);

    return composePath;
  }

  /**
   * Get environment variables for container commands
   */
  private getEnvironment(): NodeJS.ProcessEnv {
    const env = { ...process.env };

    // Set socket path for rootless Docker if configured
    if (this.config?.containers.socketPath) {
      env.DOCKER_HOST = `unix://${this.config.containers.socketPath}`;
    }

    return env;
  }

  /**
   * Ensure the service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

// Singleton instance
let containerServiceInstance: ContainerService | null = null;

/**
 * Get the global container service instance
 */
export function getContainerService(): ContainerService {
  if (!containerServiceInstance) {
    containerServiceInstance = new ContainerService();
  }
  return containerServiceInstance;
}

/**
 * Create a new container service instance with custom options
 */
export function createContainerService(options?: ContainerServiceOptions): ContainerService {
  return new ContainerService(options);
}

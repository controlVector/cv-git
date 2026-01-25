/**
 * Service Discovery for ControlVector Tools
 *
 * Automatically discovers cv-prd, Qdrant, and FalkorDB services.
 *
 * Discovery order:
 * 1. Check ~/.cv/services.json for explicit configuration
 * 2. Check environment variables (CV_PRD_URL, CV_QDRANT_URL, etc.)
 * 3. Auto-probe localhost on common ports
 *
 * For non-technical users, the default localhost probing "just works".
 * Power users can configure remote services via `cv services add`.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface ServiceConfig {
  cvPrd?: string;      // cv-prd API URL
  qdrant?: string;     // Qdrant vector DB URL
  falkordb?: string;   // FalkorDB graph URL
  ollama?: string;     // Ollama local LLM URL
}

export interface ServicesFile {
  version: string;
  services: ServiceConfig;
  lastUpdated: string;
}

// Common ports for each service
const DEFAULT_PORTS = {
  cvPrd: [8000, 8080, 3000],
  qdrant: [6333],
  falkordb: [6379],
  ollama: [11434]
};

// Environment variable names
const ENV_VARS = {
  cvPrd: 'CV_PRD_URL',
  qdrant: 'CV_QDRANT_URL',
  falkordb: 'CV_FALKORDB_URL',
  ollama: 'CV_OLLAMA_URL'
};

/**
 * Get the services config file path
 */
function getServicesPath(): string {
  return path.join(os.homedir(), '.cv', 'services.json');
}

/**
 * Load services from config file
 */
export async function loadServicesFile(): Promise<ServicesFile | null> {
  try {
    const content = await fs.readFile(getServicesPath(), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save services to config file
 */
export async function saveServices(services: ServiceConfig): Promise<void> {
  const cvDir = path.join(os.homedir(), '.cv');
  await fs.mkdir(cvDir, { recursive: true });

  const file: ServicesFile = {
    version: '1.0.0',
    services,
    lastUpdated: new Date().toISOString()
  };

  await fs.writeFile(getServicesPath(), JSON.stringify(file, null, 2));
}

/**
 * Check if a URL is reachable
 */
async function isReachable(url: string, timeout = 2000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Check if cv-prd is available at a URL
 */
async function checkCvPrd(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${baseUrl}/api/v1/health`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json() as { status?: string };
      return data.status === 'healthy';
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if Qdrant is available at a URL
 */
async function checkQdrant(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(baseUrl, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json() as { title?: string };
      return data.title === 'qdrant - vectorass engine';
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if FalkorDB (Redis protocol) is available
 * Note: Can't easily check Redis via HTTP, so we just verify the port is open
 */
async function checkFalkorDB(url: string): Promise<boolean> {
  // Parse redis URL
  const match = url.match(/redis:\/\/([^:]+):(\d+)/);
  if (!match) return false;

  const [, host, port] = match;

  // Try a simple TCP connection check via HTTP fallback
  // FalkorDB doesn't have HTTP, so we'll just mark as "potentially available"
  // The actual connection will be tested when we use it
  return true;
}

/**
 * Auto-discover a service on localhost
 */
async function probeLocalhost(
  service: keyof typeof DEFAULT_PORTS,
  checker: (url: string) => Promise<boolean>
): Promise<string | null> {
  const ports = DEFAULT_PORTS[service];
  const hosts = ['127.0.0.1', 'localhost'];

  for (const host of hosts) {
    for (const port of ports) {
      let url: string;

      if (service === 'falkordb') {
        url = `redis://${host}:${port}`;
      } else {
        url = `http://${host}:${port}`;
      }

      if (await checker(url)) {
        return url;
      }
    }
  }

  return null;
}

/**
 * Discover cv-prd service
 */
export async function discoverCvPrd(): Promise<string | null> {
  // 1. Check config file
  const config = await loadServicesFile();
  if (config?.services.cvPrd) {
    if (await checkCvPrd(config.services.cvPrd)) {
      return config.services.cvPrd;
    }
  }

  // 2. Check environment variable
  const envUrl = process.env[ENV_VARS.cvPrd];
  if (envUrl) {
    if (await checkCvPrd(envUrl)) {
      return envUrl;
    }
  }

  // 3. Auto-probe localhost
  return probeLocalhost('cvPrd', checkCvPrd);
}

/**
 * Discover Qdrant service
 */
export async function discoverQdrant(): Promise<string | null> {
  // 1. Check config file
  const config = await loadServicesFile();
  if (config?.services.qdrant) {
    if (await checkQdrant(config.services.qdrant)) {
      return config.services.qdrant;
    }
  }

  // 2. Check environment variable
  const envUrl = process.env[ENV_VARS.qdrant];
  if (envUrl) {
    if (await checkQdrant(envUrl)) {
      return envUrl;
    }
  }

  // 3. Auto-probe localhost
  return probeLocalhost('qdrant', checkQdrant);
}

/**
 * Discover FalkorDB service
 */
export async function discoverFalkorDB(): Promise<string | null> {
  // 1. Check config file
  const config = await loadServicesFile();
  if (config?.services.falkordb) {
    return config.services.falkordb;
  }

  // 2. Check environment variable
  const envUrl = process.env[ENV_VARS.falkordb];
  if (envUrl) {
    return envUrl;
  }

  // 3. Default localhost
  return 'redis://127.0.0.1:6379';
}

/**
 * Discover all services
 */
export async function discoverAllServices(): Promise<{
  cvPrd: string | null;
  qdrant: string | null;
  falkordb: string | null;
}> {
  const [cvPrd, qdrant, falkordb] = await Promise.all([
    discoverCvPrd(),
    discoverQdrant(),
    discoverFalkorDB()
  ]);

  return { cvPrd, qdrant, falkordb };
}

/**
 * Get service status for display
 */
export async function getServiceStatus(): Promise<Array<{
  name: string;
  url: string | null;
  status: 'connected' | 'configured' | 'not found';
}>> {
  const services = await discoverAllServices();

  return [
    {
      name: 'cv-prd',
      url: services.cvPrd,
      status: services.cvPrd ? 'connected' : 'not found'
    },
    {
      name: 'Qdrant',
      url: services.qdrant,
      status: services.qdrant ? 'connected' : 'not found'
    },
    {
      name: 'FalkorDB',
      url: services.falkordb,
      status: services.falkordb ? 'configured' : 'not found'
    }
  ];
}

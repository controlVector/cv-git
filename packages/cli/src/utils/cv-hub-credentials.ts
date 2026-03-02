/**
 * CV-Hub credentials file utilities
 *
 * Reads/writes the CV-Hub credentials file (~/.config/cv-hub/credentials)
 * which uses simple KEY=VALUE format (sourced by shell hooks).
 */

import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import * as os from 'os';

/** Standard paths to search for credentials, in priority order */
export const CREDENTIAL_PATHS = [
  join(homedir(), '.config', 'cv-hub', 'credentials'),
  '/root/.config/cv-hub/credentials',
];

export interface CVHubCredentials {
  CV_HUB_PAT?: string;
  CV_HUB_API?: string;
  CV_HUB_MACHINE_NAME?: string;
  CV_HUB_ORG_OVERRIDE?: string;
  CV_HUB_DEBUG?: string;
  [key: string]: string | undefined;
}

/**
 * Find the first existing credentials file path
 */
export async function findCredentialFile(): Promise<string | null> {
  for (const p of CREDENTIAL_PATHS) {
    try {
      await fs.access(p);
      return p;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Read and parse the CV-Hub credentials file.
 * Parses KEY=VALUE lines, ignoring comments (#) and empty lines.
 */
export async function readCredentials(): Promise<CVHubCredentials> {
  const credPath = await findCredentialFile();
  if (!credPath) {
    return {};
  }

  try {
    const content = await fs.readFile(credPath, 'utf-8');
    return parseCredentials(content);
  } catch {
    return {};
  }
}

/**
 * Parse credential file content into key-value pairs.
 */
export function parseCredentials(content: string): CVHubCredentials {
  const result: CVHubCredentials = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    result[key] = value;
  }

  return result;
}

/**
 * Write or update a single field in the credentials file.
 * Preserves existing fields, comments, and ordering.
 * If the file doesn't exist, creates it with secure permissions.
 */
export async function writeCredentialField(key: string, value: string): Promise<string> {
  let credPath = await findCredentialFile();

  if (!credPath) {
    // Create the default credentials file
    credPath = CREDENTIAL_PATHS[0];
    await fs.mkdir(dirname(credPath), { recursive: true });
    await fs.writeFile(credPath, `${key}=${value}\n`, { mode: 0o600 });
    return credPath;
  }

  let content: string;
  try {
    content = await fs.readFile(credPath, 'utf-8');
  } catch {
    content = '';
  }

  const lines = content.split('\n');
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('#') || !trimmed) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const lineKey = trimmed.slice(0, eqIdx).trim();
    if (lineKey === key) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }

  if (!found) {
    // Append — ensure there's a trailing newline before adding
    if (content.length > 0 && !content.endsWith('\n')) {
      lines.push('');
    }
    lines.push(`${key}=${value}`);
  }

  // Ensure file ends with newline
  let newContent = lines.join('\n');
  if (!newContent.endsWith('\n')) {
    newContent += '\n';
  }

  await fs.writeFile(credPath, newContent, { mode: 0o600 });
  return credPath;
}

/**
 * Get the machine name for this host.
 * Priority: CV_HUB_MACHINE_NAME from credentials > os.hostname()
 * Cleans the value: lowercase, trim, replace spaces with hyphens.
 */
export async function getMachineName(): Promise<string> {
  const creds = await readCredentials();
  const raw = creds.CV_HUB_MACHINE_NAME || os.hostname();
  return cleanMachineName(raw);
}

/**
 * Clean a machine name: lowercase, trim, replace spaces with hyphens.
 */
export function cleanMachineName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

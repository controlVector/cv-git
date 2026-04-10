/**
 * Shared Credential Discovery
 *
 * cv-git and cv-agent share a single credentials file:
 *   ~/.config/controlvector/credentials.json
 *
 * Whichever tool authenticates first writes the file.
 * The other reads it. No duplicate auth.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface SharedCredentials {
  hub_url: string;
  token: string;
  username?: string;
  created_at?: string;
}

const SHARED_CRED_DIR = join(homedir(), '.config', 'controlvector');
const SHARED_CRED_PATH = join(SHARED_CRED_DIR, 'credentials.json');

/**
 * Read shared credentials (used by both cv-git and cv-agent).
 * Returns null if not found or invalid.
 */
export async function readSharedCredentials(): Promise<SharedCredentials | null> {
  try {
    const content = await fs.readFile(SHARED_CRED_PATH, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed.token && parsed.hub_url) {
      return parsed as SharedCredentials;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write shared credentials. Creates directory if needed.
 * File is written mode 0600 (owner read/write only).
 */
export async function writeSharedCredentials(creds: SharedCredentials): Promise<void> {
  await fs.mkdir(SHARED_CRED_DIR, { recursive: true });
  await fs.writeFile(SHARED_CRED_PATH, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
}

/**
 * Validate a CV-Hub PAT token against the API.
 * Returns the username if valid, null if invalid.
 */
export async function validateToken(hubUrl: string, token: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${hubUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json() as { user?: { username?: string; email?: string } };
    return data.user?.username || data.user?.email || 'unknown';
  } catch {
    return null;
  }
}

export function getSharedCredentialPath(): string {
  return SHARED_CRED_PATH;
}

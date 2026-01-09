/**
 * Auth Command Utilities
 *
 * Shared utilities for auth setup commands.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Open URL in default browser
 */
export async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let command: string;

  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else {
    // Check for WSL
    try {
      const { stdout } = await execAsync('cat /proc/version');
      if (
        stdout.toLowerCase().includes('microsoft') ||
        stdout.toLowerCase().includes('wsl')
      ) {
        // WSL detected - use cmd.exe to open in Windows browser
        command = `cmd.exe /c start "" "${url.replace(/&/g, '^&')}"`;
      } else {
        command = `xdg-open "${url}"`;
      }
    } catch {
      command = `xdg-open "${url}"`;
    }
  }

  try {
    await execAsync(command);
  } catch (error) {
    // Browser open failed, user will need to open manually
  }
}

/**
 * Mask a secret string for display
 */
export function maskSecret(secret: string, visibleChars: number = 8): string {
  if (secret.length <= visibleChars) {
    return '*'.repeat(secret.length);
  }
  return secret.substring(0, visibleChars) + '...';
}

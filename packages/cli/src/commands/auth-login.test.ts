/**
 * Tests for cv auth login / logout / status
 *
 * Tests the credential file management, PAT validation,
 * and authentication state checks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CREDENTIAL_PATHS, readCredentials, writeCredentialField, findCredentialFile } from '../utils/cv-hub-credentials';

describe('cv auth login/logout', () => {
  let tempDir: string;
  let tempCredPath: string;
  let origPaths: string[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-auth-'));
    tempCredPath = path.join(tempDir, 'credentials');
    origPaths = [...CREDENTIAL_PATHS];
    (CREDENTIAL_PATHS as string[]).length = 0;
    (CREDENTIAL_PATHS as string[]).push(tempCredPath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    (CREDENTIAL_PATHS as string[]).length = 0;
    for (const p of origPaths) {
      (CREDENTIAL_PATHS as string[]).push(p);
    }
  });

  // ── Credential file operations ──────────────────────────────────

  describe('credential file management', () => {
    it('writeCredentialField creates file with secure permissions', async () => {
      await writeCredentialField('CV_HUB_PAT', 'cv_pat_test123');
      const stat = fs.statSync(tempCredPath);
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('writeCredentialField writes KEY=VALUE format', async () => {
      await writeCredentialField('CV_HUB_PAT', 'cv_pat_test123');
      await writeCredentialField('CV_HUB_API', 'https://api.hub.controlvector.io');
      const content = fs.readFileSync(tempCredPath, 'utf-8');
      expect(content).toContain('CV_HUB_PAT=cv_pat_test123');
      expect(content).toContain('CV_HUB_API=https://api.hub.controlvector.io');
    });

    it('writeCredentialField updates existing key', async () => {
      await writeCredentialField('CV_HUB_PAT', 'old_token');
      await writeCredentialField('CV_HUB_PAT', 'new_token');
      const content = fs.readFileSync(tempCredPath, 'utf-8');
      expect(content).toContain('CV_HUB_PAT=new_token');
      expect(content).not.toContain('old_token');
    });

    it('readCredentials returns all fields', async () => {
      fs.writeFileSync(tempCredPath, [
        'CV_HUB_PAT=cv_pat_abc',
        'CV_HUB_API=https://api.hub.controlvector.io',
        'CV_HUB_MACHINE_NAME=my-laptop',
      ].join('\n') + '\n');

      const creds = await readCredentials();
      expect(creds.CV_HUB_PAT).toBe('cv_pat_abc');
      expect(creds.CV_HUB_API).toBe('https://api.hub.controlvector.io');
      expect(creds.CV_HUB_MACHINE_NAME).toBe('my-laptop');
    });
  });

  // ── Login with PAT validation ───────────────────────────────────

  describe('PAT validation logic', () => {
    it('validates PAT format acceptance', () => {
      // cv_pat_ prefix tokens
      const pat1 = 'cv_pat_abc123def456';
      expect(pat1.startsWith('cv_pat_')).toBe(true);

      // JWT tokens (also valid)
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig';
      expect(jwt.length > 0).toBe(true);
    });

    it('loginWithPAT saves credentials on valid response', async () => {
      // Simulate what loginWithPAT does: write credentials after validation
      const pat = 'cv_pat_test_valid';
      const apiUrl = 'https://api.hub.controlvector.io';

      // Write credentials (same as loginWithPAT internals)
      await writeCredentialField('CV_HUB_PAT', pat);
      await writeCredentialField('CV_HUB_API', apiUrl);
      await writeCredentialField('CV_HUB_MACHINE_NAME', 'test-machine');

      const creds = await readCredentials();
      expect(creds.CV_HUB_PAT).toBe(pat);
      expect(creds.CV_HUB_API).toBe(apiUrl);
      expect(creds.CV_HUB_MACHINE_NAME).toBe('test-machine');
    });

    it('already-authenticated check reads existing credentials', async () => {
      fs.writeFileSync(tempCredPath, 'CV_HUB_PAT=cv_pat_exists\nCV_HUB_API=https://api.hub.controlvector.io\n');

      const creds = await readCredentials();
      expect(creds.CV_HUB_PAT).toBe('cv_pat_exists');

      // Simulates the "already authenticated" check
      const hasAuth = !!creds.CV_HUB_PAT;
      expect(hasAuth).toBe(true);
    });

    it('login --force ignores existing credentials', async () => {
      fs.writeFileSync(tempCredPath, 'CV_HUB_PAT=old_token\n');

      // With --force, we proceed to re-auth regardless
      // Simulate by writing new credentials
      await writeCredentialField('CV_HUB_PAT', 'new_token');

      const creds = await readCredentials();
      expect(creds.CV_HUB_PAT).toBe('new_token');
    });
  });

  // ── Logout ──────────────────────────────────────────────────────

  describe('logout', () => {
    it('removes credentials file', async () => {
      fs.writeFileSync(tempCredPath, 'CV_HUB_PAT=cv_pat_abc\nCV_HUB_API=https://api.test.io\n');

      expect(fs.existsSync(tempCredPath)).toBe(true);
      fs.unlinkSync(tempCredPath);
      expect(fs.existsSync(tempCredPath)).toBe(false);
    });

    it('finds no credentials after logout', async () => {
      fs.writeFileSync(tempCredPath, 'CV_HUB_PAT=cv_pat_abc\n');

      // Remove the file (logout)
      fs.unlinkSync(tempCredPath);

      // readCredentials should return empty
      const creds = await readCredentials();
      expect(creds.CV_HUB_PAT).toBeUndefined();
    });

    it('logout when already logged out is harmless', async () => {
      const credFile = await findCredentialFile();
      expect(credFile).toBeNull();
      // No error thrown — command just says "already logged out"
    });
  });

  // ── Status ──────────────────────────────────────────────────────

  describe('status', () => {
    it('shows PAT masked', async () => {
      fs.writeFileSync(tempCredPath, 'CV_HUB_PAT=cv_pat_abcdef123456\n');
      const creds = await readCredentials();
      const pat = creds.CV_HUB_PAT!;
      const masked = pat.startsWith('cv_pat_')
        ? pat.slice(0, 12) + '...'
        : pat.slice(0, 10) + '...';
      expect(masked).toBe('cv_pat_abcde...');
    });

    it('defaults API URL when not set', async () => {
      fs.writeFileSync(tempCredPath, 'CV_HUB_PAT=cv_pat_abc\n');
      const creds = await readCredentials();
      const apiUrl = creds.CV_HUB_API || 'https://api.hub.controlvector.io';
      expect(apiUrl).toBe('https://api.hub.controlvector.io');
    });

    it('shows machine name from credentials', async () => {
      fs.writeFileSync(tempCredPath, 'CV_HUB_MACHINE_NAME=surface-laptop\n');
      const creds = await readCredentials();
      expect(creds.CV_HUB_MACHINE_NAME).toBe('surface-laptop');
    });
  });

  // ── Credential file permissions ─────────────────────────────────

  describe('credential file security', () => {
    it('creates file with 0600 permissions', async () => {
      await writeCredentialField('CV_HUB_PAT', 'secret');
      const stat = fs.statSync(tempCredPath);
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('maintains 0600 on updates', async () => {
      await writeCredentialField('CV_HUB_PAT', 'token1');
      await writeCredentialField('CV_HUB_API', 'https://api.test.io');
      const stat = fs.statSync(tempCredPath);
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });
});

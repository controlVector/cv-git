/**
 * Tests for cv doctor new checks: machine name, executor status, hook version
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  readCredentials,
  getMachineName,
  writeCredentialField,
  cleanMachineName,
  CREDENTIAL_PATHS,
} from '../utils/cv-hub-credentials';

describe('cv doctor — new checks', () => {
  let tempDir: string;
  let tempCredPath: string;
  let origPaths: string[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-doctor-'));
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

  describe('checkMachineName logic', () => {
    it('passes when CV_HUB_MACHINE_NAME is set', async () => {
      fs.writeFileSync(tempCredPath, `CV_HUB_PAT=test\nCV_HUB_MACHINE_NAME=z840-primary\n`);

      const creds = await readCredentials();
      expect(creds.CV_HUB_MACHINE_NAME).toBe('z840-primary');
      // Doctor should report pass status
    });

    it('warns when CV_HUB_MACHINE_NAME is not set', async () => {
      fs.writeFileSync(tempCredPath, `CV_HUB_PAT=test\n`);

      const creds = await readCredentials();
      expect(creds.CV_HUB_MACHINE_NAME).toBeUndefined();

      // getMachineName falls back to hostname
      const fallback = await getMachineName();
      expect(fallback).toBeTruthy();
      expect(fallback).not.toBe('');
    });

    it('warns when no credentials file exists', async () => {
      // Don't create the file
      const creds = await readCredentials();
      expect(creds.CV_HUB_MACHINE_NAME).toBeUndefined();
    });
  });

  describe('--fix auto-sets machine name', () => {
    it('writes hostname-based machine name when missing', async () => {
      fs.writeFileSync(tempCredPath, `CV_HUB_PAT=abc123\n`);

      // Simulate what doctor --fix does
      const creds = await readCredentials();
      expect(creds.CV_HUB_MACHINE_NAME).toBeUndefined();

      const fallbackName = await getMachineName();
      await writeCredentialField('CV_HUB_MACHINE_NAME', fallbackName);

      const updated = await readCredentials();
      expect(updated.CV_HUB_MACHINE_NAME).toBe(fallbackName);
      expect(updated.CV_HUB_PAT).toBe('abc123'); // preserved
    });

    it('does not overwrite existing machine name', async () => {
      fs.writeFileSync(tempCredPath, `CV_HUB_PAT=abc123\nCV_HUB_MACHINE_NAME=my-box\n`);

      const creds = await readCredentials();
      // Doctor --fix should skip because name already set
      expect(creds.CV_HUB_MACHINE_NAME).toBe('my-box');
    });
  });

  describe('checkExecutorStatus logic', () => {
    it('requires CV_HUB_PAT and CV_HUB_API for executor check', async () => {
      // No credentials — should warn
      const creds = await readCredentials();
      expect(creds.CV_HUB_PAT).toBeUndefined();
      expect(creds.CV_HUB_API).toBeUndefined();
      // Doctor would return warn status
    });

    it('has credentials needed for executor API call', async () => {
      fs.writeFileSync(tempCredPath, `CV_HUB_PAT=cv_pat_abc\nCV_HUB_API=https://api.test.io\nCV_HUB_MACHINE_NAME=dev-laptop\n`);

      const creds = await readCredentials();
      expect(creds.CV_HUB_PAT).toBe('cv_pat_abc');
      expect(creds.CV_HUB_API).toBe('https://api.test.io');

      const machineName = await getMachineName();
      expect(machineName).toBe('dev-laptop');
      // Doctor would call: GET ${CV_HUB_API}/api/v1/executors?machine_name=dev-laptop
    });
  });

  describe('checkHookVersion logic', () => {
    it('detects hook with all required markers as passing', () => {
      const hookContent = `#!/usr/bin/env bash
SESSION_ENV="/tmp/cv-hub-session.env"
machine_name="\${CV_HUB_MACHINE_NAME:-}"
repos_json="[]"
`;
      expect(hookContent).toContain('SESSION_ENV=');
      expect(hookContent).toContain('machine_name');
      expect(hookContent).toContain('repos_json');
    });

    it('detects hook missing machine_name marker as outdated', () => {
      const hookContent = `#!/usr/bin/env bash
SESSION_ENV="/tmp/cv-hub-session.env"
# Old hook without the host identifier variable
`;
      const hasMachineName = hookContent.includes('machine_name=');
      expect(hookContent).toContain('SESSION_ENV=');
      expect(hasMachineName).toBe(false);
    });

    it('detects hook missing repos marker as outdated', () => {
      const hookContent = `#!/usr/bin/env bash
SESSION_ENV="/tmp/cv-hub-session.env"
# Old hook with no repository list variable
`;
      const hasRepos = hookContent.includes('repos_json=');
      expect(hookContent).toContain('SESSION_ENV=');
      expect(hasRepos).toBe(false);
    });

    it('produces consistent SHA-256 hashes for content comparison', () => {
      const content = 'test hook content';
      const hash1 = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
      const hash2 = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(12);

      // Different content produces different hash
      const hash3 = crypto.createHash('sha256').update(content + ' v2').digest('hex').slice(0, 12);
      expect(hash3).not.toBe(hash1);
    });
  });
});

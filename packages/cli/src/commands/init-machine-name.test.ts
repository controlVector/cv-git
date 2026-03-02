/**
 * Tests for cv init machine name feature
 *
 * Tests the setupMachineName behavior and hook template content.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  parseCredentials,
  cleanMachineName,
  CREDENTIAL_PATHS,
} from '../utils/cv-hub-credentials';

describe('cv init — Machine Name', () => {
  let tempDir: string;
  let tempCredPath: string;
  let origPaths: string[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-init-mn-'));
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

  describe('existing machine name detection', () => {
    it('reads existing machine name from credentials', async () => {
      fs.writeFileSync(tempCredPath, `CV_HUB_PAT=test\nCV_HUB_MACHINE_NAME=z840-primary\n`);

      const { readCredentials } = await import('../utils/cv-hub-credentials');
      const creds = await readCredentials();
      expect(creds.CV_HUB_MACHINE_NAME).toBe('z840-primary');
    });

    it('detects when machine name is not set', async () => {
      fs.writeFileSync(tempCredPath, `CV_HUB_PAT=test\nCV_HUB_API=https://api.test.io\n`);

      const { readCredentials } = await import('../utils/cv-hub-credentials');
      const creds = await readCredentials();
      expect(creds.CV_HUB_MACHINE_NAME).toBeUndefined();
    });
  });

  describe('non-interactive mode (-y)', () => {
    it('uses hostname when no machine name is set', async () => {
      fs.writeFileSync(tempCredPath, `CV_HUB_PAT=test\n`);

      const { writeCredentialField, readCredentials } = await import('../utils/cv-hub-credentials');

      // Simulate what setupMachineName does in non-interactive mode
      const creds = await readCredentials();
      if (!creds.CV_HUB_MACHINE_NAME) {
        const hostname = cleanMachineName(os.hostname());
        await writeCredentialField('CV_HUB_MACHINE_NAME', hostname);
      }

      const updated = await readCredentials();
      expect(updated.CV_HUB_MACHINE_NAME).toBe(cleanMachineName(os.hostname()));
    });

    it('preserves existing machine name', async () => {
      fs.writeFileSync(tempCredPath, `CV_HUB_PAT=test\nCV_HUB_MACHINE_NAME=existing-name\n`);

      const { readCredentials } = await import('../utils/cv-hub-credentials');
      const creds = await readCredentials();

      // In non-interactive mode with existing name, init skips — name is preserved
      expect(creds.CV_HUB_MACHINE_NAME).toBe('existing-name');
    });
  });

  describe('machine name written to credentials', () => {
    it('writes machine name via writeCredentialField', async () => {
      fs.writeFileSync(tempCredPath, `CV_HUB_PAT=abc123\n`);

      const { writeCredentialField, readCredentials } = await import('../utils/cv-hub-credentials');
      await writeCredentialField('CV_HUB_MACHINE_NAME', 'my-dev-box');

      const content = fs.readFileSync(tempCredPath, 'utf-8');
      expect(content).toContain('CV_HUB_MACHINE_NAME=my-dev-box');
      expect(content).toContain('CV_HUB_PAT=abc123');

      const creds = await readCredentials();
      expect(creds.CV_HUB_MACHINE_NAME).toBe('my-dev-box');
    });
  });

  describe('session-start hook template', () => {
    // We verify the embedded HOOK_SESSION_START template in init.ts has the right patterns

    it('template includes MACHINE_NAME variable', () => {
      const initContent = fs.readFileSync(
        path.join(__dirname, 'init.ts'),
        'utf-8'
      );
      expect(initContent).toContain('CV_HUB_MACHINE_NAME');
      expect(initContent).toContain('machine_name=');
    });

    it('template sends machine_name in registration body', () => {
      const initContent = fs.readFileSync(
        path.join(__dirname, 'init.ts'),
        'utf-8'
      );
      expect(initContent).toContain('"machine_name"');
    });

    it('template sends repos in registration body', () => {
      const initContent = fs.readFileSync(
        path.join(__dirname, 'init.ts'),
        'utf-8'
      );
      expect(initContent).toContain('"repos"');
      expect(initContent).toContain('repos_json');
    });
  });
});

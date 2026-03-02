/**
 * Tests for CV-Hub credential utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  parseCredentials,
  cleanMachineName,
  readCredentials,
  writeCredentialField,
  getMachineName,
  findCredentialFile,
  CREDENTIAL_PATHS,
} from './cv-hub-credentials';

describe('CV-Hub Credential Utilities', () => {
  describe('parseCredentials', () => {
    it('parses KEY=VALUE lines', () => {
      const content = `CV_HUB_PAT=cv_pat_abc123
CV_HUB_API=https://api.hub.controlvector.io
CV_HUB_MACHINE_NAME=z840-primary`;

      const result = parseCredentials(content);
      expect(result.CV_HUB_PAT).toBe('cv_pat_abc123');
      expect(result.CV_HUB_API).toBe('https://api.hub.controlvector.io');
      expect(result.CV_HUB_MACHINE_NAME).toBe('z840-primary');
    });

    it('skips comments and empty lines', () => {
      const content = `# This is a comment
CV_HUB_PAT=test123

# Another comment
CV_HUB_API=https://example.com
`;

      const result = parseCredentials(content);
      expect(result.CV_HUB_PAT).toBe('test123');
      expect(result.CV_HUB_API).toBe('https://example.com');
      expect(Object.keys(result).length).toBe(2);
    });

    it('handles values with = signs', () => {
      const content = `CV_HUB_API=https://example.com/path?key=value`;
      const result = parseCredentials(content);
      expect(result.CV_HUB_API).toBe('https://example.com/path?key=value');
    });

    it('returns empty object for empty string', () => {
      expect(parseCredentials('')).toEqual({});
    });

    it('trims whitespace from keys and values', () => {
      const content = `  CV_HUB_PAT  =  abc123  `;
      const result = parseCredentials(content);
      expect(result.CV_HUB_PAT).toBe('abc123');
    });
  });

  describe('cleanMachineName', () => {
    it('lowercases the name', () => {
      expect(cleanMachineName('My-Machine')).toBe('my-machine');
    });

    it('trims whitespace', () => {
      expect(cleanMachineName('  z840  ')).toBe('z840');
    });

    it('replaces spaces with hyphens', () => {
      expect(cleanMachineName('my work laptop')).toBe('my-work-laptop');
    });
  });

  describe('file operations', () => {
    let tempDir: string;
    let tempCredPath: string;
    let origPaths: string[];

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-cred-test-'));
      tempCredPath = path.join(tempDir, 'credentials');
      // Save original CREDENTIAL_PATHS and point to temp dir
      origPaths = [...CREDENTIAL_PATHS];
      (CREDENTIAL_PATHS as string[]).length = 0;
      (CREDENTIAL_PATHS as string[]).push(tempCredPath);
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      // Restore CREDENTIAL_PATHS
      (CREDENTIAL_PATHS as string[]).length = 0;
      for (const p of origPaths) {
        (CREDENTIAL_PATHS as string[]).push(p);
      }
    });

    it('readCredentials returns empty object when no file exists', async () => {
      // tempCredPath doesn't exist yet
      const result = await readCredentials();
      expect(result).toEqual({});
    });

    it('readCredentials reads all fields from file', async () => {
      fs.writeFileSync(tempCredPath, `CV_HUB_PAT=test-pat\nCV_HUB_MACHINE_NAME=test-machine\nCV_HUB_API=https://test.io\n`);

      const result = await readCredentials();
      expect(result.CV_HUB_PAT).toBe('test-pat');
      expect(result.CV_HUB_MACHINE_NAME).toBe('test-machine');
      expect(result.CV_HUB_API).toBe('https://test.io');
    });

    it('writeCredentialField adds new field to existing file', async () => {
      fs.writeFileSync(tempCredPath, `CV_HUB_PAT=abc123\n`);

      await writeCredentialField('CV_HUB_MACHINE_NAME', 'z840');

      const content = fs.readFileSync(tempCredPath, 'utf-8');
      expect(content).toContain('CV_HUB_PAT=abc123');
      expect(content).toContain('CV_HUB_MACHINE_NAME=z840');
    });

    it('writeCredentialField updates existing field without destroying others', async () => {
      fs.writeFileSync(tempCredPath, `# My credentials\nCV_HUB_PAT=abc123\nCV_HUB_MACHINE_NAME=old-name\n`);

      await writeCredentialField('CV_HUB_MACHINE_NAME', 'new-name');

      const content = fs.readFileSync(tempCredPath, 'utf-8');
      expect(content).toContain('CV_HUB_PAT=abc123');
      expect(content).toContain('CV_HUB_MACHINE_NAME=new-name');
      expect(content).not.toContain('old-name');
      expect(content).toContain('# My credentials');
    });

    it('writeCredentialField creates file when none exists', async () => {
      // tempCredPath doesn't exist — writeCredentialField should create it
      await writeCredentialField('CV_HUB_MACHINE_NAME', 'new-machine');

      expect(fs.existsSync(tempCredPath)).toBe(true);
      const content = fs.readFileSync(tempCredPath, 'utf-8');
      expect(content).toContain('CV_HUB_MACHINE_NAME=new-machine');
    });

    it('getMachineName returns credential value when set', async () => {
      fs.writeFileSync(tempCredPath, `CV_HUB_MACHINE_NAME=Z840-Primary\n`);

      const result = await getMachineName();
      expect(result).toBe('z840-primary');
    });

    it('getMachineName falls back to hostname when not set', async () => {
      fs.writeFileSync(tempCredPath, `CV_HUB_PAT=abc\n`);

      const result = await getMachineName();
      // Should be the actual hostname, lowercased
      const expected = os.hostname().trim().toLowerCase().replace(/\s+/g, '-');
      expect(result).toBe(expected);
    });

    it('getMachineName cleans whitespace and casing', async () => {
      fs.writeFileSync(tempCredPath, `CV_HUB_MACHINE_NAME=  My Work Machine  \n`);

      const result = await getMachineName();
      expect(result).toBe('my-work-machine');
    });
  });
});

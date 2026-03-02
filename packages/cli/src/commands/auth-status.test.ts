/**
 * Tests for cv auth status command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  readCredentials,
  getMachineName,
  findCredentialFile,
  CREDENTIAL_PATHS,
} from '../utils/cv-hub-credentials';

describe('cv auth status', () => {
  let tempDir: string;
  let tempCredPath: string;
  let origPaths: string[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-auth-status-'));
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

  it('shows machine name when set', async () => {
    fs.writeFileSync(tempCredPath, `CV_HUB_PAT=cv_pat_abc\nCV_HUB_API=https://api.test.io\nCV_HUB_MACHINE_NAME=z840-primary\n`);

    const creds = await readCredentials();
    expect(creds.CV_HUB_MACHINE_NAME).toBe('z840-primary');

    const machineName = await getMachineName();
    expect(machineName).toBe('z840-primary');
  });

  it('shows warning when machine name not set', async () => {
    fs.writeFileSync(tempCredPath, `CV_HUB_PAT=cv_pat_abc\nCV_HUB_API=https://api.test.io\n`);

    const creds = await readCredentials();
    expect(creds.CV_HUB_MACHINE_NAME).toBeUndefined();

    // getMachineName falls back to hostname
    const machineName = await getMachineName();
    expect(machineName).toBeTruthy();
    expect(machineName).not.toBe('');
  });

  it('shows connection hint with machine name', async () => {
    fs.writeFileSync(tempCredPath, `CV_HUB_PAT=cv_pat_abc\nCV_HUB_API=https://api.test.io\nCV_HUB_MACHINE_NAME=dev-laptop\n`);

    const creds = await readCredentials();
    const displayName = creds.CV_HUB_MACHINE_NAME || await getMachineName();
    // The connection hint is: "Connect me to <machine-name>"
    expect(displayName).toBe('dev-laptop');
  });

  it('shows all existing info (PAT, org, API) — regression', async () => {
    fs.writeFileSync(tempCredPath, `CV_HUB_PAT=cv_pat_abc123\nCV_HUB_API=https://api.hub.controlvector.io\nCV_HUB_ORG_OVERRIDE=acme-corp\nCV_HUB_MACHINE_NAME=z840\n`);

    const creds = await readCredentials();
    expect(creds.CV_HUB_PAT).toBe('cv_pat_abc123');
    expect(creds.CV_HUB_API).toBe('https://api.hub.controlvector.io');
    expect(creds.CV_HUB_ORG_OVERRIDE).toBe('acme-corp');
    expect(creds.CV_HUB_MACHINE_NAME).toBe('z840');
  });

  it('finds credential file path', async () => {
    fs.writeFileSync(tempCredPath, `CV_HUB_PAT=test\n`);

    const credFile = await findCredentialFile();
    expect(credFile).toBe(tempCredPath);
  });

  it('returns null when no credential file exists', async () => {
    // Don't create the file
    const credFile = await findCredentialFile();
    expect(credFile).toBeNull();
  });
});

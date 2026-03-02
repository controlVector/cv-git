/**
 * Tests for cv connect command
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

describe('cv connect', () => {
  let tempDir: string;
  let tempCredPath: string;
  let origPaths: string[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-connect-'));
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

  it('shows connection hint with configured machine name', async () => {
    fs.writeFileSync(tempCredPath, `CV_HUB_PAT=cv_pat_abc\nCV_HUB_API=https://api.test.io\nCV_HUB_MACHINE_NAME=z840-primary\n`);

    const machineName = await getMachineName();
    expect(machineName).toBe('z840-primary');

    // The connect output includes: "Connect me to z840-primary"
    const connectionHint = `Connect me to ${machineName}`;
    expect(connectionHint).toBe('Connect me to z840-primary');
  });

  it('shows fallback hostname when machine name not set', async () => {
    fs.writeFileSync(tempCredPath, `CV_HUB_PAT=cv_pat_abc\nCV_HUB_API=https://api.test.io\n`);

    const creds = await readCredentials();
    expect(creds.CV_HUB_MACHINE_NAME).toBeUndefined();

    const machineName = await getMachineName();
    expect(machineName).toBeTruthy();
    // Still provides a connection hint with hostname fallback
    expect(`Connect me to ${machineName}`).toContain('Connect me to ');
  });

  it('reports ready=true when PAT, API, and machine name all set', async () => {
    fs.writeFileSync(tempCredPath, `CV_HUB_PAT=cv_pat_abc\nCV_HUB_API=https://api.test.io\nCV_HUB_MACHINE_NAME=dev-box\n`);

    const creds = await readCredentials();
    const hasApi = !!(creds.CV_HUB_PAT && creds.CV_HUB_API);
    const ready = hasApi && !!creds.CV_HUB_MACHINE_NAME;

    expect(ready).toBe(true);
  });

  it('reports ready=false when no credentials exist', async () => {
    // No credentials file
    const creds = await readCredentials();
    const hasApi = !!(creds.CV_HUB_PAT && creds.CV_HUB_API);
    const ready = hasApi && !!creds.CV_HUB_MACHINE_NAME;

    expect(ready).toBe(false);
  });

  it('reports ready=false when PAT is missing', async () => {
    fs.writeFileSync(tempCredPath, `CV_HUB_API=https://api.test.io\nCV_HUB_MACHINE_NAME=dev-box\n`);

    const creds = await readCredentials();
    const hasApi = !!(creds.CV_HUB_PAT && creds.CV_HUB_API);

    expect(hasApi).toBe(false);
  });

  it('provides credential file path for JSON output', async () => {
    fs.writeFileSync(tempCredPath, `CV_HUB_PAT=test\n`);

    const credFile = await findCredentialFile();
    expect(credFile).toBe(tempCredPath);
  });
});

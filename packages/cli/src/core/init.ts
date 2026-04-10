/**
 * Core Init Function — importable, no side effects.
 *
 * Used by:
 *   - cv-git init (interactive CLI wrapper)
 *   - cv-agent bootstrapRepo (headless, non-interactive)
 *
 * This module does NOT:
 *   - Use readline or prompts
 *   - Call process.exit
 *   - Print to console (uses callbacks for logging)
 */

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

export interface InitOptions {
  /** Path to initialize */
  path: string;
  /** Skip all prompts, use defaults */
  headless?: boolean;
  /** Git platform: 'cv-hub' | 'github' | 'gitlab' | 'bitbucket' */
  provider?: string;
  /** CV-Hub API URL */
  hubUrl?: string;
  /** CV-Hub PAT token */
  token?: string;
  /** Create repo on CV-Hub if it doesn't exist */
  createRepo?: boolean;
  /** Override repo name (default: directory name) */
  repoName?: string;
  /** CV-Hub username (for repo creation) */
  username?: string;
  /** Log callback (optional) */
  log?: (message: string) => void;
}

export interface InitResult {
  repoPath: string;
  provider: string;
  remoteName?: string;
  remoteUrl?: string;
  claudeMdCreated: boolean;
  repoCreatedOnHub: boolean;
  gitInitialized: boolean;
}

function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf8', timeout: 15_000 }).trim();
}

/**
 * Generate a default CLAUDE.md for a new project.
 */
export function generateDefaultClaudeMd(repoName: string): string {
  return `# ${repoName}

## Overview
[Describe your project here]

## Tech Stack
[What languages/frameworks does this project use?]

## Key Files
[List important files and what they do]

## Conventions
- [Coding conventions, naming patterns, etc.]

## Build & Run
[How to build and run this project]

## Testing
[How to run tests]
`;
}

/**
 * Initialize a repository with cv-git configuration.
 *
 * In headless mode (headless: true), this:
 * - Initializes git if needed
 * - Adds CV-Hub remote if token is provided
 * - Creates repo on CV-Hub if createRepo is true
 * - Generates CLAUDE.md if missing
 * - Creates .cv directory
 *
 * Throws on unrecoverable errors. Returns InitResult on success.
 */
export async function initRepo(options: InitOptions): Promise<InitResult> {
  const log = options.log || (() => {});
  const repoPath = options.path;
  const repoName = options.repoName || basename(repoPath);
  const provider = options.provider || 'cv-hub';

  let gitInitialized = false;
  let remoteName: string | undefined;
  let remoteUrl: string | undefined;
  let repoCreatedOnHub = false;
  let claudeMdCreated = false;

  // 1. Ensure git repo exists
  if (!existsSync(join(repoPath, '.git'))) {
    log('Initializing git repository...');
    git('git init', repoPath);
    git('git checkout -b main', repoPath);
    gitInitialized = true;
  }

  // 2. Ensure .cv directory
  const cvDir = join(repoPath, '.cv');
  if (!existsSync(cvDir)) {
    mkdirSync(cvDir, { recursive: true });
  }

  // 3. Generate CLAUDE.md if missing
  const claudeMdPath = join(repoPath, 'CLAUDE.md');
  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, generateDefaultClaudeMd(repoName));
    claudeMdCreated = true;
    log('Created CLAUDE.md');
  }

  // 4. CV-Hub remote setup (if provider is cv-hub and token is available)
  if (provider === 'cv-hub' && options.token && options.hubUrl) {
    const username = options.username || 'user';
    const gitHost = options.hubUrl
      .replace(/^https?:\/\//, '')
      .replace(/^api\./, 'git.');

    // Check if repo exists on CV-Hub
    let repoExists = false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(`${options.hubUrl}/api/v1/repos/${username}/${repoName}`, {
        headers: { Authorization: `Bearer ${options.token}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      repoExists = res.ok;
    } catch {
      // API unreachable — skip remote setup
    }

    // Create repo on CV-Hub if requested and doesn't exist
    if (!repoExists && options.createRepo) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        const res = await fetch(`${options.hubUrl}/api/v1/user/repos`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: repoName, auto_init: false }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          repoCreatedOnHub = true;
          repoExists = true;
          log(`Repo created on CV-Hub: ${username}/${repoName}`);
        }
      } catch {
        // Repo creation failed — continue without remote
      }
    }

    // Add git remote
    if (repoExists) {
      remoteUrl = `https://${gitHost}/${username}/${repoName}.git`;
      remoteName = 'cv-hub';

      try {
        // Check if remote already exists
        const existingRemote = git('git remote get-url cv-hub 2>/dev/null || echo ""', repoPath);
        if (!existingRemote) {
          git(`git remote add cv-hub ${remoteUrl}`, repoPath);
          log(`Remote added: cv-hub → ${remoteUrl}`);
        } else if (existingRemote !== remoteUrl) {
          git(`git remote set-url cv-hub ${remoteUrl}`, repoPath);
          log(`Remote updated: cv-hub → ${remoteUrl}`);
        }

        // Configure credentials for this remote
        git(`git config credential.https://${gitHost}.helper store`, repoPath);
      } catch {
        // Remote setup failed — non-fatal
      }
    }
  }

  return {
    repoPath,
    provider,
    remoteName,
    remoteUrl,
    claudeMdCreated,
    repoCreatedOnHub,
    gitInitialized,
  };
}

/**
 * Deploy Provider Interface + Base Class
 *
 * Each provider implements the full deploy lifecycle:
 *   preflight → build → push → deploy → healthCheck
 *   rollback (when things go wrong)
 *
 * All shell commands go through execCommand() which handles:
 *   - Timeouts (default 5 minutes per command)
 *   - Logging (every command and its output)
 *   - Dry run mode (log but don't execute)
 *   - Error wrapping with context
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type {
  DeployConfig,
  DeployProvider,
  DeployTokenConfig,
  PreflightResult,
  BuildResult,
  PushResult,
  DeployResult,
  HealthResult,
  RollbackResult,
  DeployHistory,
} from '@cv-git/shared';

export interface DeployOptions {
  dryRun: boolean;
  ref?: string;
  verbose?: boolean;
  timeout?: number;
  onEvent?: (event: DeployEvent) => void;
}

export interface DeployEvent {
  phase: 'preflight' | 'build' | 'push' | 'deploy' | 'healthcheck' | 'rollback';
  message: string;
  status: 'start' | 'progress' | 'success' | 'error';
  service?: string;
  timestamp: string;
}

export interface DeployProviderInterface {
  name: DeployProvider;

  preflight(config: DeployConfig, options: DeployOptions): Promise<PreflightResult>;
  build(config: DeployConfig, options: DeployOptions): Promise<BuildResult[]>;
  push(config: DeployConfig, builds: BuildResult[], options: DeployOptions): Promise<PushResult[]>;
  deploy(config: DeployConfig, images: PushResult[], options: DeployOptions): Promise<DeployResult>;
  healthCheck(config: DeployConfig): Promise<HealthResult>;
  rollback(config: DeployConfig, toVersion: string, options: DeployOptions): Promise<RollbackResult>;
  getDeployHistory(config: DeployConfig, limit?: number): Promise<DeployHistory>;
}

export abstract class BaseDeployProvider implements DeployProviderInterface {
  abstract name: DeployProvider;

  /**
   * Execute a shell command with timeout, logging, and dry-run support.
   */
  protected async execCommand(
    command: string,
    options: DeployOptions,
    description?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const timeout = options.timeout ?? 300_000; // 5 min default

    if (description) {
      this.emit({ phase: 'deploy', message: description, status: 'progress' }, options);
    }

    if (options.dryRun) {
      this.emit(
        { phase: 'deploy', message: `[DRY RUN] Would execute: ${command}`, status: 'progress' },
        options,
      );
      return { stdout: '[dry run]', stderr: '', exitCode: 0 };
    }

    if (options.verbose) {
      this.emit({ phase: 'deploy', message: `$ ${command}`, status: 'progress' }, options);
    }

    return new Promise((resolve, reject) => {
      const proc = spawn('sh', ['-c', command], {
        timeout,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Command failed (exit ${code}): ${command}\n${stderr}`));
        } else {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 });
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Command error: ${command}\n${err.message}`));
      });
    });
  }

  /**
   * Emit a deploy event via the callback.
   */
  protected emit(event: Omit<DeployEvent, 'timestamp'>, options: DeployOptions): void {
    options.onEvent?.({
      ...event,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Resolve a token reference (vault://xxx or env://VAR).
   */
  protected async resolveToken(tokenRef: string | DeployTokenConfig): Promise<string> {
    const source = typeof tokenRef === 'string' ? tokenRef : tokenRef.source;

    if (source.startsWith('env://')) {
      const varName = source.slice(6);
      const value = process.env[varName];
      if (!value) throw new Error(`Environment variable ${varName} not set`);
      return value;
    }

    if (source.startsWith('vault://')) {
      const keyName = source.slice(8);
      // Try cv-hub credentials file first
      const credPath = path.join(os.homedir(), '.config', 'cv-hub', 'credentials');
      try {
        const creds = await fs.readFile(credPath, 'utf-8');
        const match = creds.match(new RegExp(`${keyName}=(.+)`));
        if (match) return match[1].trim();
      } catch {
        // Fall through to env
      }

      // Fall back to environment variable
      const envValue =
        process.env[keyName] ?? process.env[keyName.toUpperCase().replace(/-/g, '_')];
      if (envValue) return envValue;

      throw new Error(`Token ${keyName} not found in vault or environment`);
    }

    // Plain string token
    return source;
  }

  /**
   * Run a hook script if configured.
   */
  protected async runHook(
    hookPath: string | undefined,
    config: DeployConfig,
    options: DeployOptions,
  ): Promise<void> {
    if (!hookPath) return;

    this.emit(
      { phase: 'deploy', message: `Running hook: ${hookPath}`, status: 'progress' },
      options,
    );

    await this.execCommand(`bash ${hookPath}`, options, `Hook: ${hookPath}`);
  }

  /**
   * Get the current git ref (short SHA + branch).
   */
  protected async getGitRef(
    repoRoot: string,
  ): Promise<{ sha: string; branch: string; tag?: string }> {
    try {
      const { stdout: sha } = await this.execCommand('git rev-parse HEAD', {
        dryRun: false,
        timeout: 10_000,
      });
      const { stdout: branch } = await this.execCommand('git rev-parse --abbrev-ref HEAD', {
        dryRun: false,
        timeout: 10_000,
      });
      let tag: string | undefined;
      try {
        const { stdout: tagOut } = await this.execCommand('git describe --tags --exact-match 2>/dev/null', {
          dryRun: false,
          timeout: 10_000,
        });
        if (tagOut) tag = tagOut;
      } catch {
        // No tag at HEAD
      }
      return { sha, branch, tag };
    } catch {
      return { sha: 'unknown', branch: 'unknown' };
    }
  }

  abstract preflight(config: DeployConfig, options: DeployOptions): Promise<PreflightResult>;
  abstract build(config: DeployConfig, options: DeployOptions): Promise<BuildResult[]>;
  abstract push(
    config: DeployConfig,
    builds: BuildResult[],
    options: DeployOptions,
  ): Promise<PushResult[]>;
  abstract deploy(
    config: DeployConfig,
    images: PushResult[],
    options: DeployOptions,
  ): Promise<DeployResult>;
  abstract healthCheck(config: DeployConfig): Promise<HealthResult>;
  abstract rollback(
    config: DeployConfig,
    toVersion: string,
    options: DeployOptions,
  ): Promise<RollbackResult>;
  abstract getDeployHistory(config: DeployConfig, limit?: number): Promise<DeployHistory>;
}

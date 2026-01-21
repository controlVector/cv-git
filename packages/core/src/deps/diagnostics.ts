/**
 * Build Diagnostics Service
 *
 * Runs builds, captures output, diagnoses issues, and applies workarounds.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { BuildSystem, BuildDependency } from '@cv-git/shared';
import {
  KnownIssue,
  IssueRegistry,
  DiagnosisResult,
  BuildResult,
  DiagnoseOptions,
  Workaround,
  loadIssueRegistry,
  matchIssue
} from './issues/registry.js';

function loadKnownIssues(): IssueRegistry {
  // Embedded known issues to avoid JSON import issues
  return {
    version: '1.0.0',
    updatedAt: '2026-01-20T00:00:00Z',
    issues: [
      {
        id: 'grpc-bazel-header-inclusion',
        buildSystem: 'bazel',
        package: 'grpc',
        affectedVersions: '>=1.50.0',
        errorPatterns: [
          'undeclared inclusion.*in rule \'@@grpc~',
          'undeclared inclusion.*grpc.*:status_helper',
          'grpc.*upb-gen.*\\.upb\\.h',
          'grpc.*ext/upb-gen.*\\.upb_minitable\\.h',
          'this rule is missing dependency declarations.*grpc'
        ],
        severity: 'error',
        description: 'grpc bazel rules have missing header declarations for upb-generated protobuf files.',
        upstreamIssue: 'https://github.com/grpc/grpc/issues/35271',
        tags: ['bazel', 'grpc', 'protobuf', 'upb', 'header'],
        status: 'active',
        workarounds: [
          {
            id: 'spawn-local',
            description: 'Use local spawn strategy to bypass sandbox restrictions',
            type: 'flag',
            automatic: true,
            priority: 1,
            action: { type: 'add_build_flag', flag: '--spawn_strategy=local' },
            risks: 'Builds may be less hermetic and reproducible'
          },
          {
            id: 'bazelrc-spawn-local',
            description: 'Add spawn_strategy=local to .bazelrc for persistent fix',
            type: 'config',
            automatic: true,
            priority: 2,
            action: {
              type: 'add_to_config',
              file: '.bazelrc.user',
              content: '# Workaround for grpc header inclusion issue (cv-git)\nbuild --spawn_strategy=local\n',
              position: 'append'
            }
          }
        ]
      },
      {
        id: 'bazel-sandbox-permission',
        buildSystem: 'bazel',
        package: '*',
        errorPatterns: [
          'sandbox.*permission denied',
          'operation not permitted.*sandbox',
          'failed.*sandbox.*mount',
          'linux-sandbox.*EPERM'
        ],
        severity: 'error',
        description: 'Bazel sandbox operations failing due to permission issues.',
        tags: ['bazel', 'sandbox', 'permission'],
        status: 'active',
        workarounds: [
          {
            id: 'disable-sandbox',
            description: 'Disable sandboxing entirely',
            type: 'flag',
            automatic: true,
            priority: 1,
            action: { type: 'add_build_flag', flag: '--spawn_strategy=local' },
            risks: 'Builds are less isolated and reproducible'
          }
        ]
      },
      {
        id: 'bazel-memory-oom',
        buildSystem: 'bazel',
        package: '*',
        errorPatterns: [
          'java\\.lang\\.OutOfMemoryError',
          'Cannot allocate memory',
          'ENOMEM',
          'Killed.*memory',
          'exit code 137'
        ],
        severity: 'error',
        description: 'Bazel or its subprocesses ran out of memory.',
        tags: ['bazel', 'memory', 'oom'],
        status: 'active',
        workarounds: [
          {
            id: 'limit-jobs',
            description: 'Reduce parallel job count',
            type: 'flag',
            automatic: true,
            priority: 1,
            action: { type: 'add_build_flag', flag: '--jobs=4' }
          }
        ]
      }
    ]
  };
}

/**
 * Build commands for each build system
 */
const BUILD_COMMANDS: Record<string, { command: string; args: string[] }> = {
  bazel: { command: 'bazel', args: ['build', '//...'] },
  npm: { command: 'npm', args: ['run', 'build'] },
  cargo: { command: 'cargo', args: ['build'] },
  go: { command: 'go', args: ['build', './...'] },
  cmake: { command: 'cmake', args: ['--build', '.'] },
  make: { command: 'make', args: [] },
  meson: { command: 'meson', args: ['compile'] }
};

/**
 * Build Diagnostics Service
 */
export class BuildDiagnostics {
  private registry: IssueRegistry;
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.registry = loadKnownIssues();
  }

  /**
   * Get all known issues
   */
  getKnownIssues(): KnownIssue[] {
    return this.registry.issues;
  }

  /**
   * Get issues for a specific build system
   */
  getIssuesForBuildSystem(buildSystem: BuildSystem): KnownIssue[] {
    return this.registry.issues.filter(
      issue => issue.buildSystem === buildSystem || issue.package === '*'
    );
  }

  /**
   * Get issues for a specific package
   */
  getIssuesForPackage(packageName: string): KnownIssue[] {
    return this.registry.issues.filter(
      issue => issue.package === packageName || issue.package === '*'
    );
  }

  /**
   * Run a build and capture output
   */
  async runBuild(
    buildSystem: BuildSystem,
    options: { target?: string; timeout?: number; extraArgs?: string[] } = {}
  ): Promise<BuildResult> {
    const config = BUILD_COMMANDS[buildSystem];
    if (!config) {
      throw new Error(`Unknown build system: ${buildSystem}`);
    }

    const args = [...config.args];

    // Handle custom target
    if (options.target) {
      if (buildSystem === 'bazel') {
        args[1] = options.target;
      } else if (buildSystem === 'cargo' || buildSystem === 'go') {
        args.push(options.target);
      }
    }

    // Add extra args
    if (options.extraArgs) {
      args.push(...options.extraArgs);
    }

    const startTime = Date.now();
    const timeout = options.timeout || 300000; // 5 minutes default

    return new Promise((resolve) => {
      const stdout: string[] = [];
      const stderr: string[] = [];

      const proc = spawn(config.command, args, {
        cwd: this.rootDir,
        shell: true,
        env: { ...process.env }
      });

      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
      }, timeout);

      proc.stdout?.on('data', (data) => {
        stdout.push(data.toString());
      });

      proc.stderr?.on('data', (data) => {
        stderr.push(data.toString());
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;
        const stdoutStr = stdout.join('');
        const stderrStr = stderr.join('');

        resolve({
          success: code === 0,
          exitCode: code ?? 1,
          stdout: stdoutStr,
          stderr: stderrStr,
          output: stdoutStr + '\n' + stderrStr,
          duration,
          command: `${config.command} ${args.join(' ')}`
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        resolve({
          success: false,
          exitCode: 1,
          stdout: stdout.join(''),
          stderr: stderr.join('') + '\n' + err.message,
          output: stdout.join('') + '\n' + stderr.join('') + '\n' + err.message,
          duration,
          command: `${config.command} ${args.join(' ')}`
        });
      });
    });
  }

  /**
   * Diagnose build output for known issues
   */
  diagnose(
    buildOutput: string,
    buildSystem: BuildSystem,
    dependencies?: BuildDependency[]
  ): DiagnosisResult[] {
    const results: DiagnosisResult[] = [];
    const issues = this.getIssuesForBuildSystem(buildSystem);

    for (const issue of issues) {
      // Check if we have the affected package
      if (issue.package !== '*' && dependencies) {
        const hasDep = dependencies.some(d => d.name === issue.package);
        if (!hasDep) continue;
      }

      const match = matchIssue(issue, buildOutput);
      if (match) {
        // Try to detect version from dependencies
        if (dependencies && issue.package !== '*') {
          const dep = dependencies.find(d => d.name === issue.package);
          if (dep?.versionConstraint) {
            match.detectedVersion = dep.versionConstraint.replace(/^[=<>^~]+/, '');
          }
        }

        results.push(match);
      }
    }

    // Sort by confidence (highest first)
    results.sort((a, b) => b.confidence - a.confidence);

    return results;
  }

  /**
   * Get recommended workarounds for diagnosed issues
   */
  getWorkarounds(diagnosis: DiagnosisResult[]): Map<DiagnosisResult, Workaround[]> {
    const workarounds = new Map<DiagnosisResult, Workaround[]>();

    for (const result of diagnosis) {
      const available = result.issue.workarounds
        .filter(w => w.automatic || !w.automatic)
        .sort((a, b) => (a.priority || 99) - (b.priority || 99));

      workarounds.set(result, available);
    }

    return workarounds;
  }

  /**
   * Apply a workaround
   */
  async applyWorkaround(workaround: Workaround, dryRun = false): Promise<{
    success: boolean;
    message: string;
    changes?: string[];
  }> {
    const changes: string[] = [];

    try {
      switch (workaround.action.type) {
        case 'add_build_flag': {
          const action = workaround.action;
          const message = `Add build flag: ${action.flag}`;
          changes.push(message);

          if (!dryRun) {
            // For now, we'll add to .bazelrc.user or equivalent
            const bazelrcPath = path.join(this.rootDir, '.bazelrc.user');
            const content = `# Added by cv-git: ${workaround.description}\nbuild ${action.flag}\n`;
            await fs.appendFile(bazelrcPath, content);
          }

          return { success: true, message, changes };
        }

        case 'pin_version': {
          const action = workaround.action;
          const message = `Pin ${action.package} to version ${action.version}`;
          changes.push(message);

          if (!dryRun && action.file) {
            const filePath = path.join(this.rootDir, action.file);
            let content = await fs.readFile(filePath, 'utf-8');

            // For MODULE.bazel, update bazel_dep version
            const pattern = new RegExp(
              `(bazel_dep\\s*\\(\\s*name\\s*=\\s*["']${action.package}["']\\s*,\\s*version\\s*=\\s*["'])[^"']+["']`,
              'g'
            );
            content = content.replace(pattern, `$1${action.version}"`);

            await fs.writeFile(filePath, content);
          }

          return { success: true, message, changes };
        }

        case 'patch_file': {
          const action = workaround.action;
          const filePath = path.join(this.rootDir, action.file);
          const message = `Patch ${action.file}`;
          changes.push(message);

          if (!dryRun) {
            let content = await fs.readFile(filePath, 'utf-8');

            if (action.regex) {
              const pattern = new RegExp(action.search, 'g');
              content = content.replace(pattern, action.replace);
            } else {
              content = content.replace(action.search, action.replace);
            }

            await fs.writeFile(filePath, content);
          }

          return { success: true, message, changes };
        }

        case 'set_env': {
          const action = workaround.action;
          const message = `Set environment variable: ${action.key}=${action.value}`;
          changes.push(message);

          if (!dryRun) {
            process.env[action.key] = action.value;
            // Also add to .env file if it exists
            const envPath = path.join(this.rootDir, '.env');
            try {
              await fs.appendFile(envPath, `\n${action.key}=${action.value}\n`);
            } catch {
              // .env file doesn't exist, that's ok
            }
          }

          return { success: true, message, changes };
        }

        case 'add_to_config': {
          const action = workaround.action;
          const filePath = path.join(this.rootDir, action.file);
          const message = `Add configuration to ${action.file}`;
          changes.push(message);

          if (!dryRun) {
            try {
              let content = '';
              try {
                content = await fs.readFile(filePath, 'utf-8');
              } catch {
                // File doesn't exist, will create it
              }

              switch (action.position) {
                case 'prepend':
                  content = action.content + '\n' + content;
                  break;
                case 'after_pattern':
                  if (action.pattern) {
                    content = content.replace(
                      new RegExp(`(${action.pattern})`),
                      `$1\n${action.content}`
                    );
                  }
                  break;
                case 'before_pattern':
                  if (action.pattern) {
                    content = content.replace(
                      new RegExp(`(${action.pattern})`),
                      `${action.content}\n$1`
                    );
                  }
                  break;
                default: // append
                  content = content + '\n' + action.content;
              }

              await fs.writeFile(filePath, content);
            } catch (err) {
              return {
                success: false,
                message: `Failed to update ${action.file}: ${err}`,
                changes
              };
            }
          }

          return { success: true, message, changes };
        }

        case 'run_command': {
          const action = workaround.action;
          const message = `Run command: ${action.command}`;
          changes.push(message);

          if (!dryRun) {
            const cwd = action.cwd
              ? path.join(this.rootDir, action.cwd)
              : this.rootDir;

            await new Promise<void>((resolve, reject) => {
              const proc = spawn(action.command, [], {
                cwd,
                shell: true,
                stdio: 'inherit'
              });

              proc.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Command failed with code ${code}`));
              });
            });
          }

          return { success: true, message, changes };
        }

        default:
          return {
            success: false,
            message: `Unknown action type: ${(workaround.action as any).type}`,
            changes
          };
      }
    } catch (err) {
      return {
        success: false,
        message: `Failed to apply workaround: ${err}`,
        changes
      };
    }
  }

  /**
   * Generate a diagnostic report
   */
  generateReport(
    buildResult: BuildResult,
    diagnosis: DiagnosisResult[],
    dependencies?: BuildDependency[]
  ): string {
    const lines: string[] = [];

    lines.push('═'.repeat(60));
    lines.push('CV-GIT BUILD DIAGNOSTICS REPORT');
    lines.push('═'.repeat(60));
    lines.push('');

    // Build summary
    lines.push('BUILD SUMMARY');
    lines.push('─'.repeat(40));
    lines.push(`  Command: ${buildResult.command}`);
    lines.push(`  Status: ${buildResult.success ? '✓ SUCCESS' : '✗ FAILED'}`);
    lines.push(`  Exit Code: ${buildResult.exitCode}`);
    lines.push(`  Duration: ${(buildResult.duration / 1000).toFixed(1)}s`);
    lines.push('');

    if (diagnosis.length === 0) {
      if (!buildResult.success) {
        lines.push('NO KNOWN ISSUES MATCHED');
        lines.push('─'.repeat(40));
        lines.push('The build failed but no known issues were detected.');
        lines.push('This may be a new issue or a project-specific problem.');
        lines.push('');
        lines.push('Build output (last 20 lines):');
        const outputLines = buildResult.output.split('\n');
        const lastLines = outputLines.slice(-20);
        for (const line of lastLines) {
          lines.push(`  ${line}`);
        }
      } else {
        lines.push('No issues detected - build succeeded!');
      }
    } else {
      lines.push(`DIAGNOSED ISSUES: ${diagnosis.length}`);
      lines.push('');

      for (let i = 0; i < diagnosis.length; i++) {
        const result = diagnosis[i];
        lines.push('─'.repeat(60));
        lines.push(`[${i + 1}] ${result.issue.id.toUpperCase()}`);
        lines.push('─'.repeat(60));
        lines.push(`  Package: ${result.issue.package}${result.detectedVersion ? ` (v${result.detectedVersion})` : ''}`);
        lines.push(`  Severity: ${result.issue.severity.toUpperCase()}`);
        lines.push(`  Confidence: ${Math.round(result.confidence * 100)}%`);
        lines.push('');
        lines.push(`  ${result.issue.description}`);
        lines.push('');

        if (result.issue.upstreamIssue) {
          lines.push(`  Upstream: ${result.issue.upstreamIssue}`);
          lines.push('');
        }

        lines.push('  Matched Error:');
        lines.push(`    Line ${result.lineNumber}: ${result.matchedError.substring(0, 100)}${result.matchedError.length > 100 ? '...' : ''}`);
        lines.push('');

        if (result.issue.workarounds.length > 0) {
          lines.push('  WORKAROUNDS:');
          for (const w of result.issue.workarounds) {
            const auto = w.automatic ? '[AUTO]' : '[MANUAL]';
            lines.push(`    ${auto} ${w.id}: ${w.description}`);
            if (w.risks) {
              lines.push(`           ⚠ ${w.risks}`);
            }
          }
        }
        lines.push('');
      }

      lines.push('─'.repeat(60));
      lines.push('');
      lines.push('To apply automatic workarounds, run:');
      lines.push('  cv deps diagnose --fix');
      lines.push('');
      lines.push('To preview changes without applying:');
      lines.push('  cv deps diagnose --fix --dry-run');
    }

    lines.push('');
    lines.push('═'.repeat(60));

    return lines.join('\n');
  }

  /**
   * Full diagnostic flow
   */
  async diagnoseAndReport(
    buildSystem: BuildSystem,
    options: DiagnoseOptions = {},
    dependencies?: BuildDependency[]
  ): Promise<{
    buildResult: BuildResult | null;
    diagnosis: DiagnosisResult[];
    report: string;
    appliedWorkarounds: Workaround[];
  }> {
    let buildResult: BuildResult | null = null;
    let buildOutput: string;

    // Either run build or use provided output
    if (options.buildOutput) {
      buildOutput = options.buildOutput;
    } else {
      buildResult = await this.runBuild(buildSystem, {
        target: options.target,
        timeout: options.timeout
      });
      buildOutput = buildResult.output;
    }

    // Diagnose issues
    const diagnosis = this.diagnose(buildOutput, buildSystem, dependencies);

    // Apply workarounds if requested
    const appliedWorkarounds: Workaround[] = [];
    if (options.fix && diagnosis.length > 0) {
      for (const result of diagnosis) {
        const autoWorkarounds = result.issue.workarounds
          .filter(w => w.automatic)
          .sort((a, b) => (a.priority || 99) - (b.priority || 99));

        if (autoWorkarounds.length > 0) {
          const workaround = autoWorkarounds[0];
          const applied = await this.applyWorkaround(workaround, options.dryRun);

          if (applied.success) {
            appliedWorkarounds.push(workaround);
          }
        }
      }
    }

    // Generate report
    const report = buildResult
      ? this.generateReport(buildResult, diagnosis, dependencies)
      : this.generateReportFromOutput(buildOutput, diagnosis, dependencies);

    return {
      buildResult,
      diagnosis,
      report,
      appliedWorkarounds
    };
  }

  /**
   * Generate report when we only have build output (no buildResult)
   */
  private generateReportFromOutput(
    buildOutput: string,
    diagnosis: DiagnosisResult[],
    dependencies?: BuildDependency[]
  ): string {
    // Create a mock build result for the report
    const mockResult: BuildResult = {
      success: diagnosis.length === 0,
      exitCode: diagnosis.length > 0 ? 1 : 0,
      stdout: '',
      stderr: buildOutput,
      output: buildOutput,
      duration: 0,
      command: '(analyzed from provided output)'
    };

    return this.generateReport(mockResult, diagnosis, dependencies);
  }
}

/**
 * Create a BuildDiagnostics instance
 */
export function createBuildDiagnostics(rootDir: string): BuildDiagnostics {
  return new BuildDiagnostics(rootDir);
}

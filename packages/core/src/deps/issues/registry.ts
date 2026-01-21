/**
 * Build Issue Registry
 *
 * Defines types for known build issues and their workarounds.
 * Issues are matched against build output to provide actionable diagnostics.
 */

import { BuildSystem } from '@cv-git/shared';

/**
 * Action to add a build flag
 */
export interface AddBuildFlagAction {
  type: 'add_build_flag';
  flag: string;
  /** Optional: only for specific build system commands */
  command?: string;
}

/**
 * Action to pin a dependency version
 */
export interface PinVersionAction {
  type: 'pin_version';
  package: string;
  version: string;
  /** File to modify (e.g., MODULE.bazel, package.json) */
  file?: string;
}

/**
 * Action to patch a file
 */
export interface PatchFileAction {
  type: 'patch_file';
  file: string;
  search: string;
  replace: string;
  /** Use regex for search */
  regex?: boolean;
}

/**
 * Action to set an environment variable
 */
export interface SetEnvAction {
  type: 'set_env';
  key: string;
  value: string;
}

/**
 * Action to add content to a config file
 */
export interface AddToConfigAction {
  type: 'add_to_config';
  file: string;
  content: string;
  /** Where to add: 'append', 'prepend', 'after_pattern', 'before_pattern' */
  position?: 'append' | 'prepend' | 'after_pattern' | 'before_pattern';
  /** Pattern for position-based insertion */
  pattern?: string;
}

/**
 * Action to run a command
 */
export interface RunCommandAction {
  type: 'run_command';
  command: string;
  /** Working directory relative to project root */
  cwd?: string;
}

/**
 * Union of all workaround action types
 */
export type WorkaroundAction =
  | AddBuildFlagAction
  | PinVersionAction
  | PatchFileAction
  | SetEnvAction
  | AddToConfigAction
  | RunCommandAction;

/**
 * A workaround for a known issue
 */
export interface Workaround {
  /** Unique identifier for this workaround */
  id: string;
  /** Human-readable description */
  description: string;
  /** Type of workaround */
  type: 'flag' | 'patch' | 'pin_version' | 'env_var' | 'config' | 'command';
  /** Can cv-git apply this automatically? */
  automatic: boolean;
  /** The action to take */
  action: WorkaroundAction;
  /** Risks or side effects of this workaround */
  risks?: string;
  /** Priority (lower = try first) */
  priority?: number;
}

/**
 * A known build issue with patterns and workarounds
 */
export interface KnownIssue {
  /** Unique identifier (e.g., "grpc-header-inclusion") */
  id: string;
  /** Build system this issue affects */
  buildSystem: BuildSystem;
  /** Package name that triggers this issue */
  package: string;
  /** Semver range of affected versions (e.g., ">=1.50.0 <1.62.0") */
  affectedVersions?: string;
  /** Regex patterns to match in build output */
  errorPatterns: string[];
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
  /** Human-readable description of the issue */
  description: string;
  /** URL to upstream issue tracker */
  upstreamIssue?: string;
  /** Available workarounds */
  workarounds: Workaround[];
  /** Tags for categorization */
  tags?: string[];
  /** When this issue was added to registry */
  addedAt?: string;
  /** When this issue was last updated */
  updatedAt?: string;
  /** Is this issue still active or has it been fixed upstream? */
  status?: 'active' | 'fixed' | 'wontfix';
  /** Version where the issue was fixed upstream */
  fixedInVersion?: string;
}

/**
 * Result of diagnosing a build issue
 */
export interface DiagnosisResult {
  /** The matched known issue */
  issue: KnownIssue;
  /** The specific error message that matched */
  matchedError: string;
  /** Line number in build output where error was found */
  lineNumber?: number;
  /** The pattern that matched */
  matchedPattern: string;
  /** Confidence level (0-1) based on pattern specificity */
  confidence: number;
  /** Detected version of the affected package */
  detectedVersion?: string;
}

/**
 * Result of running a build
 */
export interface BuildResult {
  /** Whether the build succeeded */
  success: boolean;
  /** Exit code */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Combined output */
  output: string;
  /** Duration in milliseconds */
  duration: number;
  /** Build command that was run */
  command: string;
}

/**
 * Options for the diagnose command
 */
export interface DiagnoseOptions {
  /** Apply automatic workarounds */
  fix?: boolean;
  /** Show what would be done without doing it */
  dryRun?: boolean;
  /** Specific build target */
  target?: string;
  /** Maximum time to wait for build (ms) */
  timeout?: number;
  /** Skip running build, just analyze provided output */
  buildOutput?: string;
}

/**
 * Registry of known issues
 */
export interface IssueRegistry {
  /** Schema version for compatibility */
  version: string;
  /** Last updated timestamp */
  updatedAt: string;
  /** Known issues */
  issues: KnownIssue[];
}

/**
 * Load issues from registry
 */
export function loadIssueRegistry(data: unknown): IssueRegistry {
  // Basic validation
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid issue registry data');
  }

  const registry = data as IssueRegistry;

  if (!Array.isArray(registry.issues)) {
    throw new Error('Issue registry must have an issues array');
  }

  return {
    version: registry.version || '1.0.0',
    updatedAt: registry.updatedAt || new Date().toISOString(),
    issues: registry.issues
  };
}

/**
 * Match a known issue against build output
 */
export function matchIssue(issue: KnownIssue, buildOutput: string): DiagnosisResult | null {
  const lines = buildOutput.split('\n');

  for (const pattern of issue.errorPatterns) {
    const regex = new RegExp(pattern, 'i');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (regex.test(line)) {
        // Calculate confidence based on pattern specificity
        const confidence = calculateConfidence(pattern, line);

        return {
          issue,
          matchedError: line,
          lineNumber: i + 1,
          matchedPattern: pattern,
          confidence
        };
      }
    }
  }

  return null;
}

/**
 * Calculate confidence based on pattern specificity
 */
function calculateConfidence(pattern: string, matchedLine: string): number {
  // More specific patterns get higher confidence
  let confidence = 0.5;

  // Longer patterns are more specific
  if (pattern.length > 50) confidence += 0.2;
  else if (pattern.length > 30) confidence += 0.1;

  // Patterns with package names are more specific
  if (pattern.includes('@@') || pattern.includes('//')) confidence += 0.1;

  // Exact substring matches boost confidence
  if (matchedLine.includes(pattern.replace(/\\/g, ''))) confidence += 0.1;

  return Math.min(confidence, 1.0);
}

/**
 * Bazel Build System Parser
 *
 * Parses Bazel build files to extract dependencies from:
 * - MODULE.bazel (bzlmod - modern dependency management)
 * - WORKSPACE.bazel / WORKSPACE (legacy external dependencies)
 * - .bazelversion (Bazel version requirement)
 *
 * Handles both bzlmod (MODULE.bazel) and legacy WORKSPACE patterns.
 */

import * as path from 'path';
import {
  BuildDependency,
  DetectedBuildSystem
} from '@cv-git/shared';
import { BaseBuildSystemParser } from './base.js';

export class BazelParser extends BaseBuildSystemParser {
  readonly type = 'bazel' as const;
  readonly filePatterns = [
    'BUILD.bazel',
    'BUILD',
    '**/BUILD.bazel',
    '**/BUILD',
    'WORKSPACE.bazel',
    'WORKSPACE',
    'MODULE.bazel',
    '.bazelrc',
    '.bazelversion'
  ];

  async detect(rootDir: string, files: string[]): Promise<DetectedBuildSystem | null> {
    const buildFiles = this.matchesPattern(files);

    if (buildFiles.length === 0) {
      return null;
    }

    // Check for root-level Bazel files
    const hasModuleBazel = buildFiles.some(f => f === 'MODULE.bazel');
    const hasWorkspace = buildFiles.some(f =>
      f === 'WORKSPACE.bazel' || f === 'WORKSPACE'
    );
    const hasRootBuild = buildFiles.some(f =>
      f === 'BUILD.bazel' || f === 'BUILD'
    );

    // Need at least MODULE.bazel or WORKSPACE for high confidence
    if (!hasModuleBazel && !hasWorkspace) {
      return null;
    }

    // Try to detect Bazel version
    let version: string | undefined;
    const bazelVersionFile = buildFiles.find(f => f === '.bazelversion');
    if (bazelVersionFile) {
      const content = await this.readFile(path.join(rootDir, bazelVersionFile));
      version = content.trim().split('\n')[0];
    }

    // Determine primary file (prefer MODULE.bazel for modern projects)
    const primaryFile = hasModuleBazel ? 'MODULE.bazel' :
      (hasWorkspace ? (buildFiles.find(f => f === 'WORKSPACE.bazel') || 'WORKSPACE') : buildFiles[0]);

    return {
      type: 'bazel',
      primaryFile,
      buildFiles,
      confidence: hasModuleBazel ? 1.0 : (hasWorkspace ? 0.9 : 0.6),
      version
    };
  }

  async parseDependencies(rootDir: string, buildFiles: string[]): Promise<BuildDependency[]> {
    const dependencies: BuildDependency[] = [];
    const seen = new Set<string>();

    // Parse MODULE.bazel for bzlmod dependencies
    const moduleBazel = buildFiles.find(f => f === 'MODULE.bazel');
    if (moduleBazel) {
      const content = await this.readFile(path.join(rootDir, moduleBazel));
      const bzlmodDeps = this.parseBzlmodDependencies(content, moduleBazel);
      for (const dep of bzlmodDeps) {
        const key = `${dep.name}:${dep.source}`;
        if (!seen.has(key)) {
          seen.add(key);
          dependencies.push(dep);
        }
      }
    }

    // Parse WORKSPACE for legacy dependencies
    const workspaceFile = buildFiles.find(f =>
      f === 'WORKSPACE.bazel' || f === 'WORKSPACE'
    );
    if (workspaceFile) {
      const content = await this.readFile(path.join(rootDir, workspaceFile));
      const workspaceDeps = this.parseWorkspaceDependencies(content, workspaceFile);
      for (const dep of workspaceDeps) {
        const key = `${dep.name}:${dep.source}`;
        if (!seen.has(key)) {
          seen.add(key);
          dependencies.push(dep);
        }
      }
    }

    return dependencies;
  }

  /**
   * Parse MODULE.bazel for bzlmod dependencies
   * Examples:
   *   bazel_dep(name = "rules_go", version = "0.39.1")
   *   bazel_dep(name = "protobuf", version = "21.7", repo_name = "com_google_protobuf")
   */
  private parseBzlmodDependencies(content: string, sourceFile: string): BuildDependency[] {
    const deps: BuildDependency[] = [];

    // Match bazel_dep() calls
    const bazelDepPattern = /bazel_dep\s*\(\s*([^)]+)\)/g;

    let match;
    while ((match = bazelDepPattern.exec(content)) !== null) {
      const args = match[1];

      // Extract name
      const nameMatch = args.match(/name\s*=\s*["']([^"']+)["']/);
      if (!nameMatch) continue;
      const name = nameMatch[1];

      // Extract version
      const versionMatch = args.match(/version\s*=\s*["']([^"']+)["']/);
      const version = versionMatch ? versionMatch[1] : undefined;

      // Extract dev_dependency flag
      const devDep = /dev_dependency\s*=\s*True/i.test(args);

      // Find line number
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      deps.push({
        name,
        type: 'library',
        required: !devDep,
        versionConstraint: version ? `=${version}` : undefined,
        source: 'bazel_bzlmod',
        sourceFile,
        sourceLine: lineNumber
      });
    }

    return deps;
  }

  /**
   * Parse WORKSPACE for legacy external dependencies
   * Examples:
   *   http_archive(name = "rules_go", urls = [...], sha256 = "...")
   *   git_repository(name = "com_google_protobuf", remote = "...", tag = "v3.21.7")
   *   new_local_repository(name = "openssl", path = "/usr/local/ssl", ...)
   */
  private parseWorkspaceDependencies(content: string, sourceFile: string): BuildDependency[] {
    const deps: BuildDependency[] = [];

    // Map rule names to DependencySource types
    const ruleToSource: Record<string, BuildDependency['source']> = {
      'http_archive': 'bazel_http_archive',
      'http_file': 'bazel_http_file',
      'git_repository': 'bazel_git_repository',
      'new_git_repository': 'bazel_new_git_repository',
      'local_repository': 'bazel_local_repository',
      'new_local_repository': 'bazel_new_local_repository'
    };

    for (const [rule, source] of Object.entries(ruleToSource)) {
      const pattern = new RegExp(`${rule}\\s*\\(\\s*([^)]+)\\)`, 'g');

      let match;
      while ((match = pattern.exec(content)) !== null) {
        const args = match[1];

        // Extract name
        const nameMatch = args.match(/name\s*=\s*["']([^"']+)["']/);
        if (!nameMatch) continue;
        const name = nameMatch[1];

        // Skip internal/test repos
        if (this.isInternalRepo(name)) continue;

        // Try to extract version from various sources
        let version: string | undefined;

        // From tag (git_repository)
        const tagMatch = args.match(/tag\s*=\s*["']v?([^"']+)["']/);
        if (tagMatch) {
          version = tagMatch[1];
        }

        // From strip_prefix which often contains version
        if (!version) {
          const stripMatch = args.match(/strip_prefix\s*=\s*["'][^"']*-([0-9]+\.[0-9]+[^"']*)["']/);
          if (stripMatch) {
            version = stripMatch[1];
          }
        }

        // Find line number
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split('\n').length;

        deps.push({
          name,
          type: 'library',
          required: true,
          versionConstraint: version ? `=${version}` : undefined,
          source,
          sourceFile,
          sourceLine: lineNumber
        });
      }
    }

    return deps;
  }

  /**
   * Check if repository is internal/test
   */
  private isInternalRepo(name: string): boolean {
    const internalPrefixes = [
      'bazel_',
      'rules_',
      'platforms',
      'io_bazel',
      'local_config_'
    ];

    // These are meta-dependencies, not actual external deps
    const metaDeps = [
      'bazel_skylib',
      'rules_cc',
      'rules_java',
      'rules_proto',
      'rules_python',
      'rules_pkg'
    ];

    // Don't filter out rules_* as they are often important dependencies
    // Just filter truly internal ones
    return name.startsWith('local_config_') ||
           name.startsWith('io_bazel_') ||
           name === 'platforms';
  }
}

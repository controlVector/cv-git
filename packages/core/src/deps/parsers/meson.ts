/**
 * Meson Build System Parser
 *
 * Parses meson.build files to extract dependencies from:
 * - dependency()
 * - find_library()
 * - find_program()
 * - cc.find_library()
 */

import * as path from 'path';
import {
  BuildDependency,
  DetectedBuildSystem
} from '@cv-git/shared';
import { BaseBuildSystemParser } from './base.js';

export class MesonParser extends BaseBuildSystemParser {
  readonly type = 'meson' as const;
  readonly filePatterns = [
    'meson.build',
    '**/meson.build',
    'meson_options.txt',
    '**/meson_options.txt'
  ];

  async detect(rootDir: string, files: string[]): Promise<DetectedBuildSystem | null> {
    const buildFiles = this.matchesPattern(files);

    // Must have root meson.build for detection
    const hasRootFile = buildFiles.some(f => f === 'meson.build');

    if (!hasRootFile) {
      return null;
    }

    // Try to detect Meson version from root file
    let version: string | undefined;
    const rootFile = buildFiles.find(f => f === 'meson.build');
    if (rootFile) {
      const content = await this.readFile(path.join(rootDir, rootFile));
      const versionMatch = content.match(/meson_version\s*:\s*['\"]>=?\s*([0-9.]+)['\"]/)
        || content.match(/meson\.version\(\)\s*>=?\s*['\"]([0-9.]+)['\"]/);
      if (versionMatch) {
        version = versionMatch[1];
      }
    }

    return {
      type: 'meson',
      primaryFile: 'meson.build',
      buildFiles,
      confidence: 1.0,
      version
    };
  }

  async parseDependencies(rootDir: string, buildFiles: string[]): Promise<BuildDependency[]> {
    const dependencies: BuildDependency[] = [];
    const seen = new Set<string>();

    for (const file of buildFiles) {
      // Skip meson_options.txt for dependency parsing
      if (file.endsWith('meson_options.txt')) {
        continue;
      }

      const filePath = path.join(rootDir, file);
      const content = await this.readFile(filePath);

      // Parse dependency() calls
      const depDeps = this.parseDependencyFunction(content, file);
      for (const dep of depDeps) {
        const key = `${dep.name}:${dep.source}`;
        if (!seen.has(key)) {
          seen.add(key);
          dependencies.push(dep);
        }
      }

      // Parse find_library() calls
      const libDeps = this.parseFindLibrary(content, file);
      for (const dep of libDeps) {
        const key = `${dep.name}:${dep.source}`;
        if (!seen.has(key)) {
          seen.add(key);
          dependencies.push(dep);
        }
      }

      // Parse find_program() calls
      const progDeps = this.parseFindProgram(content, file);
      for (const dep of progDeps) {
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
   * Parse dependency() function calls
   * Examples:
   *   dependency('glib-2.0')
   *   dependency('openssl', required: true, version: '>=1.1')
   *   dependency('threads')
   */
  private parseDependencyFunction(content: string, sourceFile: string): BuildDependency[] {
    const deps: BuildDependency[] = [];

    // Match dependency() calls with optional named arguments
    const pattern = /dependency\s*\(\s*['\"]([^'\"]+)['\"](?:\s*,\s*([^)]+))?\)/gi;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      const args = match[2] || '';

      // Skip internal dependencies
      if (this.isInternalDependency(name)) {
        continue;
      }

      // Parse required argument (default is true in Meson)
      const requiredMatch = args.match(/required\s*:\s*(true|false)/i);
      const required = requiredMatch ? requiredMatch[1].toLowerCase() === 'true' : true;

      // Parse version constraint
      let versionConstraint: string | undefined;
      const versionMatch = args.match(/version\s*:\s*['\"]([^'\"]+)['\"]/);
      if (versionMatch) {
        versionConstraint = versionMatch[1];
      }

      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      deps.push({
        name,
        type: 'library',
        required,
        versionConstraint,
        source: 'meson_dependency',
        sourceFile,
        sourceLine: lineNumber,
        pkgConfigName: name
      });
    }

    return deps;
  }

  /**
   * Parse find_library() calls
   * Examples:
   *   cc.find_library('m')
   *   meson.get_compiler('c').find_library('dl', required: false)
   *   find_library('pthread')
   */
  private parseFindLibrary(content: string, sourceFile: string): BuildDependency[] {
    const deps: BuildDependency[] = [];

    // Match various find_library patterns
    const pattern = /(?:\w+\.)?find_library\s*\(\s*['\"]([^'\"]+)['\"](?:\s*,\s*([^)]+))?\)/gi;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      const args = match[2] || '';

      // Skip common system libs
      if (this.isSystemLib(name)) {
        continue;
      }

      const requiredMatch = args.match(/required\s*:\s*(true|false)/i);
      const required = requiredMatch ? requiredMatch[1].toLowerCase() === 'true' : true;

      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      deps.push({
        name,
        type: 'library',
        required,
        source: 'meson_find_library',
        sourceFile,
        sourceLine: lineNumber,
        libraries: [`lib${name}.so`, `lib${name}.a`]
      });
    }

    return deps;
  }

  /**
   * Parse find_program() calls
   * Examples:
   *   find_program('python3')
   *   find_program('pkg-config', required: false)
   */
  private parseFindProgram(content: string, sourceFile: string): BuildDependency[] {
    const deps: BuildDependency[] = [];

    const pattern = /find_program\s*\(\s*['\"]([^'\"]+)['\"](?:\s*,\s*([^)]+))?\)/gi;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      const args = match[2] || '';

      const requiredMatch = args.match(/required\s*:\s*(true|false)/i);
      const required = requiredMatch ? requiredMatch[1].toLowerCase() === 'true' : true;

      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      deps.push({
        name,
        type: 'tool',
        required,
        source: 'meson_find_program',
        sourceFile,
        sourceLine: lineNumber
      });
    }

    return deps;
  }

  /**
   * Check if dependency is Meson internal
   */
  private isInternalDependency(name: string): boolean {
    const internal = ['threads', 'openmp', 'mpi', 'cuda'];
    return internal.includes(name.toLowerCase());
  }

  /**
   * Check if library is a common system library
   */
  private isSystemLib(name: string): boolean {
    const systemLibs = ['m', 'c', 'pthread', 'dl', 'rt', 'resolv'];
    return systemLibs.includes(name);
  }
}

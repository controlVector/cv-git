/**
 * CMake Build System Parser
 *
 * Parses CMakeLists.txt files to extract dependencies from:
 * - find_package()
 * - pkg_check_modules()
 * - find_library()
 * - find_path()
 */

import * as path from 'path';
import {
  BuildDependency,
  DetectedBuildSystem
} from '@cv-git/shared';
import { BaseBuildSystemParser } from './base.js';

export class CMakeParser extends BaseBuildSystemParser {
  readonly type = 'cmake' as const;
  readonly filePatterns = [
    'CMakeLists.txt',
    '**/CMakeLists.txt',
    '*.cmake',
    'cmake/*.cmake'
  ];

  async detect(rootDir: string, files: string[]): Promise<DetectedBuildSystem | null> {
    const buildFiles = this.matchesPattern(files);

    // Must have root CMakeLists.txt for high confidence
    const hasRootCMake = buildFiles.some(f =>
      f === 'CMakeLists.txt' || f.endsWith('/CMakeLists.txt')
    );

    if (buildFiles.length === 0) {
      return null;
    }

    // Try to detect CMake version from root file
    let version: string | undefined;
    const rootFile = buildFiles.find(f => f === 'CMakeLists.txt');
    if (rootFile) {
      const content = await this.readFile(path.join(rootDir, rootFile));
      const versionMatch = content.match(/cmake_minimum_required\s*\(\s*VERSION\s+([0-9.]+)/i);
      if (versionMatch) {
        version = versionMatch[1];
      }
    }

    return {
      type: 'cmake',
      primaryFile: rootFile || buildFiles[0],
      buildFiles,
      confidence: hasRootCMake ? 1.0 : 0.7,
      version
    };
  }

  async parseDependencies(rootDir: string, buildFiles: string[]): Promise<BuildDependency[]> {
    const dependencies: BuildDependency[] = [];
    const seen = new Set<string>();

    for (const file of buildFiles) {
      const filePath = path.join(rootDir, file);
      const content = await this.readFile(filePath);

      // Parse find_package() calls
      const findPackageDeps = this.parseFindPackage(content, file);
      for (const dep of findPackageDeps) {
        const key = `${dep.name}:${dep.source}`;
        if (!seen.has(key)) {
          seen.add(key);
          dependencies.push(dep);
        }
      }

      // Parse pkg_check_modules() calls
      const pkgConfigDeps = this.parsePkgCheckModules(content, file);
      for (const dep of pkgConfigDeps) {
        const key = `${dep.name}:${dep.source}`;
        if (!seen.has(key)) {
          seen.add(key);
          dependencies.push(dep);
        }
      }

      // Parse find_library() calls
      const libraryDeps = this.parseFindLibrary(content, file);
      for (const dep of libraryDeps) {
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
   * Parse find_package() calls
   * Examples:
   *   find_package(OpenSSL REQUIRED)
   *   find_package(Boost 1.70 COMPONENTS system filesystem)
   *   find_package(CURL QUIET)
   */
  private parseFindPackage(content: string, sourceFile: string): BuildDependency[] {
    const deps: BuildDependency[] = [];
    const lines = content.split('\n');

    // Regex to match find_package with various argument styles
    const pattern = /find_package\s*\(\s*(\w+)([^)]*)\)/gi;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      const args = match[2] || '';

      // Skip CMake internal packages
      if (this.isInternalPackage(name)) {
        continue;
      }

      // Determine if required
      const required = /\bREQUIRED\b/i.test(args);

      // Extract version constraint
      let versionConstraint: string | undefined;
      const versionMatch = args.match(/\b(\d+(?:\.\d+)*(?:\.\d+)?)\b/);
      if (versionMatch) {
        versionConstraint = `>=${versionMatch[1]}`;
      }

      // Find line number
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      deps.push({
        name,
        type: 'library',
        required,
        versionConstraint,
        source: 'cmake_find_package',
        sourceFile,
        sourceLine: lineNumber,
        cmakeName: name
      });
    }

    return deps;
  }

  /**
   * Parse pkg_check_modules() calls
   * Examples:
   *   pkg_check_modules(CURL REQUIRED libcurl)
   *   pkg_check_modules(DEPS REQUIRED glib-2.0>=2.50 gio-2.0)
   */
  private parsePkgCheckModules(content: string, sourceFile: string): BuildDependency[] {
    const deps: BuildDependency[] = [];

    // Match pkg_check_modules and pkg_search_module
    const pattern = /pkg_(?:check|search)_modules?\s*\(\s*(\w+)\s+([^)]+)\)/gi;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const prefix = match[1];
      const args = match[2];

      // Check if required
      const required = /\bREQUIRED\b/i.test(args);

      // Extract module names (skip REQUIRED, QUIET, etc.)
      const modules = args
        .replace(/\b(REQUIRED|QUIET|NO_CMAKE_PATH|NO_CMAKE_ENVIRONMENT_PATH|IMPORTED_TARGET)\b/gi, '')
        .trim()
        .split(/\s+/)
        .filter(m => m && !m.startsWith('-'));

      for (const module of modules) {
        // Parse version from module name (e.g., glib-2.0>=2.50)
        const moduleMatch = module.match(/^([a-zA-Z0-9._-]+)(?:([<>=]+)([0-9.]+))?$/);
        if (moduleMatch) {
          const [, name, op, version] = moduleMatch;

          const beforeMatch = content.substring(0, match.index);
          const lineNumber = beforeMatch.split('\n').length;

          deps.push({
            name,
            type: 'library',
            required,
            versionConstraint: op && version ? `${op}${version}` : undefined,
            source: 'cmake_pkg_config',
            sourceFile,
            sourceLine: lineNumber,
            pkgConfigName: name
          });
        }
      }
    }

    return deps;
  }

  /**
   * Parse find_library() calls
   * Examples:
   *   find_library(CURL_LIB curl)
   *   find_library(SSL_LIB NAMES ssl crypto)
   */
  private parseFindLibrary(content: string, sourceFile: string): BuildDependency[] {
    const deps: BuildDependency[] = [];

    const pattern = /find_library\s*\(\s*(\w+)\s+([^)]+)\)/gi;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const varName = match[1];
      const args = match[2];

      // Extract library names
      const namesMatch = args.match(/\bNAMES\s+([^)]+?)(?:\s+(?:PATHS|HINTS|PATH_SUFFIXES|DOC|REQUIRED|QUIET)|\s*$)/i);
      let names: string[];

      if (namesMatch) {
        names = namesMatch[1].trim().split(/\s+/).filter(n => n);
      } else {
        // First argument after variable name is the library name
        const firstArg = args.trim().split(/\s+/)[0];
        if (firstArg && !/^(NAMES|PATHS|HINTS|DOC|REQUIRED|QUIET)$/i.test(firstArg)) {
          names = [firstArg];
        } else {
          continue;
        }
      }

      const required = /\bREQUIRED\b/i.test(args);

      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      // Use first name as primary
      deps.push({
        name: names[0],
        type: 'library',
        required,
        source: 'cmake_find_package',
        sourceFile,
        sourceLine: lineNumber,
        libraries: names.map(n => `lib${n}.so`)
      });
    }

    return deps;
  }

  /**
   * Check if package is CMake internal
   */
  private isInternalPackage(name: string): boolean {
    const internalPackages = [
      'Threads', 'OpenMP', 'MPI', 'CUDA', 'CUDAToolkit',
      'Python', 'Python2', 'Python3', 'PythonInterp', 'PythonLibs',
      'Git', 'Doxygen', 'GTest', 'Catch2'
    ];
    return internalPackages.includes(name);
  }
}

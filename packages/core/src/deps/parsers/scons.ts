/**
 * SCons Build System Parser
 *
 * Parses SConstruct and SConscript files to extract dependencies from:
 * - Configure checks (CheckLib, CheckHeader, etc.)
 * - env.Library/env.Program dependencies
 * - LIBS environment variable
 */

import * as path from 'path';
import {
  BuildDependency,
  DetectedBuildSystem
} from '@cv-git/shared';
import { BaseBuildSystemParser } from './base.js';

export class SConsParser extends BaseBuildSystemParser {
  readonly type = 'scons' as const;
  readonly filePatterns = [
    'SConstruct',
    'SConscript',
    '**/SConscript',
    'site_scons/**/*.py'
  ];

  async detect(rootDir: string, files: string[]): Promise<DetectedBuildSystem | null> {
    const buildFiles = this.matchesPattern(files);

    // Must have SConstruct for detection
    const hasRootFile = buildFiles.some(f => f === 'SConstruct');

    if (!hasRootFile) {
      return null;
    }

    return {
      type: 'scons',
      primaryFile: 'SConstruct',
      buildFiles,
      confidence: 1.0
    };
  }

  async parseDependencies(rootDir: string, buildFiles: string[]): Promise<BuildDependency[]> {
    const dependencies: BuildDependency[] = [];
    const seen = new Set<string>();

    for (const file of buildFiles) {
      const filePath = path.join(rootDir, file);
      const content = await this.readFile(filePath);

      // Parse Configure checks
      const configureDeps = this.parseConfigureChecks(content, file);
      for (const dep of configureDeps) {
        const key = `${dep.name}:${dep.source}`;
        if (!seen.has(key)) {
          seen.add(key);
          dependencies.push(dep);
        }
      }

      // Parse LIBS assignments
      const libsDeps = this.parseLibsAssignments(content, file);
      for (const dep of libsDeps) {
        const key = `${dep.name}:${dep.source}`;
        if (!seen.has(key)) {
          seen.add(key);
          dependencies.push(dep);
        }
      }

      // Parse pkg-config usage
      const pkgConfigDeps = this.parsePkgConfig(content, file);
      for (const dep of pkgConfigDeps) {
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
   * Parse SCons Configure checks
   * Examples:
   *   conf.CheckLib('ssl')
   *   conf.CheckLibWithHeader('curl', 'curl/curl.h', 'c')
   *   conf.CheckHeader('openssl/ssl.h')
   *   conf.CheckCHeader('zlib.h')
   *   conf.CheckProg('python3')
   */
  private parseConfigureChecks(content: string, sourceFile: string): BuildDependency[] {
    const deps: BuildDependency[] = [];

    // CheckLib patterns
    const checkLibPattern = /\.CheckLib(?:WithHeader)?\s*\(\s*['"]([^'"]+)['"]/gi;
    let match;

    while ((match = checkLibPattern.exec(content)) !== null) {
      const name = match[1];
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      deps.push({
        name,
        type: 'library',
        required: true,
        source: 'scons_configure',
        sourceFile,
        sourceLine: lineNumber,
        libraries: [`lib${name}.so`, `lib${name}.a`]
      });
    }

    // CheckHeader patterns
    const checkHeaderPattern = /\.Check(?:C|CXX)?Header\s*\(\s*['"]([^'"]+)['"]/gi;

    while ((match = checkHeaderPattern.exec(content)) !== null) {
      const header = match[1];
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      // Derive library name from header (e.g., openssl/ssl.h -> openssl)
      const libName = header.split('/')[0].replace('.h', '');

      deps.push({
        name: libName,
        type: 'header',
        required: true,
        source: 'scons_configure',
        sourceFile,
        sourceLine: lineNumber,
        headers: [header]
      });
    }

    // CheckProg patterns
    const checkProgPattern = /\.CheckProg\s*\(\s*['"]([^'"]+)['"]/gi;

    while ((match = checkProgPattern.exec(content)) !== null) {
      const name = match[1];
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      deps.push({
        name,
        type: 'tool',
        required: true,
        source: 'scons_configure',
        sourceFile,
        sourceLine: lineNumber
      });
    }

    return deps;
  }

  /**
   * Parse LIBS assignments and AppendUnique
   * Examples:
   *   env['LIBS'] = ['ssl', 'crypto']
   *   env.AppendUnique(LIBS=['pthread'])
   *   LIBS=['z', 'lzma']
   */
  private parseLibsAssignments(content: string, sourceFile: string): BuildDependency[] {
    const deps: BuildDependency[] = [];

    // Match LIBS assignments with list
    const libsPattern = /(?:env\[['"]?LIBS['"]?\]\s*=|\.(?:Append|AppendUnique|Prepend)\s*\(\s*LIBS\s*=|LIBS\s*=)\s*\[([^\]]+)\]/gi;

    let match;
    while ((match = libsPattern.exec(content)) !== null) {
      const libsList = match[1];
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      // Extract library names from the list
      const libMatches = libsList.matchAll(/['"]([^'"]+)['"]/g);
      for (const libMatch of libMatches) {
        const name = libMatch[1];

        // Skip common system libs that are usually present
        if (this.isSystemLib(name)) {
          continue;
        }

        deps.push({
          name,
          type: 'library',
          required: true,
          source: 'linker_flag',
          sourceFile,
          sourceLine: lineNumber,
          libraries: [`lib${name}.so`, `lib${name}.a`]
        });
      }
    }

    return deps;
  }

  /**
   * Parse pkg-config usage in SCons
   * Examples:
   *   env.ParseConfig('pkg-config --cflags --libs libcurl')
   *   ParseConfig('pkg-config openssl')
   */
  private parsePkgConfig(content: string, sourceFile: string): BuildDependency[] {
    const deps: BuildDependency[] = [];

    const pkgConfigPattern = /\.?ParseConfig\s*\(\s*['"]pkg-config\s+(?:--\w+\s+)*([a-zA-Z0-9._-]+)/gi;

    let match;
    while ((match = pkgConfigPattern.exec(content)) !== null) {
      const name = match[1];
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      deps.push({
        name,
        type: 'library',
        required: true,
        source: 'pkg_config',
        sourceFile,
        sourceLine: lineNumber,
        pkgConfigName: name
      });
    }

    return deps;
  }

  /**
   * Check if library is a common system library
   */
  private isSystemLib(name: string): boolean {
    const systemLibs = [
      'm', 'c', 'pthread', 'dl', 'rt', 'resolv', 'nsl', 'socket'
    ];
    return systemLibs.includes(name);
  }
}

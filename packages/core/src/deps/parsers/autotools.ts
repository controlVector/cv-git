/**
 * Autotools Build System Parser
 *
 * Parses configure.ac/configure.in and Makefile.am files to extract dependencies from:
 * - AC_CHECK_LIB
 * - AC_CHECK_HEADER
 * - PKG_CHECK_MODULES
 * - AM_PATH_* macros
 */

import * as path from 'path';
import {
  BuildDependency,
  DetectedBuildSystem
} from '@cv-git/shared';
import { BaseBuildSystemParser } from './base.js';

export class AutotoolsParser extends BaseBuildSystemParser {
  readonly type = 'autotools' as const;
  readonly filePatterns = [
    'configure.ac',
    'configure.in',
    'Makefile.am',
    '**/Makefile.am',
    'aclocal.m4',
    'm4/*.m4'
  ];

  async detect(rootDir: string, files: string[]): Promise<DetectedBuildSystem | null> {
    const buildFiles = this.matchesPattern(files);

    // Must have configure.ac or configure.in
    const hasConfigureFile = buildFiles.some(f =>
      f === 'configure.ac' || f === 'configure.in'
    );

    if (!hasConfigureFile) {
      return null;
    }

    // Determine primary file
    const primaryFile = buildFiles.find(f => f === 'configure.ac')
      || buildFiles.find(f => f === 'configure.in')
      || buildFiles[0];

    return {
      type: 'autotools',
      primaryFile,
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

      // Parse AC_CHECK_LIB
      const libDeps = this.parseCheckLib(content, file);
      for (const dep of libDeps) {
        const key = `${dep.name}:${dep.source}`;
        if (!seen.has(key)) {
          seen.add(key);
          dependencies.push(dep);
        }
      }

      // Parse AC_CHECK_HEADER
      const headerDeps = this.parseCheckHeader(content, file);
      for (const dep of headerDeps) {
        const key = `${dep.name}:${dep.source}`;
        if (!seen.has(key)) {
          seen.add(key);
          dependencies.push(dep);
        }
      }

      // Parse PKG_CHECK_MODULES
      const pkgDeps = this.parsePkgCheckModules(content, file);
      for (const dep of pkgDeps) {
        const key = `${dep.name}:${dep.source}`;
        if (!seen.has(key)) {
          seen.add(key);
          dependencies.push(dep);
        }
      }

      // Parse AC_CHECK_PROG
      const progDeps = this.parseCheckProg(content, file);
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
   * Parse AC_CHECK_LIB and AC_SEARCH_LIBS
   * Examples:
   *   AC_CHECK_LIB([ssl], [SSL_new])
   *   AC_CHECK_LIB(crypto, CRYPTO_new_ex_data)
   *   AC_SEARCH_LIBS([pthread_create], [pthread])
   */
  private parseCheckLib(content: string, sourceFile: string): BuildDependency[] {
    const deps: BuildDependency[] = [];

    // AC_CHECK_LIB pattern
    const checkLibPattern = /AC_CHECK_LIB\s*\(\s*\[?([^\],\[]+)\]?\s*,/gi;

    let match;
    while ((match = checkLibPattern.exec(content)) !== null) {
      const name = match[1].trim();

      if (this.isSystemLib(name)) {
        continue;
      }

      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      deps.push({
        name,
        type: 'library',
        required: true,
        source: 'autoconf_check',
        sourceFile,
        sourceLine: lineNumber,
        libraries: [`lib${name}.so`, `lib${name}.a`]
      });
    }

    // AC_SEARCH_LIBS pattern
    const searchLibsPattern = /AC_SEARCH_LIBS\s*\(\s*\[?[^\],\[]+\]?\s*,\s*\[?([^\],\[]+)\]?/gi;

    while ((match = searchLibsPattern.exec(content)) !== null) {
      const libList = match[1].trim();
      // Libraries can be space-separated
      const libs = libList.split(/\s+/).filter(l => l);

      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      for (const name of libs) {
        if (this.isSystemLib(name)) {
          continue;
        }

        deps.push({
          name,
          type: 'library',
          required: true,
          source: 'autoconf_check',
          sourceFile,
          sourceLine: lineNumber,
          libraries: [`lib${name}.so`, `lib${name}.a`]
        });
      }
    }

    return deps;
  }

  /**
   * Parse AC_CHECK_HEADER and AC_CHECK_HEADERS
   * Examples:
   *   AC_CHECK_HEADER([openssl/ssl.h])
   *   AC_CHECK_HEADERS([zlib.h bzlib.h])
   */
  private parseCheckHeader(content: string, sourceFile: string): BuildDependency[] {
    const deps: BuildDependency[] = [];

    // AC_CHECK_HEADER pattern (single header)
    const checkHeaderPattern = /AC_CHECK_HEADER\s*\(\s*\[?([^\],\[]+)\]?/gi;

    let match;
    while ((match = checkHeaderPattern.exec(content)) !== null) {
      const header = match[1].trim();
      const libName = this.deriveLibFromHeader(header);

      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      deps.push({
        name: libName,
        type: 'header',
        required: true,
        source: 'autoconf_check',
        sourceFile,
        sourceLine: lineNumber,
        headers: [header]
      });
    }

    // AC_CHECK_HEADERS pattern (multiple headers)
    const checkHeadersPattern = /AC_CHECK_HEADERS\s*\(\s*\[?([^\]]+)\]?/gi;

    while ((match = checkHeadersPattern.exec(content)) !== null) {
      const headerList = match[1].trim();
      const headers = headerList.split(/\s+/).filter(h => h && !h.startsWith('['));

      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      for (const header of headers) {
        const libName = this.deriveLibFromHeader(header);

        deps.push({
          name: libName,
          type: 'header',
          required: true,
          source: 'autoconf_check',
          sourceFile,
          sourceLine: lineNumber,
          headers: [header]
        });
      }
    }

    return deps;
  }

  /**
   * Parse PKG_CHECK_MODULES
   * Examples:
   *   PKG_CHECK_MODULES([GLIB], [glib-2.0 >= 2.50])
   *   PKG_CHECK_MODULES(CURL, libcurl)
   */
  private parsePkgCheckModules(content: string, sourceFile: string): BuildDependency[] {
    const deps: BuildDependency[] = [];

    const pattern = /PKG_CHECK_MODULES\s*\(\s*\[?(\w+)\]?\s*,\s*\[?([^\],\)]+)\]?/gi;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const prefix = match[1];
      const moduleSpec = match[2].trim();

      // Parse module specifications (can have version constraints)
      const modules = this.parseModuleSpec(moduleSpec);

      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      for (const mod of modules) {
        deps.push({
          name: mod.name,
          type: 'library',
          required: true,
          versionConstraint: mod.version,
          source: 'pkg_config',
          sourceFile,
          sourceLine: lineNumber,
          pkgConfigName: mod.name
        });
      }
    }

    return deps;
  }

  /**
   * Parse AC_CHECK_PROG and AC_PATH_PROG
   * Examples:
   *   AC_CHECK_PROG([PYTHON], [python3], [python3])
   *   AC_PATH_PROG([PKG_CONFIG], [pkg-config])
   */
  private parseCheckProg(content: string, sourceFile: string): BuildDependency[] {
    const deps: BuildDependency[] = [];

    const pattern = /AC_(?:CHECK|PATH)_PROG\s*\(\s*\[?(\w+)\]?\s*,\s*\[?([^\],\[]+)\]?/gi;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[2].trim();

      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      deps.push({
        name,
        type: 'tool',
        required: true,
        source: 'autoconf_check',
        sourceFile,
        sourceLine: lineNumber
      });
    }

    return deps;
  }

  /**
   * Parse module specification with optional version
   * e.g., "glib-2.0 >= 2.50" or "libcurl >= 7.58.0 gio-2.0"
   */
  private parseModuleSpec(spec: string): Array<{ name: string; version?: string }> {
    const modules: Array<{ name: string; version?: string }> = [];

    // Split by spaces but handle version constraints
    const parts = spec.split(/\s+/);
    let i = 0;

    while (i < parts.length) {
      const part = parts[i];

      // Skip empty parts
      if (!part) {
        i++;
        continue;
      }

      // Check if this looks like a module name (not an operator or version)
      if (!/^[<>=]+$/.test(part) && !/^\d/.test(part)) {
        const mod: { name: string; version?: string } = { name: part };

        // Check for version constraint following
        if (i + 2 < parts.length) {
          const op = parts[i + 1];
          const ver = parts[i + 2];
          if (/^[<>=]+$/.test(op) && /^\d/.test(ver)) {
            mod.version = `${op}${ver}`;
            i += 2;
          }
        }

        modules.push(mod);
      }

      i++;
    }

    return modules;
  }

  /**
   * Derive library name from header path
   */
  private deriveLibFromHeader(header: string): string {
    // openssl/ssl.h -> openssl
    // zlib.h -> zlib
    const parts = header.split('/');
    if (parts.length > 1) {
      return parts[0];
    }
    return header.replace(/\.h$/, '');
  }

  /**
   * Check if library is a common system library
   */
  private isSystemLib(name: string): boolean {
    const systemLibs = ['m', 'c', 'pthread', 'dl', 'rt', 'resolv', 'nsl', 'socket'];
    return systemLibs.includes(name);
  }
}

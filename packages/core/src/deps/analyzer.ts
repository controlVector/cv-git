/**
 * Dependency Analyzer
 *
 * Coordinates build system detection and dependency extraction
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import {
  BuildDependency,
  DetectedBuildSystem,
  DependencyAnalysis,
  SystemPackageInfo
} from '@cv-git/shared';
import { getAllParsers, IBuildSystemParser } from './parsers/index.js';

export interface AnalyzerOptions {
  /** Root directory to analyze */
  rootDir: string;
  /** Maximum depth to scan for build files */
  maxDepth?: number;
  /** Include optional dependencies */
  includeOptional?: boolean;
}

export class DependencyAnalyzer {
  private parsers: IBuildSystemParser[];

  constructor() {
    this.parsers = getAllParsers();
  }

  /**
   * Analyze a project directory for dependencies
   */
  async analyze(options: AnalyzerOptions): Promise<DependencyAnalysis> {
    const { rootDir, maxDepth = 5, includeOptional = true } = options;

    // Collect all files up to maxDepth
    const files = await this.collectFiles(rootDir, maxDepth);

    // Detect build systems
    const buildSystems: DetectedBuildSystem[] = [];
    for (const parser of this.parsers) {
      const detected = await parser.detect(rootDir, files);
      if (detected) {
        buildSystems.push(detected);
      }
    }

    // Sort by confidence
    buildSystems.sort((a, b) => b.confidence - a.confidence);

    // Parse dependencies from all detected build systems
    const allDependencies: BuildDependency[] = [];
    const seen = new Set<string>();

    for (const buildSystem of buildSystems) {
      const parser = this.parsers.find(p => p.type === buildSystem.type);
      if (parser) {
        const deps = await parser.parseDependencies(rootDir, buildSystem.buildFiles);
        for (const dep of deps) {
          // Filter optional if requested
          if (!includeOptional && !dep.required) {
            continue;
          }

          // Deduplicate by name
          if (!seen.has(dep.name)) {
            seen.add(dep.name);
            allDependencies.push(dep);
          }
        }
      }
    }

    // Categorize dependencies
    const requiredDeps = allDependencies.filter(d => d.required);
    const optionalDeps = allDependencies.filter(d => !d.required);

    return {
      buildSystems,
      dependencies: allDependencies,
      requiredDependencies: requiredDeps,
      optionalDependencies: optionalDeps,
      analyzedAt: new Date().toISOString()
    };
  }

  /**
   * Check which dependencies are available on the system
   */
  async checkAvailability(dependencies: BuildDependency[]): Promise<Map<string, SystemPackageInfo>> {
    const results = new Map<string, SystemPackageInfo>();

    for (const dep of dependencies) {
      const info = await this.checkDependency(dep);
      results.set(dep.name, info);
    }

    return results;
  }

  /**
   * Check a single dependency's availability
   */
  private async checkDependency(dep: BuildDependency): Promise<SystemPackageInfo> {
    const info: SystemPackageInfo = {
      name: dep.name,
      available: false,
      source: 'unknown'
    };

    // Check pkg-config first if available
    if (dep.pkgConfigName) {
      const pkgResult = await this.checkPkgConfig(dep.pkgConfigName);
      if (pkgResult.available) {
        return pkgResult;
      }
    }

    // Check for library files
    if (dep.libraries && dep.libraries.length > 0) {
      const libResult = await this.checkLibraryFiles(dep.libraries);
      if (libResult.available) {
        return { ...info, ...libResult };
      }
    }

    // Check for header files
    if (dep.headers && dep.headers.length > 0) {
      const headerResult = await this.checkHeaderFiles(dep.headers);
      if (headerResult.available) {
        return { ...info, ...headerResult };
      }
    }

    // Check for tools
    if (dep.type === 'tool') {
      const toolResult = await this.checkTool(dep.name);
      if (toolResult.available) {
        return { ...info, ...toolResult };
      }
    }

    return info;
  }

  /**
   * Check pkg-config for a module
   */
  private async checkPkgConfig(moduleName: string): Promise<SystemPackageInfo> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const { stdout } = await execAsync(`pkg-config --modversion ${moduleName} 2>/dev/null`);
      const version = stdout.trim();

      // Try to get library flags
      let libFlags: string[] = [];
      try {
        const { stdout: libsOut } = await execAsync(`pkg-config --libs ${moduleName} 2>/dev/null`);
        libFlags = libsOut.trim().split(/\s+/).filter(f => f.startsWith('-l'));
      } catch {
        // Ignore
      }

      return {
        name: moduleName,
        available: true,
        version,
        source: 'pkg_config',
        pkgConfigName: moduleName
      };
    } catch {
      return {
        name: moduleName,
        available: false,
        source: 'pkg_config'
      };
    }
  }

  /**
   * Check if library files exist in common paths
   */
  private async checkLibraryFiles(libraries: string[]): Promise<Partial<SystemPackageInfo>> {
    const searchPaths = [
      '/usr/lib',
      '/usr/lib64',
      '/usr/local/lib',
      '/usr/local/lib64',
      '/lib',
      '/lib64',
      '/usr/lib/x86_64-linux-gnu',
      '/usr/lib/aarch64-linux-gnu'
    ];

    for (const lib of libraries) {
      for (const searchPath of searchPaths) {
        const libPath = path.join(searchPath, lib);
        try {
          await fs.access(libPath);
          return {
            available: true,
            source: 'library_file',
            installPath: searchPath
          };
        } catch {
          // Not found, continue
        }
      }
    }

    return { available: false };
  }

  /**
   * Check if header files exist in common paths
   */
  private async checkHeaderFiles(headers: string[]): Promise<Partial<SystemPackageInfo>> {
    const searchPaths = [
      '/usr/include',
      '/usr/local/include',
      '/usr/include/x86_64-linux-gnu'
    ];

    for (const header of headers) {
      for (const searchPath of searchPaths) {
        const headerPath = path.join(searchPath, header);
        try {
          await fs.access(headerPath);
          return {
            available: true,
            source: 'header_file',
            installPath: searchPath
          };
        } catch {
          // Not found, continue
        }
      }
    }

    return { available: false };
  }

  /**
   * Check if a tool is available in PATH
   */
  private async checkTool(toolName: string): Promise<Partial<SystemPackageInfo>> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const { stdout } = await execAsync(`which ${toolName} 2>/dev/null`);
      const toolPath = stdout.trim();

      // Try to get version
      let version: string | undefined;
      try {
        const { stdout: verOut } = await execAsync(`${toolName} --version 2>/dev/null | head -1`);
        const verMatch = verOut.match(/(\d+\.\d+(?:\.\d+)?)/);
        if (verMatch) {
          version = verMatch[1];
        }
      } catch {
        // Ignore version check failure
      }

      return {
        available: true,
        version,
        source: 'path',
        installPath: path.dirname(toolPath)
      };
    } catch {
      return { available: false };
    }
  }

  /**
   * Collect files recursively up to maxDepth
   */
  private async collectFiles(rootDir: string, maxDepth: number): Promise<string[]> {
    const files: string[] = [];

    const scan = async (dir: string, depth: number, prefix: string) => {
      if (depth > maxDepth) return;

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          // Skip hidden directories and common non-source directories
          if (entry.name.startsWith('.') ||
              entry.name === 'node_modules' ||
              entry.name === '__pycache__' ||
              entry.name === 'build' ||
              entry.name === 'dist' ||
              entry.name === 'target') {
            continue;
          }

          const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            await scan(path.join(dir, entry.name), depth + 1, relativePath);
          } else {
            files.push(relativePath);
          }
        }
      } catch {
        // Ignore permission errors
      }
    };

    await scan(rootDir, 0, '');
    return files;
  }

  /**
   * Generate installation commands for missing dependencies
   */
  generateInstallCommands(
    missing: BuildDependency[],
    packageManager: 'apt' | 'yum' | 'dnf' | 'pacman' | 'brew' = 'apt'
  ): string[] {
    const commands: string[] = [];
    const packages: string[] = [];

    for (const dep of missing) {
      const pkgName = this.mapToPackageName(dep, packageManager);
      if (pkgName && !packages.includes(pkgName)) {
        packages.push(pkgName);
      }
    }

    if (packages.length === 0) {
      return [];
    }

    switch (packageManager) {
      case 'apt':
        commands.push(`sudo apt-get update`);
        commands.push(`sudo apt-get install -y ${packages.join(' ')}`);
        break;
      case 'yum':
        commands.push(`sudo yum install -y ${packages.join(' ')}`);
        break;
      case 'dnf':
        commands.push(`sudo dnf install -y ${packages.join(' ')}`);
        break;
      case 'pacman':
        commands.push(`sudo pacman -S --noconfirm ${packages.join(' ')}`);
        break;
      case 'brew':
        commands.push(`brew install ${packages.join(' ')}`);
        break;
    }

    return commands;
  }

  /**
   * Map dependency to system package name
   */
  private mapToPackageName(dep: BuildDependency, packageManager: string): string | null {
    // Common mappings for apt
    const aptMappings: Record<string, string> = {
      'openssl': 'libssl-dev',
      'ssl': 'libssl-dev',
      'crypto': 'libssl-dev',
      'curl': 'libcurl4-openssl-dev',
      'libcurl': 'libcurl4-openssl-dev',
      'zlib': 'zlib1g-dev',
      'z': 'zlib1g-dev',
      'bz2': 'libbz2-dev',
      'lzma': 'liblzma-dev',
      'sqlite3': 'libsqlite3-dev',
      'pcre': 'libpcre3-dev',
      'pcre2': 'libpcre2-dev',
      'xml2': 'libxml2-dev',
      'yaml': 'libyaml-dev',
      'jpeg': 'libjpeg-dev',
      'png': 'libpng-dev',
      'freetype': 'libfreetype-dev',
      'glib-2.0': 'libglib2.0-dev',
      'gio-2.0': 'libglib2.0-dev',
      'boost': 'libboost-all-dev'
    };

    if (packageManager === 'apt') {
      // Check direct mapping
      if (aptMappings[dep.name]) {
        return aptMappings[dep.name];
      }

      // Try common patterns
      if (dep.type === 'library') {
        return `lib${dep.name}-dev`;
      } else if (dep.type === 'tool') {
        return dep.name;
      }
    }

    // For other package managers, use the dep name as-is for now
    return dep.name;
  }
}

/**
 * Base Build System Parser
 *
 * Defines the interface for all build system parsers
 */

import {
  BuildSystem,
  BuildDependency,
  DetectedBuildSystem
} from '@cv-git/shared';

/**
 * Interface for build system parsers
 */
export interface IBuildSystemParser {
  /** Build system type this parser handles */
  readonly type: BuildSystem;

  /** File patterns to detect this build system */
  readonly filePatterns: string[];

  /**
   * Check if this build system is present in the given directory
   */
  detect(rootDir: string, files: string[]): Promise<DetectedBuildSystem | null>;

  /**
   * Parse build files and extract dependencies
   */
  parseDependencies(rootDir: string, buildFiles: string[]): Promise<BuildDependency[]>;
}

/**
 * Base class for build system parsers with common functionality
 */
export abstract class BaseBuildSystemParser implements IBuildSystemParser {
  abstract readonly type: BuildSystem;
  abstract readonly filePatterns: string[];

  /**
   * Check if any of the file patterns match
   */
  protected matchesPattern(files: string[]): string[] {
    const matches: string[] = [];
    for (const file of files) {
      for (const pattern of this.filePatterns) {
        if (this.matchGlob(file, pattern)) {
          matches.push(file);
          break;
        }
      }
    }
    return matches;
  }

  /**
   * Simple glob matching (supports * and **)
   */
  protected matchGlob(file: string, pattern: string): boolean {
    // Convert glob to regex
    const regexStr = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{DOUBLESTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\{\{DOUBLESTAR\}\}/g, '.*');
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(file);
  }

  /**
   * Read file content safely
   */
  protected async readFile(filePath: string): Promise<string> {
    const fs = await import('fs/promises');
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  abstract detect(rootDir: string, files: string[]): Promise<DetectedBuildSystem | null>;
  abstract parseDependencies(rootDir: string, buildFiles: string[]): Promise<BuildDependency[]>;
}

/**
 * Dependency Analysis Module
 *
 * Provides build system detection and dependency extraction
 */

export { DependencyAnalyzer, type AnalyzerOptions } from './analyzer.js';
export {
  getAllParsers,
  BaseBuildSystemParser,
  type IBuildSystemParser,
  CMakeParser,
  MesonParser,
  SConsParser,
  AutotoolsParser
} from './parsers/index.js';

/**
 * Dependency Analysis Module
 *
 * Provides build system detection, dependency extraction, and build diagnostics
 */

export { DependencyAnalyzer, type AnalyzerOptions } from './analyzer.js';
export {
  getAllParsers,
  BaseBuildSystemParser,
  type IBuildSystemParser,
  CMakeParser,
  MesonParser,
  SConsParser,
  AutotoolsParser,
  BazelParser
} from './parsers/index.js';

// Build diagnostics
export {
  BuildDiagnostics,
  createBuildDiagnostics
} from './diagnostics.js';

// Issue registry types
export type {
  KnownIssue,
  IssueRegistry,
  DiagnosisResult,
  BuildResult,
  DiagnoseOptions,
  Workaround,
  WorkaroundAction
} from './issues/index.js';

export {
  loadIssueRegistry,
  matchIssue
} from './issues/index.js';

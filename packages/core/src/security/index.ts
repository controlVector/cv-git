/**
 * AI Security Module
 *
 * STUB: Not yet implemented
 *
 * This module will provide AI-powered security scanning and analysis.
 * Features planned:
 * - SAST (Static Application Security Testing)
 * - Secret detection and credential scanning
 * - SCA (Software Composition Analysis) for dependency vulnerabilities
 * - License compliance checking
 * - Container image scanning
 * - Infrastructure as Code (IaC) scanning
 * - AI-powered vulnerability analysis and prioritization
 * - Automated remediation suggestions with code fixes
 * - Security posture assessment and trending
 * - CI/CD integration with PR comments and notifications
 *
 * @module @cv-git/core/security
 */

export * from './types.js';

/**
 * Security Scanner placeholder class
 *
 * This class will implement the ISecurityScanner interface when the feature is implemented.
 *
 * @example
 * ```typescript
 * // Future usage:
 * const scanner = new SecurityScanner();
 * await scanner.init({
 *   scanTypes: ['sast', 'secrets', 'dependencies'],
 *   minSeverity: 'medium',
 *   failOn: 'high',
 * });
 *
 * const result = await scanner.scan('./src');
 * console.log(`Found ${result.summary.total} findings`);
 *
 * // Scan staged changes before commit
 * const stagedResult = await scanner.scanStaged();
 * if (stagedResult.findings.some(f => f.severity === 'critical')) {
 *   console.error('Critical security issues found in staged changes!');
 *   process.exit(1);
 * }
 * ```
 */
export class SecurityScanner {
  static readonly NOT_IMPLEMENTED = 'Security Scanner is not yet implemented';

  /**
   * Check if the scanner feature is available
   */
  static isAvailable(): boolean {
    return false;
  }

  /**
   * Get implementation status message
   */
  static getStatus(): string {
    return 'The Security Scanner feature is planned for a future release. ' +
      'It will provide SAST, secret detection, dependency scanning, and more.';
  }

  /**
   * Get list of planned scan types
   */
  static getPlannedScanTypes(): string[] {
    return ['sast', 'secrets', 'dependencies', 'licenses', 'container', 'iac'];
  }
}

/**
 * AI Security Analyzer placeholder class
 *
 * This class will implement the IAISecurityAnalyzer interface when the feature is implemented.
 *
 * @example
 * ```typescript
 * // Future usage:
 * const analyzer = new AISecurityAnalyzer();
 *
 * // Analyze a finding
 * const analysis = await analyzer.analyzeFinding(finding);
 * console.log(`Priority: ${analysis.priorityScore}/100`);
 * console.log(`Risk: ${analysis.riskAssessment}`);
 *
 * // Get remediation suggestion
 * const remediation = await analyzer.suggestRemediation(finding);
 * if (remediation.codeFix) {
 *   console.log('Suggested fix:');
 *   console.log(remediation.codeFix.fixedCode);
 * }
 *
 * // Assess overall security posture
 * const posture = await analyzer.assessPosture(scanResults);
 * console.log(`Security Grade: ${posture.grade} (${posture.score}/100)`);
 * ```
 */
export class AISecurityAnalyzer {
  static readonly NOT_IMPLEMENTED = 'AI Security Analyzer is not yet implemented';

  /**
   * Check if the analyzer feature is available
   */
  static isAvailable(): boolean {
    return false;
  }

  /**
   * Get implementation status message
   */
  static getStatus(): string {
    return 'The AI Security Analyzer feature is planned for a future release. ' +
      'It will provide AI-powered vulnerability analysis, risk assessment, and remediation suggestions.';
  }

  /**
   * Get list of planned analysis capabilities
   */
  static getPlannedCapabilities(): string[] {
    return [
      'Finding analysis and risk assessment',
      'Exploitability scoring',
      'False positive detection',
      'Code fix suggestions',
      'Finding prioritization',
      'Pattern detection across findings',
      'Root cause analysis',
      'Security posture assessment',
      'Trend analysis',
      'Report generation',
    ];
  }
}

/**
 * Create a Security Scanner instance
 *
 * @throws {Error} Always throws as the feature is not yet implemented
 */
export function createSecurityScanner(): never {
  throw new Error(SecurityScanner.NOT_IMPLEMENTED);
}

/**
 * Create an AI Security Analyzer instance
 *
 * @throws {Error} Always throws as the feature is not yet implemented
 */
export function createAISecurityAnalyzer(): never {
  throw new Error(AISecurityAnalyzer.NOT_IMPLEMENTED);
}

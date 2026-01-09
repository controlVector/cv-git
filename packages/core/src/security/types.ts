/**
 * AI Security Types
 * Stub interfaces for future AI-powered security scanning functionality
 *
 * NOTE: These are placeholder interfaces - not yet implemented
 *
 * The AI Security module will provide:
 * - Static Application Security Testing (SAST)
 * - Secret detection and credential scanning
 * - Dependency vulnerability scanning (SCA)
 * - License compliance checking
 * - Container image scanning
 * - AI-powered vulnerability analysis and remediation suggestions
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Types of security scans available
 */
export type ScanType =
  | 'sast'           // Static Application Security Testing
  | 'secrets'        // Secret/credential detection
  | 'dependencies'   // Dependency vulnerability scanning (SCA)
  | 'licenses'       // License compliance
  | 'container'      // Container image scanning
  | 'iac';           // Infrastructure as Code scanning

/**
 * Severity levels for findings
 */
export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Finding status
 */
export type FindingStatus =
  | 'open'           // New or unresolved finding
  | 'confirmed'      // Confirmed as a real issue
  | 'false-positive' // Marked as false positive
  | 'accepted-risk'  // Risk accepted, will not fix
  | 'fixed';         // Issue has been resolved

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Security scan configuration
 */
export interface SecurityScanConfig {
  /** Types of scans to run */
  scanTypes: ScanType[];

  /** Files/patterns to include in scan */
  include?: string[];

  /** Files/patterns to exclude from scan */
  exclude?: string[];

  /** Minimum severity to report */
  minSeverity?: SeverityLevel;

  /** Fail pipeline if findings exceed this severity */
  failOn?: SeverityLevel;

  /** Maximum number of findings to report */
  maxFindings?: number;

  /** Enable AI-assisted analysis */
  aiAnalysis?: boolean;

  /** Custom rules configuration */
  customRules?: CustomRule[];

  /** Baseline file to exclude known findings */
  baselineFile?: string;
}

/**
 * Custom security rule
 */
export interface CustomRule {
  /** Rule identifier */
  id: string;

  /** Rule name */
  name: string;

  /** Rule description */
  description: string;

  /** Scan type this rule applies to */
  scanType: ScanType;

  /** Severity if rule matches */
  severity: SeverityLevel;

  /** Pattern to match (regex) */
  pattern: string;

  /** File patterns this rule applies to */
  filePatterns?: string[];

  /** CWE identifier if applicable */
  cwe?: string;
}

// ============================================================================
// Finding Types
// ============================================================================

/**
 * Security finding/vulnerability
 */
export interface SecurityFinding {
  /** Unique finding identifier */
  id: string;

  /** Type of scan that found this */
  type: ScanType;

  /** Severity level */
  severity: SeverityLevel;

  /** Current status */
  status: FindingStatus;

  /** Finding title */
  title: string;

  /** Detailed description */
  description: string;

  /** File where finding was detected */
  file?: string;

  /** Line number in file */
  line?: number;

  /** Column number in file */
  column?: number;

  /** End line (for multi-line findings) */
  endLine?: number;

  /** Code snippet showing the issue */
  snippet?: string;

  /** CWE (Common Weakness Enumeration) identifier */
  cwe?: string;

  /** CVE (Common Vulnerabilities and Exposures) identifier */
  cve?: string;

  /** CVSS score (0-10) */
  cvssScore?: number;

  /** Remediation guidance */
  remediation?: string;

  /** Reference URLs */
  references?: string[];

  /** Rule that triggered this finding */
  rule?: string;

  /** First detected timestamp */
  firstDetected?: number;

  /** Last seen timestamp */
  lastSeen?: number;

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Dependency vulnerability finding (for SCA)
 */
export interface DependencyFinding extends SecurityFinding {
  type: 'dependencies';

  /** Package name */
  packageName: string;

  /** Current version */
  currentVersion: string;

  /** Fixed version (if available) */
  fixedVersion?: string;

  /** Package ecosystem (npm, pip, maven, etc.) */
  ecosystem: string;

  /** Is this a direct or transitive dependency */
  isDirect: boolean;

  /** Dependency path for transitive dependencies */
  dependencyPath?: string[];
}

/**
 * Secret finding
 */
export interface SecretFinding extends SecurityFinding {
  type: 'secrets';

  /** Type of secret detected */
  secretType: string;

  /** Redacted value preview */
  redactedValue?: string;

  /** Entropy score */
  entropy?: number;

  /** Was the secret verified as valid */
  verified?: boolean;
}

/**
 * License finding
 */
export interface LicenseFinding extends SecurityFinding {
  type: 'licenses';

  /** Package name */
  packageName: string;

  /** Detected license */
  license: string;

  /** License category (permissive, copyleft, proprietary, etc.) */
  licenseCategory: 'permissive' | 'copyleft' | 'weak-copyleft' | 'proprietary' | 'unknown';

  /** Is license compatible with project license */
  compatible?: boolean;
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Scan result
 */
export interface ScanResult {
  /** Unique scan identifier */
  scanId: string;

  /** Scan start timestamp */
  timestamp: number;

  /** Scan duration in milliseconds */
  duration: number;

  /** Types of scans performed */
  scanTypes: ScanType[];

  /** Target that was scanned */
  target: string;

  /** All findings */
  findings: SecurityFinding[];

  /** Summary statistics */
  summary: ScanSummary;

  /** Scan configuration used */
  config: SecurityScanConfig;

  /** Errors encountered during scan */
  errors?: ScanError[];
}

/**
 * Summary of scan results
 */
export interface ScanSummary {
  /** Total number of findings */
  total: number;

  /** Findings by severity */
  bySeverity: Record<SeverityLevel, number>;

  /** Findings by type */
  byType: Record<ScanType, number>;

  /** Findings by status */
  byStatus: Record<FindingStatus, number>;

  /** New findings (not in baseline) */
  newFindings: number;

  /** Fixed findings (in baseline but not found) */
  fixedFindings: number;

  /** Files scanned */
  filesScanned: number;

  /** Lines of code scanned */
  linesScanned?: number;
}

/**
 * Scan error
 */
export interface ScanError {
  /** Error code */
  code: string;

  /** Error message */
  message: string;

  /** File that caused the error */
  file?: string;

  /** Scan type that failed */
  scanType?: ScanType;
}

// ============================================================================
// Scanner Interface
// ============================================================================

/**
 * Security Scanner Interface
 * Future implementation will provide code security scanning
 */
export interface ISecurityScanner {
  /**
   * Initialize the scanner with optional configuration
   */
  init(config?: SecurityScanConfig): Promise<void>;

  /**
   * Scan a file or directory
   */
  scan(target: string, options?: Partial<SecurityScanConfig>): Promise<ScanResult>;

  /**
   * Scan only staged git changes
   */
  scanStaged(): Promise<ScanResult>;

  /**
   * Scan changes in a specific commit
   */
  scanCommit(sha: string): Promise<ScanResult>;

  /**
   * Scan a diff/patch
   */
  scanDiff(diff: string): Promise<ScanResult>;

  /**
   * Get supported scan types
   */
  getSupportedScanTypes(): ScanType[];

  /**
   * Validate configuration
   */
  validateConfig(config: SecurityScanConfig): ValidationResult;

  /**
   * Generate baseline from current findings
   */
  generateBaseline(scanResult: ScanResult): Promise<string>;

  /**
   * Load baseline for comparison
   */
  loadBaseline(path: string): Promise<SecurityFinding[]>;
}

/**
 * Configuration validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// AI-Assisted Analysis
// ============================================================================

/**
 * AI-Assisted Security Analyzer Interface
 * Uses AI to analyze findings and suggest remediations
 */
export interface IAISecurityAnalyzer {
  /**
   * Analyze a finding and provide AI-powered insights
   */
  analyzeFinding(finding: SecurityFinding): Promise<AISecurityAnalysis>;

  /**
   * Analyze multiple findings for patterns
   */
  analyzeFindings(findings: SecurityFinding[]): Promise<AIFindingsAnalysis>;

  /**
   * Generate remediation code suggestions
   */
  suggestRemediation(finding: SecurityFinding): Promise<RemediationSuggestion>;

  /**
   * Prioritize findings based on risk
   */
  prioritizeFindings(findings: SecurityFinding[]): Promise<PrioritizedFindings>;

  /**
   * Assess overall security posture
   */
  assessPosture(results: ScanResult[]): Promise<SecurityPosture>;

  /**
   * Generate security report
   */
  generateReport(results: ScanResult[], format: ReportFormat): Promise<string>;
}

/**
 * AI analysis of a single finding
 */
export interface AISecurityAnalysis {
  /** The finding being analyzed */
  finding: SecurityFinding;

  /** Risk assessment narrative */
  riskAssessment: string;

  /** How easy is this to exploit */
  exploitability: 'low' | 'medium' | 'high';

  /** Potential business impact */
  businessImpact: string;

  /** Attack scenarios */
  attackScenarios?: string[];

  /** Priority score (0-100) */
  priorityScore: number;

  /** Confidence in the analysis (0-1) */
  confidence: number;

  /** Is this likely a false positive */
  likelyFalsePositive: boolean;

  /** Reasoning for false positive assessment */
  falsePositiveReason?: string;
}

/**
 * AI analysis of multiple findings
 */
export interface AIFindingsAnalysis {
  /** Patterns detected across findings */
  patterns: SecurityPattern[];

  /** Root causes identified */
  rootCauses: RootCause[];

  /** Overall risk assessment */
  overallRisk: 'low' | 'medium' | 'high' | 'critical';

  /** Key recommendations */
  recommendations: string[];
}

/**
 * Security pattern detected
 */
export interface SecurityPattern {
  /** Pattern name */
  name: string;

  /** Pattern description */
  description: string;

  /** Findings that match this pattern */
  findings: string[];

  /** Suggested remediation approach */
  remediationApproach: string;
}

/**
 * Root cause analysis
 */
export interface RootCause {
  /** Root cause description */
  description: string;

  /** Affected findings */
  affectedFindings: string[];

  /** Suggested fix */
  suggestedFix: string;

  /** Effort to fix */
  effort: 'trivial' | 'small' | 'medium' | 'large';
}

/**
 * Remediation suggestion
 */
export interface RemediationSuggestion {
  /** Finding this addresses */
  findingId: string;

  /** Textual suggestion */
  suggestion: string;

  /** Code fix (if applicable) */
  codeFix?: CodeFix;

  /** Confidence in the suggestion (0-1) */
  confidence: number;

  /** Estimated effort to implement */
  effort: 'trivial' | 'small' | 'medium' | 'large';

  /** Could this fix break something */
  breakingRisk: 'none' | 'low' | 'medium' | 'high';

  /** Alternative approaches */
  alternatives?: string[];
}

/**
 * Code fix suggestion
 */
export interface CodeFix {
  /** File to modify */
  file: string;

  /** Starting line */
  startLine: number;

  /** Ending line */
  endLine: number;

  /** Original code */
  originalCode: string;

  /** Fixed code */
  fixedCode: string;

  /** Explanation of the fix */
  explanation: string;
}

/**
 * Prioritized findings result
 */
export interface PrioritizedFindings {
  /** Findings in priority order */
  findings: Array<{
    finding: SecurityFinding;
    priorityScore: number;
    priorityReason: string;
  }>;

  /** Recommended fix order */
  recommendedOrder: string[];
}

/**
 * Overall security posture assessment
 */
export interface SecurityPosture {
  /** Overall score (0-100) */
  score: number;

  /** Letter grade */
  grade: 'A' | 'B' | 'C' | 'D' | 'F';

  /** Score trend */
  trend: 'improving' | 'stable' | 'declining';

  /** Security strengths */
  strengths: string[];

  /** Security weaknesses */
  weaknesses: string[];

  /** Top recommendations */
  recommendations: string[];

  /** Risk areas */
  riskAreas: RiskArea[];

  /** Comparison to baseline/previous */
  comparison?: PostureComparison;
}

/**
 * Risk area
 */
export interface RiskArea {
  /** Area name */
  name: string;

  /** Risk level */
  level: 'low' | 'medium' | 'high' | 'critical';

  /** Description */
  description: string;

  /** Related findings */
  findings: string[];
}

/**
 * Posture comparison
 */
export interface PostureComparison {
  /** Previous score */
  previousScore: number;

  /** Score change */
  scoreChange: number;

  /** New issues */
  newIssues: number;

  /** Fixed issues */
  fixedIssues: number;
}

/**
 * Report format options
 */
export type ReportFormat = 'markdown' | 'html' | 'json' | 'sarif' | 'pdf';

// ============================================================================
// Integration Types
// ============================================================================

/**
 * CI/CD integration configuration
 */
export interface CICDConfig {
  /** Fail build on findings */
  failOnFindings: boolean;

  /** Minimum severity to fail */
  failSeverity: SeverityLevel;

  /** Comment on PRs */
  prComments: boolean;

  /** Create issues for findings */
  createIssues: boolean;

  /** Notify on new findings */
  notifications: NotificationConfig[];
}

/**
 * Notification configuration
 */
export interface NotificationConfig {
  /** Notification type */
  type: 'slack' | 'email' | 'webhook';

  /** Target (channel, email, URL) */
  target: string;

  /** Minimum severity to notify */
  minSeverity: SeverityLevel;
}

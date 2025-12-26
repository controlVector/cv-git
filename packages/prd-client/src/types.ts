/**
 * cvPRD Type Definitions
 * Based on cvPRD DATA_MODELS.md
 */

export type ChunkType =
  // Core PRD types
  | 'requirement'
  | 'feature'
  | 'constraint'
  | 'stakeholder'
  | 'metric'
  | 'dependency'
  | 'risk'
  | 'assumption'
  | 'objective'
  | 'overview'
  // Test artifacts
  | 'test_case'
  | 'unit_test_spec'
  | 'integration_test_spec'
  | 'acceptance_criteria'
  // Documentation artifacts
  | 'documentation'
  | 'user_manual'
  | 'api_doc'
  | 'technical_spec'
  | 'release_note'
  // Design artifacts
  | 'design_spec'
  | 'screen_flow'
  | 'wireframe';

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export type Status = 'draft' | 'in_review' | 'approved' | 'implemented' | 'deprecated';

export type RelationshipType =
  | 'DEPENDS_ON'
  | 'REFERENCES'
  | 'PARENT_OF'
  | 'IMPLEMENTS'
  | 'CONTRADICTS'
  | 'RELATES_TO'
  // Artifact relationships
  | 'TESTS'
  | 'DOCUMENTS'
  | 'DESIGNS'
  | 'BELONGS_TO'
  // Document-specific relationships (for markdown knowledge graph)
  | 'DESCRIBES'        // Document -> Code/Symbol (docs that describe code)
  | 'REFERENCES_DOC'   // Document -> Document (doc references another doc)
  | 'SUPERSEDES';      // Document -> Document (ADR supersedes older ADR)

export interface ChunkMetadata {
  priority?: Priority;
  status?: Status;
  tags: string[];
  owner?: string;
  section_path?: string;
  custom_fields?: Record<string, any>;
}

export interface Chunk {
  id: string;
  prd_id: string;
  chunk_type: ChunkType;
  text: string;
  context_prefix?: string;
  metadata: ChunkMetadata;
  vector_id?: string;
  graph_node_id?: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PRD {
  id: string;
  name: string;
  description?: string;
  version: number;
  content: {
    sections: any[];
    metadata: Record<string, any>;
  };
  tags: string[];
  status: Status;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export interface Relationship {
  id: string;
  source_chunk_id: string;
  target_chunk_id: string;
  relationship_type: RelationshipType;
  strength: number;
  metadata: Record<string, any>;
  created_at: string;
}

export interface ChunkContext {
  chunk_id: string;
  text: string;
  chunk_type: ChunkType;
  metadata: ChunkMetadata;
  relationship?: string;
  distance: number;
}

export interface AIContext {
  primary_chunk: ChunkContext;
  dependencies: ChunkContext[];
  references: ChunkContext[];
  related: ChunkContext[];
  constraints: ChunkContext[];
  strategy: 'direct' | 'expanded' | 'full' | 'summarized';
  total_tokens: number;
  max_tokens: number;
  prd_info: Record<string, any>;
}

export interface SearchRequest {
  query: string;
  filters?: {
    prd_id?: string;
    chunk_type?: ChunkType[];
    priority?: Priority[];
    status?: Status[];
    tags?: string[];
  };
  limit?: number;
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
  highlights?: string[];
}

export interface ImplementationLink {
  chunk_id: string;
  commit_sha: string;
  symbols: string[];
  files: string[];
  linked_at: string;
}

// =============================================================================
// Unified Context Types (for AI traversal)
// =============================================================================

export interface TestCase {
  id: string;
  test_type: 'unit' | 'integration' | 'acceptance';
  title: string;
  description: string;
  preconditions: string[];
  steps: string[];
  expected_result: string;
  priority: Priority;
  code_stub?: string;
  source_requirement_id: string;
}

export interface CoverageMetrics {
  prd_id: string;
  total_requirements: number;
  covered_requirements: number;
  uncovered_requirements: number;
  coverage_percent: number;
}

export interface TestCoverage extends CoverageMetrics {
  total_tests: number;
}

export interface DocCoverage extends CoverageMetrics {
  total_docs: number;
}

export interface FullTraceability {
  chunk_id: string;
  chunk: ChunkContext | null;
  dependencies: ChunkContext[];
  dependents: ChunkContext[];
  tests: ChunkContext[];
  documentation: ChunkContext[];
  designs: ChunkContext[];
  implementations: ImplementationLink[];
}

export interface UnifiedContextRequest {
  query: string;
  prd_id?: string;
  include_types?: ChunkType[];
  depth?: number;
  format?: 'structured' | 'narrative';
}

export interface UnifiedContextResult {
  chunk_id: string;
  chunk_type: ChunkType;
  text: string;
  score: number;
  traceability?: FullTraceability;
}

export interface UnifiedContext {
  query: string;
  prd_id?: string;
  results: UnifiedContextResult[];
  count: number;
  coverage: {
    test_coverage?: TestCoverage;
    doc_coverage?: DocCoverage;
  };
  include_types: ChunkType[];
}

export interface GenerateTestsRequest {
  test_type?: 'unit' | 'integration' | 'acceptance' | 'all';
  framework?: 'pytest' | 'jest' | 'mocha' | 'vitest';
  include_code_stub?: boolean;
}

export interface GenerateTestsResponse {
  chunk_id: string;
  test_cases: TestCase[];
  count: number;
}

export interface GenerateDocsRequest {
  doc_type: 'user_manual' | 'api_doc' | 'technical_spec';
  audience?: string;
}

export interface GenerateDocsResponse {
  prd_id: string;
  doc_type: string;
  sections: Chunk[];
  count: number;
}

export interface GenerateReleaseNotesRequest {
  version: string;
  changes?: string[];
}

export interface ReleaseNotes {
  version: string;
  release_date: string;
  summary: string;
  highlights: string[];
  sections: {
    title: string;
    items: {
      title: string;
      description: string;
      related_requirement_ids: string[];
    }[];
  }[];
  full_markdown: string;
  chunk_id?: string;
}

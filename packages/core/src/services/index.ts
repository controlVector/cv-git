/**
 * Services index
 * High-level services built on top of core managers
 */

export {
  CacheService,
  createCacheService,
  getGlobalCache,
  resetGlobalCache,
  MemoryCacheStats,
  AllMemoryCacheStats,
  CacheOptions
} from './cache-service.js';

export {
  RLMRouter,
  createRLMRouter,
  RLMContext,
  RLMResult,
  RLMStep,
  RLMTask,
  RLMPlan,
  RLMTaskType,
  RLMRouterOptions
} from './rlm-router.js';

export {
  CodebaseSummaryService,
  createCodebaseSummaryService,
  loadCodebaseSummary,
  CodebaseSummary,
  CodebaseSummaryServiceOptions,
  ModuleSummary,
  InterfaceSummary,
  ClassSummary,
  FunctionSummary
} from './codebase-summary.js';

export {
  GraphService,
  createGraphService,
  PathResult,
  PathEdge,
  Neighborhood,
  NeighborhoodNode,
  ImpactAnalysis,
  BridgeResult
} from './graph-service.js';

export {
  SemanticGraphService,
  createSemanticGraphService,
  SemanticSearchResult,
  ExpandedContext,
  ConceptCluster,
  SemanticGraphSearchOptions
} from './semantic-graph.js';

export {
  CredentialService,
  getCredentialService,
  createCredentialService,
  CredentialServiceOptions
} from './credential-service.js';

export {
  ContainerService,
  getContainerService,
  createContainerService,
  ContainerStatus,
  ContainerServiceOptions
} from './container-service.js';

export {
  HierarchicalSummaryService,
  createHierarchicalSummaryService,
  SummaryContext
} from './hierarchical-summary.js';

export {
  TraversalService,
  createTraversalService,
  TraversalServiceOptions
} from './traversal-service.js';

export {
  SessionService,
  createSessionService,
  SessionServiceOptions
} from './session-service.js';

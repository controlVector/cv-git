/**
 * Sync Engine
 * Orchestrates synchronization between repository, graph, and vector databases
 */

import {
  SyncState,
  FileNode,
  ParsedFile,
  CodeChunk,
  CodeChunkPayload,
  DocumentNode,
  DocumentChunk,
  DocumentChunkPayload,
  ParsedDocument,
  CommitNode,
  ChangeType,
  HierarchicalSummaryOptions
} from '@cv-git/shared';
import { HierarchicalSummaryService, createHierarchicalSummaryService } from '../services/hierarchical-summary.js';
import { shouldSyncFile, detectLanguage, getCVDir } from '@cv-git/shared';
import { minimatch } from 'minimatch';
import { GitManager } from '../git/index.js';
import { CodeParser } from '../parser/index.js';
import { GraphManager } from '../graph/index.js';
import { VectorManager } from '../vector/index.js';
import { DeltaSyncManager, createDeltaSyncManager, SyncDelta } from './delta.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Re-export delta types, file locking, and file utilities
export * from './delta.js';
export * from './file-lock.js';
export * from './file-utils.js';

import { safeReadFile, logSkippedFile } from './file-utils.js';

export interface SyncOptions {
  incremental?: boolean;
  files?: string[];
  excludePatterns?: string[];
  includeLanguages?: string[];
  // Document sync options
  includeDocs?: boolean;          // Include markdown files (default: true)
  docPatterns?: string[];         // Patterns for doc files (default: ['**/*.md'])
  docExcludePatterns?: string[];  // Exclude patterns for docs
  // Commit history sync options
  syncCommits?: boolean;          // Sync commit history (default: true)
  commitDepth?: number;           // Number of commits to sync (default: 50)
  // Chunked processing options (for large repos)
  maxFiles?: number;              // Maximum files to process per run
  batchSize?: number;             // Batch size for embeddings (default: 50)
  continueFromLast?: boolean;     // Continue from last chunked sync position
  // Hierarchical summary options
  generateSummaries?: boolean;    // Generate hierarchical summaries (default: false)
  summaryOptions?: {
    maxSymbolsPerFile?: number;
    maxFilesPerDirectory?: number;
    skipUnchanged?: boolean;
  };
}

export interface DocumentSyncResult {
  documentCount: number;
  sectionCount: number;
  vectorCount: number;
  errors: string[];
}

/**
 * Sync error details for reporting
 */
export interface SyncError {
  file: string;
  error: string;
  phase: 'parse' | 'graph' | 'vector' | 'commit' | 'document';
  timestamp: number;
}

/**
 * Sync report saved to .cv/sync-report.json
 */
export interface SyncReport {
  timestamp: number;
  duration: number;
  type: 'full' | 'delta' | 'incremental';
  success: boolean;
  stats: {
    filesProcessed: number;
    filesFailed: number;
    symbolsCreated: number;
    vectorsCreated: number;
  };
  errors: SyncError[];
  systemInfo?: {
    nodeVersion: string;
    platform: string;
    cvVersion: string;
  };
}

export class SyncEngine {
  private delta: DeltaSyncManager;

  constructor(
    private repoRoot: string,
    private git: GitManager,
    private parser: CodeParser,
    private graph: GraphManager,
    private vector?: VectorManager
  ) {
    this.delta = createDeltaSyncManager(repoRoot);
  }

  /**
   * Save sync report to .cv/sync-report.json
   * This is used for error tracking and bug reports
   */
  async saveSyncReport(report: SyncReport): Promise<void> {
    try {
      const cvDir = getCVDir(this.repoRoot);
      const reportPath = path.join(cvDir, 'sync-report.json');

      // Ensure .cv directory exists
      await fs.mkdir(cvDir, { recursive: true });

      // Save the report
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

      // If there were errors, also append to a rolling error log
      if (report.errors.length > 0) {
        const errorLogPath = path.join(cvDir, 'sync-errors.log');
        const errorLogEntry = `\n--- ${new Date(report.timestamp).toISOString()} (${report.type} sync) ---\n` +
          report.errors.map(e => `[${e.phase}] ${e.file}: ${e.error}`).join('\n') + '\n';

        // Append to error log (create if doesn't exist)
        await fs.appendFile(errorLogPath, errorLogEntry);

        // Trim error log if it gets too large (keep last 100KB)
        try {
          const stats = await fs.stat(errorLogPath);
          if (stats.size > 100 * 1024) {
            const content = await fs.readFile(errorLogPath, 'utf-8');
            const trimmed = content.slice(-80 * 1024); // Keep last 80KB
            await fs.writeFile(errorLogPath, trimmed);
          }
        } catch {
          // Ignore trim errors
        }
      }
    } catch (error: any) {
      // Don't fail sync if report saving fails
      console.warn(`Failed to save sync report: ${error.message}`);
    }
  }

  /**
   * Get the most recent sync report
   */
  async getSyncReport(): Promise<SyncReport | null> {
    try {
      const cvDir = getCVDir(this.repoRoot);
      const reportPath = path.join(cvDir, 'sync-report.json');
      const content = await fs.readFile(reportPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Perform full repository sync
   */
  async fullSync(options: SyncOptions = {}): Promise<SyncState> {
    const startTime = Date.now();
    const syncErrors: SyncError[] = [];

    console.log('Starting full sync...');

    try {
      // 1. Get all tracked files
      console.log('Getting tracked files...');
      const allFiles = await this.git.getTrackedFiles();
      console.log(`Found ${allFiles.length} tracked files`);

      // 2. Filter files to sync
      // Always include critical patterns (merge with any custom patterns)
      const defaultPatterns = this.getDefaultExcludePatterns();
      const customPatterns = options.excludePatterns || [];
      const excludePatterns = [...new Set([...defaultPatterns, ...customPatterns])];
      const includeLanguages = options.includeLanguages || this.getDefaultIncludeLanguages();

      const filesToSync = allFiles.filter(f =>
        shouldSyncFile(f, excludePatterns, includeLanguages)
      );

      console.log(`Syncing ${filesToSync.length} files`);

      // 3. Parse all files (with parallelization)
      console.log('Parsing files...');
      const parsedFiles: ParsedFile[] = [];
      const CONCURRENCY = 10; // Parse 10 files in parallel

      // Process files in batches for parallel parsing
      for (let i = 0; i < filesToSync.length; i += CONCURRENCY) {
        const batch = filesToSync.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.allSettled(
          batch.map(file => this.parseFile(file))
        );

        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          const file = batch[j];
          if (result.status === 'fulfilled') {
            parsedFiles.push(result.value);
          } else {
            syncErrors.push({
              file,
              error: result.reason?.message || 'Unknown error',
              phase: 'parse',
              timestamp: Date.now()
            });
          }
        }

        const progress = Math.min(i + CONCURRENCY, filesToSync.length);
        if (progress % 50 === 0 || progress === filesToSync.length) {
          console.log(`Parsed ${progress}/${filesToSync.length} files`);
        }
      }

      console.log(`Successfully parsed ${parsedFiles.length} files`);

      // 4. Update graph
      console.log('Updating knowledge graph...');
      await this.updateGraph(parsedFiles);

      // 5. Sync commit history (if enabled)
      const syncCommits = options.syncCommits !== false; // default: true
      if (syncCommits) {
        console.log('Syncing commit history...');
        const commitDepth = options.commitDepth || 50;
        await this.syncCommitHistory(commitDepth);
      }

      // 6. Generate hierarchical summaries (if enabled)
      if (options.generateSummaries && this.vector && this.vector.isConnected()) {
        console.log('Generating hierarchical summaries...');
        await this.generateHierarchicalSummaries(parsedFiles, options.summaryOptions);
      }

      // 7. Collect statistics
      const stats = await this.graph.getStats();

      // Count vectors (if vector DB is available)
      let vectorCount = 0;
      if (this.vector && this.vector.isConnected()) {
        try {
          const info = await this.vector.getCollectionInfo('code_chunks');
          vectorCount = info.points_count || 0;
        } catch (error) {
          // Collection might not exist yet
          vectorCount = 0;
        }
      }

      const syncState: SyncState = {
        lastFullSync: Date.now(),
        lastCommitSynced: await this.git.getLastCommitSha(),
        fileCount: stats.fileCount,
        symbolCount: stats.symbolCount,
        nodeCount: stats.fileCount + stats.symbolCount,
        edgeCount: stats.relationshipCount,
        vectorCount,
        languages: this.countLanguages(parsedFiles),
        syncDuration: (Date.now() - startTime) / 1000,
        errors: syncErrors.map(e => `${e.file}: ${e.error}`)
      };

      // 8. Save sync state
      await this.saveSyncState(syncState);

      // 9. Save sync report for error tracking
      const syncReport: SyncReport = {
        timestamp: Date.now(),
        duration: syncState.syncDuration ?? 0,
        type: 'full',
        success: syncErrors.length === 0,
        stats: {
          filesProcessed: parsedFiles.length,
          filesFailed: syncErrors.length,
          symbolsCreated: stats.symbolCount,
          vectorsCreated: vectorCount
        },
        errors: syncErrors,
        systemInfo: {
          nodeVersion: process.version,
          platform: process.platform,
          cvVersion: '0.4.24'
        }
      };
      await this.saveSyncReport(syncReport);

      console.log(`Sync completed in ${syncState.syncDuration}s`);
      console.log(`- Files: ${syncState.fileCount}`);
      console.log(`- Symbols: ${syncState.symbolCount}`);
      console.log(`- Relationships: ${syncState.edgeCount}`);
      if (vectorCount > 0) {
        console.log(`- Vectors: ${vectorCount}`);
      }
      if (syncErrors.length > 0) {
        console.log(`- Parse errors: ${syncErrors.length} (see .cv/sync-report.json for details)`);
      }

      return syncState;

    } catch (error: any) {
      console.error('Sync failed:', error);
      throw error;
    }
  }

  /**
   * Perform incremental sync for changed files
   */
  async incrementalSync(changedFiles: string[], options: SyncOptions = {}): Promise<SyncState> {
    const startTime = Date.now();
    const errors: string[] = [];

    console.log(`Starting incremental sync for ${changedFiles.length} files...`);

    try {
      // Filter files to sync
      // Always include critical patterns (merge with any custom patterns)
      const defaultPatterns = this.getDefaultExcludePatterns();
      const customPatterns = options.excludePatterns || [];
      const excludePatterns = [...new Set([...defaultPatterns, ...customPatterns])];
      const includeLanguages = options.includeLanguages || this.getDefaultIncludeLanguages();

      const filesToSync = changedFiles.filter(f =>
        shouldSyncFile(f, excludePatterns, includeLanguages)
      );

      console.log(`Syncing ${filesToSync.length} files`);

      // Parse changed files
      const parsedFiles: ParsedFile[] = [];

      for (const file of filesToSync) {
        try {
          const parsed = await this.parseFile(file);
          parsedFiles.push(parsed);
        } catch (error: any) {
          errors.push(`Failed to parse ${file}: ${error.message}`);
          console.error(`Error parsing ${file}:`, error.message);
        }
      }

      // Update graph (will merge/upsert nodes)
      await this.updateGraph(parsedFiles);

      // Get updated statistics
      const stats = await this.graph.getStats();
      const prevState = await this.loadSyncState();

      // Count vectors (if vector DB is available)
      let vectorCount = 0;
      if (this.vector && this.vector.isConnected()) {
        try {
          const info = await this.vector.getCollectionInfo('code_chunks');
          vectorCount = info.points_count || 0;
        } catch (error) {
          vectorCount = 0;
        }
      }

      const syncState: SyncState = {
        lastFullSync: prevState?.lastFullSync || Date.now(),
        lastIncrementalSync: Date.now(),
        lastCommitSynced: await this.git.getLastCommitSha(),
        fileCount: stats.fileCount,
        symbolCount: stats.symbolCount,
        nodeCount: stats.fileCount + stats.symbolCount,
        edgeCount: stats.relationshipCount,
        vectorCount,
        languages: this.countLanguages(parsedFiles),
        syncDuration: (Date.now() - startTime) / 1000,
        errors
      };

      await this.saveSyncState(syncState);

      console.log(`Incremental sync completed in ${syncState.syncDuration}s`);

      return syncState;

    } catch (error: any) {
      console.error('Incremental sync failed:', error);
      throw error;
    }
  }

  /**
   * Smart delta sync - automatically detects changes and only syncs what changed
   *
   * This is the recommended sync method for most use cases.
   * It uses content hashing to detect actual file changes.
   */
  async deltaSync(options: SyncOptions = {}): Promise<SyncState & { delta: SyncDelta }> {
    const startTime = Date.now();
    const syncErrors: SyncError[] = [];

    console.log('Starting delta sync...');

    try {
      // Check if full sync is needed
      const needsFull = await this.delta.needsFullSync();
      if (needsFull) {
        console.log('No previous sync state, performing full sync...');
        const fullResult = await this.fullSync(options);

        // Track all files for next delta
        const allFiles = await this.git.getTrackedFiles();
        const defaultPatterns = this.getDefaultExcludePatterns();
        const customPatterns = options.excludePatterns || [];
        const excludePatterns = [...new Set([...defaultPatterns, ...customPatterns])];
        const includeLanguages = options.includeLanguages || this.getDefaultIncludeLanguages();

        const filesToTrack = allFiles.filter(f =>
          shouldSyncFile(f, excludePatterns, includeLanguages)
        );

        // Read content and mark as synced (using safe file reading with size limits)
        const fileContents = new Map<string, string>();
        for (const file of filesToTrack) {
          const absolutePath = path.join(this.repoRoot, file);
          const result = await safeReadFile(absolutePath);
          if ('content' in result) {
            fileContents.set(file, result.content);
          } else {
            logSkippedFile(file, result.error);
          }
        }

        await this.delta.markSynced(fileContents, 'code');
        await this.delta.setLastCommit(await this.git.getLastCommitSha());
        await this.delta.close();

        return {
          ...fullResult,
          delta: {
            added: filesToTrack,
            modified: [],
            deleted: [],
            unchanged: []
          }
        };
      }

      // Get all current files
      const allFiles = await this.git.getTrackedFiles();
      const defaultPatterns = this.getDefaultExcludePatterns();
      const customPatterns = options.excludePatterns || [];
      const excludePatterns = [...new Set([...defaultPatterns, ...customPatterns])];
      const includeLanguages = options.includeLanguages || this.getDefaultIncludeLanguages();

      const currentFiles = allFiles.filter(f =>
        shouldSyncFile(f, excludePatterns, includeLanguages)
      );

      // Read current file contents (using safe file reading with size limits)
      const fileContents = new Map<string, string>();
      for (const file of currentFiles) {
        const absolutePath = path.join(this.repoRoot, file);
        const result = await safeReadFile(absolutePath);
        if ('content' in result) {
          fileContents.set(file, result.content);
        } else {
          logSkippedFile(file, result.error);
        }
      }

      // Compute delta
      const delta = await this.delta.computeDelta(fileContents, 'code');

      console.log(`Delta: ${delta.added.length} added, ${delta.modified.length} modified, ${delta.deleted.length} deleted, ${delta.unchanged.length} unchanged`);

      // If nothing changed in files, still sync commit history
      if (delta.added.length === 0 && delta.modified.length === 0 && delta.deleted.length === 0) {
        console.log('No file changes detected');

        // Sync commit history even when no file changes (new commits may exist)
        const syncCommits = options.syncCommits !== false;
        if (syncCommits) {
          console.log('Syncing commit history...');
          const commitDepth = options.commitDepth || 50;
          await this.syncCommitHistory(commitDepth);
        }

        const stats = await this.graph.getStats();
        const prevState = await this.loadSyncState();

        let vectorCount = 0;
        if (this.vector && this.vector.isConnected()) {
          try {
            const info = await this.vector.getCollectionInfo('code_chunks');
            vectorCount = info.points_count || 0;
          } catch (error) {
            vectorCount = 0;
          }
        }

        return {
          lastFullSync: prevState?.lastFullSync || Date.now(),
          lastIncrementalSync: Date.now(),
          lastCommitSynced: await this.git.getLastCommitSha(),
          fileCount: stats.fileCount,
          symbolCount: stats.symbolCount,
          nodeCount: stats.fileCount + stats.symbolCount,
          edgeCount: stats.relationshipCount,
          vectorCount,
          languages: prevState?.languages || {},
          syncDuration: (Date.now() - startTime) / 1000,
          errors: [],
          delta
        };
      }

      // Process changed files
      const changedFiles = [...delta.added, ...delta.modified];
      console.log(`Processing ${changedFiles.length} changed files...`);

      // Parse changed files
      const parsedFiles: ParsedFile[] = [];
      for (const file of changedFiles) {
        try {
          const parsed = await this.parseFile(file);
          parsedFiles.push(parsed);
        } catch (error: any) {
          syncErrors.push({
            file,
            error: error.message,
            phase: 'parse',
            timestamp: Date.now()
          });
        }
      }

      // Update graph with changed files
      if (parsedFiles.length > 0) {
        await this.updateGraph(parsedFiles);
      }

      // Sync commit history (if enabled)
      const syncCommits = options.syncCommits !== false; // default: true
      if (syncCommits) {
        console.log('Syncing commit history...');
        const commitDepth = options.commitDepth || 50;
        await this.syncCommitHistory(commitDepth);
      }

      // Handle deleted files
      if (delta.deleted.length > 0) {
        console.log(`Removing ${delta.deleted.length} deleted files from graph...`);
        for (const file of delta.deleted) {
          try {
            await this.graph.deleteFileNode(file);
          } catch (error: any) {
            syncErrors.push({
              file,
              error: error.message,
              phase: 'graph',
              timestamp: Date.now()
            });
          }
        }

        // Remove from delta tracking
        await this.delta.markDeleted(delta.deleted);
      }

      // Update delta tracking for synced files
      const syncedContents = new Map<string, string>();
      for (const file of changedFiles) {
        if (fileContents.has(file)) {
          syncedContents.set(file, fileContents.get(file)!);
        }
      }
      await this.delta.markSynced(syncedContents, 'code');
      await this.delta.setLastCommit(await this.git.getLastCommitSha());
      await this.delta.close();

      // Get updated statistics
      const stats = await this.graph.getStats();
      const prevState = await this.loadSyncState();

      let vectorCount = 0;
      if (this.vector && this.vector.isConnected()) {
        try {
          const info = await this.vector.getCollectionInfo('code_chunks');
          vectorCount = info.points_count || 0;
        } catch (error) {
          vectorCount = 0;
        }
      }

      const syncState: SyncState & { delta: SyncDelta } = {
        lastFullSync: prevState?.lastFullSync || Date.now(),
        lastIncrementalSync: Date.now(),
        lastCommitSynced: await this.git.getLastCommitSha(),
        fileCount: stats.fileCount,
        symbolCount: stats.symbolCount,
        nodeCount: stats.fileCount + stats.symbolCount,
        edgeCount: stats.relationshipCount,
        vectorCount,
        languages: this.countLanguages(parsedFiles),
        syncDuration: (Date.now() - startTime) / 1000,
        errors: syncErrors.map(e => `${e.file}: ${e.error}`),
        delta
      };

      await this.saveSyncState(syncState);

      // Save sync report for error tracking
      const syncReport: SyncReport = {
        timestamp: Date.now(),
        duration: syncState.syncDuration ?? 0,
        type: 'delta',
        success: syncErrors.length === 0,
        stats: {
          filesProcessed: parsedFiles.length,
          filesFailed: syncErrors.length,
          symbolsCreated: stats.symbolCount,
          vectorsCreated: vectorCount
        },
        errors: syncErrors,
        systemInfo: {
          nodeVersion: process.version,
          platform: process.platform,
          cvVersion: '0.4.24'
        }
      };
      await this.saveSyncReport(syncReport);

      console.log(`Delta sync completed in ${syncState.syncDuration}s`);
      console.log(`- Added: ${delta.added.length}`);
      console.log(`- Modified: ${delta.modified.length}`);
      console.log(`- Deleted: ${delta.deleted.length}`);
      if (syncErrors.length > 0) {
        console.log(`- Parse errors: ${syncErrors.length} (see .cv/sync-report.json for details)`);
      }

      return syncState;

    } catch (error: any) {
      console.error('Delta sync failed:', error);
      throw error;
    }
  }

  /**
   * Smart delta sync for documents
   */
  async deltaSyncDocuments(options: SyncOptions = {}): Promise<DocumentSyncResult & { delta: SyncDelta }> {
    const errors: string[] = [];
    const includeDocs = options.includeDocs !== false;

    if (!includeDocs) {
      return {
        documentCount: 0,
        sectionCount: 0,
        vectorCount: 0,
        errors: [],
        delta: { added: [], modified: [], deleted: [], unchanged: [] }
      };
    }

    console.log('Starting delta sync for documents...');

    try {
      // Get all tracked files
      const allFiles = await this.git.getTrackedFiles();

      // Filter to markdown files
      const docPatterns = options.docPatterns || ['**/*.md', '**/*.markdown'];
      const excludePatterns = options.docExcludePatterns || [
        'node_modules/**',
        '.git/**',
        'vendor/**',
        '**/CHANGELOG.md'
      ];

      const docFiles = allFiles.filter(f => this.matchesDocPattern(f, docPatterns, excludePatterns));

      // Read current file contents (using safe file reading with size limits)
      const fileContents = new Map<string, string>();
      for (const file of docFiles) {
        const absolutePath = path.join(this.repoRoot, file);
        const result = await safeReadFile(absolutePath);
        if ('content' in result) {
          fileContents.set(file, result.content);
        } else {
          logSkippedFile(file, result.error);
        }
      }

      // Compute delta
      const delta = await this.delta.computeDelta(fileContents, 'document');

      console.log(`Document delta: ${delta.added.length} added, ${delta.modified.length} modified, ${delta.deleted.length} deleted`);

      // If nothing changed, return early
      if (delta.added.length === 0 && delta.modified.length === 0 && delta.deleted.length === 0) {
        console.log('No document changes detected');
        return {
          documentCount: 0,
          sectionCount: 0,
          vectorCount: 0,
          errors: [],
          delta
        };
      }

      // Process changed documents
      const changedFiles = [...delta.added, ...delta.modified];
      const parsedDocs: ParsedDocument[] = [];
      let totalSections = 0;

      for (const file of changedFiles) {
        try {
          const content = fileContents.get(file)!;
          const parsed = await this.parser.parseDocument(file, content);
          parsedDocs.push(parsed);
          totalSections += parsed.sections.length;
        } catch (error: any) {
          errors.push(`Failed to parse ${file}: ${error.message}`);
        }
      }

      // Update graph with changed documents
      if (parsedDocs.length > 0) {
        await this.updateGraphWithDocuments(parsedDocs);
      }

      // Handle deleted documents
      if (delta.deleted.length > 0) {
        console.log(`Removing ${delta.deleted.length} deleted documents from graph...`);
        for (const file of delta.deleted) {
          try {
            await this.graph.deleteDocumentNode(file);
          } catch (error: any) {
            errors.push(`Failed to delete document ${file}: ${error.message}`);
          }
        }
        await this.delta.markDeleted(delta.deleted);
      }

      // Generate embeddings for changed documents
      let vectorCount = 0;
      if (this.vector && this.vector.isConnected() && parsedDocs.length > 0) {
        vectorCount = await this.updateDocumentEmbeddings(parsedDocs);
      }

      // Update delta tracking
      const syncedContents = new Map<string, string>();
      for (const file of changedFiles) {
        if (fileContents.has(file)) {
          syncedContents.set(file, fileContents.get(file)!);
        }
      }
      await this.delta.markSynced(syncedContents, 'document');
      await this.delta.close();

      console.log(`✓ Delta synced ${parsedDocs.length} documents`);

      return {
        documentCount: parsedDocs.length,
        sectionCount: totalSections,
        vectorCount,
        errors,
        delta
      };

    } catch (error: any) {
      console.error('Document delta sync failed:', error.message);
      errors.push(`Document delta sync failed: ${error.message}`);
      return {
        documentCount: 0,
        sectionCount: 0,
        vectorCount: 0,
        errors,
        delta: { added: [], modified: [], deleted: [], unchanged: [] }
      };
    }
  }

  /**
   * Get delta sync statistics
   */
  async getDeltaStats(): Promise<{
    totalFiles: number;
    codeFiles: number;
    documentFiles: number;
    lastSyncedAt: string | null;
    lastCommit: string | null;
  }> {
    return this.delta.getStats();
  }

  /**
   * Reset delta tracking (forces full sync on next run)
   */
  async resetDelta(): Promise<void> {
    await this.delta.reset();
  }

  /**
   * Get chunked sync progress (for --continue flag)
   */
  async getChunkedProgress() {
    return this.delta.getChunkedProgress();
  }

  /**
   * Chunked full sync - processes files in chunks for large repositories
   *
   * Use this for repositories with thousands of files that would otherwise
   * overwhelm memory or take too long in a single run.
   *
   * @param options.maxFiles - Maximum files to process per run
   * @param options.continueFromLast - Continue from previous chunked sync
   * @param options.batchSize - Batch size for embedding generation
   */
  async chunkedFullSync(options: SyncOptions = {}): Promise<{
    syncState: SyncState;
    progress: {
      processed: number;
      total: number;
      complete: boolean;
      remaining: number;
    };
  }> {
    const startTime = Date.now();
    const syncErrors: SyncError[] = [];
    const maxFiles = options.maxFiles || 500;
    const batchSize = options.batchSize || 50;

    console.log(`Starting chunked sync (max ${maxFiles} files per run)...`);

    try {
      // Get all tracked files
      const allFiles = await this.git.getTrackedFiles();
      const defaultPatterns = this.getDefaultExcludePatterns();
      const customPatterns = options.excludePatterns || [];
      const excludePatterns = [...new Set([...defaultPatterns, ...customPatterns])];
      const includeLanguages = options.includeLanguages || this.getDefaultIncludeLanguages();

      const filesToSync = allFiles.filter(f =>
        shouldSyncFile(f, excludePatterns, includeLanguages)
      );

      // Check for existing progress
      let progress = await this.delta.getChunkedProgress();
      let startIndex = 0;

      if (options.continueFromLast && progress && !progress.complete) {
        // Continue from previous run
        startIndex = progress.lastProcessedIndex + 1;
        console.log(`Continuing from file ${startIndex + 1}/${progress.totalFiles}`);

        // Verify file list hasn't changed (simple length check)
        if (progress.fileList.length !== filesToSync.length) {
          console.warn('File list changed since last run, starting fresh');
          await this.delta.clearChunkedProgress();
          progress = await this.delta.startChunkedSync(filesToSync);
          startIndex = 0;
        }
      } else {
        // Start fresh
        if (progress && !progress.complete) {
          console.log('Starting fresh chunked sync (use --continue to resume previous)');
        }
        await this.delta.clearChunkedProgress();
        progress = await this.delta.startChunkedSync(filesToSync);
      }

      // Calculate chunk to process
      const endIndex = Math.min(startIndex + maxFiles, filesToSync.length);
      const chunkFiles = filesToSync.slice(startIndex, endIndex);

      console.log(`Processing files ${startIndex + 1}-${endIndex} of ${filesToSync.length}`);

      // Parse files in this chunk
      const parsedFiles: ParsedFile[] = [];
      const CONCURRENCY = 10;

      for (let i = 0; i < chunkFiles.length; i += CONCURRENCY) {
        const batch = chunkFiles.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.allSettled(
          batch.map(file => this.parseFile(file))
        );

        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          const file = batch[j];
          if (result.status === 'fulfilled') {
            parsedFiles.push(result.value);
          } else {
            syncErrors.push({
              file,
              error: result.reason?.message || 'Unknown error',
              phase: 'parse',
              timestamp: Date.now()
            });
          }
        }

        // Update progress periodically
        const currentIndex = startIndex + i + batch.length - 1;
        await this.delta.updateChunkedProgress(currentIndex);

        const progressPct = Math.round(((i + batch.length) / chunkFiles.length) * 100);
        if (progressPct % 20 === 0) {
          console.log(`Progress: ${progressPct}% (${i + batch.length}/${chunkFiles.length} in this chunk)`);
        }
      }

      console.log(`Parsed ${parsedFiles.length} files in this chunk`);

      // Update graph
      if (parsedFiles.length > 0) {
        console.log('Updating knowledge graph...');
        await this.updateGraph(parsedFiles);
      }

      // Check if complete
      const isComplete = endIndex >= filesToSync.length;
      if (isComplete) {
        await this.delta.completeChunkedSync();
        console.log('Chunked sync complete!');

        // Sync commit history only when complete
        if (options.syncCommits !== false) {
          console.log('Syncing commit history...');
          const commitDepth = options.commitDepth || 50;
          await this.syncCommitHistory(commitDepth);
        }
      }

      // Update final progress
      await this.delta.updateChunkedProgress(endIndex - 1);

      // Get statistics
      const stats = await this.graph.getStats();

      let vectorCount = 0;
      if (this.vector && this.vector.isConnected()) {
        try {
          const info = await this.vector.getCollectionInfo('code_chunks');
          vectorCount = info.points_count || 0;
        } catch {
          vectorCount = 0;
        }
      }

      // Track files for delta
      const fileContents = new Map<string, string>();
      for (const file of chunkFiles) {
        const absolutePath = path.join(this.repoRoot, file);
        const result = await safeReadFile(absolutePath);
        if ('content' in result) {
          fileContents.set(file, result.content);
        }
      }
      await this.delta.markSynced(fileContents, 'code');
      await this.delta.setLastCommit(await this.git.getLastCommitSha());
      await this.delta.close();

      const syncState: SyncState = {
        lastFullSync: Date.now(),
        lastCommitSynced: await this.git.getLastCommitSha(),
        fileCount: stats.fileCount,
        symbolCount: stats.symbolCount,
        nodeCount: stats.fileCount + stats.symbolCount,
        edgeCount: stats.relationshipCount,
        vectorCount,
        languages: this.countLanguages(parsedFiles),
        syncDuration: (Date.now() - startTime) / 1000,
        errors: syncErrors.map(e => `${e.file}: ${e.error}`)
      };

      await this.saveSyncState(syncState);

      console.log(`\nChunk processed in ${syncState.syncDuration?.toFixed(1)}s`);

      return {
        syncState,
        progress: {
          processed: endIndex,
          total: filesToSync.length,
          complete: isComplete,
          remaining: filesToSync.length - endIndex
        }
      };

    } catch (error: any) {
      console.error('Chunked sync failed:', error);
      throw error;
    }
  }

  /**
   * Parse a single file (with safe file reading)
   */
  private async parseFile(filePath: string): Promise<ParsedFile> {
    const absolutePath = path.join(this.repoRoot, filePath);
    const result = await safeReadFile(absolutePath);

    if ('error' in result) {
      throw new Error(result.error);
    }

    const language = detectLanguage(filePath);
    const parsed = await this.parser.parseFile(filePath, result.content, language);
    // Ensure absolutePath is correctly set (parser may not know the repo root)
    parsed.absolutePath = absolutePath;
    return parsed;
  }

  /**
   * Update graph with parsed files
   */
  private async updateGraph(parsedFiles: ParsedFile[]): Promise<void> {
    console.log('Creating file nodes...');

    // Get git hashes for all files in batch (more efficient than per-file)
    const filePaths = parsedFiles.map(f => f.path);
    const gitHashes = await this.git.getFileHashes(filePaths);

    // Step 1: Create/update file nodes
    for (const file of parsedFiles) {
      const stats = await fs.stat(file.absolutePath);
      const gitHash = gitHashes.get(file.path) || '';

      const fileNode: FileNode = {
        path: file.path,
        absolutePath: file.absolutePath,
        language: file.language,
        lastModified: stats.mtimeMs,
        size: stats.size,
        gitHash,
        linesOfCode: file.content.split('\n').length,
        complexity: file.symbols.reduce((sum, s) => sum + s.complexity, 0),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await this.graph.upsertFileNode(fileNode);
    }

    console.log('Creating symbol nodes...');

    // Step 2: Create/update symbol nodes and DEFINES edges
    for (const file of parsedFiles) {
      for (const symbol of file.symbols) {
        await this.graph.upsertSymbolNode(symbol);

        // Create DEFINES relationship
        await this.graph.createDefinesEdge(file.path, symbol.qualifiedName, {
          line: symbol.startLine
        });
      }
    }

    console.log('Creating import relationships...');

    // Step 3: Create IMPORTS edges
    for (const file of parsedFiles) {
      for (const imp of file.imports) {
        // Only create edges for local imports (not npm packages)
        if (!imp.isExternal) {
          const targetPath = this.resolveImportPath(file.path, imp.source);

          // Check if target file exists in our parsed files
          const targetExists = parsedFiles.some(f => f.path === targetPath);

          if (targetExists) {
            try {
              await this.graph.createImportsEdge(file.path, targetPath, {
                line: imp.line,
                importedSymbols: imp.importedSymbols,
                alias: undefined
              });
            } catch (error) {
              // Target file might not be in graph yet, skip
            }
          }
        }
      }
    }

    console.log('Creating call relationships...');

    // Build symbol index for faster call resolution
    const symbolIndex = new Map<string, string>(); // name -> qualifiedName
    const exportedSymbols = new Map<string, string>(); // name -> qualifiedName (exported only)

    for (const file of parsedFiles) {
      for (const symbol of file.symbols) {
        symbolIndex.set(`${file.path}:${symbol.name}`, symbol.qualifiedName);

        // Track exported symbols for cross-file resolution
        const isExported = file.exports.some(exp => exp.name === symbol.name);
        if (isExported) {
          exportedSymbols.set(symbol.name, symbol.qualifiedName);
        }
      }
    }

    // Step 4: Create CALLS edges
    for (const file of parsedFiles) {
      for (const symbol of file.symbols) {
        if (!symbol.calls || symbol.calls.length === 0) continue;

        // Process each call
        for (const call of symbol.calls) {
          try {
            // Try to resolve the callee to a qualified name
            const calleeQualifiedName = this.resolveCallTargetFast(
              call.callee,
              file,
              parsedFiles,
              symbolIndex,
              exportedSymbols
            );

            if (calleeQualifiedName) {
              // Create CALLS edge
              await this.graph.createCallsEdge(symbol.qualifiedName, calleeQualifiedName, {
                line: call.line,
                callCount: 1, // Could be improved to count multiple calls
                isConditional: call.isConditional
              });
            }
          } catch (error) {
            // Target symbol might not exist, skip
          }
        }
      }
    }

    console.log('Graph update complete');

    // Step 5: Generate and store vector embeddings (if VectorManager available)
    // Also links graph symbols to their vector chunk IDs
    if (this.vector && this.vector.isConnected()) {
      console.log('Generating vector embeddings...');
      const { vectorCount, symbolToChunkMap } = await this.updateVectorEmbeddings(parsedFiles);
      if (process.env.CV_DEBUG) {
        console.log(`  Embedded ${vectorCount} chunks, linked ${symbolToChunkMap.size} symbols`);
      }
    }
  }

  /**
   * Fast call target resolution using pre-built symbol index
   */
  private resolveCallTargetFast(
    callee: string,
    currentFile: ParsedFile,
    allFiles: ParsedFile[],
    symbolIndex: Map<string, string>,
    exportedSymbols: Map<string, string>
  ): string | null {
    // Strategy 1: Look for symbol in the same file (O(1) with index)
    const localKey = `${currentFile.path}:${callee}`;
    if (symbolIndex.has(localKey)) {
      return symbolIndex.get(localKey)!;
    }

    // Strategy 2: Look for symbol in imported files (O(imports) with index)
    for (const imp of currentFile.imports) {
      if (imp.isExternal) continue;

      const targetPath = this.resolveImportPath(currentFile.path, imp.source);

      // Check if the imported symbols include this callee
      if (imp.importedSymbols.includes(callee) || imp.importType === 'namespace' || imp.importType === 'default') {
        const importedKey = `${targetPath}:${callee}`;
        if (symbolIndex.has(importedKey)) {
          return symbolIndex.get(importedKey)!;
        }
      }
    }

    // Strategy 3: Look up in exported symbols index (O(1))
    if (exportedSymbols.has(callee)) {
      return exportedSymbols.get(callee)!;
    }

    // Could not resolve
    return null;
  }

  /**
   * Generate and store vector embeddings for code chunks
   * Also builds symbol→chunk mapping and links graph nodes to vectors
   */
  private async updateVectorEmbeddings(parsedFiles: ParsedFile[]): Promise<{ vectorCount: number; symbolToChunkMap: Map<string, string[]> }> {
    const symbolToChunkMap = new Map<string, string[]>();

    if (!this.vector) return { vectorCount: 0, symbolToChunkMap };

    try {
      // Collect all code chunks from all files
      const allChunks: CodeChunk[] = [];
      for (const file of parsedFiles) {
        if (file.chunks && file.chunks.length > 0) {
          allChunks.push(...file.chunks);
        }
      }

      if (allChunks.length === 0) {
        console.log('No code chunks to embed');
        return { vectorCount: 0, symbolToChunkMap };
      }

      console.log(`Found ${allChunks.length} code chunks to embed`);

      // Build symbol→chunk mapping as we process chunks
      // This links graph symbol nodes to their vector chunk IDs
      for (const chunk of allChunks) {
        if (chunk.symbolName) {
          // Find the symbol in parsed files to get qualified name
          const file = parsedFiles.find(f => f.path === chunk.file);
          if (file) {
            const symbol = file.symbols.find(s =>
              s.name === chunk.symbolName &&
              s.startLine <= chunk.startLine &&
              s.endLine >= chunk.endLine
            );
            if (symbol) {
              const existing = symbolToChunkMap.get(symbol.qualifiedName) || [];
              existing.push(chunk.id);
              symbolToChunkMap.set(symbol.qualifiedName, existing);
            }
          }
        }
      }

      // Prepare chunks for embedding (add context)
      const textsToEmbed = allChunks.map(chunk =>
        this.vector!.prepareCodeForEmbedding(chunk)
      );

      // Generate embeddings in batch
      console.log('Generating embeddings...');
      const embeddings = await this.vector.embedBatch(textsToEmbed);

      // Prepare batch upsert items
      const items = allChunks.map((chunk, idx) => {
        // Find the file this chunk belongs to
        const file = parsedFiles.find(f => f.path === chunk.file);
        const imports = file ? file.imports.map(i => i.source) : [];

        const payload: CodeChunkPayload = {
          id: chunk.id,
          file: chunk.file,
          language: chunk.language,
          symbolName: chunk.symbolName,
          symbolKind: chunk.symbolKind,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text,
          summary: chunk.summary,
          docstring: chunk.docstring,
          imports,
          complexity: chunk.complexity,
          lastModified: Date.now()
        };

        return {
          id: chunk.id,
          vector: embeddings[idx],
          payload
        };
      });

      // Upsert to Qdrant in batches
      console.log('Storing embeddings in Qdrant...');
      await this.vector.upsertBatch('code_chunks', items);

      // Link graph symbols to vector IDs
      if (symbolToChunkMap.size > 0) {
        console.log(`Linking ${symbolToChunkMap.size} symbols to vector chunks...`);
        const linkResult = await this.graph.batchUpdateSymbolVectorIds(symbolToChunkMap);
        if (linkResult.errors.length > 0) {
          console.warn(`  ${linkResult.errors.length} link errors (symbols may not exist in graph yet)`);
        }
        console.log(`  ✓ Linked ${linkResult.updated} symbols to vectors`);
      }

      console.log(`✓ Stored ${allChunks.length} embeddings`);
      return { vectorCount: allChunks.length, symbolToChunkMap };

    } catch (error: any) {
      console.warn('Embeddings skipped: ' + error.message);
      return { vectorCount: 0, symbolToChunkMap };
    }
  }

  // ========== Document Sync Methods ==========

  /**
   * Sync markdown documentation into the knowledge graph
   */
  async syncDocuments(options: SyncOptions = {}): Promise<DocumentSyncResult> {
    const errors: string[] = [];
    const includeDocs = options.includeDocs !== false; // Default to true

    if (!includeDocs) {
      return { documentCount: 0, sectionCount: 0, vectorCount: 0, errors: [] };
    }

    console.log('Syncing documentation...');

    try {
      // Get all tracked files
      const allFiles = await this.git.getTrackedFiles();

      // Filter to markdown files
      const docPatterns = options.docPatterns || ['**/*.md', '**/*.markdown'];
      const excludePatterns = options.docExcludePatterns || [
        'node_modules/**',
        '.git/**',
        'vendor/**',
        '**/CHANGELOG.md' // Often auto-generated
      ];

      const docFiles = allFiles.filter(f => this.matchesDocPattern(f, docPatterns, excludePatterns));

      console.log(`Found ${docFiles.length} documentation files`);

      if (docFiles.length === 0) {
        return { documentCount: 0, sectionCount: 0, vectorCount: 0, errors: [] };
      }

      // Parse all documents
      const parsedDocs: ParsedDocument[] = [];
      let totalSections = 0;

      for (const file of docFiles) {
        try {
          const absolutePath = path.join(this.repoRoot, file);
          const result = await safeReadFile(absolutePath);

          if ('error' in result) {
            logSkippedFile(file, result.error);
            continue;
          }

          const parsed = await this.parser.parseDocument(file, result.content);
          parsedDocs.push(parsed);
          totalSections += parsed.sections.length;
        } catch (error: any) {
          errors.push(`Failed to parse ${file}: ${error.message}`);
          console.error(`Error parsing document ${file}:`, error.message);
        }
      }

      console.log(`Parsed ${parsedDocs.length} documents with ${totalSections} sections`);

      // Update graph with documents
      await this.updateGraphWithDocuments(parsedDocs);

      // Generate and store document embeddings
      let vectorCount = 0;
      if (this.vector && this.vector.isConnected()) {
        vectorCount = await this.updateDocumentEmbeddings(parsedDocs);
      }

      console.log(`✓ Synced ${parsedDocs.length} documents`);

      return {
        documentCount: parsedDocs.length,
        sectionCount: totalSections,
        vectorCount,
        errors
      };
    } catch (error: any) {
      console.error('Document sync failed:', error.message);
      errors.push(`Document sync failed: ${error.message}`);
      return { documentCount: 0, sectionCount: 0, vectorCount: 0, errors };
    }
  }

  /**
   * Check if a file matches document patterns
   */
  private matchesDocPattern(
    filePath: string,
    includePatterns: string[],
    excludePatterns: string[]
  ): boolean {
    // Check exclusions first
    for (const pattern of excludePatterns) {
      if (minimatch(filePath, pattern)) {
        return false;
      }
    }

    // Check inclusions
    for (const pattern of includePatterns) {
      if (minimatch(filePath, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Update graph with parsed documents
   */
  private async updateGraphWithDocuments(parsedDocs: ParsedDocument[]): Promise<void> {
    console.log('Creating document nodes...');

    // Get git hashes for all docs
    const docPaths = parsedDocs.map(d => d.path);
    const gitHashes = await this.git.getFileHashes(docPaths);

    // Create document nodes
    for (const doc of parsedDocs) {
      const absolutePath = path.join(this.repoRoot, doc.path);
      const stats = await fs.stat(absolutePath);
      const gitHash = gitHashes.get(doc.path) || '';

      // Extract title from first H1 or filename
      const firstH1 = doc.headings.find(h => h.level === 1);
      const title = firstH1?.text || path.basename(doc.path, path.extname(doc.path));

      // Determine status from frontmatter or default to 'active'
      const status = doc.frontmatter.status || 'active';

      // Count words in content
      const wordCount = doc.content.split(/\s+/).filter(w => w.length > 0).length;

      const docNode: DocumentNode = {
        path: doc.path,
        absolutePath,
        title,
        type: doc.frontmatter.type || doc.inferredType,
        status,
        frontmatter: doc.frontmatter,
        headings: doc.headings,
        links: doc.links,
        sections: doc.sections,
        wordCount,
        gitHash,
        lastModified: stats.mtimeMs,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await this.graph.upsertDocumentNode(docNode);
    }

    console.log('Creating document relationships...');

    // Create relationships from links and frontmatter
    for (const doc of parsedDocs) {
      // Process internal links
      for (const link of doc.links) {
        if (link.isInternal) {
          // Resolve relative path
          const targetPath = this.resolveDocLink(doc.path, link.target);

          if (link.isCodeRef) {
            // Document describes code
            await this.graph.createDescribesEdge(doc.path, targetPath);
          } else {
            // Document references another document
            await this.graph.createReferencesDocEdge(doc.path, targetPath);
          }
        }
      }

      // Process relates_to from frontmatter
      if (doc.frontmatter.relates_to) {
        for (const ref of doc.frontmatter.relates_to) {
          // Could be code path or doc path
          const targetPath = this.resolveDocLink(doc.path, ref);
          await this.graph.createDescribesEdge(doc.path, targetPath);
        }
      }
    }

    console.log('Document graph update complete');
  }

  /**
   * Resolve a document link to an absolute path
   */
  private resolveDocLink(fromDoc: string, target: string): string {
    // Handle anchor links
    if (target.startsWith('#')) {
      return fromDoc + target;
    }

    // Handle relative paths
    if (target.startsWith('.')) {
      const dir = path.dirname(fromDoc);
      return path.normalize(path.join(dir, target));
    }

    // Handle absolute paths from root
    if (target.startsWith('/')) {
      return target.slice(1);
    }

    // Assume relative to current file's directory
    const dir = path.dirname(fromDoc);
    return path.normalize(path.join(dir, target));
  }

  /**
   * Generate and store document embeddings
   */
  private async updateDocumentEmbeddings(parsedDocs: ParsedDocument[]): Promise<number> {
    if (!this.vector) return 0;

    try {
      // Get the markdown parser to chunk documents
      const markdownParser = this.parser.getMarkdownParser();

      // Collect all document chunks
      const allChunks: DocumentChunk[] = [];

      for (const doc of parsedDocs) {
        const chunks = markdownParser.chunkDocument(doc, doc.path);
        allChunks.push(...chunks);
      }

      if (allChunks.length === 0) {
        console.log('No document chunks to embed');
        return 0;
      }

      console.log(`Found ${allChunks.length} document chunks to embed`);

      // Ensure document_chunks collection exists
      try {
        await this.vector.ensureCollection('document_chunks', 1536);  // Default dimension for embeddings
      } catch (error) {
        // Collection might already exist
      }

      // Prepare chunks for embedding
      const textsToEmbed = allChunks.map(chunk =>
        this.prepareDocumentForEmbedding(chunk)
      );

      // Generate embeddings
      console.log('Generating document embeddings...');
      const embeddings = await this.vector.embedBatch(textsToEmbed);

      // Prepare batch upsert items
      const items = allChunks.map((chunk, idx) => {
        // Find the doc this chunk belongs to
        const doc = parsedDocs.find(d => d.path === chunk.file);

        const payload: DocumentChunkPayload = {
          id: chunk.id,
          file: chunk.file,
          language: 'markdown',
          documentType: chunk.documentType,
          heading: chunk.heading,
          headingLevel: chunk.headingLevel,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text,
          tags: chunk.tags,
          status: doc?.frontmatter.status || 'active',
          priority: doc?.frontmatter.priority,
          lastModified: Date.now()
        };

        return {
          id: chunk.id,
          vector: embeddings[idx],
          payload
        };
      });

      // Upsert to Qdrant
      console.log('Storing document embeddings in Qdrant...');
      await this.vector.upsertBatch('document_chunks', items);

      console.log(`✓ Stored ${allChunks.length} document embeddings`);
      return allChunks.length;

    } catch (error: any) {
      console.error('Failed to generate/store document embeddings:', error.message);
      return 0;
    }
  }

  /**
   * Prepare document chunk for embedding
   */
  private prepareDocumentForEmbedding(chunk: DocumentChunk): string {
    const parts: string[] = [];
    parts.push(`// Document Type: ${chunk.documentType}`);
    parts.push(`// File: ${chunk.file}`);
    if (chunk.heading) {
      parts.push(`// Section: ${chunk.heading}`);
    }
    if (chunk.tags.length > 0) {
      parts.push(`// Tags: ${chunk.tags.join(', ')}`);
    }
    parts.push('');
    parts.push(chunk.text);
    return parts.join('\n');
  }

  /**
   * Generate hierarchical summaries for parsed files
   * Creates multi-level summaries (symbol, file, directory) for traversal-aware context
   */
  private async generateHierarchicalSummaries(
    parsedFiles: ParsedFile[],
    options?: HierarchicalSummaryOptions
  ): Promise<void> {
    if (!this.vector) {
      console.log('Vector manager not available, skipping summary generation');
      return;
    }

    try {
      // Create the summary service
      const summaryService = createHierarchicalSummaryService(
        this.vector,
        this.graph,
        { useFallback: true } // Use fallback extraction instead of LLM by default
      );

      // Generate all summaries bottom-up
      const result = await summaryService.generateAllSummaries(parsedFiles, {
        maxSymbolsPerFile: options?.maxSymbolsPerFile ?? 50,
        maxFilesPerDirectory: options?.maxFilesPerDirectory ?? 100,
        skipUnchanged: options?.skipUnchanged ?? true
      });

      console.log(`✓ Generated ${result.count} hierarchical summaries`);
      console.log(`  - Symbols: ${result.byLevel[1]}`);
      console.log(`  - Files: ${result.byLevel[2]}`);
      console.log(`  - Directories: ${result.byLevel[3]}`);

      if (result.errors.length > 0) {
        console.warn(`  - Errors: ${result.errors.length}`);
        if (process.env.CV_DEBUG) {
          for (const err of result.errors.slice(0, 5)) {
            console.warn(`    ${err}`);
          }
        }
      }
    } catch (error: any) {
      console.error('Failed to generate hierarchical summaries:', error.message);
    }
  }

  /**
   * Resolve import path to actual file path
   */
  private resolveImportPath(fromFile: string, importSource: string): string {
    if (importSource.startsWith('.')) {
      // Relative import
      const dir = path.dirname(fromFile);
      let resolved = path.join(dir, importSource);

      // Try common extensions
      const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
      for (const ext of extensions) {
        const candidate = resolved + ext;
        // We'll assume it exists - actual file checking happens in updateGraph
        return path.normalize(candidate);
      }

      return path.normalize(resolved + '.ts');
    } else if (importSource.startsWith('/')) {
      // Absolute import from root
      return importSource.slice(1);
    } else {
      // Module import (npm package) - skip
      return importSource;
    }
  }

  /**
   * Load sync state from disk
   */
  async loadSyncState(): Promise<SyncState | null> {
    try {
      const cvDir = getCVDir(this.repoRoot);
      const statePath = path.join(cvDir, 'sync_state.json');
      const data = await fs.readFile(statePath, 'utf-8');
      return JSON.parse(data) as SyncState;
    } catch (error) {
      return null;
    }
  }

  /**
   * Save sync state to disk
   */
  async saveSyncState(state: SyncState): Promise<void> {
    const cvDir = getCVDir(this.repoRoot);
    const statePath = path.join(cvDir, 'sync_state.json');
    await fs.writeFile(statePath, JSON.stringify(state, null, 2));
  }

  /**
   * Count languages in parsed files
   */
  private countLanguages(parsedFiles: ParsedFile[]): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const file of parsedFiles) {
      counts[file.language] = (counts[file.language] || 0) + 1;
    }

    return counts;
  }

  /**
   * Get default exclude patterns
   */
  private getDefaultExcludePatterns(): string[] {
    return [
      // JavaScript/Node
      'node_modules/**',
      '.next/**',
      '.nuxt/**',
      '*.min.js',
      '*.bundle.js',

      // Python virtualenvs
      'venv/**',
      '.venv/**',
      'env/**',
      '.env/**',
      '**/lib/python*/**',        // Matches admin/lib/python3.10/...
      '**/site-packages/**',
      '__pycache__/**',
      '*.pyc',
      '.pytest_cache/**',
      '*.egg-info/**',

      // Build outputs
      'dist/**',
      'build/**',
      'out/**',
      'target/**',
      '.build/**',

      // Test files
      '*.test.ts',
      '*.test.js',
      '*.spec.ts',
      '*.spec.js',
      'coverage/**',

      // Version control & cache
      '.git/**',
      '.cache/**',
      '.tmp/**',
      'tmp/**',

      // IDE/Editor
      '.idea/**',
      '.vscode/**',

      // Vendor directories
      'vendor/**',
      'third_party/**',
    ];
  }

  /**
   * Get default include languages
   */
  private getDefaultIncludeLanguages(): string[] {
    return ['typescript', 'javascript', 'python', 'go', 'rust'];
  }

  /**
   * Sync commit history to the knowledge graph
   * Creates Commit nodes and MODIFIES edges linking commits to files
   */
  async syncCommitHistory(depth: number = 50): Promise<{ commitCount: number; modifiesCount: number }> {
    let commitCount = 0;
    let modifiesCount = 0;

    try {
      // Get recent commits
      const commits = await this.git.getRecentCommits(depth);
      console.log(`Found ${commits.length} commits to sync`);

      // Get current branch
      let currentBranch = 'unknown';
      try {
        currentBranch = await this.git.getCurrentBranch();
      } catch {
        // Fallback to 'unknown' if git fails
      }

      // Process each commit
      for (const commit of commits) {
        try {
          // Get detailed commit info with files changed
          const detailedCommit = await this.git.getCommit(commit.sha);

          // Get diff stats for this commit (insertions/deletions per file)
          let diffStats: Map<string, { insertions: number; deletions: number }> = new Map();
          try {
            const diffs = await this.git.getDiff(`${commit.sha}^`, commit.sha);
            for (const diff of diffs) {
              diffStats.set(diff.file, {
                insertions: diff.insertions,
                deletions: diff.deletions
              });
            }
          } catch {
            // First commit has no parent, skip diff stats
          }

          // Calculate total insertions/deletions
          let totalInsertions = 0;
          let totalDeletions = 0;
          for (const stats of diffStats.values()) {
            totalInsertions += stats.insertions;
            totalDeletions += stats.deletions;
          }

          // Create CommitNode
          const commitNode: CommitNode = {
            sha: commit.sha,
            message: commit.message,
            author: commit.author,
            authorEmail: commit.authorEmail,
            committer: commit.author, // simple-git doesn't distinguish
            timestamp: commit.date,
            branch: currentBranch,
            filesChanged: detailedCommit.files.length,
            insertions: totalInsertions,
            deletions: totalDeletions,
            createdAt: Date.now()
          };

          await this.graph.upsertCommitNode(commitNode);
          commitCount++;

          // Create MODIFIES edges for each file changed
          for (const filePath of detailedCommit.files) {
            try {
              const stats = diffStats.get(filePath) || { insertions: 0, deletions: 0 };

              // Determine change type
              let changeType: ChangeType = 'modified';
              // Note: We can't easily determine added/deleted from simple-git here
              // The file list only contains paths, not change types
              // For now, we'll mark everything as 'modified'

              await this.graph.createModifiesEdge(commit.sha, filePath, {
                changeType,
                insertions: stats.insertions,
                deletions: stats.deletions
              });
              modifiesCount++;
            } catch {
              // File might not exist in graph (e.g., excluded file types)
              // Skip silently
            }
          }
        } catch (error: any) {
          // Log but continue with other commits
          console.warn(`Failed to sync commit ${commit.sha.slice(0, 7)}: ${error.message}`);
        }
      }

      console.log(`✓ Synced ${commitCount} commits with ${modifiesCount} file modifications`);
      return { commitCount, modifiesCount };

    } catch (error: any) {
      console.error('Commit history sync failed:', error.message);
      return { commitCount, modifiesCount };
    }
  }
}

/**
 * Create a sync engine instance
 */
export function createSyncEngine(
  repoRoot: string,
  git: GitManager,
  parser: CodeParser,
  graph: GraphManager,
  vector?: VectorManager
): SyncEngine {
  return new SyncEngine(repoRoot, git, parser, graph, vector);
}

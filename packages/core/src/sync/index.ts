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
  ParsedDocument
} from '@cv-git/shared';
import { shouldSyncFile, detectLanguage, getCVDir } from '@cv-git/shared';
import { minimatch } from 'minimatch';
import { GitManager } from '../git/index.js';
import { CodeParser } from '../parser/index.js';
import { GraphManager } from '../graph/index.js';
import { VectorManager } from '../vector/index.js';
import { DeltaSyncManager, createDeltaSyncManager, SyncDelta } from './delta.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Re-export delta types
export * from './delta.js';

export interface SyncOptions {
  incremental?: boolean;
  files?: string[];
  excludePatterns?: string[];
  includeLanguages?: string[];
  // Document sync options
  includeDocs?: boolean;          // Include markdown files (default: true)
  docPatterns?: string[];         // Patterns for doc files (default: ['**/*.md'])
  docExcludePatterns?: string[];  // Exclude patterns for docs
}

export interface DocumentSyncResult {
  documentCount: number;
  sectionCount: number;
  vectorCount: number;
  errors: string[];
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
   * Perform full repository sync
   */
  async fullSync(options: SyncOptions = {}): Promise<SyncState> {
    const startTime = Date.now();
    const errors: string[] = [];

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
            errors.push(`Failed to parse ${file}: ${result.reason?.message || 'Unknown error'}`);
            console.error(`Error parsing ${file}:`, result.reason?.message);
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

      // 5. Collect statistics
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
        errors
      };

      // 6. Save sync state
      await this.saveSyncState(syncState);

      console.log(`Sync completed in ${syncState.syncDuration}s`);
      console.log(`- Files: ${syncState.fileCount}`);
      console.log(`- Symbols: ${syncState.symbolCount}`);
      console.log(`- Relationships: ${syncState.edgeCount}`);
      if (vectorCount > 0) {
        console.log(`- Vectors: ${vectorCount}`);
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
    const errors: string[] = [];

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

        // Read content and mark as synced
        const fileContents = new Map<string, string>();
        for (const file of filesToTrack) {
          try {
            const absolutePath = path.join(this.repoRoot, file);
            const content = await fs.readFile(absolutePath, 'utf-8');
            fileContents.set(file, content);
          } catch (error) {
            // Skip files that can't be read
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

      // Read current file contents
      const fileContents = new Map<string, string>();
      for (const file of currentFiles) {
        try {
          const absolutePath = path.join(this.repoRoot, file);
          const content = await fs.readFile(absolutePath, 'utf-8');
          fileContents.set(file, content);
        } catch (error) {
          // Skip files that can't be read
        }
      }

      // Compute delta
      const delta = await this.delta.computeDelta(fileContents, 'code');

      console.log(`Delta: ${delta.added.length} added, ${delta.modified.length} modified, ${delta.deleted.length} deleted, ${delta.unchanged.length} unchanged`);

      // If nothing changed, return early
      if (delta.added.length === 0 && delta.modified.length === 0 && delta.deleted.length === 0) {
        console.log('No changes detected, skipping sync');

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
          errors.push(`Failed to parse ${file}: ${error.message}`);
          console.error(`Error parsing ${file}:`, error.message);
        }
      }

      // Update graph with changed files
      if (parsedFiles.length > 0) {
        await this.updateGraph(parsedFiles);
      }

      // Handle deleted files
      if (delta.deleted.length > 0) {
        console.log(`Removing ${delta.deleted.length} deleted files from graph...`);
        for (const file of delta.deleted) {
          try {
            await this.graph.deleteFileNode(file);
          } catch (error: any) {
            errors.push(`Failed to delete ${file}: ${error.message}`);
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
        errors,
        delta
      };

      await this.saveSyncState(syncState);

      console.log(`Delta sync completed in ${syncState.syncDuration}s`);
      console.log(`- Added: ${delta.added.length}`);
      console.log(`- Modified: ${delta.modified.length}`);
      console.log(`- Deleted: ${delta.deleted.length}`);

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

      // Read current file contents
      const fileContents = new Map<string, string>();
      for (const file of docFiles) {
        try {
          const absolutePath = path.join(this.repoRoot, file);
          const content = await fs.readFile(absolutePath, 'utf-8');
          fileContents.set(file, content);
        } catch (error) {
          // Skip files that can't be read
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
   * Parse a single file
   */
  private async parseFile(filePath: string): Promise<ParsedFile> {
    const absolutePath = path.join(this.repoRoot, filePath);
    const content = await fs.readFile(absolutePath, 'utf-8');
    const language = detectLanguage(filePath);

    const parsed = await this.parser.parseFile(filePath, content, language);
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
    if (this.vector && this.vector.isConnected()) {
      console.log('Generating vector embeddings...');
      await this.updateVectorEmbeddings(parsedFiles);
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
   */
  private async updateVectorEmbeddings(parsedFiles: ParsedFile[]): Promise<number> {
    if (!this.vector) return 0;

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
        return 0;
      }

      console.log(`Found ${allChunks.length} code chunks to embed`);

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

      console.log(`✓ Stored ${allChunks.length} embeddings`);
      return allChunks.length;

    } catch (error: any) {
      console.error('Failed to generate/store embeddings:', error.message);
      return 0;
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
          const content = await fs.readFile(absolutePath, 'utf-8');

          const parsed = await this.parser.parseDocument(file, content);
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

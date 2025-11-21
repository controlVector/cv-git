/**
 * Sync Engine
 * Orchestrates synchronization between repository, graph, and vector databases
 */

import { SyncState, FileNode, ParsedFile, CodeChunk, CodeChunkPayload } from '@cv-git/shared';
import { shouldSyncFile, detectLanguage, getCVDir } from '@cv-git/shared';
import { GitManager } from '../git/index.js';
import { CodeParser } from '../parser/index.js';
import { GraphManager } from '../graph/index.js';
import { VectorManager } from '../vector/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface SyncOptions {
  incremental?: boolean;
  files?: string[];
  excludePatterns?: string[];
  includeLanguages?: string[];
}

export class SyncEngine {
  constructor(
    private repoRoot: string,
    private git: GitManager,
    private parser: CodeParser,
    private graph: GraphManager,
    private vector?: VectorManager
  ) {}

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
      const excludePatterns = options.excludePatterns || this.getDefaultExcludePatterns();
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
      const excludePatterns = options.excludePatterns || this.getDefaultExcludePatterns();
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
   * Parse a single file
   */
  private async parseFile(filePath: string): Promise<ParsedFile> {
    const absolutePath = path.join(this.repoRoot, filePath);
    const content = await fs.readFile(absolutePath, 'utf-8');
    const language = detectLanguage(filePath);

    return await this.parser.parseFile(filePath, content, language);
  }

  /**
   * Update graph with parsed files
   */
  private async updateGraph(parsedFiles: ParsedFile[]): Promise<void> {
    console.log('Creating file nodes...');

    // Step 1: Create/update file nodes
    for (const file of parsedFiles) {
      const stats = await fs.stat(file.absolutePath);
      const gitHash = ''; // TODO: Get from git

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
      'node_modules/**',
      '.git/**',
      'dist/**',
      'build/**',
      '*.test.ts',
      '*.test.js',
      '*.spec.ts',
      '*.spec.js',
      'coverage/**',
      '.next/**',
      '.cache/**',
      '__pycache__/**',
      '*.pyc',
      'venv/**',
      'target/**',
      '*.min.js'
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

/**
 * Document Ingestion Manager
 *
 * Handles ingesting markdown documents into the cv-git knowledge system.
 * Ingested documents are:
 * - Stored in .cv/documents/
 * - Indexed in the graph database
 * - Embedded in the vector database
 * - Tracked in ingestion.jsonl
 *
 * Documents can optionally be "archived" (removed from git but retained in .cv/).
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

/**
 * Ingestion entry for tracking ingested documents
 */
export interface IngestEntry {
  path: string;              // Original relative path
  ingestedAt: string;        // ISO timestamp
  updatedAt: string;         // Last update timestamp
  contentHash: string;       // SHA256 of content
  archived: boolean;         // Whether original is removed
  archivedAt?: string;       // When archived
  gitCommit?: string;        // Commit where ingested
  wordCount: number;         // Document word count
  sectionCount: number;      // Number of sections
  documentType?: string;     // Inferred or explicit type
}

/**
 * Result of an ingest operation
 */
export interface IngestResult {
  path: string;
  status: 'created' | 'updated' | 'unchanged' | 'error';
  archived: boolean;
  error?: string;
}

/**
 * Options for ingest operations
 */
export interface IngestOptions {
  archive?: boolean;         // Remove from git after ingesting
  createStub?: boolean;      // Create placeholder file
  gitCommit?: string;        // Current git commit
  force?: boolean;           // Re-ingest even if unchanged
}

/**
 * Document Ingestion Manager
 */
export class IngestManager {
  private cvDir: string;
  private documentsDir: string;
  private indexPath: string;
  private entries: Map<string, IngestEntry> = new Map();
  private loaded = false;
  private dirty = false;

  constructor(repoRoot: string) {
    this.cvDir = path.join(repoRoot, '.cv');
    this.documentsDir = path.join(this.cvDir, 'documents');
    this.indexPath = path.join(this.cvDir, 'ingestion.jsonl');
  }

  /**
   * Load ingestion index from disk
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      await fs.mkdir(this.documentsDir, { recursive: true });
      const content = await fs.readFile(this.indexPath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as IngestEntry;
          this.entries.set(entry.path, entry);
        } catch (e) {
          console.warn(`Failed to parse ingest entry: ${line.slice(0, 50)}...`);
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.warn(`Failed to load ingestion index: ${error.message}`);
      }
    }

    this.loaded = true;
  }

  /**
   * Save ingestion index to disk
   */
  async save(): Promise<void> {
    if (!this.dirty) return;

    await fs.mkdir(this.cvDir, { recursive: true });

    const lines = Array.from(this.entries.values())
      .map(entry => JSON.stringify(entry))
      .join('\n');

    await fs.writeFile(this.indexPath, lines + '\n');
    this.dirty = false;
  }

  /**
   * Compute content hash
   */
  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Count words in content
   */
  private countWords(content: string): number {
    return content.split(/\s+/).filter(w => w.length > 0).length;
  }

  /**
   * Count sections (H2 headings)
   */
  private countSections(content: string): number {
    const matches = content.match(/^##\s+/gm);
    return matches ? matches.length : 0;
  }

  /**
   * Ingest a document
   *
   * @param docPath - Relative path to document
   * @param content - Document content
   * @param options - Ingest options
   */
  async ingest(
    docPath: string,
    content: string,
    options: IngestOptions = {}
  ): Promise<IngestResult> {
    await this.load();

    const contentHash = this.computeHash(content);
    const existing = this.entries.get(docPath);

    // Check if unchanged
    if (existing && existing.contentHash === contentHash && !options.force) {
      return { path: docPath, status: 'unchanged', archived: existing.archived };
    }

    const now = new Date().toISOString();

    try {
      // Store content in .cv/documents/
      const storagePath = path.join(this.documentsDir, docPath);
      await fs.mkdir(path.dirname(storagePath), { recursive: true });
      await fs.writeFile(storagePath, content);

      // Create/update entry
      const entry: IngestEntry = {
        path: docPath,
        ingestedAt: existing?.ingestedAt || now,
        updatedAt: now,
        contentHash,
        archived: options.archive ?? existing?.archived ?? false,
        archivedAt: options.archive ? now : existing?.archivedAt,
        gitCommit: options.gitCommit,
        wordCount: this.countWords(content),
        sectionCount: this.countSections(content)
      };

      this.entries.set(docPath, entry);
      this.dirty = true;

      return {
        path: docPath,
        status: existing ? 'updated' : 'created',
        archived: entry.archived
      };
    } catch (error: any) {
      return {
        path: docPath,
        status: 'error',
        archived: false,
        error: error.message
      };
    }
  }

  /**
   * Archive a document (mark as removed from git)
   */
  async archive(docPath: string): Promise<boolean> {
    await this.load();

    const entry = this.entries.get(docPath);
    if (!entry) {
      throw new Error(`Document not ingested: ${docPath}`);
    }

    if (entry.archived) {
      return false; // Already archived
    }

    entry.archived = true;
    entry.archivedAt = new Date().toISOString();
    this.dirty = true;

    return true;
  }

  /**
   * Restore an archived document
   */
  async restore(docPath: string): Promise<string | null> {
    await this.load();

    const entry = this.entries.get(docPath);
    if (!entry) {
      return null;
    }

    // Read content from storage
    const storagePath = path.join(this.documentsDir, docPath);
    try {
      const content = await fs.readFile(storagePath, 'utf-8');

      // Mark as not archived
      entry.archived = false;
      delete entry.archivedAt;
      this.dirty = true;

      return content;
    } catch (error: any) {
      throw new Error(`Failed to restore document: ${error.message}`);
    }
  }

  /**
   * Get ingested document content
   */
  async getContent(docPath: string): Promise<string | null> {
    await this.load();

    if (!this.entries.has(docPath)) {
      return null;
    }

    const storagePath = path.join(this.documentsDir, docPath);
    try {
      return await fs.readFile(storagePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Check if a document is ingested
   */
  async isIngested(docPath: string): Promise<boolean> {
    await this.load();
    return this.entries.has(docPath);
  }

  /**
   * Check if a document is archived
   */
  async isArchived(docPath: string): Promise<boolean> {
    await this.load();
    const entry = this.entries.get(docPath);
    return entry?.archived ?? false;
  }

  /**
   * Get entry for a document
   */
  async getEntry(docPath: string): Promise<IngestEntry | null> {
    await this.load();
    return this.entries.get(docPath) || null;
  }

  /**
   * Get all ingested documents
   */
  async getAllEntries(): Promise<IngestEntry[]> {
    await this.load();
    return Array.from(this.entries.values());
  }

  /**
   * Get archived documents
   */
  async getArchivedEntries(): Promise<IngestEntry[]> {
    await this.load();
    return Array.from(this.entries.values()).filter(e => e.archived);
  }

  /**
   * Get active (non-archived) documents
   */
  async getActiveEntries(): Promise<IngestEntry[]> {
    await this.load();
    return Array.from(this.entries.values()).filter(e => !e.archived);
  }

  /**
   * Remove a document from ingestion
   */
  async remove(docPath: string): Promise<boolean> {
    await this.load();

    if (!this.entries.has(docPath)) {
      return false;
    }

    // Remove from storage
    const storagePath = path.join(this.documentsDir, docPath);
    try {
      await fs.unlink(storagePath);
    } catch {
      // File might not exist
    }

    this.entries.delete(docPath);
    this.dirty = true;
    return true;
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    total: number;
    archived: number;
    active: number;
    totalWords: number;
    totalSections: number;
  }> {
    await this.load();

    let archived = 0;
    let totalWords = 0;
    let totalSections = 0;

    for (const entry of this.entries.values()) {
      if (entry.archived) archived++;
      totalWords += entry.wordCount;
      totalSections += entry.sectionCount;
    }

    return {
      total: this.entries.size,
      archived,
      active: this.entries.size - archived,
      totalWords,
      totalSections
    };
  }

  /**
   * Export ingestion data
   */
  async export(): Promise<{
    version: string;
    exportedAt: string;
    entries: IngestEntry[];
  }> {
    await this.load();

    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      entries: Array.from(this.entries.values())
    };
  }

  /**
   * Import ingestion data
   */
  async import(data: { entries: IngestEntry[] }): Promise<{
    imported: number;
    updated: number;
    skipped: number;
  }> {
    await this.load();

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const entry of data.entries) {
      const existing = this.entries.get(entry.path);

      if (existing) {
        if (new Date(entry.updatedAt) > new Date(existing.updatedAt)) {
          this.entries.set(entry.path, entry);
          updated++;
        } else {
          skipped++;
        }
      } else {
        this.entries.set(entry.path, entry);
        imported++;
      }
    }

    if (imported > 0 || updated > 0) {
      this.dirty = true;
    }

    return { imported, updated, skipped };
  }

  /**
   * Close and save pending changes
   */
  async close(): Promise<void> {
    await this.save();
  }
}

/**
 * Create an ingest manager instance
 */
export function createIngestManager(repoRoot: string): IngestManager {
  return new IngestManager(repoRoot);
}

/**
 * Authored Metadata Storage
 *
 * Stores human-authored relationships and metadata that cannot be
 * regenerated from source code. This is critical for preserving
 * manual work across syncs and for distributed collaboration.
 *
 * Storage format: JSONL in .cv/authored.jsonl
 * Each line is a JSON object representing an authored entry.
 *
 * Entry types:
 * - document_meta: Frontmatter/metadata for a document
 * - relationship: Manual relationship between nodes
 * - annotation: Custom annotations on code/docs
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { DocumentFrontmatter, DocumentType, DocumentStatus } from '@cv-git/shared';

/**
 * Types of authored entries
 */
export type AuthoredEntryType = 'document_meta' | 'relationship' | 'annotation';

/**
 * Relationship types that can be manually authored
 */
export type AuthoredRelationType =
  | 'DESCRIBES'      // Document describes code/symbol
  | 'REFERENCES_DOC' // Document references another document
  | 'SUPERSEDES'     // Document supersedes another (ADRs)
  | 'RELATED_TO'     // Generic relationship
  | 'IMPLEMENTS'     // Code implements a spec
  | 'OWNED_BY';      // Ownership relationship

/**
 * Base interface for all authored entries
 */
export interface AuthoredEntryBase {
  id: string;
  type: AuthoredEntryType;
  path: string;           // Path to the source (file or node)
  createdAt: string;
  updatedAt: string;
  createdBy?: string;     // Git author if available
  gitCommit?: string;     // Commit where this was authored
}

/**
 * Document metadata entry
 * Preserves frontmatter that was manually written
 */
export interface DocumentMetaEntry extends AuthoredEntryBase {
  type: 'document_meta';
  frontmatter: DocumentFrontmatter;
  title?: string;
  inferredType?: DocumentType;
  effectiveType: DocumentType;
  status: DocumentStatus;
}

/**
 * Relationship entry
 * Preserves manually-created relationships
 */
export interface RelationshipEntry extends AuthoredEntryBase {
  type: 'relationship';
  relationType: AuthoredRelationType;
  targetPath: string;
  properties?: Record<string, unknown>;
}

/**
 * Annotation entry
 * Preserves custom annotations on code/docs
 */
export interface AnnotationEntry extends AuthoredEntryBase {
  type: 'annotation';
  annotationType: string;
  content: string;
  line?: number;
  endLine?: number;
  metadata?: Record<string, unknown>;
}

export type AuthoredEntry = DocumentMetaEntry | RelationshipEntry | AnnotationEntry;

/**
 * Authored metadata index
 */
export interface AuthoredIndex {
  version: string;
  lastUpdated: string;
  stats: {
    documentMeta: number;
    relationships: number;
    annotations: number;
  };
}

/**
 * Authored Metadata Manager
 *
 * Manages the .cv/authored.jsonl file for preserving human-authored
 * metadata and relationships.
 */
export class AuthoredMetadataManager {
  private cvDir: string;
  private filePath: string;
  private entries: Map<string, AuthoredEntry> = new Map();
  private dirty = false;
  private loaded = false;

  constructor(repoRoot: string) {
    this.cvDir = path.join(repoRoot, '.cv');
    this.filePath = path.join(this.cvDir, 'authored.jsonl');
  }

  /**
   * Load authored metadata from disk
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      await fs.mkdir(this.cvDir, { recursive: true });
      const content = await fs.readFile(this.filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as AuthoredEntry;
          this.entries.set(entry.id, entry);
        } catch (e) {
          console.warn(`Failed to parse authored entry: ${line.slice(0, 50)}...`);
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.warn(`Failed to load authored metadata: ${error.message}`);
      }
    }

    this.loaded = true;
  }

  /**
   * Save authored metadata to disk
   */
  async save(): Promise<void> {
    if (!this.dirty) return;

    await fs.mkdir(this.cvDir, { recursive: true });

    const lines = Array.from(this.entries.values())
      .map(entry => JSON.stringify(entry))
      .join('\n');

    await fs.writeFile(this.filePath, lines + '\n');
    this.dirty = false;
  }

  /**
   * Generate unique ID for an entry
   */
  private generateId(type: AuthoredEntryType, path: string, extra?: string): string {
    const timestamp = Date.now().toString(36);
    const suffix = extra ? `:${extra}` : '';
    return `${type}:${path}${suffix}:${timestamp}`;
  }

  /**
   * Add or update document metadata
   */
  async upsertDocumentMeta(
    docPath: string,
    frontmatter: DocumentFrontmatter,
    options?: {
      title?: string;
      inferredType?: DocumentType;
      gitCommit?: string;
      createdBy?: string;
    }
  ): Promise<DocumentMetaEntry> {
    await this.load();

    // Find existing entry for this path
    const existingId = Array.from(this.entries.entries())
      .find(([_, e]) => e.type === 'document_meta' && e.path === docPath)?.[0];

    const now = new Date().toISOString();
    const effectiveType = frontmatter.type || options?.inferredType || 'unknown';

    const entry: DocumentMetaEntry = {
      id: existingId || this.generateId('document_meta', docPath),
      type: 'document_meta',
      path: docPath,
      createdAt: existingId ? this.entries.get(existingId)!.createdAt : now,
      updatedAt: now,
      createdBy: options?.createdBy,
      gitCommit: options?.gitCommit,
      frontmatter,
      title: options?.title,
      inferredType: options?.inferredType,
      effectiveType,
      status: frontmatter.status || 'active'
    };

    this.entries.set(entry.id, entry);
    this.dirty = true;
    return entry;
  }

  /**
   * Add a manual relationship
   */
  async addRelationship(
    sourcePath: string,
    targetPath: string,
    relationType: AuthoredRelationType,
    options?: {
      properties?: Record<string, unknown>;
      gitCommit?: string;
      createdBy?: string;
    }
  ): Promise<RelationshipEntry> {
    await this.load();

    // Check for existing relationship
    const existingId = Array.from(this.entries.entries())
      .find(([_, e]) =>
        e.type === 'relationship' &&
        e.path === sourcePath &&
        (e as RelationshipEntry).targetPath === targetPath &&
        (e as RelationshipEntry).relationType === relationType
      )?.[0];

    const now = new Date().toISOString();

    const entry: RelationshipEntry = {
      id: existingId || this.generateId('relationship', sourcePath, `${relationType}:${targetPath}`),
      type: 'relationship',
      path: sourcePath,
      createdAt: existingId ? this.entries.get(existingId)!.createdAt : now,
      updatedAt: now,
      createdBy: options?.createdBy,
      gitCommit: options?.gitCommit,
      relationType,
      targetPath,
      properties: options?.properties
    };

    this.entries.set(entry.id, entry);
    this.dirty = true;
    return entry;
  }

  /**
   * Add an annotation
   */
  async addAnnotation(
    targetPath: string,
    annotationType: string,
    content: string,
    options?: {
      line?: number;
      endLine?: number;
      metadata?: Record<string, unknown>;
      gitCommit?: string;
      createdBy?: string;
    }
  ): Promise<AnnotationEntry> {
    await this.load();

    const now = new Date().toISOString();

    const entry: AnnotationEntry = {
      id: this.generateId('annotation', targetPath, annotationType),
      type: 'annotation',
      path: targetPath,
      createdAt: now,
      updatedAt: now,
      createdBy: options?.createdBy,
      gitCommit: options?.gitCommit,
      annotationType,
      content,
      line: options?.line,
      endLine: options?.endLine,
      metadata: options?.metadata
    };

    this.entries.set(entry.id, entry);
    this.dirty = true;
    return entry;
  }

  /**
   * Get document metadata for a path
   */
  async getDocumentMeta(docPath: string): Promise<DocumentMetaEntry | null> {
    await this.load();

    for (const entry of this.entries.values()) {
      if (entry.type === 'document_meta' && entry.path === docPath) {
        return entry as DocumentMetaEntry;
      }
    }
    return null;
  }

  /**
   * Get all relationships for a source path
   */
  async getRelationships(sourcePath: string): Promise<RelationshipEntry[]> {
    await this.load();

    return Array.from(this.entries.values())
      .filter(e => e.type === 'relationship' && e.path === sourcePath) as RelationshipEntry[];
  }

  /**
   * Get all relationships targeting a path
   */
  async getIncomingRelationships(targetPath: string): Promise<RelationshipEntry[]> {
    await this.load();

    return Array.from(this.entries.values())
      .filter(e => e.type === 'relationship' && (e as RelationshipEntry).targetPath === targetPath) as RelationshipEntry[];
  }

  /**
   * Get annotations for a path
   */
  async getAnnotations(targetPath: string): Promise<AnnotationEntry[]> {
    await this.load();

    return Array.from(this.entries.values())
      .filter(e => e.type === 'annotation' && e.path === targetPath) as AnnotationEntry[];
  }

  /**
   * Get all entries of a specific type
   */
  async getEntriesByType<T extends AuthoredEntry>(type: AuthoredEntryType): Promise<T[]> {
    await this.load();

    return Array.from(this.entries.values())
      .filter(e => e.type === type) as T[];
  }

  /**
   * Delete an entry by ID
   */
  async deleteEntry(id: string): Promise<boolean> {
    await this.load();

    if (this.entries.has(id)) {
      this.entries.delete(id);
      this.dirty = true;
      return true;
    }
    return false;
  }

  /**
   * Delete all entries for a path (useful when file is deleted)
   */
  async deleteEntriesForPath(docPath: string): Promise<number> {
    await this.load();

    let deleted = 0;
    for (const [id, entry] of this.entries) {
      if (entry.path === docPath) {
        this.entries.delete(id);
        deleted++;
      }
      // Also check target path for relationships
      if (entry.type === 'relationship' && (entry as RelationshipEntry).targetPath === docPath) {
        this.entries.delete(id);
        deleted++;
      }
    }

    if (deleted > 0) {
      this.dirty = true;
    }
    return deleted;
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<AuthoredIndex['stats']> {
    await this.load();

    let documentMeta = 0;
    let relationships = 0;
    let annotations = 0;

    for (const entry of this.entries.values()) {
      switch (entry.type) {
        case 'document_meta': documentMeta++; break;
        case 'relationship': relationships++; break;
        case 'annotation': annotations++; break;
      }
    }

    return { documentMeta, relationships, annotations };
  }

  /**
   * Export all entries for backup/sync
   */
  async export(): Promise<{
    version: string;
    exportedAt: string;
    entries: AuthoredEntry[];
  }> {
    await this.load();

    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      entries: Array.from(this.entries.values())
    };
  }

  /**
   * Import entries (merges with existing)
   */
  async import(data: {
    entries: AuthoredEntry[];
  }): Promise<{ imported: number; updated: number; skipped: number }> {
    await this.load();

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const entry of data.entries) {
      const existing = this.entries.get(entry.id);

      if (existing) {
        // Update if newer
        if (new Date(entry.updatedAt) > new Date(existing.updatedAt)) {
          this.entries.set(entry.id, entry);
          updated++;
        } else {
          skipped++;
        }
      } else {
        this.entries.set(entry.id, entry);
        imported++;
      }
    }

    if (imported > 0 || updated > 0) {
      this.dirty = true;
    }

    return { imported, updated, skipped };
  }

  /**
   * Sync authored metadata with current document state
   * Removes entries for files that no longer exist
   */
  async syncWithFilesystem(existingPaths: Set<string>): Promise<{ removed: number }> {
    await this.load();

    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (!existingPaths.has(entry.path)) {
        this.entries.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      this.dirty = true;
    }

    return { removed };
  }

  /**
   * Close and save pending changes
   */
  async close(): Promise<void> {
    await this.save();
  }
}

/**
 * Create an authored metadata manager instance
 */
export function createAuthoredMetadataManager(repoRoot: string): AuthoredMetadataManager {
  return new AuthoredMetadataManager(repoRoot);
}

/**
 * Markdown Parser
 * Parses markdown files for documentation knowledge graph integration
 * Extracts frontmatter, headings, links, and sections
 */

import * as path from 'path';
import {
  DocumentType,
  DocumentStatus,
  DocumentFrontmatter,
  DocumentHeading,
  DocumentLink,
  DocumentSection,
  DocumentChunk,
  ParsedDocument
} from '@cv-git/shared';

/**
 * Configuration for the markdown parser
 */
export interface MarkdownParserConfig {
  /** Heading level to use as chunk boundary (1=H1, 2=H2, 3=H3) */
  chunkByHeading: 1 | 2 | 3;
  /** Maximum lines per chunk (fallback for large sections) */
  maxChunkSize: number;
  /** Whether to extract code blocks as separate chunks */
  extractCodeBlocks: boolean;
  /** File patterns to include */
  includePatterns: string[];
  /** File patterns to exclude */
  excludePatterns: string[];
}

const DEFAULT_CONFIG: MarkdownParserConfig = {
  chunkByHeading: 2,
  maxChunkSize: 500,
  extractCodeBlocks: false,
  includePatterns: ['**/*.md', '**/*.markdown'],
  excludePatterns: ['node_modules/**', '.git/**', 'vendor/**']
};

/**
 * Markdown parser for documentation files
 */
export class MarkdownParser {
  private config: MarkdownParserConfig;

  constructor(config?: Partial<MarkdownParserConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Parse a markdown file and extract all metadata
   */
  async parseFile(filePath: string, content: string): Promise<ParsedDocument> {
    const absolutePath = path.resolve(filePath);

    // Extract frontmatter
    const { frontmatter, bodyStart } = this.parseFrontmatter(content);
    const bodyContent = content.slice(bodyStart);

    // Extract headings
    const headings = this.extractHeadings(bodyContent, bodyStart);

    // Extract links
    const links = this.extractLinks(bodyContent, bodyStart);

    // Chunk by sections
    const sections = this.chunkBySections(bodyContent, headings, filePath, bodyStart);

    // Infer document type if not in frontmatter
    const inferredType = frontmatter.type || this.inferDocumentType(filePath, content);

    return {
      path: filePath,
      absolutePath,
      content,
      frontmatter: {
        ...frontmatter,
        type: frontmatter.type || inferredType
      },
      headings,
      links,
      sections,
      inferredType
    };
  }

  /**
   * Parse YAML frontmatter from content
   * Frontmatter is between --- markers at the start of the file
   */
  parseFrontmatter(content: string): { frontmatter: DocumentFrontmatter; bodyStart: number } {
    const lines = content.split('\n');

    // Check if file starts with ---
    if (lines[0]?.trim() !== '---') {
      return { frontmatter: {}, bodyStart: 0 };
    }

    // Find closing ---
    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        endIndex = i;
        break;
      }
    }

    if (endIndex === -1) {
      return { frontmatter: {}, bodyStart: 0 };
    }

    // Parse YAML content between markers
    const yamlContent = lines.slice(1, endIndex).join('\n');
    const frontmatter = this.parseSimpleYaml(yamlContent);

    // Calculate byte offset for body start
    const bodyStart = lines.slice(0, endIndex + 1).join('\n').length + 1;

    return { frontmatter, bodyStart };
  }

  /**
   * Simple YAML parser for frontmatter
   * Handles common cases without full YAML library dependency
   */
  private parseSimpleYaml(yaml: string): DocumentFrontmatter {
    const frontmatter: DocumentFrontmatter = {};
    const lines = yaml.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const colonIndex = trimmed.indexOf(':');
      if (colonIndex === -1) continue;

      const key = trimmed.slice(0, colonIndex).trim();
      let value = trimmed.slice(colonIndex + 1).trim();

      // Handle arrays (simple inline format: [item1, item2])
      if (value.startsWith('[') && value.endsWith(']')) {
        const arrayContent = value.slice(1, -1);
        const items = arrayContent.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
        (frontmatter as any)[key] = items;
        continue;
      }

      // Handle quoted strings
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Map known fields
      switch (key) {
        case 'type':
          frontmatter.type = value as DocumentType;
          break;
        case 'status':
          frontmatter.status = value as DocumentStatus;
          break;
        case 'tags':
          if (!Array.isArray((frontmatter as any)[key])) {
            frontmatter.tags = value ? [value] : [];
          }
          break;
        case 'relates_to':
          if (!Array.isArray((frontmatter as any)[key])) {
            frontmatter.relates_to = value ? [value] : [];
          }
          break;
        case 'priority':
          frontmatter.priority = value as any;
          break;
        case 'author':
          frontmatter.author = value;
          break;
        case 'created':
          frontmatter.created = value;
          break;
        case 'updated':
          frontmatter.updated = value;
          break;
        case 'version':
          frontmatter.version = value;
          break;
        default:
          // Store unknown fields in custom_fields
          if (!frontmatter.custom_fields) {
            frontmatter.custom_fields = {};
          }
          frontmatter.custom_fields[key] = value;
      }
    }

    return frontmatter;
  }

  /**
   * Extract headings from markdown content
   */
  extractHeadings(content: string, offset: number = 0): DocumentHeading[] {
    const headings: DocumentHeading[] = [];
    const lines = content.split('\n');

    // Track line number accounting for offset
    const offsetLines = offset > 0 ? content.slice(0, offset).split('\n').length - 1 : 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match ATX-style headings (# Heading)
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim();

        headings.push({
          level,
          text,
          line: i + 1 + offsetLines,
          anchor: this.generateAnchor(text)
        });
      }
    }

    return headings;
  }

  /**
   * Generate URL-friendly anchor from heading text
   */
  private generateAnchor(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')  // Remove special chars
      .replace(/\s+/g, '-')       // Replace spaces with dashes
      .replace(/-+/g, '-')        // Collapse multiple dashes
      .replace(/^-|-$/g, '');     // Trim leading/trailing dashes
  }

  /**
   * Extract links from markdown content
   */
  extractLinks(content: string, offset: number = 0): DocumentLink[] {
    const links: DocumentLink[] = [];
    const lines = content.split('\n');
    const offsetLines = offset > 0 ? content.slice(0, offset).split('\n').length - 1 : 0;

    // Markdown link pattern: [text](url)
    const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;

    // Bare URL pattern
    const urlPattern = /(?<![[(])(https?:\/\/[^\s<>)\]]+)/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1 + offsetLines;

      // Find markdown links
      let match;
      while ((match = linkPattern.exec(line)) !== null) {
        const text = match[1];
        const target = match[2];

        links.push({
          text,
          target,
          line: lineNum,
          isInternal: this.isInternalLink(target),
          isCodeRef: this.isCodeReference(target)
        });
      }

      // Find bare URLs
      while ((match = urlPattern.exec(line)) !== null) {
        const url = match[1];

        links.push({
          text: url,
          target: url,
          line: lineNum,
          isInternal: false,
          isCodeRef: false
        });
      }
    }

    return links;
  }

  /**
   * Check if a link target is internal (relative path or repo file)
   */
  private isInternalLink(target: string): boolean {
    // External URLs
    if (target.startsWith('http://') || target.startsWith('https://')) {
      return false;
    }
    // Anchors
    if (target.startsWith('#')) {
      return false;
    }
    // Likely a relative path
    return true;
  }

  /**
   * Check if a link references code (source file)
   */
  private isCodeReference(target: string): boolean {
    const codeExtensions = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h'];
    const ext = path.extname(target);
    return codeExtensions.includes(ext);
  }

  /**
   * Chunk markdown content by sections (headings)
   */
  chunkBySections(
    content: string,
    headings: DocumentHeading[],
    filePath: string,
    offset: number = 0
  ): DocumentSection[] {
    const sections: DocumentSection[] = [];
    const lines = content.split('\n');
    const chunkLevel = this.config.chunkByHeading;

    // Find headings at or above the chunk level
    const chunkHeadings = headings.filter(h => h.level <= chunkLevel);

    // If no headings, create a single section for the whole document
    if (chunkHeadings.length === 0) {
      const section: DocumentSection = {
        id: this.generateSectionId(filePath, 1, lines.length),
        content,
        startLine: 1,
        endLine: lines.length,
        links: this.extractLinks(content, offset)
      };
      sections.push(section);
      return sections;
    }

    // Create sections between headings
    for (let i = 0; i < chunkHeadings.length; i++) {
      const heading = chunkHeadings[i];
      const nextHeading = chunkHeadings[i + 1];

      const startLine = heading.line;
      const endLine = nextHeading ? nextHeading.line - 1 : lines.length;

      const sectionContent = lines.slice(startLine - 1, endLine).join('\n');

      const section: DocumentSection = {
        id: this.generateSectionId(filePath, startLine, endLine),
        heading,
        content: sectionContent,
        startLine,
        endLine,
        links: this.extractLinks(sectionContent, offset + startLine - 1)
      };

      sections.push(section);
    }

    // Handle content before first heading
    if (chunkHeadings[0].line > 1) {
      const preContent = lines.slice(0, chunkHeadings[0].line - 1).join('\n');
      if (preContent.trim()) {
        const section: DocumentSection = {
          id: this.generateSectionId(filePath, 1, chunkHeadings[0].line - 1),
          content: preContent,
          startLine: 1,
          endLine: chunkHeadings[0].line - 1,
          links: this.extractLinks(preContent, offset)
        };
        sections.unshift(section);
      }
    }

    return sections;
  }

  /**
   * Generate unique section ID
   */
  private generateSectionId(filePath: string, startLine: number, endLine: number): string {
    return `doc:${filePath}:${startLine}-${endLine}`;
  }

  /**
   * Infer document type from file path and content
   */
  inferDocumentType(filePath: string, content: string): DocumentType {
    const filename = path.basename(filePath).toLowerCase();
    const dirname = path.dirname(filePath).toLowerCase();
    const lowerContent = content.toLowerCase();

    // Filename-based inference (highest priority)
    if (filename === 'readme.md' || filename === 'readme.markdown') {
      return 'readme';
    }
    if (filename === 'changelog.md' || filename === 'changes.md' || filename === 'history.md') {
      return 'changelog';
    }
    if (filename.startsWith('adr-') || filename.startsWith('adr_')) {
      return 'adr';
    }
    if (filename.includes('roadmap')) {
      return 'roadmap';
    }
    if (filename.includes('session') || filename.includes('notes') || filename.includes('summary')) {
      return 'session_notes';
    }
    if (filename.match(/phase[-_]?\d/i) || filename.includes('phase')) {
      return 'phase_doc';
    }
    if (filename.includes('api') && (filename.includes('doc') || filename.includes('ref'))) {
      return 'api_doc';
    }
    if (filename.includes('release') && filename.includes('note')) {
      return 'release_note';
    }
    if (filename.includes('guide') || filename.includes('quickstart') || filename.includes('getting-started')) {
      return 'guide';
    }
    if (filename.includes('tutorial')) {
      return 'tutorial';
    }
    if (filename.includes('reference')) {
      return 'reference';
    }
    if (filename.includes('setup') || filename.includes('install')) {
      return 'guide';
    }

    // Directory-based inference
    if (dirname.includes('/adr') || dirname.includes('/adrs') || dirname.includes('/decisions')) {
      return 'adr';
    }
    if (dirname.includes('/guides') || dirname.includes('/howto')) {
      return 'guide';
    }
    if (dirname.includes('/tutorials')) {
      return 'tutorial';
    }
    if (dirname.includes('/api') || dirname.includes('/reference')) {
      return 'api_doc';
    }
    if (dirname.includes('/design') || dirname.includes('/architecture')) {
      return 'design_spec';
    }
    if (dirname.includes('/docs')) {
      // Generic docs folder - try content-based
    }

    // Content-based inference (lower priority)
    if (lowerContent.includes('# architecture') ||
        lowerContent.includes('## design') ||
        lowerContent.includes('## system design')) {
      return 'design_spec';
    }
    if (lowerContent.includes('# api reference') ||
        lowerContent.includes('## endpoints') ||
        lowerContent.includes('## api methods')) {
      return 'api_doc';
    }
    if (lowerContent.includes('## installation') ||
        lowerContent.includes('## getting started') ||
        lowerContent.includes('## prerequisites')) {
      return 'guide';
    }
    if ((lowerContent.includes('## decision') && lowerContent.includes('## context')) ||
        lowerContent.includes('## status: accepted') ||
        lowerContent.includes('## status: deprecated')) {
      return 'adr';
    }
    if (lowerContent.includes("## what's new") ||
        lowerContent.includes('## release notes') ||
        lowerContent.includes('## breaking changes')) {
      return 'release_note';
    }
    if (lowerContent.includes('## technical specification') ||
        lowerContent.includes('## implementation details')) {
      return 'technical_spec';
    }

    return 'unknown';
  }

  /**
   * Generate chunks for vector embedding
   */
  chunkDocument(parsed: ParsedDocument, filePath: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const documentType = parsed.frontmatter.type || parsed.inferredType;
    const tags = parsed.frontmatter.tags || [];

    for (const section of parsed.sections) {
      chunks.push({
        id: section.id,
        file: filePath,
        startLine: section.startLine,
        endLine: section.endLine,
        text: section.content,
        heading: section.heading?.text,
        headingLevel: section.heading?.level,
        documentType,
        tags
      });
    }

    return chunks;
  }

  /**
   * Get supported file extensions
   */
  getSupportedExtensions(): string[] {
    return ['.md', '.markdown'];
  }

  /**
   * Get language identifier
   */
  getLanguage(): string {
    return 'markdown';
  }
}

/**
 * Create a markdown parser instance
 */
export function createMarkdownParser(config?: Partial<MarkdownParserConfig>): MarkdownParser {
  return new MarkdownParser(config);
}

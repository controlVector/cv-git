/**
 * Markdown Parser Unit Tests
 * Tests for document parsing, type inference, and chunking
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createParser } from '@cv-git/core';

describe('MarkdownParser', () => {
  let parser: ReturnType<typeof createParser>;
  let markdownParser: ReturnType<ReturnType<typeof createParser>['getMarkdownParser']>;

  beforeEach(() => {
    parser = createParser();
    markdownParser = parser.getMarkdownParser();
  });

  describe('parseFrontmatter', () => {
    it('should parse YAML frontmatter with inline arrays', () => {
      const content = `---
type: design_spec
status: active
tags: [architecture, api]
---

# Document Title`;

      const result = markdownParser.parseFrontmatter(content);

      expect(result.frontmatter.type).toBe('design_spec');
      expect(result.frontmatter.status).toBe('active');
      expect(result.frontmatter.tags).toEqual(['architecture', 'api']);
      expect(result.bodyStart).toBeGreaterThan(0);
    });

    it('should handle missing frontmatter', () => {
      const content = `# Just a Title

Some content here.`;

      const result = markdownParser.parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.bodyStart).toBe(0);
    });

    it('should parse frontmatter with priority and author', () => {
      const content = `---
type: technical_spec
status: draft
priority: high
author: developer
---

# Technical Specification`;

      const result = markdownParser.parseFrontmatter(content);

      expect(result.frontmatter.type).toBe('technical_spec');
      expect(result.frontmatter.priority).toBe('high');
      expect(result.frontmatter.author).toBe('developer');
    });

    it('should store unknown fields in custom_fields', () => {
      const content = `---
type: design_spec
reviewer: team-lead
sprint: 42
---

# Doc`;

      const result = markdownParser.parseFrontmatter(content);

      expect(result.frontmatter.custom_fields).toHaveProperty('reviewer');
      expect(result.frontmatter.custom_fields?.reviewer).toBe('team-lead');
    });

    it('should handle empty frontmatter', () => {
      const content = `---
---

# Empty Frontmatter`;

      const result = markdownParser.parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
    });
  });

  describe('extractHeadings', () => {
    it('should extract all heading levels', () => {
      const content = `# H1 Title
## H2 Section
### H3 Subsection
#### H4 Deep
##### H5 Deeper
###### H6 Deepest`;

      const headings = markdownParser.extractHeadings(content, 0);

      expect(headings).toHaveLength(6);
      expect(headings[0].level).toBe(1);
      expect(headings[0].text).toBe('H1 Title');
      expect(headings[0].line).toBe(1);
      expect(headings[0].anchor).toBe('h1-title');

      expect(headings[5].level).toBe(6);
      expect(headings[5].text).toBe('H6 Deepest');
    });

    it('should generate anchors correctly', () => {
      const content = `# Title with Spaces
## Section with "Quotes"
### Has-Dashes-Already`;

      const headings = markdownParser.extractHeadings(content, 0);

      expect(headings[0].anchor).toBe('title-with-spaces');
      expect(headings[1].anchor).toBe('section-with-quotes');
      expect(headings[2].anchor).toBe('has-dashes-already');
    });

    it('should handle empty content', () => {
      const headings = markdownParser.extractHeadings('', 0);
      expect(headings).toHaveLength(0);
    });
  });

  describe('extractLinks', () => {
    it('should extract markdown links with metadata', () => {
      const content = `Check out [the docs](./docs/README.md) and [API](./src/api/index.ts).`;

      const links = markdownParser.extractLinks(content, 0);

      expect(links).toHaveLength(2);
      expect(links[0].text).toBe('the docs');
      expect(links[0].target).toBe('./docs/README.md');
      expect(links[0].line).toBe(1);
      expect(links[0].isInternal).toBe(true);
      expect(links[0].isCodeRef).toBe(false);  // .md is not code

      expect(links[1].isCodeRef).toBe(true);  // .ts is code
    });

    it('should detect external URLs', () => {
      const content = `Visit [GitHub](https://github.com) for details.`;

      const links = markdownParser.extractLinks(content, 0);

      expect(links).toHaveLength(1);
      expect(links[0].target).toBe('https://github.com');
      expect(links[0].isInternal).toBe(false);
    });

    it('should detect code references', () => {
      const content = `See [handler](./src/handler.ts) and [config](./config.json).`;

      const links = markdownParser.extractLinks(content, 0);

      expect(links).toHaveLength(2);
      expect(links[0].isCodeRef).toBe(true);  // .ts file
      expect(links[1].isCodeRef).toBe(false);  // .json is not in code list
    });

    it('should handle links with special characters', () => {
      const content = `[Link with spaces](./path%20with%20spaces/file.md)`;

      const links = markdownParser.extractLinks(content, 0);

      expect(links).toHaveLength(1);
      expect(links[0].target).toBe('./path%20with%20spaces/file.md');
    });
  });

  describe('inferDocumentType', () => {
    it('should infer readme type', () => {
      expect(markdownParser.inferDocumentType('README.md', '')).toBe('readme');
      expect(markdownParser.inferDocumentType('readme.md', '')).toBe('readme');
      expect(markdownParser.inferDocumentType('docs/README.md', '')).toBe('readme');
    });

    it('should infer changelog type', () => {
      expect(markdownParser.inferDocumentType('CHANGELOG.md', '')).toBe('changelog');
      expect(markdownParser.inferDocumentType('changelog.md', '')).toBe('changelog');
      expect(markdownParser.inferDocumentType('HISTORY.md', '')).toBe('changelog');
    });

    it('should infer ADR type from directory', () => {
      expect(markdownParser.inferDocumentType('docs/adr/0001-use-typescript.md', '')).toBe('adr');
      expect(markdownParser.inferDocumentType('docs/adrs/0002-api-design.md', '')).toBe('adr');
      // Note: /decisions/ also maps to ADR
      expect(markdownParser.inferDocumentType('docs/decisions/0003-architecture.md', '')).toBe('adr');
    });

    it('should infer ADR type from filename pattern', () => {
      expect(markdownParser.inferDocumentType('adr-001-decision.md', '')).toBe('adr');
      expect(markdownParser.inferDocumentType('adr_001-decision.md', '')).toBe('adr');
    });

    it('should infer guide type', () => {
      expect(markdownParser.inferDocumentType('docs/guides/setup.md', '')).toBe('guide');
      expect(markdownParser.inferDocumentType('quickstart.md', '')).toBe('guide');
      expect(markdownParser.inferDocumentType('getting-started.md', '')).toBe('guide');
    });

    it('should infer from content when path not definitive', () => {
      const apiContent = `# API Reference

## Endpoints

### GET /users`;

      // File in /api/ directory
      expect(markdownParser.inferDocumentType('docs/api/users.md', apiContent)).toBe('api_doc');
    });

    it('should infer design_spec from content', () => {
      const designContent = `# System Overview

## Architecture

This document describes the architecture...`;

      expect(markdownParser.inferDocumentType('docs/system.md', designContent)).toBe('design_spec');
    });

    it('should infer session_notes from filename', () => {
      expect(markdownParser.inferDocumentType('notes.md', '')).toBe('session_notes');
      expect(markdownParser.inferDocumentType('session-2024.md', '')).toBe('session_notes');
    });

    it('should return unknown for completely ambiguous content', () => {
      const content = `# Meeting

We discussed things.`;

      expect(markdownParser.inferDocumentType('random.md', content)).toBe('unknown');
    });
  });

  describe('parseFile', () => {
    it('should parse complete document', async () => {
      const content = `---
type: technical_spec
status: active
tags: [api, v2]
---

# API v2 Specification

This document describes the new API.

## Authentication

All requests require a bearer token.

## Endpoints

### GET /users

Returns list of users.`;

      const parsed = await markdownParser.parseFile('docs/api-spec.md', content);

      expect(parsed.frontmatter.type).toBe('technical_spec');
      expect(parsed.frontmatter.status).toBe('active');
      expect(parsed.headings.length).toBeGreaterThanOrEqual(3);
      expect(parsed.sections.length).toBeGreaterThan(0);
      expect(parsed.path).toBe('docs/api-spec.md');
    });

    it('should handle document with no headings', async () => {
      const content = `Just some plain text content without any structure.`;

      const parsed = await markdownParser.parseFile('plain.md', content);

      expect(parsed.headings).toHaveLength(0);
      expect(parsed.sections.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract links correctly', async () => {
      const content = `# Doc

See [other doc](./other.md) for details.`;

      const parsed = await markdownParser.parseFile('test.md', content);

      expect(parsed.links).toHaveLength(1);
      expect(parsed.links[0].target).toBe('./other.md');
    });

    it('should set inferredType when not in frontmatter', async () => {
      const content = `# README

This is the project readme.`;

      const parsed = await markdownParser.parseFile('README.md', content);

      expect(parsed.inferredType).toBe('readme');
    });
  });

  describe('chunkDocument', () => {
    it('should chunk by H2 headings', async () => {
      const content = `# Main Title

Introduction text.

## Section One

Content for section one.

## Section Two

Content for section two.`;

      const parsed = await markdownParser.parseFile('test.md', content);
      const chunks = markdownParser.chunkDocument(parsed, 'test.md');

      // Should have chunks for sections
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // Each chunk should have required fields
      for (const chunk of chunks) {
        expect(chunk.file).toBe('test.md');
        expect(chunk.startLine).toBeGreaterThanOrEqual(1);
        expect(chunk.endLine).toBeGreaterThan(0);
        expect(chunk.text.length).toBeGreaterThan(0);
      }
    });

    it('should include heading info in chunks', async () => {
      const content = `# Title

## First Section

Some content here.`;

      const parsed = await markdownParser.parseFile('test.md', content);
      const chunks = markdownParser.chunkDocument(parsed, 'test.md');

      const sectionChunk = chunks.find(c => c.heading === 'First Section');
      expect(sectionChunk).toBeDefined();
      expect(sectionChunk?.headingLevel).toBe(2);
    });

    it('should include document type from frontmatter', async () => {
      const content = `---
type: design_spec
tags: [architecture]
---

# Design

Content here.`;

      const parsed = await markdownParser.parseFile('design.md', content);
      const chunks = markdownParser.chunkDocument(parsed, 'design.md');

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].documentType).toBe('design_spec');
      expect(chunks[0].tags).toContain('architecture');
    });

    it('should handle single-section documents', async () => {
      const content = `Just some content without headings.`;

      const parsed = await markdownParser.parseFile('single.md', content);
      const chunks = markdownParser.chunkDocument(parsed, 'single.md');

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].text).toContain('Just some content');
    });
  });

  describe('chunkBySections', () => {
    it('should create sections between H2 headings', () => {
      const content = `# Title

Intro

## Section 1

Content 1

## Section 2

Content 2`;

      const headings = markdownParser.extractHeadings(content, 0);
      const sections = markdownParser.chunkBySections(content, headings, 'test.md', 0);

      // Should have intro + 2 sections
      expect(sections.length).toBe(3);
    });

    it('should handle content before first heading', () => {
      const content = `Some intro text here.

# Heading

Main content.`;

      const headings = markdownParser.extractHeadings(content, 0);
      const sections = markdownParser.chunkBySections(content, headings, 'test.md', 0);

      // Should have pre-heading section + heading section
      expect(sections.length).toBe(2);
      expect(sections[0].content).toContain('Some intro text');
    });

    it('should generate unique section IDs', () => {
      const content = `# H1

Content

## H2

More content`;

      const headings = markdownParser.extractHeadings(content, 0);
      const sections = markdownParser.chunkBySections(content, headings, 'test.md', 0);

      const ids = sections.map(s => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('integration with CodeParser', () => {
    it('should detect markdown files', () => {
      expect(parser.isMarkdownFile('README.md')).toBe(true);
      expect(parser.isMarkdownFile('docs/guide.md')).toBe(true);
      expect(parser.isMarkdownFile('docs/guide.markdown')).toBe(true);
      expect(parser.isMarkdownFile('file.txt')).toBe(false);
      expect(parser.isMarkdownFile('script.ts')).toBe(false);
    });

    it('should parse markdown documents through main parser', async () => {
      const content = `# Test Doc

Some content.`;

      const parsed = await parser.parseDocument('test.md', content);

      expect(parsed).toBeDefined();
      expect(parsed?.headings).toBeDefined();
      expect(parsed?.sections).toBeDefined();
    });
  });
});

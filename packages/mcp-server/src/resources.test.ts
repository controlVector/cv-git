/**
 * Unit tests for MCP Resources
 */

import { describe, it, expect } from 'vitest';
import { listResources, MCPResource } from './resources.js';

describe('MCP Resources', () => {
  describe('listResources', () => {
    it('should return an array of resources', () => {
      const resources = listResources();
      expect(Array.isArray(resources)).toBe(true);
      expect(resources.length).toBeGreaterThan(0);
    });

    it('should include cv://context/auto resource', () => {
      const resources = listResources();
      const autoContext = resources.find((r: MCPResource) => r.uri === 'cv://context/auto');

      expect(autoContext).toBeDefined();
      expect(autoContext?.name).toBe('Automatic Code Context');
      expect(autoContext?.mimeType).toBe('application/json');
      expect(autoContext?.description).toContain('knowledge graph');
    });

    it('should include cv://graph/summary resource', () => {
      const resources = listResources();
      const graphSummary = resources.find((r: MCPResource) => r.uri === 'cv://graph/summary');

      expect(graphSummary).toBeDefined();
      expect(graphSummary?.name).toBe('Knowledge Graph Summary');
      expect(graphSummary?.mimeType).toBe('application/json');
    });

    it('should include cv://status resource', () => {
      const resources = listResources();
      const status = resources.find((r: MCPResource) => r.uri === 'cv://status');

      expect(status).toBeDefined();
      expect(status?.name).toBe('Repository Status');
      expect(status?.mimeType).toBe('application/json');
    });

    it('should have valid URI format for all resources', () => {
      const resources = listResources();

      for (const resource of resources) {
        expect(resource.uri).toMatch(/^cv:\/\//);
        expect(resource.name).toBeTruthy();
      }
    });

    it('should have unique URIs', () => {
      const resources = listResources();
      const uris = resources.map((r: MCPResource) => r.uri);
      const uniqueUris = [...new Set(uris)];

      expect(uris.length).toBe(uniqueUris.length);
    });
  });
});

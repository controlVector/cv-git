/**
 * Service URL Configuration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getFalkorDbUrl,
  getQdrantUrl,
  getOllamaUrl,
  getServiceUrls,
  DEFAULT_URLS
} from '../../packages/core/src/config/service-urls.js';

describe('Service URL Configuration', () => {
  // Save original env vars
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save and clear relevant env vars
    const envVars = [
      'CV_FALKORDB_URL', 'FALKORDB_URL',
      'CV_QDRANT_URL', 'QDRANT_URL',
      'CV_OLLAMA_URL', 'OLLAMA_HOST', 'OLLAMA_URL'
    ];
    for (const key of envVars) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore original env vars
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe('getFalkorDbUrl', () => {
    it('should return default URL when no env var or config', () => {
      expect(getFalkorDbUrl()).toBe('redis://localhost:6379');
    });

    it('should return config URL when provided', () => {
      expect(getFalkorDbUrl('redis://custom:1234')).toBe('redis://custom:1234');
    });

    it('should prefer CV_FALKORDB_URL over config', () => {
      process.env.CV_FALKORDB_URL = 'redis://env-cv:6379';
      expect(getFalkorDbUrl('redis://config:6379')).toBe('redis://env-cv:6379');
    });

    it('should prefer CV_FALKORDB_URL over FALKORDB_URL', () => {
      process.env.CV_FALKORDB_URL = 'redis://cv-prefixed:6379';
      process.env.FALKORDB_URL = 'redis://non-prefixed:6379';
      expect(getFalkorDbUrl()).toBe('redis://cv-prefixed:6379');
    });

    it('should use FALKORDB_URL as fallback', () => {
      process.env.FALKORDB_URL = 'redis://fallback:6379';
      expect(getFalkorDbUrl()).toBe('redis://fallback:6379');
    });
  });

  describe('getQdrantUrl', () => {
    it('should return default URL when no env var or config', () => {
      expect(getQdrantUrl()).toBe('http://localhost:6333');
    });

    it('should return config URL when provided', () => {
      expect(getQdrantUrl('http://custom:9999')).toBe('http://custom:9999');
    });

    it('should prefer CV_QDRANT_URL over config', () => {
      process.env.CV_QDRANT_URL = 'http://env-cv:6333';
      expect(getQdrantUrl('http://config:6333')).toBe('http://env-cv:6333');
    });

    it('should prefer CV_QDRANT_URL over QDRANT_URL', () => {
      process.env.CV_QDRANT_URL = 'http://cv-prefixed:6333';
      process.env.QDRANT_URL = 'http://non-prefixed:6333';
      expect(getQdrantUrl()).toBe('http://cv-prefixed:6333');
    });

    it('should use QDRANT_URL as fallback', () => {
      process.env.QDRANT_URL = 'http://fallback:6333';
      expect(getQdrantUrl()).toBe('http://fallback:6333');
    });
  });

  describe('getOllamaUrl', () => {
    it('should return default URL when no env var or config', () => {
      expect(getOllamaUrl()).toBe('http://localhost:11434');
    });

    it('should return config URL when provided', () => {
      expect(getOllamaUrl('http://custom:8080')).toBe('http://custom:8080');
    });

    it('should prefer CV_OLLAMA_URL over config', () => {
      process.env.CV_OLLAMA_URL = 'http://env-cv:11434';
      expect(getOllamaUrl('http://config:11434')).toBe('http://env-cv:11434');
    });

    it('should prefer CV_OLLAMA_URL over OLLAMA_HOST', () => {
      process.env.CV_OLLAMA_URL = 'http://cv-prefixed:11434';
      process.env.OLLAMA_HOST = 'http://ollama-host:11434';
      expect(getOllamaUrl()).toBe('http://cv-prefixed:11434');
    });

    it('should use OLLAMA_HOST as fallback', () => {
      process.env.OLLAMA_HOST = 'http://ollama-host:11434';
      expect(getOllamaUrl()).toBe('http://ollama-host:11434');
    });

    it('should use OLLAMA_URL as last env fallback', () => {
      process.env.OLLAMA_URL = 'http://ollama-url:11434';
      expect(getOllamaUrl()).toBe('http://ollama-url:11434');
    });

    it('should strip trailing slash from URLs', () => {
      process.env.CV_OLLAMA_URL = 'http://localhost:11434/';
      expect(getOllamaUrl()).toBe('http://localhost:11434');
    });

    it('should strip trailing slash from config URL', () => {
      expect(getOllamaUrl('http://localhost:11434/')).toBe('http://localhost:11434');
    });
  });

  describe('getServiceUrls', () => {
    it('should return all default URLs when no config', () => {
      const urls = getServiceUrls();
      expect(urls.falkordb).toBe('redis://localhost:6379');
      expect(urls.qdrant).toBe('http://localhost:6333');
      expect(urls.ollama).toBe('http://localhost:11434');
    });

    it('should use config values when provided', () => {
      const urls = getServiceUrls({
        falkordb: 'redis://custom:1234',
        qdrant: 'http://custom:5678',
        ollama: 'http://custom:9999'
      });
      expect(urls.falkordb).toBe('redis://custom:1234');
      expect(urls.qdrant).toBe('http://custom:5678');
      expect(urls.ollama).toBe('http://custom:9999');
    });

    it('should prefer env vars over config', () => {
      process.env.CV_FALKORDB_URL = 'redis://env:6379';
      process.env.CV_QDRANT_URL = 'http://env:6333';
      process.env.CV_OLLAMA_URL = 'http://env:11434';

      const urls = getServiceUrls({
        falkordb: 'redis://config:6379',
        qdrant: 'http://config:6333',
        ollama: 'http://config:11434'
      });

      expect(urls.falkordb).toBe('redis://env:6379');
      expect(urls.qdrant).toBe('http://env:6333');
      expect(urls.ollama).toBe('http://env:11434');
    });
  });

  describe('DEFAULT_URLS', () => {
    it('should export default URLs for reference', () => {
      expect(DEFAULT_URLS.falkordb).toBe('redis://localhost:6379');
      expect(DEFAULT_URLS.qdrant).toBe('http://localhost:6333');
      expect(DEFAULT_URLS.ollama).toBe('http://localhost:11434');
    });
  });
});

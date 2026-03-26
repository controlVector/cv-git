/**
 * RedisBackend — FalkorDB via the `redis` npm package.
 *
 * This is the existing production backend, extracted from GraphManager.
 * Used for remote FalkorDB servers (CV-Hub, Docker, systemd).
 * Communicates via GRAPH.QUERY Redis command in compact mode.
 */

import { createClient, type RedisClientType } from 'redis';
import type { IGraphBackend } from '../backend.js';

export interface RedisBackendOptions {
  url: string;
}

export class RedisBackend implements IGraphBackend {
  private client: RedisClientType | null = null;
  private connected = false;
  private url: string;

  constructor(options: RedisBackendOptions) {
    this.url = options.url;
  }

  async connect(): Promise<void> {
    this.client = createClient({
      url: this.url,
      socket: {
        reconnectStrategy: (retries: number) => {
          if (retries > 10) {
            return new Error('Max reconnection attempts reached');
          }
          return retries * 100;
        },
      },
    });

    this.client.on('error', () => {
      this.connected = false;
    });

    this.client.on('end', () => {
      this.connected = false;
    });

    this.client.on('reconnecting', () => {
      this.connected = false;
    });

    this.client.on('ready', () => {
      this.connected = true;
    });

    await this.client.connect();
    this.connected = true;
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        // Ignore close errors
      }
      this.client = null;
      this.connected = false;
    }
  }

  async ping(): Promise<boolean> {
    if (!this.client || !this.connected) return false;
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async rawQuery(graphName: string, cypher: string): Promise<unknown> {
    if (!this.client || !this.connected) {
      throw new Error('RedisBackend: not connected');
    }
    return this.client.sendCommand([
      'GRAPH.QUERY',
      graphName,
      cypher,
      '--compact',
    ]);
  }

  isConnected(): boolean {
    return this.connected;
  }
}

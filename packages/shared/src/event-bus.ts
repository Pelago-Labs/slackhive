/**
 * @fileoverview Unified event bus for agent lifecycle events.
 *
 * Provides a common publish/subscribe interface that works with:
 * - Redis (production / Docker mode) — for cross-process communication
 * - In-process EventEmitter (simple / non-Docker mode) — zero-dependency
 *
 * The implementation is chosen automatically based on REDIS_URL:
 * - If REDIS_URL is set → Redis pub/sub
 * - Otherwise → in-process EventEmitter
 *
 * @module @slackhive/shared/event-bus
 */

import { EventEmitter } from 'events';
import { AGENT_EVENTS_CHANNEL, type AgentEvent } from './types';

// =============================================================================
// Interface
// =============================================================================

export interface EventBus {
  /** Publish an agent lifecycle event. */
  publish(event: AgentEvent): Promise<void>;
  /** Subscribe to agent lifecycle events. */
  subscribe(handler: (event: AgentEvent) => void): Promise<void>;
  /** Unsubscribe and disconnect. */
  close(): Promise<void>;
  /** The transport type. */
  readonly type: 'redis' | 'memory';
}

// =============================================================================
// In-memory implementation
// =============================================================================

class MemoryEventBus implements EventBus {
  readonly type = 'memory' as const;
  private emitter = new EventEmitter();

  async publish(event: AgentEvent): Promise<void> {
    this.emitter.emit(AGENT_EVENTS_CHANNEL, event);
  }

  async subscribe(handler: (event: AgentEvent) => void): Promise<void> {
    this.emitter.on(AGENT_EVENTS_CHANNEL, handler);
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}

// =============================================================================
// Redis implementation
// =============================================================================

class RedisEventBus implements EventBus {
  readonly type = 'redis' as const;
  private publisher: any = null;
  private subscriber: any = null;

  constructor(private redisUrl: string) {}

  async publish(event: AgentEvent): Promise<void> {
    if (!this.publisher) {
      const { createClient } = await import('redis');
      this.publisher = createClient({ url: this.redisUrl });
      await this.publisher.connect();
    }
    await this.publisher.publish(AGENT_EVENTS_CHANNEL, JSON.stringify(event));
  }

  async subscribe(handler: (event: AgentEvent) => void): Promise<void> {
    const { createClient } = await import('redis');
    this.subscriber = createClient({ url: this.redisUrl });

    this.subscriber.on('error', (err: Error) => {
      console.warn('Redis subscriber error:', err.message);
    });

    await this.subscriber.connect();
    await this.subscriber.subscribe(AGENT_EVENTS_CHANNEL, (message: string) => {
      try {
        const event = JSON.parse(message) as AgentEvent;
        handler(event);
      } catch {
        console.warn('Received malformed agent event:', message);
      }
    });
  }

  async close(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribe().catch(() => {});
      await this.subscriber.disconnect().catch(() => {});
      this.subscriber = null;
    }
    if (this.publisher) {
      await this.publisher.disconnect().catch(() => {});
      this.publisher = null;
    }
  }
}

// =============================================================================
// Singleton factory
// =============================================================================

let _bus: EventBus | null = null;

/**
 * Returns the singleton event bus instance.
 * Creates it on first call:
 * - Redis if REDIS_URL is set
 * - In-memory EventEmitter otherwise
 */
export function getEventBus(): EventBus {
  if (!_bus) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      _bus = new RedisEventBus(redisUrl);
    } else {
      _bus = new MemoryEventBus();
    }
  }
  return _bus;
}

/**
 * Set the event bus directly (e.g., for sharing in single-process mode).
 */
export function setEventBus(bus: EventBus): void {
  _bus = bus;
}

/**
 * Close and reset the event bus.
 */
export async function closeEventBus(): Promise<void> {
  if (_bus) {
    await _bus.close();
    _bus = null;
  }
}

/**
 * Message Bus - Handles inter-agent communication
 * MVP: In-memory pub/sub (production would use Redis)
 */

import { EventEmitter } from 'events';
import { AgentMessage } from '../types';

export class MessageBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100); // Support many agents
  }

  async publish(channel: string, message: AgentMessage): Promise<void> {
    this.emitter.emit(channel, message);
  }

  async subscribe(channel: string, handler: (message: AgentMessage) => void | Promise<void>): Promise<void> {
    this.emitter.on(channel, handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.emitter.removeAllListeners(channel);
  }
}

/**
 * Memory Manager - Handles agent memory storage and retrieval
 * MVP: In-memory implementation (production would use PostgreSQL + pgvector)
 */

import { Memory } from '../types';

export class MemoryManager {
  private memories: Map<string, Memory[]> = new Map();
  private agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  async store(memory: { agentId: string; content: string; metadata?: Record<string, any> }): Promise<void> {
    const memories = this.memories.get(memory.agentId) || [];

    const newMemory: Memory = {
      id: `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      agentId: memory.agentId,
      content: memory.content,
      metadata: memory.metadata || {},
      createdAt: Date.now()
    };

    memories.push(newMemory);
    this.memories.set(memory.agentId, memories);
  }

  async search(query: { query: string; limit?: number; filter?: Record<string, any> }): Promise<Memory[]> {
    const memories = this.memories.get(this.agentId) || [];

    // Simple keyword matching for MVP
    const filtered = memories.filter(m => {
      const contentMatch = m.content.toLowerCase().includes(query.query.toLowerCase());
      const filterMatch = !query.filter || Object.entries(query.filter).every(([key, value]) => {
        return m.metadata[key] === value;
      });
      return contentMatch && filterMatch;
    });

    // Sort by relevance (most recent first)
    filtered.sort((a, b) => b.createdAt - a.createdAt);

    return filtered.slice(0, query.limit || 5);
  }

  async clear(agentId: string): Promise<void> {
    this.memories.delete(agentId);
  }
}

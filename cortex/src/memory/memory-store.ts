/**
 * Memory Store - JSON-based storage with vector search
 *
 * Handles CRUD operations for memories with semantic deduplication.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  Memory,
  MemorySearchResult,
  MemorySearchOptions,
  MemoryStoreData,
  MemoryMetadata,
} from './types.js';
import { EmbeddingService, getEmbeddingService } from './embedding-service.js';

const CURRENT_VERSION = 1;
const DEDUP_THRESHOLD = 0.95;  // Skip if >95% similar memory exists

export class MemoryStore {
  private memories: Memory[] = [];
  private storagePath: string;
  private embeddingService: EmbeddingService;
  private initialized = false;

  constructor(memoryDir: string) {
    this.storagePath = path.join(memoryDir, 'memories.json');
    this.embeddingService = getEmbeddingService();
  }

  /**
   * Initialize the store - load existing memories from disk
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Ensure embedding service is ready
    await this.embeddingService.init();

    // Ensure directory exists
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Load existing memories
    if (fs.existsSync(this.storagePath)) {
      try {
        const data = fs.readFileSync(this.storagePath, 'utf-8');
        const parsed: MemoryStoreData = JSON.parse(data);

        if (parsed.version === CURRENT_VERSION) {
          this.memories = parsed.memories;
          console.log(`[Memory] Loaded ${this.memories.length} memories from disk`);
        } else {
          console.log('[Memory] Memory store version mismatch, starting fresh');
          this.memories = [];
        }
      } catch (error) {
        console.error('[Memory] Failed to load memories:', error);
        this.memories = [];
      }
    }

    this.initialized = true;
  }

  /**
   * Persist memories to disk
   */
  private async persist(): Promise<void> {
    const data: MemoryStoreData = {
      version: CURRENT_VERSION,
      memories: this.memories,
    };

    try {
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[Memory] Failed to persist memories:', error);
      throw error;
    }
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if a similar memory already exists
   */
  async findDuplicate(embedding: number[]): Promise<Memory | null> {
    for (const memory of this.memories) {
      const similarity = this.embeddingService.cosineSimilarity(embedding, memory.embedding);
      if (similarity > DEDUP_THRESHOLD) {
        return memory;
      }
    }
    return null;
  }

  /**
   * Add a new memory
   */
  async add(content: string, metadata: MemoryMetadata): Promise<Memory | null> {
    // Generate embedding
    const embedding = await this.embeddingService.embed(content);

    // Check for duplicates
    const duplicate = await this.findDuplicate(embedding);
    if (duplicate) {
      console.log(`[Memory] Skipping duplicate memory (${(DEDUP_THRESHOLD * 100).toFixed(0)}% similar to existing)`);
      // Update access count on duplicate
      duplicate.accessCount++;
      duplicate.updatedAt = new Date().toISOString();
      await this.persist();
      return null;
    }

    const now = new Date().toISOString();
    const memory: Memory = {
      id: this.generateId(),
      content,
      embedding,
      metadata,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
    };

    this.memories.push(memory);
    await this.persist();

    console.log(`[Memory] Stored new memory: "${content.substring(0, 50)}..."`);
    return memory;
  }

  /**
   * Search for relevant memories using vector similarity
   */
  async search(query: string, options: MemorySearchOptions = {}): Promise<MemorySearchResult[]> {
    const { limit = 5, category, minSimilarity = 0.3, tags } = options;

    if (this.memories.length === 0) {
      return [];
    }

    // Generate query embedding
    const queryEmbedding = await this.embeddingService.embed(query);

    // Calculate similarities and filter
    const results: MemorySearchResult[] = [];

    for (const memory of this.memories) {
      // Apply category filter
      if (category && memory.metadata.category !== category) {
        continue;
      }

      // Apply tags filter
      if (tags && tags.length > 0) {
        const memoryTags = memory.metadata.tags || [];
        const hasMatchingTag = tags.some(tag => memoryTags.includes(tag));
        if (!hasMatchingTag) continue;
      }

      const similarity = this.embeddingService.cosineSimilarity(queryEmbedding, memory.embedding);

      if (similarity >= minSimilarity) {
        results.push({ memory, similarity });
      }
    }

    // Sort by similarity (descending) and limit
    results.sort((a, b) => b.similarity - a.similarity);

    // Update access counts for returned memories
    const topResults = results.slice(0, limit);
    for (const result of topResults) {
      result.memory.accessCount++;
      result.memory.updatedAt = new Date().toISOString();
    }

    if (topResults.length > 0) {
      await this.persist();
    }

    return topResults;
  }

  /**
   * Delete memories matching a query
   */
  async delete(query: string, deleteAll = false): Promise<Memory[]> {
    // Find matching memories
    const results = await this.search(query, { limit: deleteAll ? 100 : 5, minSimilarity: 0.5 });

    if (results.length === 0) {
      return [];
    }

    const toDelete = deleteAll ? results : results.slice(0, 1);
    const deletedMemories: Memory[] = [];

    for (const result of toDelete) {
      const index = this.memories.findIndex(m => m.id === result.memory.id);
      if (index !== -1) {
        deletedMemories.push(this.memories[index]);
        this.memories.splice(index, 1);
      }
    }

    if (deletedMemories.length > 0) {
      await this.persist();
      console.log(`[Memory] Deleted ${deletedMemories.length} memories`);
    }

    return deletedMemories;
  }

  /**
   * Delete a memory by ID
   */
  async deleteById(id: string): Promise<boolean> {
    const index = this.memories.findIndex(m => m.id === id);
    if (index === -1) {
      return false;
    }

    this.memories.splice(index, 1);
    await this.persist();
    return true;
  }

  /**
   * List all memories (for debugging/admin)
   */
  list(): Memory[] {
    return [...this.memories];
  }

  /**
   * Get memory count
   */
  count(): number {
    return this.memories.length;
  }

  /**
   * Clear all memories
   */
  async clear(): Promise<void> {
    this.memories = [];
    await this.persist();
    console.log('[Memory] All memories cleared');
  }
}

/**
 * Memory Manager - High-level orchestration for the memory system
 *
 * Coordinates the embedding service, memory store, and extraction
 * to provide semantic memory capabilities.
 */

import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { MemoryStore } from './memory-store.js';
import { MemoryExtractor } from './extraction.js';
import { getEmbeddingService } from './embedding-service.js';
import {
  Memory,
  MemorySearchResult,
  MemoryCategory,
  MemoryMetadata,
} from './types.js';

const DEFAULT_MEMORY_DIR = '.claudian/memories';
const DEFAULT_CONTEXT_LIMIT = 5;

export interface MemoryManagerConfig {
  apiKey: string;
  memoryDir?: string;
  autoExtract?: boolean;
}

export class MemoryManager {
  private store: MemoryStore;
  private extractor: MemoryExtractor;
  private config: Required<MemoryManagerConfig>;
  private initialized = false;
  private currentSessionId: string;

  constructor(config: MemoryManagerConfig) {
    this.config = {
      apiKey: config.apiKey,
      memoryDir: config.memoryDir || DEFAULT_MEMORY_DIR,
      autoExtract: config.autoExtract ?? true,
    };

    this.store = new MemoryStore(this.config.memoryDir);
    this.extractor = new MemoryExtractor(this.config.apiKey);
    this.currentSessionId = this.generateSessionId();
  }

  /**
   * Initialize the memory system
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize embedding service first
      const embeddingService = getEmbeddingService();
      await embeddingService.init();

      // Then initialize the store
      await this.store.init();

      this.initialized = true;
      console.log('[Memory] Memory manager initialized');
    } catch (error) {
      console.error('[Memory] Failed to initialize memory manager:', error);
      throw error;
    }
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  /**
   * Store an explicit memory (via skill call)
   */
  async storeExplicit(
    content: string,
    options: {
      category?: MemoryCategory;
      importance?: number;
      tags?: string[];
    } = {}
  ): Promise<Memory | null> {
    await this.init();

    const metadata: MemoryMetadata = {
      source: 'explicit',
      category: options.category,
      importance: options.importance ?? 0.8,
      tags: options.tags,
      sessionId: this.currentSessionId,
    };

    return this.store.add(content, metadata);
  }

  /**
   * Extract and store memories from a conversation (post-conversation hook)
   */
  async extractFromConversation(messages: MessageParam[]): Promise<Memory[]> {
    if (!this.config.autoExtract) {
      return [];
    }

    await this.init();

    const facts = await this.extractor.extractFromConversation(messages);
    const storedMemories: Memory[] = [];

    for (const fact of facts) {
      const metadata: MemoryMetadata = {
        source: 'extracted',
        category: fact.category,
        importance: fact.importance,
        sessionId: this.currentSessionId,
      };

      const memory = await this.store.add(fact.content, metadata);
      if (memory) {
        storedMemories.push(memory);
      }
    }

    return storedMemories;
  }

  /**
   * Query for relevant memories given a context
   */
  async queryRelevant(
    context: string,
    options: {
      limit?: number;
      category?: MemoryCategory;
      minSimilarity?: number;
    } = {}
  ): Promise<MemorySearchResult[]> {
    await this.init();

    return this.store.search(context, {
      limit: options.limit ?? DEFAULT_CONTEXT_LIMIT,
      category: options.category,
      minSimilarity: options.minSimilarity ?? 0.4,
    });
  }

  /**
   * Build an augmented system prompt with relevant memories
   */
  async buildAugmentedPrompt(basePrompt: string, context: string): Promise<string> {
    await this.init();

    const memories = await this.queryRelevant(context, { limit: 5 });

    if (memories.length === 0) {
      return basePrompt;
    }

    const memorySection = this.formatMemoriesForPrompt(memories);
    return `${basePrompt}\n\n${memorySection}`;
  }

  /**
   * Format memories for injection into the system prompt
   */
  private formatMemoriesForPrompt(memories: MemorySearchResult[]): string {
    const lines = memories.map(({ memory }) => {
      const category = memory.metadata.category || 'general';
      return `- [${category}] ${memory.content}`;
    });

    return `## Relevant Memories

The following information has been stored from previous conversations:

${lines.join('\n')}

Use this context to provide more personalized and consistent responses.`;
  }

  /**
   * Delete memories matching a query
   */
  async forget(query: string, deleteAll = false): Promise<Memory[]> {
    await this.init();
    return this.store.delete(query, deleteAll);
  }

  /**
   * Delete a specific memory by ID
   */
  async forgetById(id: string): Promise<boolean> {
    await this.init();
    return this.store.deleteById(id);
  }

  /**
   * List all memories
   */
  async listAll(): Promise<Memory[]> {
    await this.init();
    return this.store.list();
  }

  /**
   * Get memory count
   */
  async count(): Promise<number> {
    await this.init();
    return this.store.count();
  }

  /**
   * Clear all memories
   */
  async clearAll(): Promise<void> {
    await this.init();
    await this.store.clear();
  }

  /**
   * Check if the manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.currentSessionId;
  }

  /**
   * Start a new session
   */
  newSession(): void {
    this.currentSessionId = this.generateSessionId();
  }
}

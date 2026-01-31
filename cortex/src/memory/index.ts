/**
 * Memory Module - Hybrid SQLite & Markdown Memory System
 *
 * Exports the memory manager and related components for use by
 * the kernel and skills.
 *
 * Architecture:
 * - Core Context: Hard facts always loaded into system prompt
 * - Knowledge: On-demand snippets retrieved via query_memory
 * - Episodes: Conversation summaries for archival
 */

// Import for singleton management
import { MemoryManager, type MemoryManagerConfig } from './manager.js';

// Re-export main components
export { MemoryManager, type MemoryManagerConfig } from './manager.js';
export { MemoryDatabase, getDatabase, initDatabase } from './db.js';
export { CoreContext, getCoreContext } from './core.js';
export { EmbeddingService, getEmbeddingService } from './embedding-service.js';

// Re-export all schema types
export {
  MemoryCategory,
  MemorySource,
  CoreFact,
  CoreFactRow,
  Episode,
  EpisodeRow,
  KnowledgeSnippet,
  KnowledgeRow,
  KnowledgeSearchResult,
  StoreMemoryInput,
  QueryMemoryInput,
  ReflectionResult,
  CREATE_TABLES_SQL,
} from './schema.js';

// Legacy type exports for backwards compatibility
export type {
  Memory,
  MemoryMetadata,
  MemorySearchResult as LegacyMemorySearchResult,
  MemorySearchOptions,
  ExtractedFact,
} from './types.js';

// Singleton memory manager instance
let memoryManagerInstance: MemoryManager | null = null;

/**
 * Get or create the singleton memory manager instance
 */
export function getMemoryManager(apiKey?: string): MemoryManager {
  if (!memoryManagerInstance) {
    if (!apiKey) {
      throw new Error('API key required for first memory manager initialization');
    }
    memoryManagerInstance = new MemoryManager({ apiKey });
  }
  return memoryManagerInstance;
}

/**
 * Initialize the memory manager with custom config
 */
export function initMemoryManager(config: MemoryManagerConfig): MemoryManager {
  if (memoryManagerInstance) {
    console.log('[Memory] Memory manager already initialized, returning existing instance');
    return memoryManagerInstance;
  }

  memoryManagerInstance = new MemoryManager(config);
  return memoryManagerInstance;
}

/**
 * Check if memory manager is initialized
 */
export function isMemoryManagerInitialized(): boolean {
  return memoryManagerInstance !== null;
}

/**
 * Reset the memory manager singleton (for testing)
 */
export function resetMemoryManager(): void {
  memoryManagerInstance = null;
}

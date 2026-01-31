/**
 * Memory Module - Long-term semantic memory for Claudian
 *
 * Exports the memory manager and related types for use by the kernel
 * and skills.
 */

import { MemoryManager, type MemoryManagerConfig } from './memory-manager.js';

export { MemoryManager, type MemoryManagerConfig } from './memory-manager.js';
export { MemoryStore } from './memory-store.js';
export { EmbeddingService, getEmbeddingService } from './embedding-service.js';
export { MemoryExtractor } from './extraction.js';
export {
  Memory,
  MemorySearchResult,
  MemoryMetadata,
  MemoryCategory,
  MemorySource,
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
export function initMemoryManager(config: {
  apiKey: string;
  memoryDir?: string;
  autoExtract?: boolean;
}): MemoryManager {
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

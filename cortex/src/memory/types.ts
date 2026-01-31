/**
 * Type definitions for the long-term memory system
 */

export type MemorySource = 'explicit' | 'extracted';

export type MemoryCategory =
  | 'preference'
  | 'fact'
  | 'project'
  | 'instruction'
  | 'personal'
  | 'technical';

export interface MemoryMetadata {
  source: MemorySource;
  category?: MemoryCategory;
  importance?: number;  // 0-1 scale
  tags?: string[];
  sessionId?: string;
}

export interface Memory {
  id: string;
  content: string;
  embedding: number[];  // 384-dimensional vector
  metadata: MemoryMetadata;
  createdAt: string;
  updatedAt: string;
  accessCount: number;
}

export interface MemorySearchResult {
  memory: Memory;
  similarity: number;
}

export interface MemorySearchOptions {
  limit?: number;
  category?: MemoryCategory;
  minSimilarity?: number;
  tags?: string[];
}

export interface ExtractedFact {
  content: string;
  category: MemoryCategory;
  importance: number;
}

export interface MemoryStoreData {
  version: number;
  memories: Memory[];
}

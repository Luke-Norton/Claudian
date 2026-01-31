/**
 * Database Schema Types for Claudian Memory System
 *
 * Defines TypeScript interfaces for SQLite tables:
 * - core_facts: Hard facts always loaded into system prompt
 * - episodes: Past conversation summaries (archival)
 * - knowledge: Knowledge snippets for on-demand retrieval
 */

/**
 * Memory categories for organizing facts and knowledge
 */
export type MemoryCategory =
  | 'preference'    // User preferences (dark mode, coding style)
  | 'fact'          // General facts about user/environment
  | 'project'       // Project-specific information
  | 'instruction'   // How the agent should behave
  | 'personal'      // Personal info about the user
  | 'technical'     // Technical details, configs, specs
  | 'identity';     // Agent identity facts

/**
 * Source of the memory entry
 */
export type MemorySource = 'explicit' | 'extracted' | 'reflection';

/**
 * Core Fact - Always loaded into system prompt
 * These are high-importance, stable facts that define context
 */
export interface CoreFact {
  id: number;
  content: string;
  category: MemoryCategory;
  importance: number;          // 0-1, higher = more important
  createdAt: string;           // ISO timestamp
  updatedAt: string;           // ISO timestamp
  active: boolean;             // Can be disabled without deleting
}

/**
 * Row type for core_facts table in SQLite
 */
export interface CoreFactRow {
  id: number;
  content: string;
  category: string;
  importance: number;
  created_at: string;
  updated_at: string;
  active: number;              // SQLite uses 0/1 for boolean
}

/**
 * Episode - Summary of a past conversation session
 * Stored for archival, queried on-demand
 */
export interface Episode {
  id: number;
  sessionId: string;           // Unique session identifier
  summary: string;             // Claude-generated summary of the conversation
  keyTopics: string[];         // Main topics discussed
  keyTakeaways: string[];      // Important conclusions/decisions
  messageCount: number;        // Number of messages in session
  startedAt: string;           // When session started
  endedAt: string;             // When session ended
  createdAt: string;           // When this record was created
}

/**
 * Row type for episodes table in SQLite
 */
export interface EpisodeRow {
  id: number;
  session_id: string;
  summary: string;
  key_topics: string;          // JSON array
  key_takeaways: string;       // JSON array
  message_count: number;
  started_at: string;
  ended_at: string;
  created_at: string;
}

/**
 * Knowledge Snippet - Fact or information for on-demand retrieval
 * Not auto-loaded; retrieved via query_memory tool
 */
export interface KnowledgeSnippet {
  id: number;
  content: string;
  category: MemoryCategory;
  importance: number;          // 0-1
  source: MemorySource;        // How it was added
  tags: string[];              // For filtering
  sessionId?: string;          // Session where it was created
  embedding?: number[];        // Vector embedding for semantic search
  accessCount: number;         // Times retrieved
  createdAt: string;
  updatedAt: string;
}

/**
 * Row type for knowledge table in SQLite
 */
export interface KnowledgeRow {
  id: number;
  content: string;
  category: string;
  importance: number;
  source: string;
  tags: string;                // JSON array
  session_id: string | null;
  embedding: Buffer | null;    // Stored as BLOB
  access_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Search result from knowledge query
 */
export interface KnowledgeSearchResult {
  snippet: KnowledgeSnippet;
  score: number;               // Relevance score (higher = better)
  matchType: 'keyword' | 'semantic' | 'category';
}

/**
 * Input for storing a new memory
 */
export interface StoreMemoryInput {
  content: string;
  category: MemoryCategory;
  importance?: number;
  tags?: string[];
  source?: MemorySource;
  isCoreFact?: boolean;        // If true, store in core_facts
}

/**
 * Input for querying memories
 */
export interface QueryMemoryInput {
  query: string;
  category?: MemoryCategory;
  limit?: number;
  includeEpisodes?: boolean;
  minImportance?: number;
}

/**
 * Reflection result from summarizing a conversation
 */
export interface ReflectionResult {
  summary: string;
  keyTopics: string[];
  keyTakeaways: string[];
  extractedFacts: Array<{
    content: string;
    category: MemoryCategory;
    importance: number;
    isCoreFact: boolean;
  }>;
}

/**
 * SQL table creation statements
 */
export const CREATE_TABLES_SQL = `
-- Core facts: Always loaded into system prompt
CREATE TABLE IF NOT EXISTS core_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.8,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  active INTEGER NOT NULL DEFAULT 1
);

-- Index for active core facts
CREATE INDEX IF NOT EXISTS idx_core_facts_active ON core_facts(active);

-- Episodes: Past conversation summaries
CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  key_topics TEXT NOT NULL DEFAULT '[]',
  key_takeaways TEXT NOT NULL DEFAULT '[]',
  message_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for session lookup
CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id);
CREATE INDEX IF NOT EXISTS idx_episodes_ended ON episodes(ended_at);

-- Knowledge: On-demand retrievable snippets
CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL DEFAULT 'explicit',
  tags TEXT NOT NULL DEFAULT '[]',
  session_id TEXT,
  embedding BLOB,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for knowledge queries
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_importance ON knowledge(importance);

-- Full-text search for knowledge content
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  content,
  category,
  tags,
  content='knowledge',
  content_rowid='id'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
  INSERT INTO knowledge_fts(rowid, content, category, tags)
  VALUES (new.id, new.content, new.category, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, content, category, tags)
  VALUES ('delete', old.id, old.content, old.category, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, content, category, tags)
  VALUES ('delete', old.id, old.content, old.category, old.tags);
  INSERT INTO knowledge_fts(rowid, content, category, tags)
  VALUES (new.id, new.content, new.category, new.tags);
END;
`;

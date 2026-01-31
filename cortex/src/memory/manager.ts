/**
 * Memory Manager - Hybrid SQLite & Markdown Memory System
 *
 * Orchestrates the tiered memory system:
 * - Core Context: Hard facts loaded into system prompt
 * - Knowledge: On-demand snippets retrieved via query_memory
 * - Episodes: Conversation summaries for archival
 *
 * Key principle: Only core facts auto-load. Everything else requires
 * explicit query_memory calls to touch the LLM context.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { MemoryDatabase, getDatabase } from './db.js';
import { CoreContext, getCoreContext } from './core.js';
import { getEmbeddingService, EmbeddingService } from './embedding-service.js';
import {
  KnowledgeSnippet,
  KnowledgeRow,
  Episode,
  EpisodeRow,
  MemoryCategory,
  MemorySource,
  KnowledgeSearchResult,
  StoreMemoryInput,
  QueryMemoryInput,
  ReflectionResult,
} from './schema.js';
import { getBackupSystem, autoBackup } from './backup.js';

const REFLECTION_MODEL = 'claude-3-haiku-20240307';
const REFLECTION_MAX_TOKENS = 2048;

export interface MemoryManagerConfig {
  apiKey: string;
  memoryDir?: string;
  enableEmbeddings?: boolean;
}

/**
 * Memory Manager - High-level orchestration for the hybrid memory system
 */
export class MemoryManager {
  private db: MemoryDatabase;
  private coreContext: CoreContext;
  private embeddingService: EmbeddingService;
  private client: Anthropic;
  private config: Required<MemoryManagerConfig>;
  private initialized = false;
  private currentSessionId: string;
  private sessionStartTime: string;

  constructor(config: MemoryManagerConfig) {
    this.config = {
      apiKey: config.apiKey,
      memoryDir: config.memoryDir || '.claudian',
      enableEmbeddings: config.enableEmbeddings ?? true,
    };

    this.db = getDatabase(this.config.memoryDir);
    this.coreContext = getCoreContext();
    this.embeddingService = getEmbeddingService();
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.currentSessionId = this.generateSessionId();
    this.sessionStartTime = new Date().toISOString();
  }

  /**
   * Initialize the memory system
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize database first
      await this.db.init();

      // Initialize core context (uses same db)
      await this.coreContext.init();

      // Initialize embeddings if enabled
      if (this.config.enableEmbeddings) {
        await this.embeddingService.init();
      }

      // Initialize backup system
      const backupSystem = getBackupSystem(this.config.memoryDir);
      backupSystem.init();
      
      // Check for auto-backup on startup
      await autoBackup(this.config.memoryDir);

      this.initialized = true;
      console.log('[Memory] Memory manager initialized with backup system');
    } catch (error) {
      console.error('[Memory] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  // ============================================================
  // CORE CONTEXT METHODS (Auto-loaded into system prompt)
  // ============================================================

  /**
   * Build the system prompt with core context
   * This is the ONLY method that auto-loads data into LLM context
   */
  async buildAugmentedPrompt(basePrompt: string): Promise<string> {
    await this.init();

    const coreSection = await this.coreContext.buildPromptSection();

    if (!coreSection) {
      return basePrompt;
    }

    return `${basePrompt}\n\n${coreSection}`;
  }

  /**
   * Add a core fact (always loaded into prompt)
   */
  async addCoreFact(
    content: string,
    category: MemoryCategory,
    importance = 0.9
  ): Promise<number> {
    await this.init();
    const fact = await this.coreContext.addFact(content, category, importance);
    return fact.id;
  }

  // ============================================================
  // KNOWLEDGE METHODS (On-demand via query_memory)
  // ============================================================

  /**
   * Store a knowledge snippet (NOT auto-loaded)
   */
  async storeKnowledge(input: StoreMemoryInput): Promise<KnowledgeSnippet> {
    await this.init();

    // If marked as core fact, store there instead
    if (input.isCoreFact) {
      const fact = await this.coreContext.addFact(
        input.content,
        input.category,
        input.importance ?? 0.9
      );
      // Return as KnowledgeSnippet format for consistency
      return {
        id: fact.id,
        content: fact.content,
        category: fact.category,
        importance: fact.importance,
        source: input.source || 'explicit',
        tags: input.tags || [],
        sessionId: this.currentSessionId,
        accessCount: 0,
        createdAt: fact.createdAt,
        updatedAt: fact.updatedAt,
      };
    }

    const now = new Date().toISOString();
    const tags = input.tags || [];
    const tagsJson = JSON.stringify(tags);
    const source = input.source || 'explicit';
    const importance = input.importance ?? 0.5;

    // Generate embedding if enabled
    let embeddingBuffer: Buffer | null = null;
    if (this.config.enableEmbeddings) {
      try {
        const embedding = await this.embeddingService.embed(input.content);
        embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);
      } catch (error) {
        console.warn('[Memory] Failed to generate embedding:', error);
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO knowledge (content, category, importance, source, tags, session_id, embedding, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = await this.db.writeWithRetry(() =>
      stmt.run(
        input.content,
        input.category,
        importance,
        source,
        tagsJson,
        this.currentSessionId,
        embeddingBuffer,
        now,
        now
      )
    );

    console.log(`[Memory] Stored knowledge: "${input.content.substring(0, 50)}..."`);

    // Trigger auto-backup after significant write operations
    autoBackup(this.config.memoryDir).catch(() => {}); // Don't let backup failures break storage

    return {
      id: result.lastInsertRowid as number,
      content: input.content,
      category: input.category,
      importance,
      source,
      tags,
      sessionId: this.currentSessionId,
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Query knowledge (called by query_memory tool)
   * Results are returned to LLM only when explicitly requested
   * TOKEN-OPTIMIZED: Smart filtering and adaptive limits for cost efficiency
   */
  async queryKnowledge(input: QueryMemoryInput): Promise<KnowledgeSearchResult[]> {
    await this.init();

    // Analyze query to determine search strategy
    const queryAnalysis = this.analyzeQuery(input.query);
    const dynamicLimit = this.calculateOptimalLimit(queryAnalysis, input.limit);
    
    const results: KnowledgeSearchResult[] = [];

    // Try FTS search first with higher relevance threshold
    const ftsResults = await this.searchFTS(input.query, input.category, dynamicLimit * 2);
    
    // Apply FTS quality filter (higher minimum score)
    const qualityFtsResults = ftsResults.filter(result => {
      const minScore = queryAnalysis.isSpecific ? 0.5 : 1.0; // BM25 scores
      return Math.abs(result.score) >= minScore;
    });
    
    results.push(...qualityFtsResults);

    // If embeddings enabled and we need more results, try semantic search
    if (this.config.enableEmbeddings && results.length < dynamicLimit) {
      const semanticResults = await this.searchSemantic(
        input.query,
        input.category,
        dynamicLimit - results.length
      );

      // Merge with higher semantic threshold, avoiding duplicates
      const existingIds = new Set(results.map(r => r.snippet.id));
      for (const result of semanticResults) {
        if (!existingIds.has(result.snippet.id) && result.score >= queryAnalysis.minSemanticScore) {
          results.push(result);
        }
      }
    }

    // Smart deduplication - remove very similar content
    const dedupedResults = this.smartDeduplication(results);

    // Sort by relevance score and apply final filtering
    dedupedResults.sort((a, b) => this.calculateRelevanceScore(b, queryAnalysis) - this.calculateRelevanceScore(a, queryAnalysis));
    
    // Apply adaptive limiting based on content quality
    const finalResults = this.applyAdaptiveLimiting(dedupedResults, dynamicLimit, queryAnalysis);

    // Update access counts for returned results only
    await this.updateAccessCounts(finalResults.map(r => r.snippet.id));

    // Log token efficiency metrics
    console.log(`[Memory] Query "${input.query.substring(0, 30)}..." - ${results.length} raw → ${finalResults.length} filtered (${((finalResults.length / Math.max(results.length, 1)) * 100).toFixed(0)}% precision)`);

    return finalResults;
  }

  /**
   * Full-text search using FTS5
   */
  private async searchFTS(
    query: string,
    category?: MemoryCategory,
    limit = 10
  ): Promise<KnowledgeSearchResult[]> {
    // Escape FTS special characters
    const escapedQuery = query.replace(/['"]/g, '').replace(/\s+/g, ' ').trim();
    if (!escapedQuery) return [];

    let sql = `
      SELECT k.*, bm25(knowledge_fts) as score
      FROM knowledge k
      JOIN knowledge_fts ON k.id = knowledge_fts.rowid
      WHERE knowledge_fts MATCH ?
    `;
    const params: (string | number)[] = [escapedQuery + '*'];

    if (category) {
      sql += ' AND k.category = ?';
      params.push(category);
    }

    sql += ' ORDER BY score LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as (KnowledgeRow & { score: number })[];

    return rows.map(row => ({
      snippet: this.rowToSnippet(row),
      score: Math.abs(row.score), // BM25 returns negative scores
      matchType: 'keyword' as const,
    }));
  }

  /**
   * Semantic search using embeddings
   */
  private async searchSemantic(
    query: string,
    category?: MemoryCategory,
    limit = 10
  ): Promise<KnowledgeSearchResult[]> {
    if (!this.config.enableEmbeddings) return [];

    try {
      const queryEmbedding = await this.embeddingService.embed(query);

      let sql = 'SELECT * FROM knowledge WHERE embedding IS NOT NULL';
      const params: string[] = [];

      if (category) {
        sql += ' AND category = ?';
        params.push(category);
      }

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as KnowledgeRow[];

      // Calculate similarities
      const scored: Array<{ row: KnowledgeRow; similarity: number }> = [];

      for (const row of rows) {
        if (!row.embedding) continue;

        const embedding = Array.from(new Float32Array(row.embedding.buffer));
        const similarity = this.embeddingService.cosineSimilarity(queryEmbedding, embedding);

        // Dynamic threshold - higher for better token efficiency
        const dynamicThreshold = this.calculateSemanticThreshold(query, rows.length);
        if (similarity > dynamicThreshold) {
          scored.push({ row, similarity });
        }
      }

      // Sort by similarity
      scored.sort((a, b) => b.similarity - a.similarity);

      return scored.slice(0, limit).map(({ row, similarity }) => ({
        snippet: this.rowToSnippet(row),
        score: similarity,
        matchType: 'semantic' as const,
      }));
    } catch (error) {
      console.warn('[Memory] Semantic search failed:', error);
      return [];
    }
  }

  /**
   * Update access counts for retrieved snippets
   */
  private async updateAccessCounts(ids: number[]): Promise<void> {
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      UPDATE knowledge
      SET access_count = access_count + 1, updated_at = ?
      WHERE id IN (${placeholders})
    `);

    await this.db.writeWithRetry(() =>
      stmt.run(new Date().toISOString(), ...ids)
    );
  }

  /**
   * Delete a knowledge snippet by ID
   */
  async deleteKnowledgeById(id: number): Promise<boolean> {
    await this.init();

    const stmt = this.db.prepare('DELETE FROM knowledge WHERE id = ?');
    const result = await this.db.writeWithRetry(() => stmt.run(id));

    if (result.changes > 0) {
      console.log(`[Memory] Deleted knowledge snippet: ${id}`);
      return true;
    }
    return false;
  }

  // ============================================================
  // EPISODE METHODS (Conversation summaries)
  // ============================================================

  /**
   * Reflect and summarize a conversation session
   * Called at end of session to extract and store key information
   */
  async reflectAndSummarize(messages: MessageParam[]): Promise<ReflectionResult | null> {
    await this.init();

    if (messages.length < 2) {
      console.log('[Memory] Skipping reflection - too few messages');
      return null;
    }

    const conversationText = this.formatConversationForReflection(messages);

    try {
      const response = await this.client.messages.create({
        model: REFLECTION_MODEL,
        max_tokens: REFLECTION_MAX_TOKENS,
        system: REFLECTION_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Please reflect on and summarize this conversation:\n\n${conversationText}`,
          },
        ],
      });

      const textContent = response.content.find(b => b.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return null;
      }

      const result = this.parseReflectionResponse(textContent.text);
      if (!result) return null;

      // Save episode
      await this.saveEpisode(result, messages.length);

      // Store extracted facts
      for (const fact of result.extractedFacts) {
        if (fact.isCoreFact) {
          await this.coreContext.addFact(fact.content, fact.category, fact.importance);
        } else {
          await this.storeKnowledge({
            content: fact.content,
            category: fact.category,
            importance: fact.importance,
            source: 'reflection',
          });
        }
      }

      console.log(`[Memory] Reflection complete: ${result.keyTakeaways.length} takeaways, ${result.extractedFacts.length} facts`);
      return result;
    } catch (error) {
      console.error('[Memory] Reflection failed:', error);
      return null;
    }
  }

  /**
   * Save an episode (conversation summary)
   */
  private async saveEpisode(reflection: ReflectionResult, messageCount: number): Promise<void> {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO episodes (session_id, summary, key_topics, key_takeaways, message_count, started_at, ended_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    await this.db.writeWithRetry(() =>
      stmt.run(
        this.currentSessionId,
        reflection.summary,
        JSON.stringify(reflection.keyTopics),
        JSON.stringify(reflection.keyTakeaways),
        messageCount,
        this.sessionStartTime,
        now,
        now
      )
    );
  }

  /**
   * Get recent episodes (for context if needed)
   */
  async getRecentEpisodes(limit = 5): Promise<Episode[]> {
    await this.init();

    const stmt = this.db.prepare(`
      SELECT * FROM episodes
      ORDER BY ended_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as EpisodeRow[];
    return rows.map(this.rowToEpisode);
  }

  // ============================================================
  // UTILITY METHODS
  // ============================================================

  /**
   * Format conversation for reflection
   */
  private formatConversationForReflection(messages: MessageParam[]): string {
    const lines: string[] = [];

    for (const msg of messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';

      if (typeof msg.content === 'string') {
        lines.push(`${role}: ${msg.content}`);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ('text' in block && block.text) {
            lines.push(`${role}: ${block.text}`);
          }
        }
      }
    }

    // Truncate if too long
    const text = lines.join('\n\n');
    if (text.length > 10000) {
      return text.substring(0, 10000) + '\n\n[...truncated...]';
    }
    return text;
  }

  /**
   * Parse reflection response JSON
   */
  private parseReflectionResponse(text: string): ReflectionResult | null {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        summary: parsed.summary || '',
        keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics : [],
        keyTakeaways: Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways : [],
        extractedFacts: Array.isArray(parsed.extractedFacts)
          ? parsed.extractedFacts.filter((f: Record<string, unknown>) =>
              typeof f.content === 'string' &&
              typeof f.category === 'string' &&
              typeof f.importance === 'number'
            )
          : [],
      };
    } catch {
      console.error('[Memory] Failed to parse reflection response');
      return null;
    }
  }

  /**
   * Convert database row to KnowledgeSnippet
   */
  private rowToSnippet(row: KnowledgeRow): KnowledgeSnippet {
    return {
      id: row.id,
      content: row.content,
      category: row.category as MemoryCategory,
      importance: row.importance,
      source: row.source as MemorySource,
      tags: JSON.parse(row.tags || '[]'),
      sessionId: row.session_id || undefined,
      embedding: row.embedding
        ? Array.from(new Float32Array(row.embedding.buffer))
        : undefined,
      accessCount: row.access_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Convert database row to Episode
   */
  private rowToEpisode(row: EpisodeRow): Episode {
    return {
      id: row.id,
      sessionId: row.session_id,
      summary: row.summary,
      keyTopics: JSON.parse(row.key_topics || '[]'),
      keyTakeaways: JSON.parse(row.key_takeaways || '[]'),
      messageCount: row.message_count,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      createdAt: row.created_at,
    };
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.currentSessionId;
  }

  /**
   * Start a new session
   */
  newSession(): void {
    this.currentSessionId = this.generateSessionId();
    this.sessionStartTime = new Date().toISOString();
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get statistics including backup information
   */
  async getStats(): Promise<{
    coreFacts: number;
    knowledgeSnippets: number;
    episodes: number;
    backup: {
      totalBackups: number;
      oldestBackup: string | null;
      newestBackup: string | null;
      totalSizeKB: number;
    };
  }> {
    await this.init();

    const coreCount = await this.coreContext.count();

    const knowledgeStmt = this.db.prepare('SELECT COUNT(*) as count FROM knowledge');
    const knowledgeResult = knowledgeStmt.get() as { count: number };

    const episodeStmt = this.db.prepare('SELECT COUNT(*) as count FROM episodes');
    const episodeResult = episodeStmt.get() as { count: number };

    const backupSystem = getBackupSystem(this.config.memoryDir);
    const backupStats = backupSystem.getStats();

    return {
      coreFacts: coreCount,
      knowledgeSnippets: knowledgeResult.count,
      episodes: episodeResult.count,
      backup: backupStats,
    };
  }

  /**
   * Create a manual backup of the memory database
   */
  async createBackup(): Promise<string | null> {
    await this.init();
    const backupSystem = getBackupSystem(this.config.memoryDir);
    const backup = await backupSystem.createBackup();
    return backup?.filename || null;
  }

  /**
   * List available backups
   */
  async listBackups(): Promise<Array<{
    filename: string;
    timestamp: string;
    size: number;
    sizeKB: string;
  }>> {
    await this.init();
    const backupSystem = getBackupSystem(this.config.memoryDir);
    const backups = backupSystem.listBackups();
    
    return backups.map(backup => ({
      filename: backup.filename,
      timestamp: backup.timestamp,
      size: backup.size,
      sizeKB: (backup.size / 1024).toFixed(1)
    }));
  }

  /**
   * Restore from a specific backup file
   */
  async restoreFromBackup(backupFilename: string): Promise<boolean> {
    const backupSystem = getBackupSystem(this.config.memoryDir);
    const success = await backupSystem.restoreFromBackup(backupFilename);
    
    if (success) {
      // Reinitialize after restore
      this.initialized = false;
      await this.init();
    }
    
    return success;
  }

  // ============================================================
  // TOKEN OPTIMIZATION METHODS
  // ============================================================

  /**
   * Analyze query to determine optimal search strategy
   */
  private analyzeQuery(query: string): {
    isSpecific: boolean;
    isFactual: boolean;
    isPreference: boolean;
    complexity: number;
    minSemanticScore: number;
  } {
    const words = query.toLowerCase().split(/\s+/);
    const length = words.length;
    
    // Detect specific queries (names, dates, technical terms)
    const specificPatterns = /\b\d{4}\b|\b[A-Z][a-z]+\s[A-Z][a-z]+\b|api|config|system|setting/i;
    const isSpecific = specificPatterns.test(query) || words.some(w => w.length > 8);
    
    // Detect factual vs preference queries
    const factualKeywords = ['what', 'when', 'where', 'how', 'which', 'who'];
    const preferenceKeywords = ['prefer', 'like', 'want', 'need', 'favorite', 'setting'];
    
    const isFactual = factualKeywords.some(kw => words.includes(kw));
    const isPreference = preferenceKeywords.some(kw => words.includes(kw));
    
    // Calculate complexity score
    const complexity = Math.min(length / 10, 1); // 0-1 scale
    
    // Determine minimum semantic score based on query type
    let minSemanticScore = 0.4; // default
    if (isSpecific) minSemanticScore = 0.5;
    if (isPreference) minSemanticScore = 0.6; // Preferences need high relevance
    if (length < 3) minSemanticScore = 0.7; // Short queries need high precision
    
    return {
      isSpecific,
      isFactual,
      isPreference,
      complexity,
      minSemanticScore,
    };
  }

  /**
   * Calculate optimal result limit based on query analysis
   */
  private calculateOptimalLimit(analysis: ReturnType<typeof this.analyzeQuery>, requestedLimit?: number): number {
    const baseLimit = requestedLimit || 10;
    
    // Reduce limit for simple/specific queries to save tokens
    if (analysis.isSpecific && analysis.complexity < 0.3) {
      return Math.max(3, Math.floor(baseLimit * 0.5));
    }
    
    // Slightly increase for complex queries but cap to avoid token waste
    if (analysis.complexity > 0.7) {
      return Math.min(baseLimit * 1.2, 12);
    }
    
    return baseLimit;
  }

  /**
   * Calculate dynamic semantic similarity threshold
   */
  private calculateSemanticThreshold(query: string, totalResults: number): number {
    const baseThreshold = 0.4;
    
    // Higher threshold when we have many results (be more selective)
    if (totalResults > 20) return 0.6;
    if (totalResults > 10) return 0.5;
    
    // Lower threshold for short queries that might have semantic gaps
    if (query.split(/\s+/).length <= 2) return 0.45;
    
    return baseThreshold;
  }

  /**
   * Smart deduplication to remove very similar content
   */
  private smartDeduplication(results: KnowledgeSearchResult[]): KnowledgeSearchResult[] {
    if (results.length <= 3) return results; // Skip dedup for small result sets
    
    const unique: KnowledgeSearchResult[] = [];
    const seenContent = new Set<string>();
    
    // Sort by score to keep best results when deduplicating
    const sorted = [...results].sort((a, b) => b.score - a.score);
    
    for (const result of sorted) {
      const content = result.snippet.content.toLowerCase();
      const contentWords = new Set(content.split(/\s+/).filter(w => w.length > 3));
      
      // Check for substantial overlap with existing results
      let isDuplicate = false;
      for (const seenWords of seenContent) {
        const overlap = this.calculateWordOverlap(contentWords, new Set(seenWords.split(/\s+/)));
        if (overlap > 0.7) { // 70% word overlap = duplicate
          isDuplicate = true;
          break;
        }
      }
      
      if (!isDuplicate) {
        unique.push(result);
        seenContent.add(content);
      }
    }
    
    return unique;
  }

  /**
   * Calculate word overlap between two sets
   */
  private calculateWordOverlap(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 || set2.size === 0) return 0;
    
    const intersection = new Set([...set1].filter(w => set2.has(w)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  /**
   * Calculate composite relevance score for ranking
   */
  private calculateRelevanceScore(result: KnowledgeSearchResult, analysis: ReturnType<typeof this.analyzeQuery>): number {
    let score = result.score;
    
    // Boost recent memories (recency bias)
    const daysSinceUpdate = (Date.now() - new Date(result.snippet.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    const recencyBoost = Math.max(0, 1 - daysSinceUpdate / 30); // Boost memories from last 30 days
    score += recencyBoost * 0.1;
    
    // Boost frequently accessed memories
    const accessBoost = Math.min(result.snippet.accessCount * 0.02, 0.2);
    score += accessBoost;
    
    // Boost high importance memories
    score += result.snippet.importance * 0.15;
    
    // Category-specific boosts
    if (analysis.isPreference && result.snippet.category === 'preference') score += 0.3;
    if (analysis.isFactual && ['fact', 'technical'].includes(result.snippet.category)) score += 0.2;
    
    return score;
  }

  /**
   * Apply adaptive limiting based on content quality and relevance distribution
   */
  private applyAdaptiveLimiting(
    results: KnowledgeSearchResult[], 
    targetLimit: number, 
    analysis: ReturnType<typeof this.analyzeQuery>
  ): KnowledgeSearchResult[] {
    if (results.length <= targetLimit) return results;
    
    // Calculate score distribution to find natural cutoffs
    const scores = results.map(r => r.score);
    const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const scoreStdDev = Math.sqrt(scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / scores.length);
    
    // Find quality threshold (1 standard deviation above mean)
    const qualityThreshold = avgScore + scoreStdDev * 0.5;
    
    // Keep high-quality results even if over limit, but cap at 1.5x target
    const highQualityResults = results.filter(r => r.score >= qualityThreshold);
    if (highQualityResults.length <= targetLimit * 1.5) {
      return highQualityResults;
    }
    
    // Fallback to simple limit
    return results.slice(0, targetLimit);
  }

  // Legacy compatibility methods

  /**
   * @deprecated Use storeKnowledge instead
   */
  async storeExplicit(
    content: string,
    options: { category?: MemoryCategory; importance?: number; tags?: string[] } = {}
  ): Promise<KnowledgeSnippet | null> {
    return this.storeKnowledge({
      content,
      category: options.category || 'fact',
      importance: options.importance,
      tags: options.tags,
      source: 'explicit',
    });
  }

  /**
   * @deprecated Use queryKnowledge instead
   */
  async queryRelevant(
    context: string,
    options: { limit?: number; category?: MemoryCategory } = {}
  ): Promise<Array<{ memory: KnowledgeSnippet; similarity: number }>> {
    const results = await this.queryKnowledge({
      query: context,
      category: options.category,
      limit: options.limit,
    });

    return results.map(r => ({
      memory: r.snippet,
      similarity: r.score,
    }));
  }
}

// Reflection prompt for Claude
const REFLECTION_PROMPT = `You are a memory reflection assistant. Your job is to analyze a conversation and extract key information worth remembering.

Analyze the conversation and return a JSON object with:
1. summary: A 1-2 sentence summary of what was discussed
2. keyTopics: Array of main topics (strings)
3. keyTakeaways: Array of important conclusions or decisions made
4. extractedFacts: Array of facts to remember, each with:
   - content: The fact as a clear statement
   - category: One of 'preference', 'fact', 'project', 'instruction', 'personal', 'technical'
   - importance: 0-1 (how important is this to remember)
   - isCoreFact: true if this should ALWAYS be in context (user preferences, critical instructions)

Guidelines:
- Only extract genuinely useful information for future conversations
- Core facts should be stable, important things (preferences, identity, critical project info)
- Regular facts are searchable but not auto-loaded
- Be concise and specific
- If nothing is worth remembering, return empty arrays

Respond with ONLY the JSON object, no other text.`;

// Singleton instance
let memoryManagerInstance: MemoryManager | null = null;

/**
 * Get the singleton MemoryManager instance
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
    return memoryManagerInstance;
  }
  memoryManagerInstance = new MemoryManager(config);
  return memoryManagerInstance;
}

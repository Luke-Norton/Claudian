/**
 * Core Context Module - Hard Facts for System Prompt
 *
 * Manages "Core Facts" that are always loaded into the system prompt.
 * These are high-importance, stable facts about:
 * - User preferences and identity
 * - Agent identity and behavior rules
 * - Critical project context
 */

import { MemoryDatabase, getDatabase } from './db.js';
import {
  CoreFact,
  CoreFactRow,
  MemoryCategory,
} from './schema.js';

/**
 * Core Context Manager
 * Handles CRUD operations for core facts and prompt injection
 */
export class CoreContext {
  private db: MemoryDatabase;
  private initialized = false;

  constructor(db?: MemoryDatabase) {
    this.db = db || getDatabase();
  }

  /**
   * Initialize the core context
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await this.db.init();
    this.initialized = true;
  }

  /**
   * Add a new core fact
   */
  async addFact(
    content: string,
    category: MemoryCategory,
    importance = 0.8
  ): Promise<CoreFact> {
    await this.init();

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO core_facts (content, category, importance, created_at, updated_at, active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);

    const result = await this.db.writeWithRetry(() =>
      stmt.run(content, category, importance, now, now)
    );

    console.log(`[Core] Added core fact: "${content.substring(0, 50)}..."`);

    return {
      id: result.lastInsertRowid as number,
      content,
      category,
      importance,
      createdAt: now,
      updatedAt: now,
      active: true,
    };
  }

  /**
   * Get all active core facts
   */
  async getActiveFacts(): Promise<CoreFact[]> {
    await this.init();

    const stmt = this.db.prepare(`
      SELECT * FROM core_facts
      WHERE active = 1
      ORDER BY importance DESC, created_at ASC
    `);

    const rows = stmt.all() as CoreFactRow[];
    return rows.map(this.rowToFact);
  }

  /**
   * Get core facts by category
   */
  async getFactsByCategory(category: MemoryCategory): Promise<CoreFact[]> {
    await this.init();

    const stmt = this.db.prepare(`
      SELECT * FROM core_facts
      WHERE active = 1 AND category = ?
      ORDER BY importance DESC
    `);

    const rows = stmt.all(category) as CoreFactRow[];
    return rows.map(this.rowToFact);
  }

  /**
   * Update a core fact
   */
  async updateFact(
    id: number,
    updates: Partial<Pick<CoreFact, 'content' | 'category' | 'importance' | 'active'>>
  ): Promise<boolean> {
    await this.init();

    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (updates.content !== undefined) {
      fields.push('content = ?');
      values.push(updates.content);
    }
    if (updates.category !== undefined) {
      fields.push('category = ?');
      values.push(updates.category);
    }
    if (updates.importance !== undefined) {
      fields.push('importance = ?');
      values.push(updates.importance);
    }
    if (updates.active !== undefined) {
      fields.push('active = ?');
      values.push(updates.active ? 1 : 0);
    }

    if (fields.length === 0) return false;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE core_facts SET ${fields.join(', ')} WHERE id = ?
    `);

    const result = await this.db.writeWithRetry(() => stmt.run(...values));
    return result.changes > 0;
  }

  /**
   * Deactivate a core fact (soft delete)
   */
  async deactivateFact(id: number): Promise<boolean> {
    return this.updateFact(id, { active: false });
  }

  /**
   * Delete a core fact permanently
   */
  async deleteFact(id: number): Promise<boolean> {
    await this.init();

    const stmt = this.db.prepare('DELETE FROM core_facts WHERE id = ?');
    const result = await this.db.writeWithRetry(() => stmt.run(id));
    return result.changes > 0;
  }

  /**
   * Check if a similar fact already exists
   */
  async findSimilarFact(content: string): Promise<CoreFact | null> {
    await this.init();

    // Simple substring match for now
    // Could be enhanced with fuzzy matching or embeddings
    const normalizedContent = content.toLowerCase().trim();

    const stmt = this.db.prepare(`
      SELECT * FROM core_facts
      WHERE active = 1 AND LOWER(content) LIKE ?
      LIMIT 1
    `);

    const row = stmt.get(`%${normalizedContent.substring(0, 50)}%`) as CoreFactRow | undefined;
    return row ? this.rowToFact(row) : null;
  }

  /**
   * Build the core context section for the system prompt
   * Only loads active core facts - no database queries at runtime
   */
  async buildPromptSection(): Promise<string> {
    const facts = await this.getActiveFacts();

    if (facts.length === 0) {
      return '';
    }

    // Group facts by category
    const grouped = new Map<MemoryCategory, CoreFact[]>();
    for (const fact of facts) {
      const list = grouped.get(fact.category) || [];
      list.push(fact);
      grouped.set(fact.category, list);
    }

    // Format for prompt
    const sections: string[] = [];

    // Priority order for categories
    const categoryOrder: MemoryCategory[] = [
      'identity',
      'instruction',
      'preference',
      'project',
      'personal',
      'fact',
      'technical',
    ];

    for (const category of categoryOrder) {
      const categoryFacts = grouped.get(category);
      if (categoryFacts && categoryFacts.length > 0) {
        const lines = categoryFacts.map(f => `- ${f.content}`);
        sections.push(`### ${this.formatCategory(category)}\n${lines.join('\n')}`);
      }
    }

    return `## Core Context

The following information has been established about the user and environment:

${sections.join('\n\n')}`;
  }

  /**
   * Format category name for display
   */
  private formatCategory(category: MemoryCategory): string {
    const names: Record<MemoryCategory, string> = {
      identity: 'Agent Identity',
      instruction: 'Instructions',
      preference: 'User Preferences',
      project: 'Project Context',
      personal: 'Personal Information',
      fact: 'Known Facts',
      technical: 'Technical Details',
    };
    return names[category] || category;
  }

  /**
   * Convert database row to CoreFact object
   */
  private rowToFact(row: CoreFactRow): CoreFact {
    return {
      id: row.id,
      content: row.content,
      category: row.category as MemoryCategory,
      importance: row.importance,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      active: row.active === 1,
    };
  }

  /**
   * Get count of active core facts
   */
  async count(): Promise<number> {
    await this.init();
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM core_facts WHERE active = 1');
    const result = stmt.get() as { count: number };
    return result.count;
  }
}

// Singleton instance
let coreContextInstance: CoreContext | null = null;

/**
 * Get the singleton CoreContext instance
 */
export function getCoreContext(): CoreContext {
  if (!coreContextInstance) {
    coreContextInstance = new CoreContext();
  }
  return coreContextInstance;
}

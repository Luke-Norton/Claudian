/**
 * Session Store - Persistent conversation storage
 *
 * Stores conversation history to disk as JSON files.
 * Each session has a unique ID and can be resumed later.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

export interface SessionMetadata {
  id: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  workingDir: string;
}

export interface SessionData {
  metadata: SessionMetadata;
  messages: MessageParam[];
}

export interface SessionStoreConfig {
  storageDir: string;
  maxSessions?: number; // Maximum sessions to keep (oldest are pruned)
}

const DEFAULT_STORAGE_DIR = ".claudian/sessions";
const DEFAULT_MAX_SESSIONS = 100;

export class SessionStore {
  private storageDir: string;
  private maxSessions: number;

  constructor(config: Partial<SessionStoreConfig> = {}) {
    this.storageDir = config.storageDir || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
    this.maxSessions = config.maxSessions || DEFAULT_MAX_SESSIONS;
  }

  /**
   * Initialize the storage directory
   */
  async init(): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
  }

  /**
   * Generate a new session ID
   */
  generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString("hex");
    return `${timestamp}-${random}`;
  }

  /**
   * Get the file path for a session
   */
  private getSessionPath(sessionId: string): string {
    // Sanitize session ID to prevent path traversal
    const sanitized = sessionId.replace(/[^a-zA-Z0-9-]/g, "");
    return path.join(this.storageDir, `${sanitized}.json`);
  }

  /**
   * Create a new session
   */
  async create(name?: string): Promise<SessionData> {
    await this.init();

    const id = this.generateId();
    const now = new Date().toISOString();

    const session: SessionData = {
      metadata: {
        id,
        name,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        workingDir: process.cwd(),
      },
      messages: [],
    };

    await this.save(session);
    await this.pruneOldSessions();

    return session;
  }

  /**
   * Load a session by ID
   */
  async load(sessionId: string): Promise<SessionData | null> {
    const sessionPath = this.getSessionPath(sessionId);

    try {
      const content = await fs.readFile(sessionPath, "utf-8");
      return JSON.parse(content) as SessionData;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Save a session
   */
  async save(session: SessionData): Promise<void> {
    await this.init();

    session.metadata.updatedAt = new Date().toISOString();
    session.metadata.messageCount = session.messages.length;

    const sessionPath = this.getSessionPath(session.metadata.id);
    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), "utf-8");
  }

  /**
   * Delete a session
   */
  async delete(sessionId: string): Promise<boolean> {
    const sessionPath = this.getSessionPath(sessionId);

    try {
      await fs.unlink(sessionPath);
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  /**
   * List all sessions
   */
  async list(): Promise<SessionMetadata[]> {
    await this.init();

    try {
      const files = await fs.readdir(this.storageDir);
      const sessions: SessionMetadata[] = [];

      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        try {
          const content = await fs.readFile(
            path.join(this.storageDir, file),
            "utf-8"
          );
          const session = JSON.parse(content) as SessionData;
          sessions.push(session.metadata);
        } catch {
          // Skip invalid files
        }
      }

      // Sort by updatedAt descending (most recent first)
      sessions.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      return sessions;
    } catch {
      return [];
    }
  }

  /**
   * Get the most recent session
   */
  async getLatest(): Promise<SessionData | null> {
    const sessions = await this.list();
    if (sessions.length === 0) return null;
    return this.load(sessions[0].id);
  }

  /**
   * Add a message to a session
   */
  async addMessage(sessionId: string, message: MessageParam): Promise<void> {
    const session = await this.load(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.messages.push(message);
    await this.save(session);
  }

  /**
   * Add multiple messages to a session
   */
  async addMessages(sessionId: string, messages: MessageParam[]): Promise<void> {
    const session = await this.load(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.messages.push(...messages);
    await this.save(session);
  }

  /**
   * Clear messages from a session but keep metadata
   */
  async clearMessages(sessionId: string): Promise<void> {
    const session = await this.load(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.messages = [];
    await this.save(session);
  }

  /**
   * Prune old sessions if over the limit
   */
  private async pruneOldSessions(): Promise<void> {
    const sessions = await this.list();

    if (sessions.length <= this.maxSessions) return;

    // Delete oldest sessions
    const toDelete = sessions.slice(this.maxSessions);
    for (const session of toDelete) {
      await this.delete(session.id);
    }
  }

  /**
   * Export a session to a standalone file
   */
  async export(sessionId: string, outputPath: string): Promise<void> {
    const session = await this.load(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    await fs.writeFile(outputPath, JSON.stringify(session, null, 2), "utf-8");
  }

  /**
   * Import a session from a file
   */
  async import(inputPath: string): Promise<SessionData> {
    const content = await fs.readFile(inputPath, "utf-8");
    const session = JSON.parse(content) as SessionData;

    // Generate new ID to avoid conflicts
    session.metadata.id = this.generateId();
    session.metadata.updatedAt = new Date().toISOString();

    await this.save(session);
    return session;
  }
}

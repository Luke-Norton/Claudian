/**
 * SQLite Database Wrapper for Claudian Memory System
 *
 * Provides a robust database connection with:
 * - Busy retry logic for Windows file-locking issues
 * - Proper path handling using path.join
 * - Automatic schema initialization
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { CREATE_TABLES_SQL } from './schema.js';

const DEFAULT_DB_DIR = '.claudian';
const DEFAULT_DB_NAME = 'claudian_memory.db';
const BUSY_TIMEOUT_MS = 5000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 100;

/**
 * Sleep utility for retry logic
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Database wrapper with Windows file-locking protection
 */
export class MemoryDatabase {
  private db: Database.Database | null = null;
  private dbPath: string;
  private initialized = false;

  constructor(baseDir?: string) {
    const dir = baseDir || path.join(process.cwd(), DEFAULT_DB_DIR);
    this.dbPath = path.join(dir, DEFAULT_DB_NAME);
  }

  /**
   * Initialize the database connection and schema
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open database with busy timeout
    this.db = await this.openWithRetry();

    // Configure for better Windows compatibility
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = ' + BUSY_TIMEOUT_MS);
    this.db.pragma('synchronous = NORMAL');

    // Initialize schema
    this.db.exec(CREATE_TABLES_SQL);

    this.initialized = true;
    console.log(`[Memory] Database initialized at: ${this.dbPath}`);
  }

  /**
   * Open database with retry logic for Windows file-locking
   */
  private async openWithRetry(): Promise<Database.Database> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        const db = new Database(this.dbPath);
        return db;
      } catch (error) {
        lastError = error as Error;
        const isLockError = (error as NodeJS.ErrnoException).code === 'SQLITE_BUSY' ||
          (error as Error).message.includes('database is locked') ||
          (error as Error).message.includes('EBUSY');

        if (isLockError && attempt < MAX_RETRY_ATTEMPTS) {
          console.log(`[Memory] Database busy, retrying (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})...`);
          await sleep(RETRY_DELAY_MS * attempt);
        } else {
          throw error;
        }
      }
    }

    throw lastError || new Error('Failed to open database');
  }

  /**
   * Execute a write operation with retry logic
   */
  async writeWithRetry<T>(operation: () => T): Promise<T> {
    this.ensureInitialized();

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        return operation();
      } catch (error) {
        lastError = error as Error;
        const isLockError = (error as Error).message.includes('SQLITE_BUSY') ||
          (error as Error).message.includes('database is locked');

        if (isLockError && attempt < MAX_RETRY_ATTEMPTS) {
          console.log(`[Memory] Write busy, retrying (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})...`);
          await sleep(RETRY_DELAY_MS * attempt);
        } else {
          throw error;
        }
      }
    }

    throw lastError || new Error('Write operation failed');
  }

  /**
   * Ensure database is initialized before operations
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
  }

  /**
   * Get the underlying database instance
   */
  getDb(): Database.Database {
    this.ensureInitialized();
    return this.db!;
  }

  /**
   * Prepare a statement
   */
  prepare(sql: string): Database.Statement {
    this.ensureInitialized();
    return this.db!.prepare(sql);
  }

  /**
   * Execute raw SQL
   */
  exec(sql: string): void {
    this.ensureInitialized();
    this.db!.exec(sql);
  }

  /**
   * Run a transaction
   */
  transaction<T>(fn: () => T): T {
    this.ensureInitialized();
    return this.db!.transaction(fn)();
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      console.log('[Memory] Database connection closed');
    }
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get database file path
   */
  getPath(): string {
    return this.dbPath;
  }
}

// Singleton instance
let dbInstance: MemoryDatabase | null = null;

/**
 * Get the singleton database instance
 */
export function getDatabase(baseDir?: string): MemoryDatabase {
  if (!dbInstance) {
    dbInstance = new MemoryDatabase(baseDir);
  }
  return dbInstance;
}

/**
 * Initialize the database (convenience function)
 */
export async function initDatabase(baseDir?: string): Promise<MemoryDatabase> {
  const db = getDatabase(baseDir);
  await db.init();
  return db;
}

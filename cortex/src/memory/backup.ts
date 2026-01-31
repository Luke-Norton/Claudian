/**
 * Memory Backup System
 * 
 * Provides automated backup and restore capabilities for the SQLite memory database.
 * Addresses the critical reliability gap identified by the audit.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDatabase } from './db.js';

const BACKUP_RETENTION_DAYS = 7;
const MAX_BACKUP_FILES = 10;

export interface BackupMetadata {
  filename: string;
  timestamp: string;
  size: number;
  version: string;
}

export class MemoryBackupSystem {
  private memoryDir: string;
  private backupDir: string;

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
    this.backupDir = path.join(memoryDir, 'backups');
  }

  /**
   * Initialize backup directory
   */
  init(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
      console.log('[Backup] Created backup directory');
    }
  }

  /**
   * Create a timestamped backup of the memory database
   */
  async createBackup(): Promise<BackupMetadata | null> {
    this.init();

    const dbPath = path.join(this.memoryDir, 'claudian_memory.db');
    
    if (!fs.existsSync(dbPath)) {
      console.log('[Backup] No database file to backup');
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilename = `claudian_memory_${timestamp}.db`;
    const backupPath = path.join(this.backupDir, backupFilename);

    try {
      // Copy the database file
      fs.copyFileSync(dbPath, backupPath);
      
      const stats = fs.statSync(backupPath);
      const metadata: BackupMetadata = {
        filename: backupFilename,
        timestamp: new Date().toISOString(),
        size: stats.size,
        version: '1.0'
      };

      // Save metadata
      const metadataPath = path.join(this.backupDir, `${backupFilename}.meta.json`);
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      console.log(`[Backup] Created backup: ${backupFilename} (${(stats.size / 1024).toFixed(1)} KB)`);
      
      // Cleanup old backups
      await this.cleanupOldBackups();
      
      return metadata;
    } catch (error) {
      console.error('[Backup] Failed to create backup:', error);
      return null;
    }
  }

  /**
   * Restore database from a specific backup
   */
  async restoreFromBackup(backupFilename: string): Promise<boolean> {
    const backupPath = path.join(this.backupDir, backupFilename);
    const dbPath = path.join(this.memoryDir, 'claudian_memory.db');

    if (!fs.existsSync(backupPath)) {
      console.error(`[Backup] Backup file not found: ${backupFilename}`);
      return false;
    }

    try {
      // Create backup of current database before restore
      const currentBackupName = `pre_restore_${Date.now()}.db`;
      const currentBackupPath = path.join(this.backupDir, currentBackupName);
      
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, currentBackupPath);
        console.log(`[Backup] Current database backed up as: ${currentBackupName}`);
      }

      // Restore from backup
      fs.copyFileSync(backupPath, dbPath);
      console.log(`[Backup] Database restored from: ${backupFilename}`);
      
      return true;
    } catch (error) {
      console.error('[Backup] Failed to restore backup:', error);
      return false;
    }
  }

  /**
   * List available backups with metadata
   */
  listBackups(): BackupMetadata[] {
    this.init();

    const backups: BackupMetadata[] = [];
    
    try {
      const files = fs.readdirSync(this.backupDir);
      
      for (const file of files) {
        if (file.endsWith('.db')) {
          const metadataFile = `${file}.meta.json`;
          const metadataPath = path.join(this.backupDir, metadataFile);
          
          if (fs.existsSync(metadataPath)) {
            try {
              const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
              backups.push(metadata);
            } catch (error) {
              console.warn(`[Backup] Failed to read metadata for ${file}`);
            }
          } else {
            // Create metadata for backups without it
            const backupPath = path.join(this.backupDir, file);
            const stats = fs.statSync(backupPath);
            const metadata: BackupMetadata = {
              filename: file,
              timestamp: stats.mtime.toISOString(),
              size: stats.size,
              version: 'unknown'
            };
            backups.push(metadata);
          }
        }
      }
    } catch (error) {
      console.error('[Backup] Failed to list backups:', error);
    }

    // Sort by timestamp (newest first)
    return backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Delete old backups based on retention policy
   */
  async cleanupOldBackups(): Promise<void> {
    const backups = this.listBackups();
    
    // Remove backups older than retention period
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - BACKUP_RETENTION_DAYS);
    
    let deleted = 0;
    
    for (const backup of backups) {
      const backupDate = new Date(backup.timestamp);
      const shouldDelete = 
        backupDate < cutoffDate || 
        backups.indexOf(backup) >= MAX_BACKUP_FILES;
      
      if (shouldDelete) {
        try {
          const backupPath = path.join(this.backupDir, backup.filename);
          const metadataPath = path.join(this.backupDir, `${backup.filename}.meta.json`);
          
          if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
          if (fs.existsSync(metadataPath)) fs.unlinkSync(metadataPath);
          
          deleted++;
        } catch (error) {
          console.warn(`[Backup] Failed to delete old backup ${backup.filename}:`, error);
        }
      }
    }
    
    if (deleted > 0) {
      console.log(`[Backup] Cleaned up ${deleted} old backup(s)`);
    }
  }

  /**
   * Setup automated backup schedule (call this periodically)
   * Returns true if backup was created, false if skipped
   */
  async checkAndBackup(): Promise<boolean> {
    const backups = this.listBackups();
    
    // Skip if we have a recent backup (within 24 hours)
    if (backups.length > 0) {
      const latestBackup = backups[0];
      const latestBackupTime = new Date(latestBackup.timestamp);
      const hoursSinceLastBackup = (Date.now() - latestBackupTime.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceLastBackup < 24) {
        return false; // Skip backup
      }
    }
    
    // Create backup
    const backup = await this.createBackup();
    return backup !== null;
  }

  /**
   * Get backup system statistics
   */
  getStats(): {
    totalBackups: number;
    oldestBackup: string | null;
    newestBackup: string | null;
    totalSizeKB: number;
  } {
    const backups = this.listBackups();
    
    const totalSizeKB = backups.reduce((sum, backup) => sum + backup.size, 0) / 1024;
    
    return {
      totalBackups: backups.length,
      oldestBackup: backups.length > 0 ? backups[backups.length - 1].timestamp : null,
      newestBackup: backups.length > 0 ? backups[0].timestamp : null,
      totalSizeKB: Math.round(totalSizeKB * 10) / 10
    };
  }
}

// Global backup system instance
let backupSystemInstance: MemoryBackupSystem | null = null;

/**
 * Get or create the backup system singleton
 */
export function getBackupSystem(memoryDir = '.claudian'): MemoryBackupSystem {
  if (!backupSystemInstance) {
    backupSystemInstance = new MemoryBackupSystem(memoryDir);
  }
  return backupSystemInstance;
}

/**
 * Auto-backup hook for memory operations
 * Call this after significant memory operations
 */
export async function autoBackup(memoryDir = '.claudian'): Promise<void> {
  try {
    const backupSystem = getBackupSystem(memoryDir);
    await backupSystem.checkAndBackup();
  } catch (error) {
    // Don't let backup failures break normal operations
    console.warn('[Backup] Auto-backup failed:', error);
  }
}
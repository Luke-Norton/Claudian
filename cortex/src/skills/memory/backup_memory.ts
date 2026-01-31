/**
 * Memory Backup Management Skill
 * 
 * Provides backup and restore capabilities for the memory system
 */

import { SkillDefinition, PermissionLevel } from '../../types.js';
import { getMemoryManager } from '../../memory/index.js';

export const backupMemorySkill: SkillDefinition = {
  name: 'backup_memory',
  description:
    'Create, list, or restore memory database backups. Addresses the critical reliability gap by providing automated backup capabilities.',
  permission: PermissionLevel.ALLOW, // Backup operations are safe
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform: "create", "list", "restore", or "stats"',
        enum: ['create', 'list', 'restore', 'stats'],
      },
      backupFilename: {
        type: 'string',
        description: 'For restore action: specific backup filename to restore from',
      },
    },
    required: ['action'],
  },
  execute: async (params: Record<string, unknown>) => {
    const action = params.action as string;
    const backupFilename = params.backupFilename as string;

    try {
      const memoryManager = getMemoryManager();

      switch (action) {
        case 'create': {
          const filename = await memoryManager.createBackup();
          if (filename) {
            return {
              success: true,
              output: `Backup created successfully: ${filename}`,
              metadata: { filename },
            };
          } else {
            return {
              success: false,
              error: 'Failed to create backup - no database file found',
            };
          }
        }

        case 'list': {
          const backups = await memoryManager.listBackups();
          if (backups.length === 0) {
            return {
              success: true,
              output: 'No backups found',
              metadata: { count: 0 },
            };
          }

          const lines = backups.map((backup, index) => {
            const date = new Date(backup.timestamp).toLocaleString();
            return `${index + 1}. ${backup.filename} - ${date} (${backup.sizeKB} KB)`;
          });

          const output = `Found ${backups.length} backups:\n\n${lines.join('\n')}`;
          
          return {
            success: true,
            output,
            metadata: { 
              count: backups.length, 
              backups: backups.map(b => ({
                filename: b.filename,
                timestamp: b.timestamp,
                sizeKB: b.sizeKB
              }))
            },
          };
        }

        case 'restore': {
          if (!backupFilename) {
            return {
              success: false,
              error: 'backupFilename parameter is required for restore action',
            };
          }

          const success = await memoryManager.restoreFromBackup(backupFilename);
          
          if (success) {
            return {
              success: true,
              output: `Successfully restored memory database from backup: ${backupFilename}`,
              metadata: { restoredFrom: backupFilename },
            };
          } else {
            return {
              success: false,
              error: `Failed to restore from backup: ${backupFilename} (file not found or restore failed)`,
            };
          }
        }

        case 'stats': {
          const stats = await memoryManager.getStats();
          
          const output = `Memory System Statistics:
          
Core Facts: ${stats.coreFacts}
Knowledge Snippets: ${stats.knowledgeSnippets}  
Episodes: ${stats.episodes}

Backup System:
- Total Backups: ${stats.backup.totalBackups}
- Total Size: ${stats.backup.totalSizeKB} KB
- Oldest Backup: ${stats.backup.oldestBackup ? new Date(stats.backup.oldestBackup).toLocaleDateString() : 'None'}
- Newest Backup: ${stats.backup.newestBackup ? new Date(stats.backup.newestBackup).toLocaleDateString() : 'None'}`;

          return {
            success: true,
            output,
            metadata: stats,
          };
        }

        default:
          return {
            success: false,
            error: `Invalid action: ${action}. Must be one of: create, list, restore, stats`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Backup operation failed: ${(error as Error).message}`,
      };
    }
  },
};
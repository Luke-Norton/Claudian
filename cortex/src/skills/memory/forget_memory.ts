/**
 * Forget Memory Skill - Delete memories matching a query
 *
 * Requires confirmation due to destructive nature.
 */

import { SkillDefinition, PermissionLevel } from '../../types.js';
import { getMemoryManager, Memory } from '../../memory/index.js';

export const forgetMemorySkill: SkillDefinition = {
  name: 'forget_memory',
  description:
    'Delete memories matching a query. Use this to remove outdated, incorrect, or unwanted memories. Requires user confirmation.',
  permission: PermissionLevel.CONFIRM,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Search query to find memories to delete. Memories semantically similar to this will be matched.',
      },
      confirm_all: {
        type: 'boolean',
        description:
          'If true, delete ALL matching memories. If false (default), only delete the best match.',
      },
    },
    required: ['query'],
  },
  execute: async (params: Record<string, unknown>) => {
    const query = params.query as string;
    const confirmAll = (params.confirm_all as boolean) ?? false;

    try {
      const memoryManager = getMemoryManager();

      // First, show what would be deleted
      const matches = await memoryManager.queryRelevant(query, {
        limit: confirmAll ? 20 : 1,
        minSimilarity: 0.5,
      });

      if (matches.length === 0) {
        return {
          success: true,
          output: 'No matching memories found to delete.',
          metadata: { deleted: 0 },
        };
      }

      // Delete the matches
      const deleted = await memoryManager.forget(query, confirmAll);

      if (deleted.length === 0) {
        return {
          success: true,
          output: 'No memories were deleted.',
          metadata: { deleted: 0 },
        };
      }

      // Format deleted memories
      const lines = deleted.map((memory: Memory, index: number) => {
        const cat = memory.metadata.category || 'general';
        return `${index + 1}. [${cat}] ${memory.content}`;
      });

      const output = `Deleted ${deleted.length} memory(s):\n\n${lines.join('\n')}`;

      return {
        success: true,
        output,
        metadata: {
          deleted: deleted.length,
          memories: deleted.map((m: Memory) => ({
            id: m.id,
            content: m.content,
            category: m.metadata.category,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete memories: ${(error as Error).message}`,
      };
    }
  },
};

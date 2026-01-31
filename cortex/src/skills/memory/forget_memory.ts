/**
 * Forget Memory Skill - Delete memories from the database
 *
 * Requires confirmation due to destructive nature.
 * Can delete both knowledge snippets and core facts.
 */

import { SkillDefinition, PermissionLevel } from '../../types.js';
import { getMemoryManager } from '../../memory/index.js';
import { KnowledgeSearchResult } from '../../memory/schema.js';

export const forgetMemorySkill: SkillDefinition = {
  name: 'forget_memory',
  description:
    'Delete memories matching a query. Use this to remove outdated, incorrect, or unwanted information. Searches for matches first, then deletes. Requires user confirmation.',
  permission: PermissionLevel.CONFIRM,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Search query to find memories to delete. Will find and delete matching knowledge snippets.',
      },
      id: {
        type: 'number',
        description:
          'Specific memory ID to delete (from a previous query_memory result). Use this for precise deletion.',
      },
      delete_all: {
        type: 'boolean',
        description:
          'If true and using query, delete ALL matching memories. If false (default), only delete the best match.',
      },
    },
  },
  execute: async (params: Record<string, unknown>) => {
    const query = params.query as string | undefined;
    const id = params.id as number | undefined;
    const deleteAll = (params.delete_all as boolean) ?? false;

    if (!query && !id) {
      return {
        success: false,
        error: 'Either query or id must be provided',
      };
    }

    try {
      const memoryManager = getMemoryManager();

      // If ID provided, delete directly
      if (id !== undefined) {
        const deleted = await memoryManager.deleteKnowledgeById(id);
        if (deleted) {
          return {
            success: true,
            output: `Deleted memory with ID: ${id}`,
            metadata: { deleted: 1, ids: [id] },
          };
        } else {
          return {
            success: true,
            output: `No memory found with ID: ${id}`,
            metadata: { deleted: 0 },
          };
        }
      }

      // Query-based deletion
      const matches = await memoryManager.queryKnowledge({
        query: query!,
        limit: deleteAll ? 20 : 1,
      });

      if (matches.length === 0) {
        return {
          success: true,
          output: `No matching memories found for: "${query}"`,
          metadata: { deleted: 0 },
        };
      }

      // Delete the matches
      const deletedIds: number[] = [];
      const deletedItems: Array<{ id: number; content: string; category: string }> = [];

      for (const match of matches) {
        const deleted = await memoryManager.deleteKnowledgeById(match.snippet.id);
        if (deleted) {
          deletedIds.push(match.snippet.id);
          deletedItems.push({
            id: match.snippet.id,
            content: match.snippet.content,
            category: match.snippet.category,
          });
        }
      }

      if (deletedIds.length === 0) {
        return {
          success: true,
          output: 'No memories were deleted.',
          metadata: { deleted: 0 },
        };
      }

      // Format deleted memories
      const lines = deletedItems.map((item, index) => {
        return `${index + 1}. [${item.category}] ${item.content}`;
      });

      return {
        success: true,
        output: `Deleted ${deletedIds.length} memory(s):\n\n${lines.join('\n')}`,
        metadata: {
          deleted: deletedIds.length,
          ids: deletedIds,
          memories: deletedItems,
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

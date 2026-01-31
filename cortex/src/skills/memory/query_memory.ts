/**
 * Query Memory Skill - Search and retrieve relevant memories
 */

import { SkillDefinition, PermissionLevel } from '../../types.js';
import { getMemoryManager, MemoryCategory, MemorySearchResult } from '../../memory/index.js';

const VALID_CATEGORIES: MemoryCategory[] = [
  'preference',
  'fact',
  'project',
  'instruction',
  'personal',
  'technical',
];

export const queryMemorySkill: SkillDefinition = {
  name: 'query_memory',
  description:
    'Search long-term memory for relevant information from previous conversations. Returns memories semantically similar to the query.',
  permission: PermissionLevel.ALLOW,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'What to search for in memory. Use natural language to describe what you want to recall.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of memories to return (default: 5, max: 20)',
      },
      category: {
        type: 'string',
        description: 'Optional: filter by category (preference, fact, project, instruction, personal, technical)',
        enum: VALID_CATEGORIES,
      },
    },
    required: ['query'],
  },
  execute: async (params: Record<string, unknown>) => {
    const query = params.query as string;
    let limit = (params.limit as number | undefined) ?? 5;
    const category = params.category as MemoryCategory | undefined;

    // Clamp limit
    limit = Math.min(Math.max(1, limit), 20);

    // Validate category
    if (category && !VALID_CATEGORIES.includes(category)) {
      return {
        success: false,
        error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
      };
    }

    try {
      const memoryManager = getMemoryManager();
      const results = await memoryManager.queryRelevant(query, {
        limit,
        category,
        minSimilarity: 0.3,
      });

      if (results.length === 0) {
        return {
          success: true,
          output: 'No relevant memories found.',
          metadata: { count: 0 },
        };
      }

      // Format results
      const lines = results.map(({ memory, similarity }: MemorySearchResult, index: number) => {
        const cat = memory.metadata.category || 'general';
        const score = (similarity * 100).toFixed(0);
        const tags = memory.metadata.tags?.length
          ? ` [tags: ${memory.metadata.tags.join(', ')}]`
          : '';
        return `${index + 1}. [${cat}] (${score}% match) ${memory.content}${tags}`;
      });

      const output = `Found ${results.length} relevant memories:\n\n${lines.join('\n')}`;

      return {
        success: true,
        output,
        metadata: {
          count: results.length,
          memories: results.map(({ memory, similarity }: MemorySearchResult) => ({
            id: memory.id,
            content: memory.content,
            category: memory.metadata.category,
            similarity,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to query memory: ${(error as Error).message}`,
      };
    }
  },
};

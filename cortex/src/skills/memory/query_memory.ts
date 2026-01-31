/**
 * Query Memory Skill - Search the knowledge database
 *
 * Allows the agent to perform keyword/category search against SQLite
 * when it realizes it's missing context. Results are returned to LLM
 * context only when this tool is explicitly called.
 */

import { SkillDefinition, PermissionLevel } from '../../types.js';
import { getMemoryManager } from '../../memory/index.js';
import { MemoryCategory, KnowledgeSearchResult } from '../../memory/schema.js';

const VALID_CATEGORIES: MemoryCategory[] = [
  'preference',
  'fact',
  'project',
  'instruction',
  'personal',
  'technical',
  'identity',
];

export const queryMemorySkill: SkillDefinition = {
  name: 'query_memory',
  description:
    'Search long-term memory for relevant information. Use this when you need context from previous conversations or stored knowledge. Performs keyword and semantic search against the memory database.',
  permission: PermissionLevel.ALLOW,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'What to search for. Use keywords or natural language to describe what you want to recall.',
      },
      category: {
        type: 'string',
        description:
          'Optional: filter by category (preference, fact, project, instruction, personal, technical, identity)',
        enum: VALID_CATEGORIES,
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10, max: 20)',
      },
    },
    required: ['query'],
  },
  execute: async (params: Record<string, unknown>) => {
    const query = params.query as string;
    const category = params.category as MemoryCategory | undefined;
    let limit = (params.limit as number | undefined) ?? 10;

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
      const results = await memoryManager.queryKnowledge({
        query,
        category,
        limit,
      });

      if (results.length === 0) {
        return {
          success: true,
          output: `No relevant memories found for: "${query}"`,
          metadata: { count: 0 },
        };
      }

      // Format results
      const lines = results.map((result: KnowledgeSearchResult, index: number) => {
        const { snippet, score, matchType } = result;
        const scorePercent = (score * 100).toFixed(0);
        const tags = snippet.tags?.length
          ? ` [tags: ${snippet.tags.join(', ')}]`
          : '';
        return `${index + 1}. [${snippet.category}] (${scorePercent}% ${matchType}) ${snippet.content}${tags}`;
      });

      const output = `Found ${results.length} relevant memories:\n\n${lines.join('\n')}`;

      return {
        success: true,
        output,
        metadata: {
          count: results.length,
          memories: results.map((r: KnowledgeSearchResult) => ({
            id: r.snippet.id,
            content: r.snippet.content,
            category: r.snippet.category,
            score: r.score,
            matchType: r.matchType,
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

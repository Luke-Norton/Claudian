/**
 * Store Memory Skill - Save facts to long-term memory
 *
 * Allows the agent to proactively save important information:
 * - Core facts: Always loaded into system prompt (high importance)
 * - Knowledge: Stored in SQLite, retrieved via query_memory
 */

import { SkillDefinition, PermissionLevel } from '../../types.js';
import { getMemoryManager } from '../../memory/index.js';
import { MemoryCategory } from '../../memory/schema.js';

const VALID_CATEGORIES: MemoryCategory[] = [
  'preference',
  'fact',
  'project',
  'instruction',
  'personal',
  'technical',
  'identity',
];

export const storeMemorySkill: SkillDefinition = {
  name: 'store_memory',
  description:
    'Store important information in long-term memory. Use this to remember user preferences, project details, instructions, or other facts. Core facts (is_core=true) are always available; regular facts require query_memory to retrieve.',
  permission: PermissionLevel.ALLOW,
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description:
          'Category of the memory: preference (user likes/dislikes), fact (general info), project (project details), instruction (behavior rules), personal (about user), technical (configs/specs), identity (agent identity)',
        enum: VALID_CATEGORIES,
      },
      content: {
        type: 'string',
        description:
          'The information to remember. Should be a clear, concise statement (e.g., "User prefers dark mode", "Project uses TypeScript")',
      },
      importance: {
        type: 'number',
        description:
          'How important this is (0-1). Higher = more important. Default: 0.5 for knowledge, 0.9 for core facts',
      },
      is_core: {
        type: 'boolean',
        description:
          'If true, this becomes a "core fact" always loaded into context. Use for critical preferences, instructions, or identity info. Default: false',
      },
      tags: {
        type: 'string',
        description:
          'Comma-separated tags for organizing (e.g., "editor,workflow"). Helps with search.',
      },
    },
    required: ['category', 'content'],
  },
  execute: async (params: Record<string, unknown>) => {
    const category = params.category as MemoryCategory;
    const content = params.content as string;
    const importance = params.importance as number | undefined;
    const isCore = (params.is_core as boolean) ?? false;
    const tagsStr = params.tags as string | undefined;

    // Validate category
    if (!VALID_CATEGORIES.includes(category)) {
      return {
        success: false,
        error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
      };
    }

    // Validate importance
    if (importance !== undefined && (importance < 0 || importance > 1)) {
      return {
        success: false,
        error: 'Importance must be between 0 and 1',
      };
    }

    // Parse tags
    const tags = tagsStr
      ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;

    try {
      const memoryManager = getMemoryManager();

      const result = await memoryManager.storeKnowledge({
        content,
        category,
        importance: importance ?? (isCore ? 0.9 : 0.5),
        tags,
        source: 'explicit',
        isCoreFact: isCore,
      });

      const typeLabel = isCore ? 'Core fact' : 'Knowledge';
      return {
        success: true,
        output: `${typeLabel} stored successfully.\nID: ${result.id}\nCategory: ${category}\nContent: "${content}"${isCore ? '\n(Will be included in all future conversations)' : '\n(Retrievable via query_memory)'}`,
        metadata: {
          memoryId: result.id,
          category,
          isCoreFact: isCore,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to store memory: ${(error as Error).message}`,
      };
    }
  },
};

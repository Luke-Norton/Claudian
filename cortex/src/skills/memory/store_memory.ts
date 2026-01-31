/**
 * Store Memory Skill - Explicitly store information in long-term memory
 */

import { SkillDefinition, PermissionLevel } from '../../types.js';
import { getMemoryManager, MemoryCategory } from '../../memory/index.js';

const VALID_CATEGORIES: MemoryCategory[] = [
  'preference',
  'fact',
  'project',
  'instruction',
  'personal',
  'technical',
];

export const storeMemorySkill: SkillDefinition = {
  name: 'store_memory',
  description:
    'Store important information in long-term memory for future conversations. Use this to remember user preferences, project details, instructions, or other facts that should persist across sessions.',
  permission: PermissionLevel.ALLOW,
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description:
          'The information to remember. Should be a clear, concise statement (e.g., "User prefers dark mode", "Project uses TypeScript with strict mode")',
      },
      category: {
        type: 'string',
        description:
          'Category of the memory: preference, fact, project, instruction, personal, or technical',
        enum: VALID_CATEGORIES,
      },
      importance: {
        type: 'number',
        description:
          'How important this memory is (0-1). Higher values make it more likely to be recalled. Default: 0.8',
      },
      tags: {
        type: 'string',
        description: 'Comma-separated tags for organizing memories (e.g., "editor,workflow")',
      },
    },
    required: ['content'],
  },
  execute: async (params: Record<string, unknown>) => {
    const content = params.content as string;
    const category = params.category as MemoryCategory | undefined;
    const importance = params.importance as number | undefined;
    const tagsStr = params.tags as string | undefined;

    // Validate category
    if (category && !VALID_CATEGORIES.includes(category)) {
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
      const memory = await memoryManager.storeExplicit(content, {
        category,
        importance,
        tags,
      });

      if (memory) {
        return {
          success: true,
          output: `Memory stored successfully with ID: ${memory.id}\nContent: "${content}"\nCategory: ${category || 'general'}`,
          metadata: {
            memoryId: memory.id,
            category: memory.metadata.category,
          },
        };
      } else {
        return {
          success: true,
          output:
            'Similar memory already exists - updated access count instead of creating duplicate.',
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to store memory: ${(error as Error).message}`,
      };
    }
  },
};

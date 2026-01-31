/**
 * Memory Extraction - Claude-based fact extraction from conversations
 *
 * Uses claude-3-haiku for cost-efficient extraction of memorable facts.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { ExtractedFact, MemoryCategory } from './types.js';

const EXTRACTION_MODEL = 'claude-3-haiku-20240307';
const MAX_TOKENS = 1024;

const EXTRACTION_PROMPT = `You are a memory extraction assistant. Your task is to identify important facts, preferences, and instructions from the conversation that would be valuable to remember for future interactions.

Extract information in these categories:
- preference: User preferences, likes/dislikes, workflow choices
- fact: Important factual information about the user or their work
- project: Information about projects the user is working on
- instruction: Explicit instructions on how the AI should behave
- personal: Personal information about the user
- technical: Technical details, configurations, or specifications

Rules:
- Only extract genuinely useful information that would help in future conversations
- Be concise - each fact should be a single, clear statement
- Assign importance (0-1) based on how likely it is to be useful again
- Do NOT extract transient information (like "user asked about X")
- Do NOT extract information that's already obvious from context
- If there's nothing worth remembering, return an empty array

Respond with a JSON array of extracted facts:
[
  {"content": "User prefers dark mode in all applications", "category": "preference", "importance": 0.8},
  {"content": "User is working on Claudian, a local AI agent framework", "category": "project", "importance": 0.9}
]

If no facts are worth extracting, respond with: []`;

export class MemoryExtractor {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Extract memorable facts from a conversation
   */
  async extractFromConversation(messages: MessageParam[]): Promise<ExtractedFact[]> {
    if (messages.length === 0) {
      return [];
    }

    // Format conversation for extraction
    const conversationText = this.formatConversation(messages);

    if (conversationText.length < 50) {
      // Too short to extract meaningful facts
      return [];
    }

    try {
      const response = await this.client.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: 'user',
            content: `Extract memorable facts from this conversation:\n\n${conversationText}`,
          },
        ],
        system: EXTRACTION_PROMPT,
      });

      // Parse the response
      const textContent = response.content.find(block => block.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return [];
      }

      const facts = this.parseExtractedFacts(textContent.text);
      console.log(`[Memory] Extracted ${facts.length} facts from conversation`);
      return facts;
    } catch (error) {
      console.error('[Memory] Extraction failed:', error);
      return [];
    }
  }

  /**
   * Format conversation messages into a readable string
   */
  private formatConversation(messages: MessageParam[]): string {
    const lines: string[] = [];

    for (const msg of messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';

      if (typeof msg.content === 'string') {
        lines.push(`${role}: ${msg.content}`);
      } else if (Array.isArray(msg.content)) {
        // Handle content blocks
        for (const block of msg.content) {
          if ('text' in block && block.text) {
            lines.push(`${role}: ${block.text}`);
          }
        }
      }
    }

    return lines.join('\n\n');
  }

  /**
   * Parse JSON response into ExtractedFact array
   */
  private parseExtractedFacts(text: string): ExtractedFact[] {
    try {
      // Try to find JSON array in the response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        return [];
      }

      // Validate and filter facts
      const validCategories: MemoryCategory[] = [
        'preference', 'fact', 'project', 'instruction', 'personal', 'technical'
      ];

      const facts: ExtractedFact[] = [];
      for (const item of parsed) {
        if (
          typeof item.content === 'string' &&
          typeof item.category === 'string' &&
          validCategories.includes(item.category as MemoryCategory) &&
          typeof item.importance === 'number' &&
          item.importance >= 0 &&
          item.importance <= 1
        ) {
          facts.push({
            content: item.content,
            category: item.category as MemoryCategory,
            importance: item.importance,
          });
        }
      }

      return facts;
    } catch {
      console.error('[Memory] Failed to parse extraction response');
      return [];
    }
  }
}

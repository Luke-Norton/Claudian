/**
 * Content Optimizer - Token-Efficient Memory Content Processing
 * 
 * Reduces token consumption by:
 * 1. Smart content summarization
 * 2. Redundancy elimination  
 * 3. Context-aware truncation
 * 4. Dynamic content expansion
 */

import { KnowledgeSnippet } from './schema.js';

export interface OptimizedContent {
  summary: string;
  fullContent: string;
  tokenEstimate: number;
  compressionRatio: number;
}

export interface ContentOptimizationOptions {
  maxTokens?: number;
  preserveKeywords?: string[];
  summaryMode?: 'brief' | 'detailed' | 'auto';
  contextQuery?: string;
}

export class ContentOptimizer {
  private keywordPatterns: RegExp[];
  private stopWords: Set<string>;

  constructor() {
    // Common technical keywords to preserve
    this.keywordPatterns = [
      /\b[A-Z][a-z]+(?:[A-Z][a-z]*)*\b/g, // PascalCase
      /\b[a-z]+(?:_[a-z]+)+\b/g, // snake_case
      /\b[a-z]+(?:-[a-z]+)+\b/g, // kebab-case
      /\b(?:https?:\/\/|www\.)[^\s]+\b/gi, // URLs
      /\b\d+(?:\.\d+)*\b/g, // Numbers/versions
      /\b[A-Z]{2,}\b/g, // ACRONYMS
    ];

    // Common stop words that can be removed in summaries
    this.stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
      'before', 'after', 'above', 'below', 'between', 'among', 'along',
    ]);
  }

  /**
   * Optimize content for token efficiency
   */
  optimizeContent(
    snippet: KnowledgeSnippet,
    options: ContentOptimizationOptions = {}
  ): OptimizedContent {
    const { maxTokens = 150, summaryMode = 'auto', contextQuery } = options;
    
    const fullContent = snippet.content;
    const estimatedTokens = this.estimateTokens(fullContent);
    
    // If already under limit, return as-is
    if (estimatedTokens <= maxTokens) {
      return {
        summary: fullContent,
        fullContent,
        tokenEstimate: estimatedTokens,
        compressionRatio: 1.0,
      };
    }

    // Determine summarization strategy
    const strategy = summaryMode === 'auto' 
      ? this.determineSummarizationStrategy(fullContent, contextQuery)
      : summaryMode;

    // Create optimized summary
    const summary = this.createSummary(fullContent, strategy, options);
    const summaryTokens = this.estimateTokens(summary);
    
    return {
      summary,
      fullContent,
      tokenEstimate: summaryTokens,
      compressionRatio: summaryTokens / estimatedTokens,
    };
  }

  /**
   * Batch optimize multiple snippets with global token budget
   */
  optimizeBatch(
    snippets: KnowledgeSnippet[],
    options: ContentOptimizationOptions & { totalTokenBudget?: number } = {}
  ): OptimizedContent[] {
    const { totalTokenBudget = 1000 } = options;
    
    // Calculate individual token budgets based on importance
    const totalImportance = snippets.reduce((sum, s) => sum + s.importance, 0);
    const budgetPerSnippet = snippets.map(s => 
      Math.floor((s.importance / totalImportance) * totalTokenBudget)
    );

    return snippets.map((snippet, index) => 
      this.optimizeContent(snippet, {
        ...options,
        maxTokens: Math.max(50, budgetPerSnippet[index]), // Minimum 50 tokens per snippet
      })
    );
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough approximation: 1 token ≈ 4 characters for English
    return Math.ceil(text.length / 4);
  }

  /**
   * Determine the best summarization strategy based on content analysis
   */
  private determineSummarizationStrategy(
    content: string, 
    contextQuery?: string
  ): 'brief' | 'detailed' {
    // Analyze content characteristics
    const hasCode = /```|`[^`]+`|\{|\}|\(|\)|;/.test(content);
    const hasStructuredData = /^\s*[-*]\s/m.test(content) || /^\d+\./m.test(content);
    const isShort = content.length < 200;
    
    // Analyze query context if provided
    const needsDetail = contextQuery && (
      contextQuery.includes('how') ||
      contextQuery.includes('explain') ||
      contextQuery.includes('detail') ||
      contextQuery.includes('steps')
    );

    // Decision logic
    if (isShort || hasCode || needsDetail) {
      return 'detailed';
    }
    
    if (hasStructuredData) {
      return 'detailed'; // Preserve structure
    }
    
    return 'brief';
  }

  /**
   * Create summary based on strategy
   */
  private createSummary(
    content: string,
    strategy: 'brief' | 'detailed',
    options: ContentOptimizationOptions
  ): string {
    const { preserveKeywords = [] } = options;
    
    if (strategy === 'brief') {
      return this.createBriefSummary(content, preserveKeywords);
    } else {
      return this.createDetailedSummary(content, preserveKeywords);
    }
  }

  /**
   * Create a brief summary (aggressive compression)
   */
  private createBriefSummary(content: string, preserveKeywords: string[]): string {
    // Extract key elements
    const keywords = this.extractKeywords(content);
    const importantNumbers = content.match(/\b\d+(?:\.\d+)*\b/g) || [];
    const technicalTerms = this.extractTechnicalTerms(content);
    
    // Get first and last sentences for context
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const firstSentence = sentences[0]?.trim();
    const lastSentence = sentences.length > 1 ? sentences[sentences.length - 1]?.trim() : '';
    
    // Combine preserved elements
    const preservedElements = [
      ...preserveKeywords,
      ...keywords.slice(0, 5), // Top 5 keywords
      ...importantNumbers.slice(0, 3), // Top 3 numbers
      ...technicalTerms.slice(0, 5), // Top 5 technical terms
    ].filter(Boolean);
    
    // Build concise summary
    let summary = firstSentence || '';
    
    if (preservedElements.length > 0) {
      const elementsStr = preservedElements.join(', ');
      summary += summary ? ` Key: ${elementsStr}.` : `Key: ${elementsStr}.`;
    }
    
    if (lastSentence && lastSentence !== firstSentence) {
      summary += ` ${lastSentence}`;
    }
    
    return this.cleanupSummary(summary);
  }

  /**
   * Create a detailed summary (moderate compression)
   */
  private createDetailedSummary(content: string, preserveKeywords: string[]): string {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    if (sentences.length <= 2) {
      return content; // Too short to summarize
    }
    
    // Score sentences by importance
    const scoredSentences = sentences.map(sentence => ({
      text: sentence.trim(),
      score: this.scoreSentence(sentence, preserveKeywords),
    }));
    
    // Sort by score and take top sentences
    scoredSentences.sort((a, b) => b.score - a.score);
    
    // Select sentences to include (aim for ~60% of original)
    const targetSentences = Math.max(1, Math.ceil(sentences.length * 0.6));
    const selectedSentences = scoredSentences
      .slice(0, targetSentences)
      .sort((a, b) => content.indexOf(a.text) - content.indexOf(b.text)) // Restore original order
      .map(s => s.text);
    
    let summary = selectedSentences.join('. ').replace(/\.\s*\./g, '.');
    if (!summary.endsWith('.')) summary += '.';
    
    return this.cleanupSummary(summary);
  }

  /**
   * Score sentence importance for selection
   */
  private scoreSentence(sentence: string, preserveKeywords: string[]): number {
    let score = 0;
    
    // Base score by length (medium sentences preferred)
    const words = sentence.split(/\s+/).length;
    if (words >= 5 && words <= 20) score += 1;
    if (words >= 8 && words <= 15) score += 1; // Sweet spot
    
    // Boost for preserved keywords
    for (const keyword of preserveKeywords) {
      if (sentence.toLowerCase().includes(keyword.toLowerCase())) {
        score += 3;
      }
    }
    
    // Boost for technical content
    if (this.keywordPatterns.some(pattern => pattern.test(sentence))) {
      score += 2;
    }
    
    // Boost for numbers/data
    if (/\b\d+(?:\.\d+)*\b/.test(sentence)) {
      score += 1;
    }
    
    // Boost for action words
    const actionWords = ['configure', 'set', 'enable', 'disable', 'create', 'delete', 'update', 'install'];
    if (actionWords.some(word => sentence.toLowerCase().includes(word))) {
      score += 2;
    }
    
    // Penalize for common filler phrases
    const fillerPhrases = ['it should be noted', 'it is important to', 'please note', 'keep in mind'];
    if (fillerPhrases.some(phrase => sentence.toLowerCase().includes(phrase))) {
      score -= 1;
    }
    
    return score;
  }

  /**
   * Extract important keywords from content
   */
  private extractKeywords(content: string): string[] {
    const words = content
      .toLowerCase()
      .split(/\s+/)
      .filter(word => 
        word.length > 3 && 
        !this.stopWords.has(word) &&
        /^[a-zA-Z]/.test(word)
      );
    
    // Count word frequency
    const wordCount = new Map<string, number>();
    for (const word of words) {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    }
    
    // Return top words by frequency
    return Array.from(wordCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  /**
   * Extract technical terms (camelCase, URLs, etc.)
   */
  private extractTechnicalTerms(content: string): string[] {
    const terms = new Set<string>();
    
    for (const pattern of this.keywordPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach(match => terms.add(match));
      }
    }
    
    return Array.from(terms);
  }

  /**
   * Clean up and normalize summary text
   */
  private cleanupSummary(summary: string): string {
    return summary
      .trim()
      .replace(/\s+/g, ' ')        // Normalize whitespace
      .replace(/\.\s*\./g, '.')    // Remove double periods
      .replace(/,\s*,/g, ',')      // Remove double commas
      .replace(/\s+([.,:;!?])/g, '$1') // Fix punctuation spacing
      .replace(/([.!?])\s*([a-z])/g, '$1 $2'); // Ensure sentence spacing
  }
}

// Singleton instance
let contentOptimizerInstance: ContentOptimizer | null = null;

/**
 * Get the singleton ContentOptimizer instance
 */
export function getContentOptimizer(): ContentOptimizer {
  if (!contentOptimizerInstance) {
    contentOptimizerInstance = new ContentOptimizer();
  }
  return contentOptimizerInstance;
}
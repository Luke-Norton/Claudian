/**
 * Embedding Service - Local vector embeddings using transformers.js
 *
 * Uses Xenova/all-MiniLM-L6-v2 which produces 384-dimensional embeddings.
 * Model is lazily loaded on first use.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PipelineType = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExtractorType = any;

// Dynamic import for ESM compatibility
let pipeline: PipelineType = null;
let extractor: ExtractorType = null;

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

export class EmbeddingService {
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the embedding model (lazy - called automatically on first use)
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Prevent multiple simultaneous initializations
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this.doInit();
    await this.initPromise;
  }

  private async doInit(): Promise<void> {
    try {
      // Dynamic import for ESM
      const transformers = await import('@xenova/transformers');
      pipeline = transformers.pipeline;

      console.log(`[Memory] Loading embedding model: ${MODEL_NAME}...`);
      extractor = await pipeline('feature-extraction', MODEL_NAME, {
        quantized: true,  // Use quantized model for faster inference
      });

      this.initialized = true;
      console.log('[Memory] Embedding model loaded successfully');
    } catch (error) {
      console.error('[Memory] Failed to load embedding model:', error);
      throw error;
    }
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    await this.init();

    if (!extractor) {
      throw new Error('Embedding model not initialized');
    }

    const output = await extractor(text, {
      pooling: 'mean',
      normalize: true,
    });

    // Convert to regular array - output is a Tensor with a data property
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tensor = output as any;
    const embedding = Array.from(tensor.data as Float32Array);

    if (embedding.length !== EMBEDDING_DIM) {
      throw new Error(`Unexpected embedding dimension: ${embedding.length}, expected ${EMBEDDING_DIM}`);
    }

    return embedding;
  }

  /**
   * Generate embeddings for multiple texts (batched for efficiency)
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // For now, process sequentially (could optimize with batching later)
    const embeddings: number[][] = [];
    for (const text of texts) {
      embeddings.push(await this.embed(text));
    }
    return embeddings;
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have the same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    // Since we use normalized embeddings, norms should be ~1
    // but compute properly for safety
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
let instance: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (!instance) {
    instance = new EmbeddingService();
  }
  return instance;
}

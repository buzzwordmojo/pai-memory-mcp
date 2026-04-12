import { pipeline, type Pipeline } from "@xenova/transformers";

const MODEL_NAME = "Xenova/bge-small-en-v1.5";
const SEARCH_PREFIX =
  "Represent this sentence for searching relevant passages: ";

let extractor: Pipeline | null = null;

async function getExtractor(): Promise<Pipeline> {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", MODEL_NAME);
  }
  return extractor;
}

/**
 * Generate a single embedding vector for text.
 * For search queries, set isQuery=true to add the retrieval prefix.
 */
export async function embed(
  text: string,
  isQuery = false
): Promise<number[]> {
  const ext = await getExtractor();
  const input = isQuery ? SEARCH_PREFIX + text : text;
  const output = await ext(input, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

/**
 * Generate embeddings for multiple texts in batch.
 * Returns array of 384-dim vectors.
 */
export async function embedBatch(
  texts: string[],
  isQuery = false
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ext = await getExtractor();
  const inputs = isQuery ? texts.map((t) => SEARCH_PREFIX + t) : texts;
  const output = await ext(inputs, { pooling: "mean", normalize: true });
  return output.tolist() as number[][];
}

/**
 * Get the embedding dimensions (384 for bge-small-en-v1.5).
 */
export function getDimensions(): number {
  return 384;
}

export { MODEL_NAME };

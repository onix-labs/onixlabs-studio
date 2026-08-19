import { CatalogCategory, CatalogModel } from '@shared/api/model-catalog-types';

/**
 * Studio's curated list of well-known Ollama-library models.
 *
 * This exists because Ollama's library has **no public search API** — the only ways to enumerate it
 * are scraping its website (which breaks whenever the site changes) or keeping a list. So this is a
 * list: hand-picked for coverage across what people actually want locally, and mechanically verified
 * against `registry.ollama.ai` so every `ref` is real and every `sizeBytes` is the true download size
 * of that exact tag.
 *
 * Sizes are pinned rather than fetched: they are facts about an immutable tag, and fetching them would
 * cost one request per entry every time the catalogue is opened. A re-pushed tag would drift slightly;
 * the pull itself always reports the truth.
 *
 * Adding an entry means verifying it the same way — a `GET` of
 * `https://registry.ollama.ai/v2/library/<name>/manifests/<tag>` must return 200, and `sizeBytes` is
 * the sum of its layer sizes.
 */
export interface CuratedEntry {
  /**
   * The pull reference, `name:tag`.
   */
  readonly ref: string;

  /**
   * The human-readable name.
   */
  readonly name: string;

  /**
   * Roughly what the model is for.
   */
  readonly category: CatalogCategory;

  /**
   * A one-line description of what it is good for.
   */
  readonly description: string;

  /**
   * The human-readable parameter count.
   */
  readonly parameterSize: string;

  /**
   * The true download size in bytes, summed from the registry manifest's layers.
   */
  readonly sizeBytes: number;
}

/**
 * The curated entries, in the order they are offered.
 */
export const CURATED_MODELS: readonly CuratedEntry[] = [
  {
    ref: 'llama3.2:3b',
    name: 'Llama 3.2 3B',
    category: 'general',
    description: "Meta's compact general-purpose model; a good default on modest hardware.",
    parameterSize: '3.2B',
    sizeBytes: 2019392628,
  },
  {
    ref: 'llama3.2:1b',
    name: 'Llama 3.2 1B',
    category: 'general',
    description: 'The smallest Llama 3.2; runs comfortably on a laptop CPU.',
    parameterSize: '1.2B',
    sizeBytes: 1321097844,
  },
  {
    ref: 'llama3.1:8b',
    name: 'Llama 3.1 8B',
    category: 'general',
    description: "Meta's mid-size general model with a long context window.",
    parameterSize: '8.0B',
    sizeBytes: 4920752841,
  },
  {
    ref: 'qwen2.5:7b',
    name: 'Qwen 2.5 7B',
    category: 'general',
    description: 'Strong all-round instruction model with broad language coverage.',
    parameterSize: '7.6B',
    sizeBytes: 4683086845,
  },
  {
    ref: 'qwen2.5:0.5b',
    name: 'Qwen 2.5 0.5B',
    category: 'general',
    description: 'Tiny Qwen; useful for smoke tests and very constrained machines.',
    parameterSize: '494M',
    sizeBytes: 397820829,
  },
  {
    ref: 'qwen3:8b',
    name: 'Qwen 3 8B',
    category: 'general',
    description: 'Latest Qwen generation, with a switchable thinking mode.',
    parameterSize: '8.2B',
    sizeBytes: 5225387677,
  },
  {
    ref: 'qwen2.5-coder:7b',
    name: 'Qwen 2.5 Coder 7B',
    category: 'coding',
    description: 'Code-specialised Qwen; a strong local coding assistant.',
    parameterSize: '7.6B',
    sizeBytes: 4683087074,
  },
  {
    ref: 'qwen2.5-coder:1.5b',
    name: 'Qwen 2.5 Coder 1.5B',
    category: 'coding',
    description: 'Small coding model for autocomplete-scale work.',
    parameterSize: '1.5B',
    sizeBytes: 986061602,
  },
  {
    ref: 'gemma3:4b',
    name: 'Gemma 3 4B',
    category: 'general',
    description: "Google's compact open model, multimodal-capable.",
    parameterSize: '4.3B',
    sizeBytes: 3338801315,
  },
  {
    ref: 'gemma3:1b',
    name: 'Gemma 3 1B',
    category: 'general',
    description: 'The smallest Gemma 3; text-only and very fast.',
    parameterSize: '1.0B',
    sizeBytes: 815319299,
  },
  {
    ref: 'phi4:14b',
    name: 'Phi-4 14B',
    category: 'reasoning',
    description: "Microsoft's reasoning-focused model, strong for its size.",
    parameterSize: '14.7B',
    sizeBytes: 9053115905,
  },
  {
    ref: 'mistral:7b',
    name: 'Mistral 7B',
    category: 'general',
    description: 'A long-standing, well-rounded open model.',
    parameterSize: '7.2B',
    sizeBytes: 4372823897,
  },
  {
    ref: 'deepseek-r1:8b',
    name: 'DeepSeek-R1 8B',
    category: 'reasoning',
    description: 'Reasoning model that shows its chain of thought.',
    parameterSize: '8.0B',
    sizeBytes: 5225375560,
  },
  {
    ref: 'deepseek-r1:1.5b',
    name: 'DeepSeek-R1 1.5B',
    category: 'reasoning',
    description: 'The smallest R1 distill; reasoning on modest hardware.',
    parameterSize: '1.8B',
    sizeBytes: 1117322281,
  },
  {
    ref: 'codellama:7b',
    name: 'Code Llama 7B',
    category: 'coding',
    description: "Meta's code model, with fill-in-the-middle support.",
    parameterSize: '6.7B',
    sizeBytes: 3825910133,
  },
  {
    ref: 'starcoder2:3b',
    name: 'StarCoder2 3B',
    category: 'coding',
    description: 'Permissively-trained code model for completion.',
    parameterSize: '3.0B',
    sizeBytes: 1709901383,
  },
  {
    ref: 'llava:7b',
    name: 'LLaVA 7B',
    category: 'vision',
    description: 'Vision model: answers questions about images.',
    parameterSize: '7B',
    sizeBytes: 4733362813,
  },
  {
    ref: 'smollm2:135m',
    name: 'SmolLM2 135M',
    category: 'small',
    description: 'Extremely small model; near-instant, for experiments.',
    parameterSize: '135M',
    sizeBytes: 270898111,
  },
  {
    ref: 'tinyllama:1.1b',
    name: 'TinyLlama 1.1B',
    category: 'small',
    description: 'Tiny Llama-architecture model for constrained machines.',
    parameterSize: '1.1B',
    sizeBytes: 637699655,
  },
  {
    ref: 'nomic-embed-text:latest',
    name: 'Nomic Embed Text',
    category: 'embedding',
    description: 'Text embedding model for search and retrieval.',
    parameterSize: '137M',
    sizeBytes: 274302030,
  },
  {
    ref: 'mxbai-embed-large:335m',
    name: 'mxbai Embed Large',
    category: 'embedding',
    description: 'Higher-quality text embeddings for retrieval.',
    parameterSize: '335M',
    sizeBytes: 669615085,
  },
  {
    ref: 'granite3.3:8b',
    name: 'Granite 3.3 8B',
    category: 'general',
    description: "IBM's open general model, tuned for enterprise tasks.",
    parameterSize: '8.2B',
    sizeBytes: 4942891236,
  },
];

/**
 * Adapts a curated entry to the shared catalogue shape.
 * @param entry The curated entry.
 * @returns Returns the catalogue model.
 */
export function curatedToModel(entry: CuratedEntry): CatalogModel {
  return {
    ref: entry.ref,
    name: entry.name,
    source: 'curated',
    category: entry.category,
    description: entry.description,
    parameterSize: entry.parameterSize,
    sizeBytes: entry.sizeBytes,
    downloads: 0,
    url: `https://ollama.com/library/${entry.ref.split(':')[0]}`,
  };
}

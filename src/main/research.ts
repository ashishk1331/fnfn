import type { SearchProgress, SearchResult } from '../shared/types';
import { extractAnswer, hostLabel } from '../shared/search';
import { NeedleRunner } from './needle';
import {
  asRawResults,
  TinyFishClient,
  type TinyFishDocument,
} from './tinyfish';

/** Below this score the snippet answer is treated as too weak to trust alone. */
const WEAK_ANSWER_SCORE = 7;

export interface ResearchServiceOptions {
  needleCli: string;
  needleModel: string;
  tinyfishApiKey: string;
  onProgress?: (progress: SearchProgress) => void;
}

function sourceOf(doc: TinyFishDocument): {
  title: string;
  url: string;
  site: string;
} {
  return {
    title: doc.title || hostLabel(doc.url),
    url: doc.url,
    site: doc.site || hostLabel(doc.url),
  };
}

function uniqueDocs(documents: TinyFishDocument[]): TinyFishDocument[] {
  const seen = new Set<string>();
  const result: TinyFishDocument[] = [];

  for (const doc of documents) {
    if (seen.has(doc.url)) {
      continue;
    }
    seen.add(doc.url);
    result.push(doc);
  }

  return result;
}

/**
 * A deliberately small retrieval loop:
 * Needle turns speech into a query, TinyFish searches, the best evidence
 * sentence is quoted, and a page fetch is only spent when the snippets are
 * too thin to answer from.
 */
export class ResearchService {
  private readonly needle: NeedleRunner;
  private readonly onProgress: (progress: SearchProgress) => void;
  private tinyfishApiKey: string;
  private controller: AbortController | null = null;

  constructor(options: ResearchServiceOptions) {
    this.needle = new NeedleRunner({
      cli: options.needleCli,
      model: options.needleModel,
    });
    this.tinyfishApiKey = options.tinyfishApiKey;
    this.onProgress = options.onProgress ?? (() => {});
  }

  setTinyfishKey(key: string): void {
    this.tinyfishApiKey = key.trim();
  }

  async needleReady(): Promise<boolean> {
    return this.needle.isReady();
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
  }

  async run(spoken: string): Promise<SearchResult> {
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    const startedAt = Date.now();

    const emit = (
      phase: SearchProgress['phase'],
      query: string,
      message: string,
    ): void => {
      if (!controller.signal.aborted) {
        this.onProgress({ phase, query, message });
      }
    };

    try {
      emit('query', '', 'Understanding the question…');

      const extraction = await this.needle.extractQuery(
        spoken,
        controller.signal,
      );
      if (!extraction.query) {
        throw new Error('That did not contain a searchable question.');
      }

      emit('searching', extraction.query, 'Searching the web…');

      const tinyfish = new TinyFishClient({ apiKey: this.tinyfishApiKey });
      const results = await tinyfish.search(
        extraction.query,
        controller.signal,
      );
      if (results.length === 0) {
        throw new Error('No web results matched that question.');
      }

      let documents = uniqueDocs(results);
      emit('answering', extraction.query, 'Reading the top results…');

      let answer = extractAnswer(extraction.query, asRawResults(documents));

      if (!answer || answer.score < WEAK_ANSWER_SCORE) {
        emit('reading', extraction.query, 'Reading the top pages…');

        const fetched = await tinyfish
          .fetchDocuments(
            documents.slice(0, 2).map((doc) => doc.url),
            extraction.query,
            controller.signal,
          )
          .catch((error: unknown) => {
            if (controller.signal.aborted) {
              throw error;
            }
            // Snippets are still usable if the fetch fails.
            return [] as TinyFishDocument[];
          });

        if (fetched.length > 0) {
          const combined = uniqueDocs([...fetched, ...documents]);
          const better = extractAnswer(
            extraction.query,
            asRawResults(combined),
          );
          if (better && (!answer || better.score > answer.score)) {
            documents = combined;
            answer = better;
          }
        }
      }

      if (!answer) {
        throw new Error('The results did not contain a readable answer.');
      }

      emit('answering', extraction.query, 'Writing the answer…');

      const sourceIndex = Math.min(
        Math.max(answer.sourceIndex, 0),
        documents.length - 1,
      );
      const ordered = [
        documents[sourceIndex],
        ...documents.filter((_, index) => index !== sourceIndex),
      ].filter((doc): doc is TinyFishDocument => Boolean(doc));

      return {
        spoken,
        query: extraction.query,
        answer: answer.answer,
        sources: uniqueDocs(ordered).slice(0, 4).map(sourceOf),
        confidence: extraction.confidence,
        elapsedMs: Date.now() - startedAt,
        fallback: extraction.fallback,
      };
    } finally {
      if (this.controller === controller) {
        this.controller = null;
      }
    }
  }
}

import {
  hostLabel,
  sanitizeSourceUrl,
  type RawSearchResult,
} from '../shared/search';

const SEARCH_ENDPOINT = 'https://api.search.tinyfish.ai';
const FETCH_ENDPOINT = 'https://api.fetch.tinyfish.ai';

const SEARCH_TIMEOUT_MS = 20_000;
const FETCH_TIMEOUT_MS = 25_000;
const MAX_RESULTS = 6;
const MAX_FETCH_URLS = 2;
const MAX_DOCUMENT_CHARS = 8_000;

export interface TinyFishDocument {
  title: string;
  url: string;
  site: string;
  text: string;
}

export interface TinyFishClientOptions {
  apiKey: string;
  timeoutMs?: number;
}

function failureMessage(status: number): string {
  switch (status) {
    case 401:
    case 403:
      return 'TinyFish rejected the API key. Check it in System settings.';
    case 402:
      return 'The TinyFish free allowance is used up. Add credit or wait for the daily reset.';
    case 429:
      return 'TinyFish rate limit reached. Try again in a minute.';
    case 500:
    case 503:
      return 'TinyFish is unavailable right now. Try again shortly.';
    default:
      return `TinyFish request failed (HTTP ${status}).`;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

export class TinyFishClient {
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: TinyFishClientOptions) {
    this.apiKey = options.apiKey.trim();
    this.timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;
  }

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  async search(
    query: string,
    signal?: AbortSignal,
  ): Promise<TinyFishDocument[]> {
    const url = new URL(SEARCH_ENDPOINT);
    url.searchParams.set('query', query);
    url.searchParams.set(
      'purpose',
      'Answer a spoken question with a short, factual result.',
    );

    const payload = await this.request(
      url,
      { method: 'GET' },
      signal,
      this.timeoutMs,
    );
    const results = Array.isArray(payload.results) ? payload.results : [];

    return results
      .slice(0, MAX_RESULTS)
      .map(normalizeSearchResult)
      .filter((doc): doc is TinyFishDocument => doc !== null);
  }

  async fetchDocuments(
    urls: string[],
    query: string,
    signal?: AbortSignal,
  ): Promise<TinyFishDocument[]> {
    const safe = urls
      .map(sanitizeSourceUrl)
      .filter((url): url is string => url !== null)
      .slice(0, MAX_FETCH_URLS);

    if (safe.length === 0) {
      return [];
    }

    const payload = await this.request(
      FETCH_ENDPOINT,
      {
        method: 'POST',
        body: JSON.stringify({
          urls: safe,
          format: 'markdown',
          ttl: 0,
          per_url_timeout_ms: 15_000,
          purpose: `Find the passage that answers: ${query}`,
        }),
      },
      signal,
      FETCH_TIMEOUT_MS,
    );

    const results = Array.isArray(payload.results) ? payload.results : [];

    return results
      .map((value): TinyFishDocument | null => {
        const record = asRecord(value);
        const url = sanitizeSourceUrl(
          readString(record, 'final_url') || readString(record, 'url'),
        );
        const text = readString(record, 'text');
        if (!url || !text) {
          return null;
        }

        return {
          title: readString(record, 'title') || hostLabel(url),
          url,
          site: hostLabel(url),
          text: text.slice(0, MAX_DOCUMENT_CHARS),
        };
      })
      .filter((doc): doc is TinyFishDocument => doc !== null);
  }

  private async request(
    target: string | URL,
    init: { method: string; body?: string },
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    if (!this.apiKey) {
      throw new Error(
        'Add a TinyFish API key in System settings, or set TINYFISH_API_KEY.',
      );
    }

    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetch(target, {
        method: init.method,
        body: init.body,
        signal: combined,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
      });
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Search cancelled.');
      }
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error('TinyFish timed out. Try a shorter question.');
      }
      throw new Error(
        `TinyFish is unreachable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).trim().slice(0, 160);
      } catch {
        // The status code is enough.
      }
      const message = failureMessage(response.status);
      throw new Error(detail ? `${message} ${detail}` : message);
    }

    try {
      return asRecord(await response.json());
    } catch {
      throw new Error('TinyFish returned an unreadable response.');
    }
  }
}

function normalizeSearchResult(value: unknown): TinyFishDocument | null {
  const record = asRecord(value);
  const url = sanitizeSourceUrl(readString(record, 'url'));
  if (!url) {
    return null;
  }

  const text = readString(record, 'snippet');
  const title = readString(record, 'title') || hostLabel(url);

  if (!text) {
    return null;
  }

  return {
    title,
    url,
    site: readString(record, 'site_name') || hostLabel(url),
    text,
  };
}

export function asRawResults(documents: TinyFishDocument[]): RawSearchResult[] {
  return documents.map((doc) => ({
    title: doc.title,
    url: doc.url,
    site_name: doc.site,
    snippet: doc.text,
  }));
}

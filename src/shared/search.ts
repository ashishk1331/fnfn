/**
 * Pure helpers for the search path. The model extracts a query; everything
 * else here is deterministic so answers stay grounded in the fetched snippets.
 */

export interface RawSearchResult {
  title?: string;
  url?: string;
  site_name?: string;
  snippet?: string;
}

export interface NeedleCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface NeedleResult {
  calls: NeedleCall[];
  suppressed: NeedleCall[];
  confidence: number;
  reasoning: string;
  error: string | null;
}

export const SEARCH_PROMPT_PREFIX = 'Web search: ';

const MAX_QUERY_LENGTH = 300;
const MAX_ANSWER_LENGTH = 280;

const STOPWORDS = new Set([
  'a',
  'about',
  'after',
  'again',
  'against',
  'all',
  'also',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'down',
  'during',
  'each',
  'few',
  'for',
  'from',
  'further',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'herself',
  'him',
  'himself',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'itself',
  'just',
  'me',
  'more',
  'most',
  'my',
  'myself',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'ours',
  'ourselves',
  'out',
  'over',
  'own',
  'please',
  'same',
  'she',
  'should',
  'so',
  'some',
  'such',
  'tell',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'themselves',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  'yours',
  'yourself',
  'yourselves',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseCall(value: unknown): NeedleCall | null {
  const record = asRecord(value);
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) {
    return null;
  }

  let args = record.arguments;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }

  return { name, arguments: asRecord(args) };
}

function parseCalls(value: unknown): NeedleCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(parseCall)
    .filter((call): call is NeedleCall => call !== null);
}

/** Parse the single JSON object printed by the Needle CLI. */
export function parseNeedleOutput(raw: string): NeedleResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const payload = parsed as Record<string, unknown>;
  const confidence = Number(payload.confidence);
  const error =
    payload.success === false
      ? typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : 'Needle could not process the request.'
      : null;

  return {
    calls: parseCalls(payload.function_calls),
    suppressed: parseCalls(payload.suppressed_calls),
    confidence: Number.isFinite(confidence) ? confidence : 0,
    reasoning: typeof payload.reasoning === 'string' ? payload.reasoning : '',
    error,
  };
}

export function needleCall(
  result: NeedleResult | null,
  name: string,
): NeedleCall | null {
  if (!result) {
    return null;
  }
  return result.calls.find((call) => call.name === name) ?? null;
}

/** Remove a search trigger the transcriber may have kept, plus stray spacing. */
export function cleanSearchQuery(value: string): string {
  return value
    .replace(
      /^\s*(?:web\s+search|search(?:\s+the\s+web)?(?:\s+for)?|look\s+up|find(?:\s+on\s+the\s+web)?|google)\s*[:\-–]\s*/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

export function buildSearchPrompt(spoken: string): string {
  const cleaned = cleanSearchQuery(spoken);
  return `${SEARCH_PROMPT_PREFIX}${cleaned || spoken.trim()}`;
}

export function searchTerms(text: string): string[] {
  const matches = text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = new Set<string>();

  for (const match of matches) {
    if (match.length > 1 && !STOPWORDS.has(match)) {
      terms.add(match);
    }
  }

  return [...terms];
}

export function splitSentences(text: string): string[] {
  const normalized = text
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#*_>`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return [];
  }

  const pieces = normalized.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g);
  return (pieces ?? [normalized])
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  const cut = text.slice(0, limit);
  const boundary = cut.lastIndexOf(' ');
  const base = boundary > limit * 0.6 ? cut.slice(0, boundary) : cut;
  return `${base.replace(/[,;:.\s]+$/, '')}…`;
}

const BOILERPLATE =
  /(cookie|subscribe|newsletter|sign in|log in|privacy policy|terms of service|all rights reserved|advertisement|accept all)/i;

function sentenceScore(
  sentence: string,
  terms: string[],
  query: string,
  rank: number,
): number {
  const lower = sentence.toLocaleLowerCase();
  let matches = 0;

  for (const term of terms) {
    if (lower.includes(term)) {
      matches += 1;
    }
  }

  if (matches === 0) {
    return 0;
  }

  let score = matches * 3;
  score += 2 / (1 + rank * 0.35);

  const phrase = query.toLocaleLowerCase().trim();
  if (phrase.length > 3 && lower.includes(phrase)) {
    score += 4;
  }

  if (sentence.length >= 35 && sentence.length <= 240) {
    score += 2;
  } else if (sentence.length < 20 || sentence.length > 360) {
    score -= 2;
  }

  if (BOILERPLATE.test(sentence)) {
    score -= 6;
  }

  return score;
}

export interface ExtractedAnswer {
  answer: string;
  sourceIndex: number;
  score: number;
}

/**
 * Pick the snippet sentence that best overlaps the query. This is an
 * extractive answer: it quotes the source instead of asking a tiny model to
 * paraphrase evidence it cannot reliably reason over.
 */
export function extractAnswer(
  query: string,
  results: RawSearchResult[],
): ExtractedAnswer | null {
  const terms = searchTerms(query);
  const phrase = cleanSearchQuery(query);
  let best: (ExtractedAnswer & { length: number }) | null = null;

  for (let index = 0; index < Math.min(results.length, 8); index += 1) {
    const result = results[index];
    const snippet =
      typeof result.snippet === 'string' ? result.snippet.trim() : '';
    if (!snippet) {
      continue;
    }

    for (const sentence of splitSentences(snippet).slice(0, 10)) {
      const score = sentenceScore(sentence, terms, phrase, index);
      if (
        !best ||
        score > best.score ||
        (score === best.score && sentence.length < best.length)
      ) {
        best = {
          answer: sentence,
          sourceIndex: index,
          score,
          length: sentence.length,
        };
      }
    }
  }

  if (!best || best.score <= 0) {
    const fallback = results
      .map((result) =>
        typeof result.snippet === 'string' ? result.snippet.trim() : '',
      )
      .find(Boolean);
    return fallback
      ? {
          answer: truncate(fallback, MAX_ANSWER_LENGTH),
          sourceIndex: 0,
          score: 0,
        }
      : null;
  }

  return {
    answer: truncate(best.answer, MAX_ANSWER_LENGTH),
    sourceIndex: best.sourceIndex,
    score: best.score,
  };
}

export function sanitizeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function hostLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

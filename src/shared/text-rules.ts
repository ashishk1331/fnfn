export type TextStyle = 'raw' | 'sentence' | 'lower' | 'upper' | 'title';

export interface DictionaryEntry {
  from: string;
  to: string;
}

export interface Snippet {
  trigger: string;
  expansion: string;
}

export interface TextRules {
  style: TextStyle;
  dictionary: DictionaryEntry[];
  snippets: Snippet[];
}

export const TEXT_STYLES: readonly TextStyle[] = [
  'raw',
  'sentence',
  'lower',
  'upper',
  'title',
];

export const DEFAULT_TEXT_RULES: TextRules = {
  style: 'raw',
  dictionary: [],
  snippets: [],
};

export const MAX_RULE_ENTRIES = 200;
const MAX_RULE_LENGTH = 500;

function clean(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_RULE_LENGTH)
    : '';
}

function normalizePair(value: unknown): DictionaryEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as { from?: unknown; to?: unknown };
  const from = clean(candidate.from);
  const to = clean(candidate.to);
  return from && to ? { from, to } : null;
}

function normalizeSnippet(value: unknown): Snippet | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as { trigger?: unknown; expansion?: unknown };
  const trigger = clean(candidate.trigger);
  const expansion =
    typeof candidate.expansion === 'string'
      ? candidate.expansion.trim().slice(0, MAX_RULE_LENGTH)
      : '';
  return trigger && expansion ? { trigger, expansion } : null;
}

function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const value = key(item).toLocaleLowerCase();
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(item);
  }
  return result;
}

export function normalizeTextRules(value: unknown): TextRules {
  const candidate =
    value && typeof value === 'object'
      ? (value as Partial<TextRules>)
      : ({} as Partial<TextRules>);
  const style = TEXT_STYLES.includes(candidate.style as TextStyle)
    ? (candidate.style as TextStyle)
    : DEFAULT_TEXT_RULES.style;
  const dictionary = Array.isArray(candidate.dictionary)
    ? dedupe(
        candidate.dictionary
          .map(normalizePair)
          .filter((entry): entry is DictionaryEntry => entry !== null),
        (entry) => entry.from,
      ).slice(0, MAX_RULE_ENTRIES)
    : [];
  const snippets = Array.isArray(candidate.snippets)
    ? dedupe(
        candidate.snippets
          .map(normalizeSnippet)
          .filter((entry): entry is Snippet => entry !== null),
        (entry) => entry.trigger,
      ).slice(0, MAX_RULE_ENTRIES)
    : [];

  return { style, dictionary, snippets };
}

/** Parse `from = to` lines, also accepting `->`. Blank lines and # comments are ignored. */
export function parseRuleLines(raw: string): DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^(.*?)\s*(?:=|->)\s*(.*)$/);
    if (!match) {
      continue;
    }

    const from = clean(match[1]);
    const to = clean(match[2]);
    if (from && to) {
      entries.push({ from, to });
    }
  }

  return entries;
}

export function formatRuleLines(entries: DictionaryEntry[]): string {
  return entries.map((entry) => `${entry.from} = ${entry.to}`).join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replacePhrases(
  text: string,
  pairs: Array<{ find: string; replace: string }>,
): string {
  const valid = pairs
    .filter((pair) => pair.find)
    .sort((a, b) => b.find.length - a.find.length);

  if (valid.length === 0) {
    return text;
  }

  const lookup = new Map(
    valid.map((pair) => [pair.find.toLocaleLowerCase(), pair.replace]),
  );
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${valid
      .map((pair) => escapeRegExp(pair.find))
      .join('|')})(?![\\p{L}\\p{N}])`,
    'giu',
  );

  return text.replace(
    pattern,
    (match: string) => lookup.get(match.toLocaleLowerCase()) ?? match,
  );
}

/** Correct words the engine misheard. Longest phrases win. */
export function applyDictionary(
  text: string,
  dictionary: DictionaryEntry[],
): string {
  return replacePhrases(
    text,
    dictionary.map((entry) => ({ find: entry.from, replace: entry.to })),
  );
}

/** Replace spoken triggers with their expansion. Longest triggers win. */
export function applySnippets(text: string, snippets: Snippet[]): string {
  return replacePhrases(
    text,
    snippets.map((entry) => ({
      find: entry.trigger,
      replace: entry.expansion,
    })),
  );
}

export function applyStyle(text: string, style: TextStyle): string {
  switch (style) {
    case 'lower':
      return text.toLocaleLowerCase();
    case 'upper':
      return text.toLocaleUpperCase();
    case 'sentence':
      return text.replace(
        /(^|[.!?][ \t]+)(\p{Ll})/gu,
        (_match, prefix: string, letter: string) =>
          `${prefix}${letter.toUpperCase()}`,
      );
    case 'title':
      return text.replace(
        /(^|\s)(\p{Ll})/gu,
        (_match, prefix: string, letter: string) =>
          `${prefix}${letter.toUpperCase()}`,
      );
    case 'raw':
    default:
      return text;
  }
}

function tidy(text: string): string {
  return text.replace(/[ \t]{2,}/g, ' ').trim();
}

export interface ApplyRuleOptions {
  /** Snippets need a complete phrase, so previews skip them. */
  snippets?: boolean;
  style?: boolean;
}

export function applyTextRules(
  text: string,
  rules: TextRules,
  options: ApplyRuleOptions = {},
): string {
  let next = applyDictionary(text, rules.dictionary);
  if (options.snippets !== false) {
    next = applySnippets(next, rules.snippets);
  }
  if (options.style !== false) {
    next = applyStyle(next, rules.style);
  }
  return tidy(next);
}

/** Vocabulary passed to the engine so names and product words are favoured. */
export function keywordList(rules: TextRules): string[] {
  const words = [
    ...rules.dictionary.flatMap((entry) => [entry.from, entry.to]),
    ...rules.snippets.map((entry) => entry.trigger),
  ];

  return dedupe(
    words.map((word) => word.trim()).filter(Boolean),
    (word) => word,
  ).slice(0, MAX_RULE_ENTRIES);
}

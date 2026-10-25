export type TextStyle = 'raw' | 'sentence' | 'lower' | 'upper' | 'title';

export interface DictionaryEntry {
  from: string;
  to: string;
}

export interface Snippet {
  trigger: string;
  expansion: string;
}

export interface CleanupRules {
  /** "comma", "full stop", "new line" and friends become punctuation. */
  spokenPunctuation: boolean;
  /** Drop um, uh, erm, hmm and similar hesitations. */
  fillers: boolean;
  /** Fix safe spelling slips such as "dont" and a lowercase "i". */
  commonFixes: boolean;
}

export interface TextRules {
  style: TextStyle;
  dictionary: DictionaryEntry[];
  snippets: Snippet[];
  /** Names, products, and places that bias the decoder and clarify intent. */
  context?: string;
  cleanup?: CleanupRules;
}

export const TEXT_STYLES: readonly TextStyle[] = [
  'raw',
  'sentence',
  'lower',
  'upper',
  'title',
];

export const DEFAULT_CLEANUP: CleanupRules = {
  spokenPunctuation: true,
  fillers: true,
  commonFixes: true,
};

export const DEFAULT_TEXT_RULES: TextRules = {
  style: 'raw',
  dictionary: [],
  snippets: [],
  context: '',
  cleanup: DEFAULT_CLEANUP,
};

export const MAX_RULE_ENTRIES = 200;
const MAX_RULE_LENGTH = 500;
const MAX_CONTEXT_LENGTH = 2_000;

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

function normalizeCleanup(value: unknown): CleanupRules {
  const candidate =
    value && typeof value === 'object'
      ? (value as Partial<CleanupRules>)
      : ({} as Partial<CleanupRules>);
  const flag = (key: keyof CleanupRules): boolean =>
    typeof candidate[key] === 'boolean' ? candidate[key] : DEFAULT_CLEANUP[key];

  return {
    spokenPunctuation: flag('spokenPunctuation'),
    fillers: flag('fillers'),
    commonFixes: flag('commonFixes'),
  };
}

function normalizeContext(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').trim().slice(0, MAX_CONTEXT_LENGTH)
    : '';
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

  return {
    style,
    dictionary,
    snippets,
    context: normalizeContext(candidate.context),
    cleanup: normalizeCleanup(candidate.cleanup),
  };
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

const SPOKEN_PUNCTUATION: Array<{ find: string; replace: string }> = [
  { find: 'new paragraph', replace: '\n\n' },
  { find: 'new line', replace: '\n' },
  { find: 'full stop', replace: '.' },
  { find: 'question mark', replace: '?' },
  { find: 'exclamation mark', replace: '!' },
  { find: 'exclamation point', replace: '!' },
  { find: 'open parenthesis', replace: '(' },
  { find: 'close parenthesis', replace: ')' },
  { find: 'semicolon', replace: ';' },
  { find: 'ellipsis', replace: '…' },
  { find: 'period', replace: '.' },
  { find: 'comma', replace: ',' },
  { find: 'colon', replace: ':' },
];

const FILLER_PATTERN =
  /(?<![\p{L}\p{N}])(?:u+m+|u+h+m*|e+r+m?|a+h+|hm+|m{2,})(?![\p{L}\p{N}])\s*,?\s*/giu;

const COMMON_FIXES: Array<{ find: string; replace: string }> = [
  { find: 'alot', replace: 'a lot' },
  { find: 'teh', replace: 'the' },
  { find: 'recieve', replace: 'receive' },
  { find: 'seperate', replace: 'separate' },
  { find: 'definately', replace: 'definitely' },
  { find: 'occured', replace: 'occurred' },
  { find: 'dont', replace: "don't" },
  { find: 'cant', replace: "can't" },
  { find: 'wont', replace: "won't" },
  { find: 'isnt', replace: "isn't" },
  { find: 'arent', replace: "aren't" },
  { find: 'wasnt', replace: "wasn't" },
  { find: 'werent', replace: "weren't" },
  { find: 'didnt', replace: "didn't" },
  { find: 'doesnt', replace: "doesn't" },
  { find: 'couldnt', replace: "couldn't" },
  { find: 'wouldnt', replace: "wouldn't" },
  { find: 'shouldnt', replace: "shouldn't" },
  { find: 'hasnt', replace: "hasn't" },
  { find: 'havent', replace: "haven't" },
  { find: 'hadnt', replace: "hadn't" },
  { find: 'im', replace: "I'm" },
  { find: 'ive', replace: "I've" },
  { find: 'youre', replace: "you're" },
  { find: 'theyre', replace: "they're" },
  { find: 'weve', replace: "we've" },
  { find: 'thats', replace: "that's" },
  { find: 'whats', replace: "what's" },
  { find: 'i', replace: 'I' },
];

function applyCommonFixes(text: string): string {
  const lookup = new Map(
    COMMON_FIXES.map((pair) => [pair.find.toLocaleLowerCase(), pair.replace]),
  );
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${COMMON_FIXES.map((pair) =>
      escapeRegExp(pair.find),
    ).join('|')})(?![\\p{L}\\p{N}])`,
    'giu',
  );

  return text.replace(pattern, (match: string) => {
    const replacement = lookup.get(match.toLocaleLowerCase());
    if (!replacement) {
      return match;
    }
    const initial = match.charAt(0);
    const capitalised =
      initial === initial.toLocaleUpperCase() &&
      initial !== initial.toLocaleLowerCase();
    return capitalised
      ? `${replacement.charAt(0).toLocaleUpperCase()}${replacement.slice(1)}`
      : replacement;
  });
}

/** Undo the tics of raw speech: spoken punctuation, fillers, and safe spelling fixes. */
export function applyCleanup(text: string, cleanup: CleanupRules): string {
  let next = text;

  if (cleanup.spokenPunctuation) {
    next = replacePhrases(next, SPOKEN_PUNCTUATION);
    next = next
      .replace(/[ \t]+([,.;:!?…])/g, '$1')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  if (cleanup.fillers) {
    next = next.replace(FILLER_PATTERN, '');
    next = next
      .replace(/[ \t]+([,.;:!?…])/g, '$1')
      .replace(/^[\s,;:]+/, '')
      .replace(/([,;:])\s*\1+/g, '$1');
  }

  if (cleanup.commonFixes) {
    next = applyCommonFixes(next);
  }

  return next;
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
  let next = applyCleanup(text, rules.cleanup ?? DEFAULT_CLEANUP);
  next = applyDictionary(next, rules.dictionary);
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
    ...contextKeywords(rules.context ?? ''),
  ];

  return dedupe(
    words.map((word) => word.trim()).filter(Boolean),
    (word) => word,
  ).slice(0, MAX_RULE_ENTRIES);
}

/**
 * Pull the words worth biasing from free-form context: names, acronyms, and
 * anything else that is not ordinary lowercase prose.
 */
function contextKeywords(context: string): string[] {
  const tokens = context.match(/[\p{L}\p{N}][\p{L}\p{N}'’._-]*/gu) ?? [];
  return tokens
    .map((token) => token.replace(/^[._'-]+|[._'-]+$/g, ''))
    .filter(
      (token) =>
        token.length > 1 &&
        /[\p{Lu}\p{N}]/u.test(token) &&
        /[\p{L}]/u.test(token),
    );
}

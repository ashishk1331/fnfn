import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCleanup,
  applyDictionary,
  applySnippets,
  applyStyle,
  applyTextRules,
  DEFAULT_CLEANUP,
  formatRuleLines,
  keywordList,
  normalizeTextRules,
  parseRuleLines,
  type TextRules,
} from '../src/shared/text-rules';

test('dictionary corrections match whole words and ignore case', () => {
  const dictionary = [
    { from: 'cactus whistle', to: 'Cactus Whistle' },
    { from: 'github', to: 'GitHub' },
  ];

  assert.equal(
    applyDictionary('open github and cactus whistle now', dictionary),
    'open GitHub and Cactus Whistle now',
  );
  assert.equal(
    applyDictionary('githubactions is not github', dictionary),
    'githubactions is not GitHub',
  );
});

test('the longest dictionary phrase wins', () => {
  const dictionary = [
    { from: 'new york', to: 'NY' },
    { from: 'new york times', to: 'The New York Times' },
  ];

  assert.equal(
    applyDictionary('read the new york times', dictionary),
    'read the The New York Times',
  );
});

test('snippets expand spoken triggers and keep surrounding punctuation', () => {
  const snippets = [
    { trigger: 'my email', expansion: 'me@example.com' },
    { trigger: 'my email signature', expansion: 'Ashish\nExample Co.' },
  ];

  assert.equal(
    applySnippets('send it to my email.', snippets),
    'send it to me@example.com.',
  );
  assert.equal(
    applySnippets('use my email signature here', snippets),
    'use Ashish\nExample Co. here',
  );
});

test('styles change case without touching other words', () => {
  assert.equal(
    applyStyle('hello world. next one!', 'sentence'),
    'Hello world. Next one!',
  );
  assert.equal(applyStyle('Hello World', 'lower'), 'hello world');
  assert.equal(applyStyle('Hello World', 'upper'), 'HELLO WORLD');
  assert.equal(applyStyle('hello world', 'title'), 'Hello World');
  assert.equal(applyStyle('Hello World', 'raw'), 'Hello World');
});

test('rules run dictionary, then snippets, then style', () => {
  const rules: TextRules = {
    style: 'sentence',
    dictionary: [{ from: 'my email', to: 'my e-mail' }],
    snippets: [{ trigger: 'my e-mail', expansion: 'me@example.com' }],
  };

  assert.equal(
    applyTextRules('my email is ready', rules),
    'Me@example.com is ready',
  );
});

test('previews can skip snippets but keep dictionary and style', () => {
  const rules: TextRules = {
    style: 'upper',
    dictionary: [{ from: 'fnfn', to: 'fnfn' }],
    snippets: [{ trigger: 'fnfn', expansion: 'hold to talk' }],
  };

  assert.equal(applyTextRules('fnfn', rules, { snippets: false }), 'FNFN');
});

test('rule lines accept = and -> and skip comments', () => {
  const parsed = parseRuleLines(
    [
      '# names',
      'cactus = Cactus',
      'github -> GitHub',
      '',
      'missing separator',
    ].join('\n'),
  );

  assert.deepEqual(parsed, [
    { from: 'cactus', to: 'Cactus' },
    { from: 'github', to: 'GitHub' },
  ]);
  assert.equal(formatRuleLines(parsed), 'cactus = Cactus\ngithub = GitHub');
});

test('normalizeTextRules rejects invalid styles and empty rules', () => {
  const normalized = normalizeTextRules({
    style: 'shout',
    dictionary: [
      { from: 'a', to: 'b' },
      { from: '', to: 'x' },
      { from: 'a', to: 'c' },
      'nope',
    ],
    snippets: [{ trigger: 'hi', expansion: 'hello' }],
  });

  assert.equal(normalized.style, 'raw');
  assert.deepEqual(normalized.dictionary, [{ from: 'a', to: 'b' }]);
  assert.deepEqual(normalized.snippets, [
    { trigger: 'hi', expansion: 'hello' },
  ]);
  assert.equal(normalized.context, '');
  assert.deepEqual(normalized.cleanup, DEFAULT_CLEANUP);
});

test('cleanup turns spoken punctuation into marks and line breaks', () => {
  assert.equal(
    applyCleanup('hello comma world full stop', DEFAULT_CLEANUP),
    'hello, world.',
  );
  assert.equal(
    applyCleanup('first line new line second line', DEFAULT_CLEANUP),
    'first line\nsecond line',
  );
  assert.equal(
    applyCleanup('really question mark', DEFAULT_CLEANUP),
    'really?',
  );
});

test('cleanup drops fillers and fixes safe spelling slips', () => {
  assert.equal(
    applyCleanup('um, i dont know', DEFAULT_CLEANUP),
    "I don't know",
  );
  assert.equal(
    applyCleanup('this is alot teh same', DEFAULT_CLEANUP),
    'this is a lot the same',
  );
  assert.equal(
    applyCleanup('um i dont know', {
      spokenPunctuation: false,
      fillers: false,
      commonFixes: false,
    }),
    'um i dont know',
  );
});

test('rules clean up speech before applying corrections', () => {
  const rules: TextRules = {
    style: 'sentence',
    dictionary: [{ from: 'cactus', to: 'Cactus' }],
    snippets: [],
    cleanup: DEFAULT_CLEANUP,
  };

  assert.equal(
    applyTextRules('um, i use cactus full stop', rules),
    'I use Cactus.',
  );
});

test('normalizeTextRules keeps context and only overridden cleanup flags', () => {
  const normalized = normalizeTextRules({
    context: '  Working with TinyFish and Cactus.\n',
    cleanup: { fillers: false },
  });

  assert.equal(normalized.context, 'Working with TinyFish and Cactus.');
  assert.deepEqual(normalized.cleanup, {
    spokenPunctuation: true,
    fillers: false,
    commonFixes: true,
  });
});

test('decoder keywords include capitalised context terms', () => {
  const words = keywordList({
    style: 'raw',
    dictionary: [],
    snippets: [],
    context: 'TinyFish API, Ashish, Berlin.',
  });

  assert.deepEqual(words, ['TinyFish', 'API', 'Ashish', 'Berlin']);
});

test('decoder keywords include dictionary words and snippet triggers', () => {
  const words = keywordList({
    style: 'raw',
    dictionary: [{ from: 'cactus', to: 'Cactus' }],
    snippets: [{ trigger: 'my email', expansion: 'me@example.com' }],
  });

  // Matching is case-insensitive, so the `to` spelling adds no new keyword.
  assert.deepEqual(words, ['cactus', 'my email']);
});

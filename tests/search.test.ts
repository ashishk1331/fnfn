import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSearchPrompt,
  cleanSearchQuery,
  extractAnswer,
  hostLabel,
  needleCall,
  parseNeedleOutput,
  sanitizeSourceUrl,
  searchTerms,
  splitSentences,
} from '../src/shared/search';

test('parseNeedleOutput reads function calls and JSON string arguments', () => {
  const parsed = parseNeedleOutput(
    JSON.stringify({
      success: true,
      function_calls: [
        { name: 'search_web', arguments: '{"query":"capital of rome"}' },
      ],
      suppressed_calls: [{ name: 'answer', arguments: {} }],
      confidence: 0.82,
      reasoning: 'The user asked for a lookup.',
    }),
  );

  assert.ok(parsed);
  assert.deepEqual(parsed.calls, [
    { name: 'search_web', arguments: { query: 'capital of rome' } },
  ]);
  assert.deepEqual(parsed.suppressed, [{ name: 'answer', arguments: {} }]);
  assert.equal(parsed.confidence, 0.82);
  assert.equal(parsed.error, null);
  assert.equal(
    needleCall(parsed, 'search_web')?.arguments.query,
    'capital of rome',
  );
  assert.equal(needleCall(parsed, 'answer'), null);
});

test('parseNeedleOutput reports failures and rejects non-JSON output', () => {
  const failed = parseNeedleOutput(
    '{"success":false,"error":" model not found "}',
  );

  assert.ok(failed);
  assert.deepEqual(failed.calls, []);
  assert.equal(failed.error, 'model not found');
  assert.equal(parseNeedleOutput('not json'), null);
  assert.equal(parseNeedleOutput('[]'), null);
});

test('cleanSearchQuery strips a leading trigger and caps the length', () => {
  assert.equal(
    cleanSearchQuery('Web search: the capital of rome'),
    'the capital of rome',
  );
  assert.equal(
    cleanSearchQuery('search for:  cactus   compute '),
    'cactus compute',
  );
  assert.equal(cleanSearchQuery('x'.repeat(400)).length, 300);
});

test('buildSearchPrompt adds the prefix Needle expects', () => {
  assert.equal(
    buildSearchPrompt('search: capital of rome'),
    'Web search: capital of rome',
  );
});

test('extractAnswer picks the snippet sentence that answers the query', () => {
  const answer = extractAnswer('capital of rome', [
    {
      title: 'Travel deals',
      url: 'https://example.com/deals',
      snippet: 'Subscribe to our newsletter for travel deals.',
    },
    {
      title: 'Rome',
      url: 'https://example.com/rome',
      snippet:
        'Rome is the capital city of Italy and Lazio. It is known for its history.',
    },
  ]);

  assert.ok(answer);
  assert.equal(answer.answer, 'Rome is the capital city of Italy and Lazio.');
  assert.equal(answer.sourceIndex, 1);
  assert.ok(answer.score > 0);
});

test('extractAnswer falls back to the first snippet when nothing matches', () => {
  const answer = extractAnswer('capital of rome', [
    { snippet: 'A plain sentence without the request words.' },
  ]);

  assert.ok(answer);
  assert.equal(answer.answer, 'A plain sentence without the request words.');
  assert.equal(answer.score, 0);
  assert.equal(extractAnswer('capital of rome', []), null);
});

test('splitSentences ignores markdown noise and keeps terminal marks', () => {
  assert.deepEqual(
    splitSentences('First one. Second [link](https://example.com) here!'),
    ['First one.', 'Second here!'],
  );
});

test('searchTerms drops stopwords and one-letter tokens', () => {
  assert.deepEqual(searchTerms('What is the capital of Rome?'), [
    'capital',
    'rome',
  ]);
});

test('source URLs are limited to http and https', () => {
  assert.equal(
    sanitizeSourceUrl('https://example.com/a?b=1'),
    'https://example.com/a?b=1',
  );
  assert.equal(sanitizeSourceUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeSourceUrl('file:///etc/passwd'), null);
  assert.equal(sanitizeSourceUrl('not a url'), null);
  assert.equal(hostLabel('https://www.example.com/path'), 'example.com');
  assert.equal(hostLabel('nonsense'), '');
});

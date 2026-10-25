# Dictation text

**System → Dictation text** changes every transcript before it is typed. Four
steps apply in this order:

1. **Cleanup** removes fillers, spoken punctuation, and safe spelling slips.
2. **Dictionary** corrects words the engine mishears.
3. **Snippets** expand a spoken phrase into longer text.
4. **Style** changes capitalisation.

**Context** is not a replacement rule. It lists names, products, and places that
are passed to Whistle as decoder keywords, so the engine is more likely to hear
them correctly in the first place.

The preview in **Live** uses cleanup, dictionary, and style but not snippets, so
a half-spoken trigger cannot expand into the wrong text. The final transcript
after release applies all four steps. Search mode keeps cleanup and the
dictionary but skips snippets and style.

## Cleanup

Three switches, all on by default:

| Switch             | What it does                                                                |
| ------------------ | --------------------------------------------------------------------------- |
| Spoken punctuation | `comma`, `full stop`, `question mark`, `new line`, and friends become marks |
| Drop fillers       | Removes `um`, `uh`, `erm`, `hmm`, and similar hesitations                   |
| Common fixes       | Fixes `dont`, `alot`, `teh`, a lowercase standalone `i`, and similar        |

Spoken punctuation only matches whole words, so `comma` becomes `,` but
`commas` and `command` are left alone. Cleanup runs before the dictionary, which
means a dictionary rule can still override anything it produced.

## Dictionary

One rule per line, `heard = typed` (or `heard -> typed`):

```text
cactus whistle = Cactus Whistle
github = GitHub
jason = JSON
```

Matching is case-insensitive and whole-word only: `github` matches `GitHub` and
`GITHUB` but not `githubactions`. The longest phrase wins, so a rule for
`new york times` beats one for `new york`. The replacement keeps the spelling on
the right exactly as written.

Dictionary words are also passed to Whistle as decoder keywords, which makes
the engine more likely to hear those names correctly in the first place.

## Snippets

Same syntax, but the left side is what you say and the right side is what gets
inserted:

```text
my email = me@example.com
my signature = Ashish Khare, Example Co.
standup = Yesterday: done. Today: next. Blockers: none.
```

Triggers are matched case-insensitively and whole-word only, longest first.
Snippets are single-line: a newline starts a new rule. Use a snippet for text
you repeat often, not for punctuation commands.

## Context

Free-form text, up to 2,000 characters. Capitalised words and acronyms are
extracted as decoder keywords alongside the dictionary and snippet triggers:

```text
TinyFish API, Ashish, Berlin, Cactus Compute, Needle
```

Use a list rather than prose. An ordinary capitalised word at the start of a
sentence also becomes a keyword, which is harmless but noisy.

## Style

| Style         | Example input           | Result                  |
| ------------- | ----------------------- | ----------------------- |
| As spoken     | `hello world. next one` | `hello world. next one` |
| Sentence case | `hello world. next one` | `Hello world. Next one` |
| lowercase     | `Hello World`           | `hello world`           |
| UPPERCASE     | `Hello World`           | `HELLO WORLD`           |
| Title Case    | `hello world`           | `Hello World`           |

Style runs last, so it also normalises the text a dictionary or snippet
inserted.

## Limits and storage

- Up to 200 dictionary entries and 200 snippets.
- Entries are trimmed to 500 characters; context is trimmed to 2,000.
- `#` starts a comment line; blank lines are ignored.
- The rules live in `fnfn-settings.json` with the rest of the settings. They
  apply to future holds, not to text already in **Events**.
- **Save** is enabled only when something changed. The rules take effect on the
  next hold, without a restart.

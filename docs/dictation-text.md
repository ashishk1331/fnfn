# Dictation text

**System → Dictation text** changes every transcript before it is typed. Three
rules apply in this order:

1. **Dictionary** corrects words the engine mishears.
2. **Snippets** expand a spoken phrase into longer text.
3. **Style** changes capitalisation.

The preview in **Live** uses the dictionary and style but not snippets, so a
half-spoken trigger cannot expand into the wrong text. The final transcript
after release applies all three.

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
- Entries are trimmed to 500 characters.
- `#` starts a comment line; blank lines are ignored.
- The rules live in `fnfn-settings.json` with the rest of the settings. They
  apply to future holds, not to text already in **Events**.
- **Save** is enabled only when something changed. The rules take effect on the
  next hold, without a restart.

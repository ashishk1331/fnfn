import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError } from '@/lib/format';
import {
  DEFAULT_CLEANUP,
  DEFAULT_TEXT_RULES,
  formatRuleLines,
  normalizeTextRules,
  parseRuleLines,
  type CleanupRules,
  type TextRules,
  type TextStyle,
} from '@/shared/text-rules';

export interface TextRulesController {
  rules: TextRules;
  style: TextStyle;
  dictionaryText: string;
  snippetsText: string;
  contextText: string;
  cleanup: CleanupRules;
  saving: boolean;
  saved: boolean;
  dirty: boolean;
  error: string | null;
  setStyle: (style: TextStyle) => void;
  setDictionaryText: (text: string) => void;
  setSnippetsText: (text: string) => void;
  setContextText: (text: string) => void;
  setCleanup: (key: keyof CleanupRules, value: boolean) => void;
  save: () => Promise<void>;
}

function snippetsToLines(rules: TextRules): string {
  return formatRuleLines(
    rules.snippets.map((snippet) => ({
      from: snippet.trigger,
      to: snippet.expansion,
    })),
  );
}

export function useTextRules(): TextRulesController {
  const [rules, setRules] = useState<TextRules>(DEFAULT_TEXT_RULES);
  const [style, setStyleState] = useState<TextStyle>(DEFAULT_TEXT_RULES.style);
  const [dictionaryText, setDictionaryTextState] = useState('');
  const [snippetsText, setSnippetsTextState] = useState('');
  const [contextText, setContextTextState] = useState('');
  const [cleanup, setCleanupState] = useState<CleanupRules>(DEFAULT_CLEANUP);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window.fnfn?.getTextRules !== 'function') {
      return;
    }

    let active = true;
    void window.fnfn
      .getTextRules()
      .then((loaded) => {
        if (!active) {
          return;
        }
        const normalized = normalizeTextRules(loaded);
        setRules(normalized);
        setStyleState(normalized.style);
        setDictionaryTextState(formatRuleLines(normalized.dictionary));
        setSnippetsTextState(snippetsToLines(normalized));
        setContextTextState(normalized.context ?? '');
        setCleanupState(normalized.cleanup ?? DEFAULT_CLEANUP);
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(describeError(failure));
        }
      });

    return () => {
      active = false;
      if (savedTimer.current) {
        clearTimeout(savedTimer.current);
      }
    };
  }, []);

  const markDirty = useCallback(() => {
    setDirty(true);
    setSaved(false);
  }, []);

  const setStyle = useCallback(
    (next: TextStyle) => {
      setStyleState(next);
      markDirty();
    },
    [markDirty],
  );

  const setDictionaryText = useCallback(
    (text: string) => {
      setDictionaryTextState(text);
      markDirty();
    },
    [markDirty],
  );

  const setSnippetsText = useCallback(
    (text: string) => {
      setSnippetsTextState(text);
      markDirty();
    },
    [markDirty],
  );

  const setContextText = useCallback(
    (text: string) => {
      setContextTextState(text);
      markDirty();
    },
    [markDirty],
  );

  const setCleanup = useCallback(
    (key: keyof CleanupRules, value: boolean) => {
      setCleanupState((current) => ({ ...current, [key]: value }));
      markDirty();
    },
    [markDirty],
  );

  const save = useCallback(async () => {
    if (typeof window.fnfn?.setTextRules !== 'function') {
      setError('The preload bridge is missing.');
      return;
    }

    const next = normalizeTextRules({
      style,
      dictionary: parseRuleLines(dictionaryText),
      snippets: parseRuleLines(snippetsText).map((entry) => ({
        trigger: entry.from,
        expansion: entry.to,
      })),
      context: contextText,
      cleanup,
    });

    setSaving(true);
    setError(null);

    try {
      const stored = normalizeTextRules(await window.fnfn.setTextRules(next));
      setRules(stored);
      setStyleState(stored.style);
      setDictionaryTextState(formatRuleLines(stored.dictionary));
      setSnippetsTextState(snippetsToLines(stored));
      setContextTextState(stored.context ?? '');
      setCleanupState(stored.cleanup ?? DEFAULT_CLEANUP);
      setDirty(false);
      setSaved(true);
      if (savedTimer.current) {
        clearTimeout(savedTimer.current);
      }
      savedTimer.current = setTimeout(() => setSaved(false), 2500);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setSaving(false);
    }
  }, [cleanup, contextText, dictionaryText, snippetsText, style]);

  return {
    rules,
    style,
    dictionaryText,
    snippetsText,
    contextText,
    cleanup,
    saving,
    saved,
    dirty,
    error,
    setStyle,
    setDictionaryText,
    setSnippetsText,
    setContextText,
    setCleanup,
    save,
  };
}

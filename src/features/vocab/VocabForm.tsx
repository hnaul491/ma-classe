'use client';

import { useEffect, useRef, useState } from 'react';
import { AccentBar } from '@/features/board/AccentBar';
import { useT } from '@/lib/i18n/client';
import { isMessageKey } from '@/lib/i18n/messages';
import { VOCAB_LIMITS, type VocabDraft } from './model';

const EMPTY: VocabDraft = { french: '', meaningVi: '', meaningEn: '', example: '' };

/** Add mode when `initial` is undefined (stays open and clears after each save), edit mode otherwise. */
export function VocabForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: VocabDraft;
  submitLabel: string;
  /** Resolves to an i18n key for the error, or null when saved. */
  onSubmit: (d: VocabDraft) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<VocabDraft>(() => initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const french = useRef<HTMLInputElement>(null);
  /** Where focus goes once the fieldset is enabled again: disabling it drops the focus. */
  const refocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (busy) return;
    const el = refocus.current;
    refocus.current = null;
    // Only when the focus was lost to the disabled fieldset, never away from where the user went since.
    if (el?.isConnected && (!document.activeElement || document.activeElement === document.body)) el.focus();
  }, [busy]);

  const set = (k: keyof VocabDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setDraft((d) => ({ ...d, [k]: e.target.value }));
    if (error) setError(null);
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const focused = document.activeElement;
    refocus.current = focused instanceof HTMLElement ? focused : null;
    setBusy(true);
    setError(null);
    let key: string | null;
    try {
      key = await onSubmit(draft);
    } catch {
      key = 'vocab.saveFailed';
    } finally {
      setBusy(false);
    }
    if (key) {
      setError(key);
    } else if (initial === undefined) {
      setDraft(EMPTY);
      refocus.current = french.current;
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {/* Disabled while saving, so nothing typed meanwhile is wiped by the reset after the save. */}
      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-2">
          <label className="field-label">
            {t('vocab.french')}
            <input
              ref={french}
              value={draft.french}
              onChange={set('french')}
              maxLength={VOCAB_LIMITS.french}
              required
              autoFocus={initial === undefined}
              lang="fr"
              className="field"
            />
          </label>
          <AccentBar />
        </div>
        <label className="field-label">
          {t('vocab.meaningVi')}
          <input value={draft.meaningVi} onChange={set('meaningVi')} maxLength={VOCAB_LIMITS.meaning} lang="vi" className="field" />
        </label>
        <label className="field-label">
          {t('vocab.meaningEn')}
          <input value={draft.meaningEn} onChange={set('meaningEn')} maxLength={VOCAB_LIMITS.meaning} lang="en" className="field" />
        </label>
        <label className="field-label">
          {t('vocab.example')}
          <textarea
            value={draft.example}
            onChange={set('example')}
            rows={2}
            maxLength={VOCAB_LIMITS.example}
            lang="fr"
            className="field resize-y py-2 leading-snug"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary btn-sm">
            {submitLabel}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className="btn btn-secondary btn-sm">
              {t('common.cancel')}
            </button>
          )}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-pen">
          {isMessageKey(error) ? t(error) : error}
        </p>
      )}
    </form>
  );
}

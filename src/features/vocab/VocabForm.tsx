'use client';

import { useRef, useState } from 'react';
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

  const set = (k: keyof VocabDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setDraft((d) => ({ ...d, [k]: e.target.value }));
    if (error) setError(null);
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const key = await onSubmit(draft);
    setBusy(false);
    if (key) {
      setError(key);
    } else if (initial === undefined) {
      setDraft(EMPTY);
      french.current?.focus();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
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
        <button type="submit" disabled={busy} className="btn btn-primary btn-sm">
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn btn-secondary btn-sm">
            {t('common.cancel')}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-pen">
          {isMessageKey(error) ? t(error) : error}
        </p>
      )}
    </form>
  );
}

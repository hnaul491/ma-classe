'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import type { Member } from '@/lib/lessons/types';
import type { VocabErrorKey } from './api';
import type { VocabDraft, VocabWord } from './model';
import type { VocabStatus } from './useVocab';
import { VocabForm } from './VocabForm';

type DraftError = VocabErrorKey | 'vocab.frenchRequired' | 'vocab.tooLong';

/** How long the "click again to delete" state lasts before it reverts. */
const CONFIRM_MS = 4000;

function WordItem({
  word,
  teacher,
  update,
  remove,
}: {
  word: VocabWord;
  teacher: boolean;
  update: (id: string, d: VocabDraft) => Promise<DraftError | null>;
  remove: (id: string) => Promise<VocabErrorKey | null>;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<VocabErrorKey | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const refocusEdit = useRef(false);

  // The edit form replaces the Edit button: once it closes, focus goes back to the button.
  useEffect(() => {
    if (editing || !refocusEdit.current) return;
    refocusEdit.current = false;
    editButton.current?.focus();
  }, [editing]);

  function closeEditor() {
    refocusEdit.current = true;
    setEditing(false);
  }

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  async function onDelete() {
    if (!confirming) {
      setConfirming(true);
      setError(null);
      return;
    }
    setConfirming(false);
    setDeleting(true);
    const err = await remove(word.id);
    // On success the word leaves the list and this item unmounts.
    setDeleting(false);
    setError(err);
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-line p-2.5">
        <VocabForm
          initial={{ french: word.french, meaningVi: word.meaningVi, meaningEn: word.meaningEn, example: word.example }}
          submitLabel={t('vocab.save')}
          onSubmit={async (d) => {
            const err = await update(word.id, d);
            if (!err) closeEditor();
            return err;
          }}
          onCancel={closeEditor}
        />
      </div>
    );
  }

  return (
    <div>
      <article className="flex flex-col gap-0.5 rounded-lg border border-line px-2.5 py-2 text-sm">
        <p lang="fr" className="break-words font-semibold">
          {word.french}
        </p>
        {word.meaningVi && (
          <p lang="vi" className="break-words">
            {word.meaningVi}
          </p>
        )}
        {word.meaningEn && (
          <p lang="en" className="break-words">
            {word.meaningEn}
          </p>
        )}
        {word.example && (
          <p lang="fr" className="whitespace-pre-wrap break-words italic text-muted">
            {word.example}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap gap-2">
          <button
            ref={editButton}
            type="button"
            onClick={() => {
              setError(null);
              setEditing(true);
            }}
            className="btn btn-secondary btn-sm"
          >
            {t('vocab.edit')}
          </button>
          {teacher && (
            <button
              type="button"
              onClick={() => void onDelete()}
              onBlur={() => setConfirming(false)}
              disabled={deleting}
              className={`btn btn-sm ${confirming ? 'btn-danger' : 'btn-secondary'}`}
            >
              {t(confirming ? 'vocab.confirmDelete' : 'vocab.delete')}
            </button>
          )}
        </div>
      </article>
      {error && (
        <p role="alert" className="mt-1 text-sm text-pen">
          {t(error)}
        </p>
      )}
    </div>
  );
}

/** The list and the add form only: the side panel around it supplies the frame and the header. */
export function VocabPanel({
  words,
  status,
  member,
  add,
  update,
  remove,
}: {
  words: VocabWord[];
  status: VocabStatus;
  member: Member;
  add: (d: VocabDraft) => Promise<DraftError | null>;
  update: (id: string, d: VocabDraft) => Promise<DraftError | null>;
  remove: (id: string) => Promise<VocabErrorKey | null>;
}) {
  const t = useT();
  const teacher = member.role === 'teacher';
  const [adding, setAdding] = useState(false);

  const emptyNote =
    status === 'loading' ? 'vocab.loading' : status !== 'ready' ? status : teacher ? 'vocab.emptyTeacher' : 'vocab.emptyStudent';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {teacher && (
        <div className="border-b border-line px-3 py-3">
          {adding ? (
            <VocabForm submitLabel={t('vocab.save')} onSubmit={(d) => add(d)} onCancel={() => setAdding(false)} />
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="btn btn-secondary btn-sm">
              {t('vocab.add')}
            </button>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
        {words.length === 0 && <p className="text-sm text-muted">{t(emptyNote)}</p>}
        {[...words].reverse().map((w) => (
          <WordItem key={w.id} word={w} teacher={teacher} update={update} remove={remove} />
        ))}
      </div>
    </div>
  );
}

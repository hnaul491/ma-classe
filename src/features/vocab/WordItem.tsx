'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import type { DraftError, VocabErrorKey } from './api';
import type { VocabDraft, VocabWord } from './model';
import { VocabForm } from './VocabForm';

/** How long the "click again to delete" state lasts before it reverts. */
const CONFIRM_MS = 4000;

/**
 * For a button that a form replaces while open: call `returnFocus()` when closing the form,
 * and focus goes back to the button once it shows again.
 */
export function useReturnFocus(open: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);

  useEffect(() => {
    if (open || !pending.current) return;
    pending.current = false;
    ref.current?.focus();
  }, [open]);

  const returnFocus = useCallback(() => {
    pending.current = true;
  }, []);

  return { ref, returnFocus };
}

/** One word's Edit and Delete: the two-click delete, its error, and focus back on Edit when the form closes. */
export function useWordItem({
  id,
  editing,
  closeEdit,
  remove,
}: {
  id: string;
  editing: boolean;
  closeEdit: () => void;
  remove: (id: string) => Promise<VocabErrorKey | null>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<VocabErrorKey | null>(null);
  const edit = useReturnFocus(editing);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  function closeEditor() {
    edit.returnFocus();
    closeEdit();
  }

  async function onDelete() {
    if (!confirming) {
      setConfirming(true);
      setError(null);
      return;
    }
    setConfirming(false);
    setDeleting(true);
    const err = await remove(id);
    // On success the word leaves the list and this item unmounts.
    setDeleting(false);
    setError(err);
  }

  return {
    editButtonRef: edit.ref,
    closeEditor,
    confirming,
    deleting,
    error,
    onDelete,
    cancelConfirm: () => setConfirming(false),
    clearError: () => setError(null),
  };
}

/** The item state without its ref: the ref goes to WordButtons on its own. */
type WordItemState = Omit<ReturnType<typeof useWordItem>, 'editButtonRef'>;

/** The edit form in place of the word; it closes once saved or cancelled. */
export function WordEditor({
  word,
  update,
  item,
  className,
}: {
  word: VocabWord;
  update: (id: string, d: VocabDraft) => Promise<DraftError | null>;
  item: WordItemState;
  className: string;
}) {
  const t = useT();
  return (
    <div className={className}>
      <VocabForm
        initial={{ french: word.french, meaningVi: word.meaningVi, meaningEn: word.meaningEn, example: word.example }}
        submitLabel={t('vocab.save')}
        onSubmit={async (d) => {
          const err = await update(word.id, d);
          if (!err) item.closeEditor();
          return err;
        }}
        onCancel={item.closeEditor}
      />
    </div>
  );
}

/** The Vietnamese and English meanings and the example, each only when filled in. */
export function WordMeanings({ word }: { word: VocabWord }) {
  return (
    <>
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
    </>
  );
}

/** Edit for both members; Delete, which asks for a second click, for the teacher. */
export function WordButtons({
  item,
  editButtonRef,
  teacher,
  onEdit,
  className,
}: {
  item: WordItemState;
  editButtonRef: React.RefObject<HTMLButtonElement | null>;
  teacher: boolean;
  onEdit: () => void;
  className: string;
}) {
  const t = useT();
  return (
    <div className={className}>
      <button
        ref={editButtonRef}
        type="button"
        onClick={() => {
          item.clearError();
          onEdit();
        }}
        className="btn btn-secondary btn-sm"
      >
        {t('vocab.edit')}
      </button>
      {teacher && (
        <button
          type="button"
          onClick={() => void item.onDelete()}
          onBlur={item.cancelConfirm}
          disabled={item.deleting}
          className={`btn btn-sm ${item.confirming ? 'btn-danger' : 'btn-secondary'}`}
        >
          {t(item.confirming ? 'vocab.confirmDelete' : 'vocab.delete')}
        </button>
      )}
    </div>
  );
}

/** Why the last delete failed, under the word. */
export function WordError({ error }: { error: VocabErrorKey | null }) {
  const t = useT();
  if (!error) return null;
  return (
    <p role="alert" className="mt-1 text-sm text-pen">
      {t(error)}
    </p>
  );
}

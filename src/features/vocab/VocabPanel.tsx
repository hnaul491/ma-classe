'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/client';
import type { Member } from '@/lib/lessons/types';
import type { DraftError, VocabErrorKey } from './api';
import type { VocabDraft, VocabWord } from './model';
import type { VocabStatus } from './useVocab';
import { VocabForm } from './VocabForm';
import { useReturnFocus, useWordItem, WordButtons, WordEditor, WordError, WordMeanings } from './WordItem';

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
  const [editing, setEditing] = useState(false);
  const { editButtonRef, ...item } = useWordItem({ id: word.id, editing, closeEdit: () => setEditing(false), remove });

  if (editing) return <WordEditor word={word} update={update} item={item} className="rounded-lg border border-line p-2.5" />;

  return (
    <div>
      <article className="flex flex-col gap-0.5 rounded-lg border border-line px-2.5 py-2 text-sm">
        <p lang="fr" className="break-words font-semibold">
          {word.french}
        </p>
        <WordMeanings word={word} />
        <WordButtons item={item} editButtonRef={editButtonRef} teacher={teacher} onEdit={() => setEditing(true)} className="mt-1.5 flex flex-wrap gap-2" />
      </article>
      <WordError error={item.error} />
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
  // The add form replaces the Add button: once it closes, focus goes back to the button.
  const { ref: addButtonRef, returnFocus: returnFocusToAdd } = useReturnFocus(adding);

  const emptyNote =
    status === 'loading' ? 'vocab.loading' : status !== 'ready' ? status : teacher ? 'vocab.emptyTeacher' : 'vocab.emptyStudent';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {teacher && (
        <div className="border-b border-line px-3 py-3">
          {adding ? (
            <VocabForm
              submitLabel={t('vocab.save')}
              onSubmit={(d) => add(d)}
              onCancel={() => {
                returnFocusToAdd();
                setAdding(false);
              }}
            />
          ) : (
            <button ref={addButtonRef} type="button" onClick={() => setAdding(true)} className="btn btn-secondary btn-sm">
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

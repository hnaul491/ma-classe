'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useT } from '@/lib/i18n/client';
import type { Member } from '@/lib/lessons/types';
import { deleteWord, insertWord, updateWord, type VocabErrorKey } from './api';
import { prepareWord, searchWords, type VocabDraft, type VocabWord } from './model';
import { VocabForm } from './VocabForm';

type DraftError = VocabErrorKey | 'vocab.frenchRequired' | 'vocab.tooLong';

/** How long the "click again to delete" state lasts before it reverts. */
const CONFIRM_MS = 4000;

const HIDE_KEY = 'ma-classe:vocab-hide';
const hideListeners = new Set<() => void>();
/** This visit's value: it also carries the choice when storage is blocked. */
let hideValue: boolean | null = null;

function readHide(): boolean {
  if (hideValue === null) {
    try {
      hideValue = localStorage.getItem(HIDE_KEY) === '1';
    } catch {
      hideValue = false;
    }
  }
  return hideValue;
}

function writeHide(v: boolean) {
  hideValue = v;
  try {
    localStorage.setItem(HIDE_KEY, v ? '1' : '0');
  } catch {
    /* storage blocked: remembered for this visit only */
  }
  hideListeners.forEach((l) => l());
}

function subscribeHide(cb: () => void) {
  hideListeners.add(cb);
  return () => void hideListeners.delete(cb);
}

/** Whether "Hide meanings" is on, remembered in this browser. Off on the server and until hydrated. */
function useHideMeanings(): boolean {
  return useSyncExternalStore(subscribeHide, readHide, () => false);
}

const NONE: ReadonlySet<string> = new Set();

function BookItem({
  word,
  lessonDate,
  teacher,
  masked,
  editing,
  onReveal,
  onEdit,
  onCloseEdit,
  update,
  remove,
}: {
  word: VocabWord;
  lessonDate: string | undefined;
  teacher: boolean;
  /** Meanings and example hidden behind a "Show meaning" button. */
  masked: boolean;
  editing: boolean;
  onReveal: () => void;
  onEdit: () => void;
  onCloseEdit: () => void;
  update: (id: string, d: VocabDraft) => Promise<DraftError | null>;
  remove: (id: string) => Promise<VocabErrorKey | null>;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<VocabErrorKey | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const refocusEdit = useRef(false);
  const meaning = useRef<HTMLDivElement>(null);
  const revealing = useRef(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  // The edit form replaces the Edit button: once it closes, focus goes back to the button.
  useEffect(() => {
    if (editing || !refocusEdit.current) return;
    refocusEdit.current = false;
    editButton.current?.focus();
  }, [editing]);

  // "Show meaning" disappears when clicked: focus goes to the text it revealed.
  useEffect(() => {
    if (masked || !revealing.current) return;
    revealing.current = false;
    meaning.current?.focus();
  }, [masked]);

  function closeEditor() {
    refocusEdit.current = true;
    onCloseEdit();
  }

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
      <div className="card p-4">
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
      <article className="card flex flex-col gap-1 px-4 py-3">
        <p lang="fr" className="break-words text-lg font-bold">
          {word.french}
        </p>
        <p className="text-sm text-muted">{lessonDate ? t('lesson.title', { date: lessonDate }) : t('vocab.noLesson')}</p>
        {masked ? (
          <button
            type="button"
            onClick={() => {
              revealing.current = true;
              onReveal();
            }}
            className="btn btn-secondary btn-sm mt-1 self-start"
          >
            {t('vocab.show')}
          </button>
        ) : (
          <div ref={meaning} tabIndex={-1} className="mt-1 flex flex-col gap-0.5 rounded-md">
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
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            ref={editButton}
            type="button"
            onClick={() => {
              setError(null);
              onEdit();
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

/** Every word, newest first: search, a "hide meanings" self-quiz, edit, and (teacher) add and delete. */
export function VocabBook({
  initial,
  lessonDates,
  member,
}: {
  initial: VocabWord[];
  /** Formatted lesson date by lesson id. */
  lessonDates: Record<string, string>;
  member: Member;
}) {
  const t = useT();
  const teacher = member.role === 'teacher';
  const [words, setWords] = useState(initial);
  const [query, setQuery] = useState('');
  const hide = useHideMeanings();
  // Tagged with the `hide` it belongs to, so a change of `hide` (also on hydration) clears it.
  const [reveal, setReveal] = useState<{ hide: boolean; ids: ReadonlySet<string> }>({ hide: false, ids: NONE });
  const revealed = reveal.hide === hide ? reveal.ids : NONE;
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const refocusAdd = useRef(false);
  const shown = searchWords(words, query);

  // The add form replaces the Add button: once it closes, focus goes back to the button.
  useEffect(() => {
    if (adding || !refocusAdd.current) return;
    refocusAdd.current = false;
    addButton.current?.focus();
  }, [adding]);

  function toggleHide() {
    setReveal({ hide: !hide, ids: NONE });
    writeHide(!hide);
  }

  async function add(d: VocabDraft): Promise<DraftError | null> {
    const p = prepareWord(d);
    if (!p.ok) return p.reason;
    const r = await insertWord(null, p.draft, member.email);
    if (!r.ok) return r.error;
    setWords((ws) => [r.value, ...ws]);
    return null;
  }

  async function update(id: string, d: VocabDraft): Promise<DraftError | null> {
    const p = prepareWord(d);
    if (!p.ok) return p.reason;
    const r = await updateWord(id, p.draft);
    if (!r.ok) return r.error;
    setWords((ws) => ws.map((w) => (w.id === id ? r.value : w)));
    return null;
  }

  async function remove(id: string): Promise<VocabErrorKey | null> {
    const r = await deleteWord(id);
    if (!r.ok) return r.error;
    setWords((ws) => ws.filter((w) => w.id !== id));
    return null;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          className="field sm:max-w-sm"
          aria-label={t('vocab.search')}
          placeholder={t('vocab.search')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // A word the search hides must not reopen in edit mode when the search is cleared.
            setEditing(null);
          }}
        />
        <button type="button" aria-pressed={hide} onClick={toggleHide} className={`btn btn-sm ${hide ? 'btn-primary' : 'btn-secondary'}`}>
          {t('vocab.hideMeanings')}
        </button>
        <span className="text-sm tabular-nums text-muted">{shown.length === 1 ? t('vocab.countOne') : t('vocab.count', { n: shown.length })}</span>
        {teacher && !adding && (
          <button ref={addButton} type="button" onClick={() => setAdding(true)} className="btn btn-secondary btn-sm">
            {t('vocab.add')}
          </button>
        )}
      </div>

      {teacher && adding && (
        <div className="card p-4">
          <VocabForm
            submitLabel={t('vocab.save')}
            onSubmit={add}
            onCancel={() => {
              refocusAdd.current = true;
              setAdding(false);
            }}
          />
        </div>
      )}

      {words.length === 0 ? (
        <p className="card max-w-prose p-6 text-muted">{t('vocab.bookEmpty')}</p>
      ) : shown.length === 0 ? (
        <p role="status" className="text-muted">
          {t('vocab.noMatch')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((w) => {
            const hasMeaning = Boolean(w.meaningVi || w.meaningEn || w.example);
            return (
              <li key={w.id}>
                <BookItem
                  word={w}
                  lessonDate={w.lessonId === null ? undefined : lessonDates[w.lessonId]}
                  teacher={teacher}
                  masked={hide && hasMeaning && !revealed.has(w.id)}
                  editing={editing === w.id}
                  onReveal={() => setReveal((r) => ({ hide, ids: new Set([...(r.hide === hide ? r.ids : []), w.id]) }))}
                  onEdit={() => setEditing(w.id)}
                  onCloseEdit={() => setEditing((e) => (e === w.id ? null : e))}
                  update={update}
                  remove={remove}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

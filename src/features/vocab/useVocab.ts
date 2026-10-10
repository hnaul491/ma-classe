'use client';

import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { useCallback, useEffect, useEffectEvent, useReducer, useState } from 'react';
import type { Member } from '@/lib/lessons/types';
import {
  deleteWord,
  insertWord,
  loadLessonWords,
  loadWord,
  updateWord,
  vocabHintAction,
  type DraftError,
  type VocabErrorKey,
  type VocabResult,
} from './api';
import { decodeVocab, encodeVocab, initialVocab, prepareWord, VOCAB_TOPIC, vocabReducer, type VocabDraft, type VocabWord } from './model';

export type VocabStatus = 'loading' | 'ready' | VocabErrorKey;

/** A live message carries one word: anything bigger is not ours and is dropped unread. */
const MAX_HINT_BYTES = 8 * 1024;

/**
 * The lesson's words: database first, then the saved row goes to the other person over LiveKit.
 * What the other person sends is only a hint that a word changed: the row is read again from the database.
 * `onIncoming`: called with the database row for each word the other person adds or edits live (not for reloads).
 */
export function useVocab(lessonId: string, member: Member, onIncoming?: (w: VocabWord) => void) {
  const room = useRoomContext();
  const [state, dispatch] = useReducer(vocabReducer, initialVocab);
  const [status, setStatus] = useState<VocabStatus>('loading');

  const applyLoad = useEffectEvent((r: Awaited<ReturnType<typeof loadLessonWords>>) => {
    if (r.ok) {
      dispatch({ type: 'loaded', words: r.value });
      setStatus('ready');
    } else {
      // Keep what is already listed after a failed reload; say why only when nothing is.
      setStatus((s) => (s === 'ready' ? s : r.error));
    }
  });

  // The words on mount, and again after a reconnect (words saved while we were away).
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void loadLessonWords(lessonId).then((r) => {
        if (!cancelled) applyLoad(r);
      });
    load();
    room.on(RoomEvent.Reconnected, load);
    return () => {
      cancelled = true;
      room.off(RoomEvent.Reconnected, load);
    };
  }, [room, lessonId]);

  /** The id a peer's message is about, or null when it is malformed or for another lesson. */
  const hintedId = useEffectEvent((text: string): string | null => {
    const m = decodeVocab(text, lessonId);
    if (!m) return null;
    return m.op === 'delete' ? m.id : m.word.id;
  });

  const applyHint = useEffectEvent((id: string, r: VocabResult<VocabWord | null>) => {
    const action = vocabHintAction(id, lessonId, r);
    if (!action) return;
    dispatch(action);
    if (action.type === 'upsert') onIncoming?.(action.word);
  });

  // Live delivery. The payload is untrusted: only the id is used, the word itself comes from the database.
  useEffect(() => {
    room.registerTextStreamHandler(VOCAB_TOPIC, async (reader) => {
      const size = reader.info.size;
      if (size !== undefined && size > MAX_HINT_BYTES) return;
      let text: string;
      try {
        text = await reader.readAll();
      } catch {
        // A broken stream is dropped; the next reload brings the row from the database.
        return;
      }
      const id = hintedId(text);
      if (!id) return;
      applyHint(id, await loadWord(id));
    });
    return () => room.unregisterTextStreamHandler(VOCAB_TOPIC);
  }, [room]);

  const broadcast = useCallback(
    (text: string) => void room.localParticipant.sendText(text, { topic: VOCAB_TOPIC }).catch(() => {}),
    [room],
  );

  const add = useCallback(
    async (d: VocabDraft): Promise<DraftError | null> => {
      const p = prepareWord(d);
      if (!p.ok) return p.reason;
      const r = await insertWord(lessonId, p.draft, member.email);
      if (!r.ok) return r.error;
      dispatch({ type: 'upsert', word: r.value });
      broadcast(encodeVocab({ v: 1, lessonId, op: 'upsert', word: r.value }));
      return null;
    },
    [lessonId, member.email, broadcast],
  );

  const update = useCallback(
    async (id: string, d: VocabDraft): Promise<DraftError | null> => {
      const p = prepareWord(d);
      if (!p.ok) return p.reason;
      const r = await updateWord(id, p.draft);
      if (!r.ok) return r.error;
      dispatch({ type: 'upsert', word: r.value });
      broadcast(encodeVocab({ v: 1, lessonId, op: 'upsert', word: r.value }));
      return null;
    },
    [lessonId, broadcast],
  );

  const remove = useCallback(
    async (id: string): Promise<VocabErrorKey | null> => {
      const r = await deleteWord(id);
      if (!r.ok) return r.error;
      dispatch({ type: 'delete', id });
      broadcast(encodeVocab({ v: 1, lessonId, op: 'delete', id }));
      return null;
    },
    [lessonId, broadcast],
  );

  return { words: state.words, status, add, update, remove };
}

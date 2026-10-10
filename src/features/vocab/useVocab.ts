'use client';

import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { useCallback, useEffect, useEffectEvent, useReducer, useState } from 'react';
import type { Member } from '@/lib/lessons/types';
import { deleteWord, insertWord, loadLessonWords, updateWord, type VocabErrorKey } from './api';
import { decodeVocab, encodeVocab, initialVocab, prepareWord, VOCAB_TOPIC, vocabReducer, type VocabDraft, type VocabWord } from './model';

type DraftError = VocabErrorKey | 'vocab.frenchRequired' | 'vocab.tooLong';
export type VocabStatus = 'loading' | 'ready' | VocabErrorKey;

/**
 * The lesson's words: database first, then the saved row goes to the other person over LiveKit.
 * `onIncoming`: called for each word the other person adds or edits live (not for reloads).
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

  const receive = useEffectEvent((text: string) => {
    const m = decodeVocab(text, lessonId);
    if (!m) return;
    if (m.op === 'delete') dispatch({ type: 'delete', id: m.id });
    else {
      dispatch({ type: 'upsert', word: m.word });
      onIncoming?.(m.word);
    }
  });

  // Live delivery. The payload is untrusted: decodeVocab checks every field and the lesson.
  useEffect(() => {
    room.registerTextStreamHandler(VOCAB_TOPIC, async (reader) => {
      let text: string;
      try {
        text = await reader.readAll();
      } catch {
        // A broken stream is dropped; the next reload brings the row from the database.
        return;
      }
      receive(text);
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

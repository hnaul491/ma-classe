'use client';

import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { withTimeout } from '@/features/board/retry';
import type { Member } from '@/lib/lessons/types';
import { createBrowserSupabase } from '@/lib/supabase/client';
import {
  CHAT_TOPIC,
  decodeChat,
  encodeChat,
  mergeMessages,
  nextHistoryState,
  prepareMessage,
  type ChatMessage,
  type HistoryState,
} from './model';

/** A save that has not answered after this long is shown as not saved. */
const INSERT_TIMEOUT_MS = 10_000;

type ChatRow = {
  id: string;
  lesson_id: string;
  author_email: string;
  author_name: string;
  body: string;
  created_at: string;
};

const fromRow = (r: ChatRow): ChatMessage => ({
  id: r.id.toLowerCase(),
  lessonId: r.lesson_id,
  authorEmail: r.author_email,
  authorName: r.author_name,
  body: r.body,
  createdAt: r.created_at,
  status: 'saved',
});

async function loadHistory(lessonId: string): Promise<ChatMessage[] | null> {
  try {
    const { data, error } = await createBrowserSupabase()
      .from('chat')
      .select('id, lesson_id, author_email, author_name, body, created_at')
      .eq('lesson_id', lessonId)
      .order('created_at');
    if (error || !data) return null;
    return (data as ChatRow[]).map(fromRow);
  } catch {
    return null;
  }
}

/** Messages plus the ids already read: kept together so "what is new" is decided in one update. */
type ChatState = { messages: ChatMessage[]; read: ReadonlySet<string> };

const sameEmail = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** `onIncoming`: called once for each live message from someone else (not for history catch-up). */
export function useChat(lessonId: string, member: Member, onIncoming?: (m: ChatMessage) => void) {
  const room = useRoomContext();
  const [state, setState] = useState<ChatState>(() => ({ messages: [], read: new Set() }));
  const [history, setHistory] = useState<HistoryState>('loading');
  /** Ids already seen (history, live, or sent by us): a message is announced only the first time. */
  const seen = useRef(new Set<string>());

  /** `initial`: what was said before we joined is not "unread"; what a reconnect catches up on is. */
  const applyHistory = useEffectEvent((loaded: ChatMessage[] | null, initial: boolean) => {
    setHistory((h) => nextHistoryState(h, loaded !== null));
    if (!loaded) return;
    for (const m of loaded) seen.current.add(m.id);
    setState((s) => {
      const known = new Set(s.messages.map((m) => m.id));
      const read = initial ? new Set([...s.read, ...loaded.filter((m) => !known.has(m.id)).map((m) => m.id)]) : s.read;
      return { messages: mergeMessages(s.messages, loaded), read };
    });
  });

  const receive = useEffectEvent((m: ChatMessage) => {
    setState((s) => ({ ...s, messages: mergeMessages(s.messages, [m]) }));
    if (seen.current.has(m.id)) return;
    seen.current.add(m.id);
    onIncoming?.(m);
  });

  // History on mount, and again after a reconnect (messages sent while we were away).
  useEffect(() => {
    let cancelled = false;
    const load = (initial: boolean) =>
      void loadHistory(lessonId).then((h) => {
        if (!cancelled) applyHistory(h, initial);
      });
    load(true);
    const onReconnected = () => load(false);
    room.on(RoomEvent.Reconnected, onReconnected);
    return () => {
      cancelled = true;
      room.off(RoomEvent.Reconnected, onReconnected);
    };
  }, [room, lessonId]);

  // Live delivery. The author is whoever LiveKit says sent it (the identity is the member email from
  // the server-minted token), never what the payload claims.
  useEffect(() => {
    room.registerTextStreamHandler(CHAT_TOPIC, async (reader, info) => {
      let text: string;
      try {
        text = await reader.readAll();
      } catch {
        return;
      }
      const m = decodeChat(text, lessonId);
      if (!m) return;
      const identity = info.identity;
      receive({
        ...m,
        authorEmail: identity,
        authorName: room.getParticipantByIdentity(identity)?.name || identity,
        // Our own clock, not the sender's: two clocks that disagree must not reorder the conversation.
        // The history reload replaces it with the server's created_at.
        createdAt: new Date().toISOString(),
      });
    });
    return () => room.unregisterTextStreamHandler(CHAT_TOPIC);
  }, [room, lessonId]);

  /** `createdAt`: the server's time for a saved row, so our own messages sort on the same clock as history. */
  const settle = useCallback((id: string, result: { createdAt: string } | null) => {
    setState((s) => {
      const messages = s.messages.map((m) => {
        // A history reload may already have brought the saved row; never downgrade it.
        if (m.id !== id || m.status === 'saved') return m;
        return result ? { ...m, status: 'saved' as const, createdAt: result.createdAt } : { ...m, status: 'unsaved' as const };
      });
      return { ...s, messages: mergeMessages(messages, []) };
    });
  }, []);

  const send = useCallback(
    async (raw: string): Promise<'chat.empty' | 'chat.tooLong' | null> => {
      const prepared = prepareMessage(raw);
      if (!prepared.ok) return prepared.reason;
      const m: ChatMessage = {
        id: crypto.randomUUID(),
        lessonId,
        authorEmail: member.email,
        authorName: member.display_name,
        body: prepared.body,
        // Shown with the client clock until the insert returns the server's created_at.
        createdAt: new Date().toISOString(),
        status: 'sending',
      };
      seen.current.add(m.id);
      setState((s) => ({ ...s, messages: mergeMessages(s.messages, [m]) }));
      room.localParticipant.sendText(encodeChat(m), { topic: CHAT_TOPIC }).catch(() => {});
      const insert = async (): Promise<{ createdAt: string } | null> => {
        const { data, error } = await createBrowserSupabase()
          .from('chat')
          .insert({ id: m.id, lesson_id: lessonId, author_email: member.email, author_name: member.display_name, body: m.body })
          .select('created_at')
          .single();
        if (error) return null;
        const serverTime = (data as { created_at?: unknown } | null)?.created_at;
        // Saved either way; keep the client time only if the server's is somehow unusable.
        const usable = typeof serverTime === 'string' && !Number.isNaN(Date.parse(serverTime));
        return { createdAt: usable ? serverTime : m.createdAt };
      };
      // A rejected or hung insert counts as not saved.
      settle(m.id, await withTimeout(insert(), INSERT_TIMEOUT_MS, null));
      return null;
    },
    [room, lessonId, member.email, member.display_name, settle],
  );

  const { messages, read } = state;
  const markRead = useCallback(() => {
    setState((s) => ({ ...s, read: new Set(s.messages.map((m) => m.id)) }));
  }, []);

  const unread = messages.filter((m) => !read.has(m.id) && !sameEmail(m.authorEmail, member.email)).length;

  return { messages, send, unread, markRead, history };
}

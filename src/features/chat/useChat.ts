'use client';

import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import type { Member } from '@/lib/lessons/types';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { CHAT_TOPIC, decodeChat, encodeChat, mergeMessages, prepareMessage, type ChatMessage } from './model';

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

export function useChat(lessonId: string, member: Member) {
  const room = useRoomContext();
  const [state, setState] = useState<ChatState>(() => ({ messages: [], read: new Set() }));
  const [loadFailed, setLoadFailed] = useState(false);

  /** `initial`: what was said before we joined is not "unread"; what a reconnect catches up on is. */
  const applyHistory = useEffectEvent((history: ChatMessage[] | null, initial: boolean) => {
    setLoadFailed(history === null);
    if (!history) return;
    setState((s) => {
      const known = new Set(s.messages.map((m) => m.id));
      const read = initial ? new Set([...s.read, ...history.filter((m) => !known.has(m.id)).map((m) => m.id)]) : s.read;
      return { messages: mergeMessages(s.messages, history), read };
    });
  });

  const receive = useEffectEvent((m: ChatMessage) => {
    setState((s) => ({ ...s, messages: mergeMessages(s.messages, [m]) }));
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
      receive({ ...m, authorEmail: identity, authorName: room.getParticipantByIdentity(identity)?.name || identity });
    });
    return () => room.unregisterTextStreamHandler(CHAT_TOPIC);
  }, [room, lessonId]);

  const setStatus = useCallback((id: string, status: 'saved' | 'unsaved') => {
    setState((s) => ({
      ...s,
      // A history reload may already have brought the saved row; never downgrade it.
      messages: s.messages.map((m) => (m.id === id && m.status !== 'saved' ? { ...m, status } : m)),
    }));
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
        // Shown with the client clock until a history reload brings the server's created_at.
        createdAt: new Date().toISOString(),
        status: 'sending',
      };
      setState((s) => ({ ...s, messages: mergeMessages(s.messages, [m]) }));
      room.localParticipant.sendText(encodeChat(m), { topic: CHAT_TOPIC }).catch(() => {});
      let saved = false;
      try {
        const { error } = await createBrowserSupabase().from('chat').insert({
          id: m.id,
          lesson_id: lessonId,
          author_email: member.email,
          author_name: member.display_name,
          body: m.body,
        });
        saved = !error;
      } catch {
        saved = false;
      }
      setStatus(m.id, saved ? 'saved' : 'unsaved');
      return null;
    },
    [room, lessonId, member.email, member.display_name, setStatus],
  );

  const { messages, read } = state;
  const markRead = useCallback(() => {
    setState((s) => ({ ...s, read: new Set(s.messages.map((m) => m.id)) }));
  }, []);

  const unread = messages.filter((m) => !read.has(m.id) && !sameEmail(m.authorEmail, member.email)).length;

  return { messages, send, unread, markRead, loadFailed };
}

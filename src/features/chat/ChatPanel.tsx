'use client';

import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccentBar } from '@/features/board/AccentBar';
import { useLocale, useT } from '@/lib/i18n/client';
import type { Member } from '@/lib/lessons/types';
import {
  charCount,
  formatChatTime,
  linkify,
  MAX_CHAT,
  prepareMessage,
  shouldSendOnKey,
  type ChatMessage,
  type HistoryState,
} from './model';

/** Within this many pixels of the bottom counts as "at the bottom": new messages keep the list scrolled down. */
const STICK_PX = 48;
const MAX_ROWS = 4;

function Body({ text }: { text: string }) {
  // Text nodes and plain links only: the body is never parsed as HTML.
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {linkify(text).map((s, i) =>
        s.kind === 'link' ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className="link break-all">
            {s.text}
          </a>
        ) : (
          s.text
        ),
      )}
    </p>
  );
}

export function ChatPanel({
  open,
  onClose,
  messages,
  send,
  member,
  history = 'ready',
}: {
  open: boolean;
  onClose: () => void;
  messages: readonly ChatMessage[];
  send: (raw: string) => Promise<'chat.empty' | 'chat.tooLong' | null>;
  member: Member;
  history?: HistoryState;
}) {
  const t = useT();
  const locale = useLocale();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<'chat.empty' | 'chat.tooLong' | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  const time = useMemo(
    () => new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
    [locale],
  );

  const stickToBottom = useEffectEvent(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  // Follow new messages unless the reader has scrolled up.
  useLayoutEffect(() => {
    if (open) stickToBottom();
  }, [messages, open]);

  // Opening the panel puts the cursor in the message box.
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // Grow from 1 to 4 lines, then scroll inside the box.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const px = (v: string) => parseFloat(v) || 0;
    const line = px(cs.lineHeight) || px(cs.fontSize) * 1.4;
    const chrome = px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + px(cs.borderTopWidth) + px(cs.borderBottomWidth), line * MAX_ROWS + chrome)}px`;
    // A taller box makes the list shorter: keep the last message in view.
    stickToBottom();
  }, [draft, open]);

  function submit() {
    const prepared = prepareMessage(draft);
    if (!prepared.ok) {
      setError(prepared.reason);
      return;
    }
    // Clear right away: the save runs in the background and must not eat what is typed next.
    setDraft('');
    setError(null);
    stick.current = true;
    void send(draft);
  }

  const mine = (m: ChatMessage) => m.authorEmail.toLowerCase() === member.email.toLowerCase();
  const count = charCount(draft);
  // Only when nothing is listed: after a failed reload what is shown is still the conversation.
  const emptyNote = history === 'loading' ? 'chat.loading' : history === 'failed' ? 'chat.loadFailed' : 'chat.none';

  return (
    <section aria-label={t('chat.title')} hidden={!open} className="card flex h-full w-full flex-col overflow-hidden shadow-xl sm:w-80">
      <header className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold">{t('chat.title')}</h2>
        <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
          {t('common.close')}
        </button>
      </header>

      <div
        ref={list}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
        }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-muted">{t(emptyNote)}</p>
        ) : (
          history === 'failed' && <p className="text-xs text-muted">{t('chat.loadFailed')}</p>
        )}
        {messages.map((m) => (
          <article key={m.id} className={mine(m) ? 'self-end text-right' : 'self-start'}>
            <div className="flex items-baseline gap-2 text-xs text-muted">
              <span className="font-semibold text-ink">{mine(m) ? t('chat.you') : m.authorName}</span>
              <time dateTime={m.createdAt}>{formatChatTime(m.createdAt, time)}</time>
            </div>
            <div className={`mt-0.5 inline-block max-w-full rounded-lg px-2.5 py-1.5 text-left ${mine(m) ? 'bg-surface-2' : 'border border-line'}`}>
              <Body text={m.body} />
            </div>
            {m.status === 'unsaved' && <p className="mt-0.5 text-xs text-pen">{t('chat.unsaved')}</p>}
          </article>
        ))}
      </div>

      <form
        className="flex flex-col gap-2 border-t border-line p-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <AccentBar />
        <div className="flex items-end gap-2">
          <textarea
            ref={input}
            rows={1}
            value={draft}
            placeholder={t('chat.placeholder')}
            aria-label={t('chat.placeholder')}
            aria-invalid={error !== null}
            aria-describedby={error ? 'chat-error' : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              const { key, shiftKey, keyCode, isComposing } = e.nativeEvent;
              if (shouldSendOnKey({ key, shiftKey, isComposing, keyCode })) {
                e.preventDefault();
                submit();
              }
            }}
            className="field resize-none overflow-y-auto py-2 leading-snug"
          />
          <button type="submit" className="btn btn-primary btn-sm">
            {t('chat.send')}
          </button>
        </div>
        {(error || count !== null) && (
          <div className="flex items-start justify-between gap-2 text-xs">
            {error ? (
              <p id="chat-error" role="alert" className="text-pen">
                {t(error)}
              </p>
            ) : (
              <span />
            )}
            {count !== null && (
              <span className={`[font-variant-numeric:tabular-nums] ${count > MAX_CHAT ? 'font-semibold text-pen' : 'text-muted'}`}>
                {count}/{MAX_CHAT}
              </span>
            )}
          </div>
        )}
      </form>
    </section>
  );
}

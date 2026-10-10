'use client';

import { useEffect, useState } from 'react';
import { CloseIcon } from '@/features/room/icons';
import { useT } from '@/lib/i18n/client';
import type { ToastState } from './notify';

const SHOW_MS = 5000;

/**
 * Preview of the newest message while the chat is closed. A polite live region; it never takes focus.
 * `onDismiss`: the 5 s ran out. `onClose`: the person pressed ×. `onOpen`: the person chose the message.
 */
export function ChatToast({
  state,
  onOpen,
  onDismiss,
  onClose,
}: {
  state: ToastState;
  onOpen: () => void;
  onDismiss: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { latest, extra } = state;
  // The timer waits while the pointer or keyboard focus is on the card.
  const [paused, setPaused] = useState(false);

  // Each new message restarts the 5 s.
  useEffect(() => {
    if (!latest || paused) return;
    const id = setTimeout(onDismiss, SHOW_MS);
    return () => clearTimeout(id);
  }, [latest, paused, onDismiss]);

  const act = (fn: () => void) => () => {
    setPaused(false);
    fn();
  };

  return (
    <div role="status" aria-live="polite" className="pointer-events-none w-72 max-w-full">
      {latest && (
        <div
          className="card pointer-events-auto flex items-start gap-1 p-1 shadow-lg"
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <button type="button" onClick={act(onOpen)} title={t('chat.openChat')} className="min-w-0 flex-1 rounded px-2 py-1 text-left">
            <span className="sr-only">{t('chat.newFrom', { name: latest.name })}</span>
            <span aria-hidden="true" className="flex items-baseline gap-2 text-xs">
              <span className="truncate font-semibold text-ink">{latest.name}</span>
              {extra > 0 && <span className="text-muted">+{extra}</span>}
            </span>
            {extra > 0 && <span className="sr-only">+{extra}</span>}
            <span className="block break-words text-sm">{latest.text}</span>
          </button>
          <button type="button" onClick={act(onClose)} aria-label={t('common.dismiss')} className="btn btn-secondary btn-sm shrink-0">
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  );
}

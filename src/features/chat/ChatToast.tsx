'use client';

import { useEffect } from 'react';
import { useT } from '@/lib/i18n/client';
import type { ToastState } from './notify';

const SHOW_MS = 5000;

/** Preview of the newest message while the chat is closed. A polite live region; it never takes focus. */
export function ChatToast({ state, onOpen, onDismiss }: { state: ToastState; onOpen: () => void; onDismiss: () => void }) {
  const t = useT();
  const { latest, extra } = state;

  // Each new message restarts the 5 s.
  useEffect(() => {
    if (!latest) return;
    const id = setTimeout(onDismiss, SHOW_MS);
    return () => clearTimeout(id);
  }, [latest, onDismiss]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute left-1/2 top-3 z-30 w-72 max-w-[calc(100%-1.5rem)] -translate-x-1/2">
      {latest && (
        <div className="card pointer-events-auto flex items-start gap-1 p-1 shadow-lg">
          <button type="button" onClick={onOpen} title={t('chat.openChat')} className="min-w-0 flex-1 rounded px-2 py-1 text-left">
            <span className="flex items-baseline gap-2 text-xs">
              <span className="truncate font-semibold text-ink">{latest.name}</span>
              {extra > 0 && <span className="text-muted">+{extra}</span>}
            </span>
            <span className="block break-words text-sm">{latest.text}</span>
          </button>
          <button type="button" onClick={onDismiss} aria-label={t('common.dismiss')} className="btn btn-secondary btn-sm shrink-0">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import { BellIcon, BellOffIcon } from './icons';

export type SideTab = 'chat' | 'vocab';

const TABS: readonly SideTab[] = ['chat', 'vocab'];
const LABEL: Record<SideTab, MessageKey> = { chat: 'chat.title', vocab: 'vocab.title' };

/**
 * The lesson's side panel: the frame, the Chat and Vocabulary tabs, and the active tab's content.
 * Docked in the camera rail (no card, no close button) or as the overlay card.
 */
export function SidePanel({
  open,
  docked,
  tab,
  onTab,
  chatUnread,
  vocabNew,
  muted,
  onToggleMuted,
  onClose,
  children,
}: {
  open: boolean;
  docked: boolean;
  tab: SideTab;
  onTab: (t: SideTab) => void;
  chatUnread: number;
  vocabNew: boolean;
  muted: boolean;
  onToggleMuted: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const id = useId();
  const tabButtons = useRef<Partial<Record<SideTab, HTMLButtonElement | null>>>({});
  const tabId = (k: SideTab) => `${id}-tab-${k}`;
  const panelId = `${id}-panel`;
  const dot: Record<SideTab, boolean> = { chat: chatUnread > 0 && tab !== 'chat', vocab: vocabNew };

  // Left and right move between the tabs and show the one reached (wrapping at the ends).
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : TABS.length - 1;
    const next = TABS[(TABS.indexOf(tab) + step) % TABS.length];
    onTab(next);
    tabButtons.current[next]?.focus();
  }

  return (
    <section
      aria-label={t(LABEL[tab])}
      hidden={!open}
      className={
        docked
          ? `${open ? 'flex' : 'hidden'} min-h-0 w-full flex-1 flex-col overflow-hidden border-t border-line`
          : 'card flex h-full w-full flex-col overflow-hidden shadow-xl sm:w-80'
      }
    >
      {/* min-h-11 fits a small button: the header keeps its height on the tab without one. */}
      <header className="flex min-h-11 items-stretch justify-between gap-2 border-b border-line px-3">
        <div role="tablist" onKeyDown={onKeyDown} className="flex gap-3">
          {TABS.map((k) => (
            <button
              key={k}
              ref={(el) => {
                tabButtons.current[k] = el;
              }}
              type="button"
              role="tab"
              id={tabId(k)}
              aria-selected={tab === k}
              aria-controls={panelId}
              tabIndex={tab === k ? 0 : -1}
              onClick={() => onTab(k)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 py-2 text-sm font-semibold ${
                tab === k ? 'border-pen text-ink' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {t(LABEL[k])}
              {dot[k] && (
                <>
                  <span aria-hidden className="size-2 rounded-full bg-pen" />
                  <span className="sr-only">{t('side.unread')}</span>
                </>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 py-1.5">
          {tab === 'chat' && (
            <button
              type="button"
              onClick={onToggleMuted}
              aria-pressed={muted}
              aria-label={t('chat.muteSound')}
              title={t('chat.muteSound')}
              className="btn btn-secondary btn-sm"
            >
              {muted ? <BellOffIcon /> : <BellIcon />}
            </button>
          )}
          {!docked && (
            <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
              {t('common.close')}
            </button>
          )}
        </div>
      </header>

      <div role="tabpanel" id={panelId} aria-labelledby={tabId(tab)} className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </section>
  );
}

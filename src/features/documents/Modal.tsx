'use client';

import { useEffect, useEffectEvent, useId, useRef, type KeyboardEventHandler, type ReactNode } from 'react';
import { useT } from '@/lib/i18n/client';

/**
 * A modal `<dialog>` opened with showModal() while mounted. Esc, the Close button or a backdrop
 * click close it (the parent then unmounts it); focus goes back to `returnFocus()` or to the
 * element that was focused when it opened.
 */
export function Modal({
  title,
  actions,
  onClose,
  returnFocus,
  onKeyDown,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
  onKeyDown?: KeyboardEventHandler<HTMLDialogElement>;
  children: ReactNode;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closed = useEffectEvent(() => onClose());
  const focusTarget = useEffectEvent(() => returnFocus?.() ?? null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    const onCloseEvent = () => closed();
    dialog.addEventListener('close', onCloseEvent);
    return () => {
      dialog.removeEventListener('close', onCloseEvent);
      if (dialog.open) dialog.close();
      const target = focusTarget() ?? previous;
      if (target?.isConnected) target.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      className="m-auto h-full max-h-none w-full max-w-none flex-col open:flex overflow-hidden border-line bg-paper p-0 text-ink backdrop:bg-black/60 sm:h-[calc(100%-3rem)] sm:w-[min(calc(100%-3rem),72rem)] sm:rounded-2xl sm:border"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <h2 id={titleId} className="min-w-0 flex-1 truncate font-display text-lg font-bold">
          {title}
        </h2>
        {actions}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => ref.current?.close()}>
          {t('common.close')}
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </dialog>
  );
}

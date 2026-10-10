'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { ACCENTS, insertAtCursor, isTextTarget } from './accents';

/** Types into the last focused text field. The board's text editor is a textarea. */
export function AccentBar() {
  const t = useT();
  const target = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLElement | null>(null);
  const [upper, setUpper] = useState(false);

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      if (isTextTarget(e.target as HTMLElement)) target.current = e.target as HTMLElement;
    };
    const onKey = (e: KeyboardEvent) => setUpper(e.shiftKey);
    const onBlur = () => setUpper(false);
    document.addEventListener('focusin', onFocus);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('focusin', onFocus);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  function insert(ch: string) {
    const el = target.current;
    if (!el || !el.isConnected) return;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const next = insertAtCursor(el.value, el.selectionStart, el.selectionEnd, ch);
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      // React and Excalidraw track the native value setter, so set it through the prototype.
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, next.value);
      try {
        el.setSelectionRange(next.caret, next.caret);
      } catch {
        // Some input types do not support selection; the value is already set.
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el.isContentEditable) {
      document.execCommand('insertText', false, ch);
    }
  }

  return (
    <div role="toolbar" aria-label={t('board.accents')} className="card flex flex-wrap gap-1 p-1 shadow-md">
      {ACCENTS.map((a) => {
        const ch = upper ? a.toUpperCase() : a;
        return (
          <button
            key={a}
            type="button"
            title={ch}
            aria-label={ch}
            // Keep focus in the text field being edited.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(ch)}
            className="flex size-8 items-center justify-center rounded-md text-base font-medium hover:bg-surface-2"
          >
            {ch}
          </button>
        );
      })}
    </div>
  );
}

'use client';

import { useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { CameraTiles } from '@/features/stage/CameraTiles';

export function FloatingCams() {
  const t = useT();
  const [hidden, setHidden] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        className="fixed left-4 top-16 z-20 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium shadow hover:bg-surface-2"
      >
        {t('cams.show')}
      </button>
    );
  }

  return (
    <div
      className="fixed z-20 w-36 cursor-grab touch-none rounded-lg bg-surface/90 shadow-xl active:cursor-grabbing"
      // Top left by default: the chat panel opens on the right.
      style={pos ? { left: pos.x, top: pos.y } : { left: 16, top: 64 }}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current) setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      <CameraTiles variant="rail" />
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setHidden(true)}
        className="w-full pb-1.5 text-center text-xs text-muted hover:text-ink"
      >
        {t('cams.hide')}
      </button>
    </div>
  );
}

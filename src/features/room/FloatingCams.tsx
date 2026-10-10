'use client';

import { useRef, useState } from 'react';
import { CameraTiles } from '@/features/stage/CameraTiles';

export function FloatingCams() {
  const [hidden, setHidden] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        className="fixed right-4 top-16 z-20 rounded-full bg-surface px-3 py-1 text-xs shadow"
      >
        Show cameras
      </button>
    );
  }

  return (
    <div
      className="fixed z-20 w-36 cursor-grab touch-none rounded-lg bg-surface/90 shadow-xl active:cursor-grabbing"
      style={pos ? { left: pos.x, top: pos.y } : { right: 16, top: 64 }}
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
        className="w-full pb-1 text-center text-xs text-muted"
      >
        Hide cameras
      </button>
    </div>
  );
}

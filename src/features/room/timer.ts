/** Elapsed lesson time as m:ss, or h:mm:ss from one hour. Negative input (clock skew) shows 0:00. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function isOvertime(ms: number, limitMinutes = 90): boolean {
  return ms >= limitMinutes * 60_000;
}

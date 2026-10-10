/** A lesson's length in whole minutes, or null while it has no end. */
export function minutesBetween(start: string, end: string | null): number | null {
  if (!end) return null;
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
}

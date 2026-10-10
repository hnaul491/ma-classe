import { isUuid } from '@/features/documents/params';

/** What the review page does for this id: 404, send a live lesson to its room, or show it. */
export function reviewTarget(id: string, lesson: { status: 'live' | 'ended' } | null): 'not-found' | 'live' | 'show' {
  if (!isUuid(id) || !lesson) return 'not-found';
  return lesson.status === 'live' ? 'live' : 'show';
}

/** The saved scene has something on it: an element that was not erased (deleted ones stay in the save). */
export function hasLiveElements(elements: readonly { isDeleted?: unknown }[]): boolean {
  return elements.some((e) => e.isDeleted !== true);
}

/** Each image file id the elements use, once, in scene order. */
export function sceneFileIds(elements: readonly object[]): string[] {
  const ids = elements.map((e) => (e as { fileId?: unknown }).fileId);
  return [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
}

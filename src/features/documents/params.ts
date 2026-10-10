const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (s: string) => UUID.test(s);

/** The document id in `?add=<id>`, or null. Only a well-formed uuid, because it goes into a database filter. */
export function addParam(search: string): string | null {
  const id = new URLSearchParams(search).get('add');
  return id && isUuid(id) ? id : null;
}

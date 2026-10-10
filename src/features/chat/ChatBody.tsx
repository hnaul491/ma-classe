import { linkify } from './model';

/** One message's text. No 'use client': the review page renders it on the server. */
export function ChatBody({ text }: { text: string }) {
  // Text nodes and plain links only: the body is never parsed as HTML.
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {linkify(text).map((s, i) =>
        s.kind === 'link' ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className="link break-all">
            {s.text}
          </a>
        ) : (
          s.text
        ),
      )}
    </p>
  );
}

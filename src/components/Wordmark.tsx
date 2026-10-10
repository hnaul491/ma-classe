/** "Ma Classe" with a red-pen stroke under it, like a teacher's correction mark. */
export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const text = size === 'lg' ? 'text-5xl' : 'text-[1.75rem]';
  return (
    <span className={`relative inline-block font-display font-bold tracking-tight text-ink ${text}`}>
      Ma Classe
      <svg
        aria-hidden
        viewBox="0 0 200 14"
        preserveAspectRatio="none"
        className="absolute -bottom-2 left-0 h-[0.32em] w-full text-pen"
      >
        <path
          d="M3 9.5c26-5 58-7.5 96-6.5 33 .8 65 3 98 1.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

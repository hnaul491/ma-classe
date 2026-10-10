const stroke = {
  viewBox: '0 0 16 16',
  width: 16,
  height: 16,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const MicIcon = () => (
  <svg {...stroke}>
    <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
    <path d="M3 8a5 5 0 0 0 10 0M8 13v2" />
  </svg>
);

export const MicOffIcon = () => (
  <svg {...stroke}>
    <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
    <path d="M3 8a5 5 0 0 0 10 0M8 13v2M2 2l12 12" />
  </svg>
);

export const CamIcon = () => (
  <svg {...stroke}>
    <rect x="1.5" y="4" width="9" height="8" rx="1.5" />
    <path d="M10.5 7l4-2.5v7l-4-2.5" />
  </svg>
);

export const CamOffIcon = () => (
  <svg {...stroke}>
    <rect x="1.5" y="4" width="9" height="8" rx="1.5" />
    <path d="M10.5 7l4-2.5v7l-4-2.5M2 2l12 12" />
  </svg>
);

export const ShareIcon = () => (
  <svg {...stroke}>
    <rect x="1.5" y="2.5" width="13" height="9" rx="1" />
    <path d="M8 9V5M6 7l2-2 2 2M5.5 14.5h5" />
  </svg>
);

export const PlanBIcon = () => (
  <svg {...stroke}>
    <circle cx="8" cy="8" r="6" />
    <circle cx="8" cy="8" r="2.5" />
    <path d="M3.8 3.8l2.4 2.4M12.2 3.8L9.8 6.2M3.8 12.2l2.4-2.4M12.2 12.2L9.8 9.8" />
  </svg>
);

export const EndIcon = () => (
  <svg viewBox="0 0 16 16" width={16} height={16} fill="currentColor" aria-hidden>
    <path d="M1.8 9.6c3.4-3.2 9-3.2 12.4 0l-1.6 2-2.6-1.1V8.6a7.5 7.5 0 0 0-4 0v1.9l-2.6 1.1z" />
  </svg>
);

export const FullscreenIcon = () => (
  <svg {...stroke}>
    <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
  </svg>
);

export const ExitFullscreenIcon = () => (
  <svg {...stroke}>
    <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
  </svg>
);

export const BoardIcon = () => (
  <svg {...stroke}>
    <rect x="1.5" y="2.5" width="13" height="9" rx="1" />
    <path d="M5 14.5l3-3 3 3" />
  </svg>
);

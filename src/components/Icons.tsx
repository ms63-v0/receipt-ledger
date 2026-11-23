type P = { size?: number };
const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const ChevronLeft = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M15 18l-6-6 6-6" /></svg>
);
export const ChevronRight = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M9 18l6-6-6-6" /></svg>
);
export const Close = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const Plus = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>
);
export const ReceiptIcon = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </svg>
);
export const Camera = ({ size = 32 }: P) => (
  <svg {...base(size)}>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </svg>
);
export const Photo = ({ size = 32 }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M21 16l-5-5-8 9" />
  </svg>
);
export const Trash = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
);

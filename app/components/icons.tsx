import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 26, height: 26, viewBox: "0 0 26 26", fill: "none", stroke: "currentColor", strokeWidth: 2.2,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...props,
});

export const HomeIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 12.5 13 5l9 7.5V21a1 1 0 0 1-1 1h-5v-6h-6v6H5a1 1 0 0 1-1-1z" /></svg>
);
export const CalendarIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="4" y="5.5" width="18" height="16" rx="2" /><path d="M4 10.5h18M9 3.5v4M17 3.5v4" /></svg>
);
export const UserIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="13" cy="9" r="4.5" /><path d="M4.5 22c.8-4.2 4.3-6.5 8.5-6.5s7.7 2.3 8.5 6.5" /></svg>
);
export const ChatIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 6h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9l-5 4v-4H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" /><path d="M9 11h8M9 14h5" /></svg>
);
export const GearIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 22, height: 22, viewBox: "0 0 24 24", strokeWidth: 2, ...p })}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const SendIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 20, height: 20, viewBox: "0 0 24 24", ...p })}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
);
export const BackIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 22, height: 22, viewBox: "0 0 22 22", strokeWidth: 2, ...p })}><path d="M13.5 5l-6 6 6 6" /></svg>
);
export const MountainIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 24, height: 24, viewBox: "0 0 28 28", strokeWidth: 2, ...p })}>
    <path d="M2 23 L11 7 L15 12 L18 9 L26 23 Z" /><path d="M8.5 11.5 L11 14 L13 11 L15 12" />
  </svg>
);
export const AppleIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M16.37 12.64c.02 2.72 2.39 3.63 2.42 3.64-.02.06-.38 1.3-1.25 2.57-.75 1.1-1.53 2.2-2.77 2.22-1.21.02-1.6-.72-2.99-.72-1.39 0-1.82.7-2.97.74-1.19.04-2.1-1.19-2.86-2.28-1.55-2.24-2.73-6.33-1.14-9.09.79-1.37 2.2-2.24 3.74-2.26 1.17-.02 2.27.79 2.99.79.71 0 2.05-.97 3.46-.83.59.03 2.24.24 3.3 1.8-.09.05-1.97 1.15-1.95 3.42zM14.1 5.9c.63-.76 1.06-1.83.94-2.9-.91.04-2.01.61-2.66 1.37-.58.67-1.1 1.76-.96 2.8 1.01.08 2.05-.52 2.68-1.27z" />
  </svg>
);

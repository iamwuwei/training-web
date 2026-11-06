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
export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 24, height: 24, viewBox: "0 0 24 24", ...p })}><path d="M6 6l12 12M18 6 6 18" /></svg>
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
export const ShoeIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 20, height: 20, viewBox: "0 0 24 24", strokeWidth: 2, ...p })}><path d="M3 16.5V10l3-1.2L8.4 5l3.4 1.9c.8 2.1 2.6 3.4 5 3.6l2.6.3c1.6.2 3.1 1.6 3.1 3.3v2.4z" /><path d="M3 16.5v1.7c0 .5.4.8.8.8h17.9c.4 0 .8-.3.8-.8v-1.7" /><path d="M9.7 9.3l1.4-1.7M12.2 11l1.3-1.6" /></svg>
);
export const WatchIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 20, height: 20, viewBox: "0 0 24 24", strokeWidth: 2, ...p })}><rect x="6.5" y="7" width="11" height="10" rx="3" /><path d="M9 7l.6-3.5h4.8L15 7M9 17l.6 3.5h4.8L15 17" /><path d="M12 10v2.2l1.5 1" /></svg>
);
export const CloudIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 20, height: 20, viewBox: "0 0 24 24", strokeWidth: 2, ...p })}><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>
);

// ---- group-race ----------------------------------------------------------------------------
/** The 群組 tab: two people (26 viewBox like the other tabs). */
export const GroupIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="10" cy="9" r="4" /><path d="M2.5 21.5c.7-3.8 3.7-6 7.5-6s6.8 2.2 7.5 6" /><path d="M16.5 5.2a4 4 0 0 1 0 7.6" /><path d="M19.6 15.9c2.1.9 3.4 2.8 3.9 5.6" /></svg>
);
/** Small 22 px line icons for the group pages (24 viewBox, stroke 2). */
const small = (p: SVGProps<SVGSVGElement>) => base({ width: 22, height: 22, viewBox: "0 0 24 24", strokeWidth: 2, ...p });
export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (<svg {...small(p)}><path d="M12 5v14M5 12h14" /></svg>);
export const RefreshIcon = (p: SVGProps<SVGSVGElement>) => (<svg {...small(p)}><path d="M20 11a8 8 0 0 0-14.3-4.5L4 9" /><path d="M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14.3 4.5L20 15" /><path d="M20 20v-5h-5" /></svg>);
export const ShareIcon = (p: SVGProps<SVGSVGElement>) => (<svg {...small(p)}><path d="M12 15V3.5" /><path d="M7.5 8 12 3.5 16.5 8" /><path d="M5 11.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7.5" /></svg>);
export const CopyIcon = (p: SVGProps<SVGSVGElement>) => (<svg {...small(p)}><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></svg>);
export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (<svg {...small(p)}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>);
export const RotateIcon = (p: SVGProps<SVGSVGElement>) => (<svg {...small(p)}><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></svg>);
export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (<svg {...small(p)}><path d="M4.5 7h15" /><path d="M9.5 7V4.5h5V7" /><path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" /><path d="M10 11v6M14 11v6" /></svg>);
export const LinkIcon = (p: SVGProps<SVGSVGElement>) => (<svg {...small(p)}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>);
/** › and ▾ at 16 px (list rows, the member picker). */
export const ChevronIcon = (p: SVGProps<SVGSVGElement>) => (<svg {...base({ width: 16, height: 16, viewBox: "0 0 16 16", strokeWidth: 2, ...p })}><path d="M6 3l5 5-5 5" /></svg>);
export const CaretDownIcon = (p: SVGProps<SVGSVGElement>) => (<svg {...base({ width: 16, height: 16, viewBox: "0 0 16 16", strokeWidth: 2, ...p })}><path d="M3.5 6l4.5 4.5L12.5 6" /></svg>);

// ---- ai-plan-generation ----
/** 改答案再排: a pencil (22 px, 24 viewBox, stroke 2 like the other small icons). */
export const EditIcon = (p: SVGProps<SVGSVGElement>) => (<svg {...small(p)}><path d="M4 20h4.2L19.4 8.8a2 2 0 0 0 0-2.8l-1.4-1.4a2 2 0 0 0-2.8 0L4 15.8z" /><path d="M13.5 6.5l4 4" /></svg>);

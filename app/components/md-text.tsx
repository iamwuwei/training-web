import { useMemo } from "react";
import { parseMd, type MdInline } from "../lib/md";

// Woo's text drawn from the markdown subset in lib/md.ts. The only elements are div, p, ul, ol, li and b, and the text
// is only ever a React text node: nothing is parsed as HTML, and no text goes into any attribute.
// className / onClick are the caller's own (the collapsible weekly summary in proposals.tsx).

function Inline({ parts }: { parts: MdInline[] }) {
  return (
    <>
      {parts.map((x, i) => (x.t === "b" ? <b key={i}>{x.s}</b> : x.s))}
    </>
  );
}

export function MdText({ text, className, onClick }: { text: string; className?: string; onClick?: () => void }) {
  const blocks = useMemo(() => parseMd(text), [text]);
  if (!text.trim() || !blocks.length) return null;
  return (
    <div className={`text md${className ? ` ${className}` : ""}`} onClick={onClick}>
      {blocks.map((b, i) => {
        if (b.t === "p") return <p key={i}><Inline parts={b.inline} /></p>;
        const items = b.items.map((it, j) => <li key={j}><Inline parts={it} /></li>);
        return b.t === "ul" ? <ul key={i}>{items}</ul> : <ol key={i} start={b.start}>{items}</ol>;
      })}
    </div>
  );
}

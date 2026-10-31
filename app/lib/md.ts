// A tiny markdown subset for Woo's replies and weekly summaries (coach-format).
//
// Parsed:   paragraphs (blank-line separated), "- " / "* " / "• " lists, "1. " / "1) " lists, **bold**.
// Printed as the characters they are (no parsing at all): # headings, ![images](...), [links](...), bare URLs,
//           <html>, | tables, ``` and `code`, > quotes, ---, *italic* and _italic_, ~~strike~~, backslashes.
// No nesting: the indent before a list marker is ignored, so a sub-item becomes an item of the same list.
//
// Pure function, no imports, no DOM: it returns data, and MdText turns that data into React elements, so
// the text only ever becomes text nodes. Nothing here builds HTML or reads a URL.

/** Longer than this is not parsed (the api cuts Woo's replies at 2000; this is the guard for anything else). */
export const MD_MAX_CHARS = 10_000;

export type MdInline = { t: "text"; s: string } | { t: "b"; s: string };
export type MdBlock =
  | { t: "p"; inline: MdInline[] }
  | { t: "ul"; items: MdInline[][] }
  | { t: "ol"; start: number; items: MdInline[][] };

// "**x**" on one line, at least one character inside, no "*" inside. A "**" without its pair stays as it is.
// [^*\n]+? cannot overlap with the closing "**", so matching is linear.
const BOLD = /\*\*([^*\n]+?)\*\*/g;
const BLANK = /^\s*$/;
// The item text is [^]* (any character): with (.*)$ a line holding U+2028 / U+2029 (which "." does not match, but
// \s does) made the engine give back the whitespace one character at a time, O(n^2) on 10 000 characters.
const UL = /^\s{0,3}[-*•]\s+([^]*)$/;
const OL = /^\s{0,3}(\d{1,2})[.)]\s+([^]*)$/;
// A horizontal-rule look-alike ("* * *", "- - -"): not a list, printed as the characters it is.
const RULE = /^\s{0,3}([-*])(?:\s*\1){2,}\s*$/;

export function parseInline(s: string): MdInline[] {
  const out: MdInline[] = [];
  let last = 0;
  BOLD.lastIndex = 0;
  for (let m = BOLD.exec(s); m; m = BOLD.exec(s)) {
    if (m.index > last) out.push({ t: "text", s: s.slice(last, m.index) });
    out.push({ t: "b", s: m[1] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: "text", s: s.slice(last) });
  return out;
}

export function parseMd(text: string): MdBlock[] {
  const src = text.replace(/\r\n?/g, "\n");
  if (src.length > MD_MAX_CHARS) return [{ t: "p", inline: [{ t: "text", s: src }] }];

  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; start: number; items: MdInline[][] } | null = null;

  const closePara = () => {
    if (!para.length) return;
    const s = para.join("\n").trim();
    if (s) blocks.push({ t: "p", inline: parseInline(s) });
    para = [];
  };
  const closeList = () => {
    if (!list) return;
    blocks.push(list.ordered ? { t: "ol", start: list.start, items: list.items } : { t: "ul", items: list.items });
    list = null;
  };
  const addItem = (ordered: boolean, start: number, s: string) => {
    closePara();
    if (list && list.ordered !== ordered) closeList();
    if (!list) list = { ordered, start, items: [] };
    list.items.push(parseInline(s.trim()));
  };

  for (const line of src.split("\n")) {
    if (BLANK.test(line)) {
      closePara();
      closeList();
      continue;
    }
    // An item needs some text after the marker ("- " alone and "* * *" are plain text lines).
    const ul = UL.exec(line);
    if (ul && ul[1].trim() && !RULE.test(line)) {
      addItem(false, 1, ul[1]);
      continue;
    }
    const ol = OL.exec(line);
    if (ol && ol[2].trim()) {
      addItem(true, Number(ol[1]), ol[2]);
      continue;
    }
    closeList();
    para.push(line);
  }
  closePara();
  closeList();
  return blocks;
}

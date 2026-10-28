// What Woo is doing while the athlete waits: one line, one animation. The text is the stage the
// worker reported (the api writes it as it goes), then the dots, which stand in for an ellipsis.

const STAGE_TEXT: Record<string, string> = {
  preparing: "Woo 在看你的課表和紀錄",
  thinking: "Woo 在想",
  searching: "Woo 在查資料",
  writing: "Woo 在打字",
  reading: "Woo 在看這趟的數據",
  judging: "Woo 在比對配速和心拍",
};
const STAGE_FALLBACK = "Woo 在想";

/**
 * `stage` from ApiCoachMessage; null or a value this build does not know shows `fallback`
 * (the api's list may grow without a web release). The dots are one element that is never
 * re-created when the text changes, so their pulse does not restart on every stage.
 */
export function WooStatus({ stage, fallback = STAGE_FALLBACK }: { stage: string | null | undefined; fallback?: string }) {
  const text = stage != null && Object.hasOwn(STAGE_TEXT, stage) ? STAGE_TEXT[stage] : fallback; // own keys only: "constructor" is not a stage
  return (
    <span className="woo-status" role="status" aria-live="polite">
      <span className="t" key={text}>{text}</span>
      <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
    </span>
  );
}

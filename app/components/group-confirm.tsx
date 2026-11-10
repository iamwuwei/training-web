import { useState } from "react";
import { SEND_FAILED } from "../lib/groups";
import { BottomSheet } from "./sheet";

/**
 * Every confirmation in the 群組 pages (remove, leave, disband, revoke, new link): a bottom sheet with the consequence in words
 * and 取消／the action side by side. `onConfirm` resolves when it is done (the caller closes or navigates); if it throws the
 * sheet stays open with 送出失敗，再試一次. Nothing here uses `window.confirm`.
 */
export function GroupConfirm({ open, title, text, action, busyLabel, tone, onCancel, onConfirm }: {
  open: boolean; title: string; text: string; action: string; busyLabel: string; tone: "danger" | "primary";
  onCancel: () => void; onConfirm: () => Promise<void>;
}) {
  return (
    <BottomSheet open={open} onClose={onCancel} label={title} className="group-confirm">
      <Body title={title} text={text} action={action} busyLabel={busyLabel} tone={tone} onCancel={onCancel} onConfirm={onConfirm} />
    </BottomSheet>
  );
}

function Body({ title, text, action, busyLabel, tone, onCancel, onConfirm }: { title: string; text: string; action: string; busyLabel: string; tone: "danger" | "primary"; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function go() {
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2 className="sheet-title st">{title}</h2>
      <p className="gc-text">{text}</p>
      {failed ? <p className="err" role="alert">{SEND_FAILED}</p> : null}
      <div className="actions-row">
        <button type="button" className="btn compact" disabled={busy} onClick={onCancel}>取消</button>
        <button type="button" className={`btn compact ${tone}`} disabled={busy} onClick={() => void go()}>{busy ? busyLabel : action}</button>
      </div>
    </>
  );
}

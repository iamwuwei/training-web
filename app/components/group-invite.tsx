import { useRef, useState } from "react";
import { deleteGroupInvite, postGroupInvite } from "../lib/api";
import { toJstDate } from "../lib/date";
import { isStatus, mdDowPlain } from "../lib/groups";
import type { ApiGroupInvite } from "../types/api";
import { GroupConfirm } from "./group-confirm";
import { CheckIcon, CopyIcon, RotateIcon, ShareIcon, TrashIcon } from "./icons";
import { BottomSheet } from "./sheet";

const ONCE = "連結只顯示這一次。關掉這張就看不到了，要再拿只能重新產生（舊的會失效）。";
const HIDDEN = "連結只在產生時顯示一次，這裡看不到也複製不了。要再傳給別人得重新產生——舊的會失效，已經傳出去的就不能用了。";

/** `navigator.share` exists on phones and some desktops; where it does not, the button is simply not drawn. */
const canShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

/**
 * 邀請夥伴 (the owner's sheet on 成員): no invite → 產生; just made → the link (only now, the api keeps a hash) with copy,
 * share, 重新產生, 撤銷; a live invite whose link can no longer be shown → dates and uses and the same two actions, no copy.
 * 重新產生 and 撤銷 ask first (the old link stops working at once). The plain token lives in this component's state only:
 * closing the sheet unmounts it and the link is gone.
 */
export function GroupInviteSheet({ open, ...rest }: { open: boolean; onClose: () => void; groupId: string; invite: ApiGroupInvite | null; onChanged: () => void }) {
  return open ? <Inner {...rest} /> : null;
}

type Ask = "regen" | "revoke" | null;

function Inner({ onClose, groupId, invite, onChanged }: { onClose: () => void; groupId: string; invite: ApiGroupInvite | null; onChanged: () => void }) {
  const [fresh, setFresh] = useState<ApiGroupInvite | null>(null);
  const [cleared, setCleared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const linkRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const current = fresh ?? (cleared ? null : invite);
  const url = fresh?.token ? `${window.location.origin}/join/${fresh.token}` : null;
  const meta = current ? `到 ${mdDowPlain(toJstDate(current.expires_at))} · 還能用 ${current.uses_left} 次` : "";

  const choose = (a: Ask) => setAsk(a);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await postGroupInvite(groupId);
      setFresh(r.invite);
      setCleared(false);
      setCopied(false);
      setSelected(false);
      onChanged();
    } catch (e) {
      setError(isStatus(e, 409) ? "群組滿了，不能再邀請" : "產生失敗，再試一次");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setSelected(false);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // the clipboard is refused (some in-app browsers): select the whole link so a long press can copy it
      setSelected(true);
      const el = linkRef.current;
      if (el) { const r = document.createRange(); r.selectNodeContents(el); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r); }
    }
  }

  async function share() {
    if (!url) return;
    try { await navigator.share({ url }); } catch { /* cancelled, or nothing to share with: not an error */ }
  }

  return (
    <>
      {/* while a confirm is up, Escape and the backdrop belong to it, not to this sheet; the confirms are siblings, not children, so each is its own top layer */}
      <BottomSheet open onClose={ask ? () => undefined : onClose} label="邀請夥伴" className="invite-sheet">
        <h2 className="sheet-title st">邀請夥伴</h2>
        <div className="group-invite">
          {!current ? (
            <>
              <p className="gi-sub">產生一條連結用 LINE 傳給朋友：7 天有效，用到滿 5 人為止。</p>
              <div className="actions-row"><button type="button" className="btn compact primary" disabled={busy} onClick={() => void generate().catch(() => undefined)}>{busy ? "產生中…" : "產生邀請連結"}</button></div>
            </>
          ) : (
            <>
              {url ? <div ref={linkRef} className={`gi-link${selected ? " selected" : ""}`}>{url}</div> : <div className="gi-t">已有一條有效邀請</div>}
              <div className="gi-bar">
                <span className="gi-meta">{meta}</span>
                {url ? (
                  <button type="button" className="gi-ic copy" aria-label="複製連結" title="複製連結" onClick={() => void copy()}>
                    {copied ? <><CheckIcon aria-hidden="true" /><span className="gi-tip" role="status">已複製</span></> : <CopyIcon aria-hidden="true" />}
                  </button>
                ) : null}
                {url && canShare() ? <button type="button" className="gi-ic" aria-label="用其他 app 分享" title="用其他 app 分享" onClick={() => void share()}><ShareIcon aria-hidden="true" /></button> : null}
                <button type="button" className="gi-ic" aria-label="重新產生連結" title="重新產生連結" onClick={() => choose("regen")}><RotateIcon aria-hidden="true" /></button>
                <button type="button" className="gi-ic danger" aria-label="撤銷連結" title="撤銷連結" onClick={() => choose("revoke")}><TrashIcon aria-hidden="true" /></button>
              </div>
              {selected ? <p className="gi-sub">沒辦法自動複製。連結已經選好了，長按就能複製。</p> : null}
              {url ? <p className="gi-once">{ONCE}</p> : <p className="gi-sub">{HIDDEN}</p>}
            </>
          )}
          {error ? <p className="err" role="alert">{error}</p> : null}
        </div>
      </BottomSheet>
      <GroupConfirm
        open={ask === "regen"} tone="primary" title="重新產生連結？" action="重新產生" busyLabel="產生中…"
        text="舊的連結會馬上失效：已經傳給朋友、還沒加入的人就不能用了，要把新的連結再傳一次。已經加入的人不受影響。"
        onCancel={() => choose(null)}
        onConfirm={async () => {
          try { await generate(); } catch (e) { if (isStatus(e, 409)) { choose(null); return; } throw e; } // full: the sheet behind says so
          choose(null);
        }}
      />
      <GroupConfirm
        open={ask === "revoke"} tone="danger" title="撤銷這條邀請？" action="撤銷" busyLabel="撤銷中…"
        text="已經傳出去的連結會馬上失效，還沒加入的人就不能用了。之後要邀請，再產生一條。"
        onCancel={() => choose(null)}
        onConfirm={async () => {
          await deleteGroupInvite(groupId);
          setFresh(null); setCleared(true); setError(null); setCopied(false); setSelected(false);
          choose(null);
          onChanged();
        }}
      />
    </>
  );
}

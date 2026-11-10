import { useState } from "react";
import { useNavigate } from "react-router";
import { parseInviteToken } from "../lib/invite";
import { ChevronIcon, LinkIcon, PlusIcon } from "./icons";
import { BottomSheet } from "./sheet";

const NOT_A_LINK = "這不是邀請連結。請整段貼上朋友傳來的連結。";

/**
 * 加入或建立群組 (the ＋ of the group list): 建立群組 hands over to the create sheet; 用邀請連結加入 opens a field for the link
 * or the bare code. 前往 takes the 43-character token out of it and goes to /join/<token>, exactly where clicking the link leads
 * (no new route, no api call here). Anything else is 這不是邀請連結.
 */
export function GroupAddSheet({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} label="加入或建立群組" className="group-add">
      <Body onClose={onClose} onCreate={onCreate} />
    </BottomSheet>
  );
}

function Body({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const navigate = useNavigate();
  const [joining, setJoining] = useState(false);
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);

  function go() {
    const token = parseInviteToken(text);
    if (!token) { setBad(true); return; }
    onClose();
    void navigate(`/join/${token}`);
  }

  return (
    <>
      <h2 className="sheet-title st">加入或建立群組</h2>
      <button type="button" className="ga-row" onClick={onCreate}>
        <span className="ic" aria-hidden="true"><PlusIcon /></span>
        <span><div className="t">建立群組</div><div className="s">你當擁有者，再邀朋友</div></span>
        <ChevronIcon aria-hidden="true" />
      </button>
      <button type="button" className="ga-row" aria-expanded={joining} onClick={() => setJoining(true)}>
        <span className="ic" aria-hidden="true"><LinkIcon /></span>
        <span><div className="t">用邀請連結加入</div><div className="s">貼上朋友傳的連結或代碼</div></span>
        <ChevronIcon aria-hidden="true" />
      </button>
      {joining ? (
        <div className="ga-join">
          <label className="gf-label" htmlFor="invite-text">邀請連結或代碼</label>
          <input
            id="invite-text" type="text" className={`oneline${bad ? " bad" : ""}`} value={text} autoFocus autoComplete="off" autoCapitalize="off" spellCheck={false}
            placeholder="貼上 https://…/join/… 或代碼" aria-invalid={bad} aria-describedby={bad ? "invite-err" : undefined}
            onChange={(e) => { setText(e.target.value); setBad(false); }}
            onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) go(); }}
          />
          {bad ? <p id="invite-err" className="err" role="alert">{NOT_A_LINK}</p> : null}
          <div className="actions-row"><button type="button" className="btn compact primary" disabled={!text.trim()} onClick={go}>前往</button></div>
        </div>
      ) : null}
      <p className="sheet-foot">有邀請連結？直接點連結也能加入。</p>
    </>
  );
}

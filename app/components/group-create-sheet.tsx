import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router";
import { postGroup } from "../lib/api";
import { isStatus, LIMIT_TEXT, SEND_FAILED } from "../lib/groups";
import { BottomSheet } from "./sheet";

const NAME_MAX = 30;
const RACE_MAX = 40;

export interface CreateDefaults { race_name: string; race_date: string }

/** The one-line form of a group: its name, the race and the race day (the athlete's own plan fills the last two in). */
export function GroupCreateSheet({ open, onClose, defaults, today }: { open: boolean; onClose: () => void; defaults: CreateDefaults | null; today: string }) {
  return (
    <BottomSheet open={open} onClose={onClose} label="建立群組" className="group-create">
      <Body onClose={onClose} defaults={defaults} today={today} />
    </BottomSheet>
  );
}

function Body({ onClose, defaults, today }: { onClose: () => void; defaults: CreateDefaults | null; today: string }) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [name, setName] = useState("");
  const [race, setRace] = useState(defaults?.race_name ?? "");
  const [date, setDate] = useState(defaults && defaults.race_date >= today ? defaults.race_date : "");
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<{ name?: string; race?: string; date?: string; form?: string }>({});

  // the api cleans the same way (one line, trimmed); this is only so the check below and the request agree
  const one = (v: string) => v.replace(/\s+/g, " ").trim();

  async function submit() {
    const n = one(name), r = one(race);
    const next: typeof errs = {};
    if (!n) next.name = "名稱不能空白";
    if (!r) next.race = "比賽不能空白";
    if (!date) next.date = "請選比賽日";
    else if (date < today) next.date = "比賽日不能早於今天";
    setErrs(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const res = await postGroup({ name: n, race_name: r, race_date: date });
      onClose();
      void navigate(`/groups/${res.group.id}`);
    } catch (e) {
      if (isStatus(e, 409)) { setErrs({ form: LIMIT_TEXT }); void revalidator.revalidate(); } // someone filled the third slot meanwhile: the list behind is stale
      else setErrs({ form: SEND_FAILED });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="sheet-title st">建立群組</h2>
      <div className="gf-field">
        <label className="gf-label" htmlFor="g-name"><span>群組名稱</span><span className={`gf-count${name.length >= NAME_MAX ? " max" : ""}`}>{name.length} / {NAME_MAX}</span></label>
        <input id="g-name" type="text" className={`oneline${errs.name ? " bad" : ""}`} value={name} maxLength={NAME_MAX} placeholder="例如：富士山組" autoComplete="off" onChange={(e) => setName(e.target.value)} aria-invalid={!!errs.name} />
        {errs.name ? <p className="err" role="alert">{errs.name}</p> : null}
      </div>
      <div className="gf-field">
        <label className="gf-label" htmlFor="g-race"><span>比賽</span><span className={`gf-count${race.length >= RACE_MAX ? " max" : ""}`}>{race.length} / {RACE_MAX}</span></label>
        <input id="g-race" type="text" className={`oneline${errs.race ? " bad" : ""}`} value={race} maxLength={RACE_MAX} autoComplete="off" onChange={(e) => setRace(e.target.value)} aria-invalid={!!errs.race} />
        {errs.race ? <p className="err" role="alert">{errs.race}</p> : <p className="gf-hint">{defaults ? "預設是你課表上的比賽" : "你的課表還沒有比賽，請自己填"}</p>}
      </div>
      <div className="gf-field">
        <label className="gf-label" htmlFor="g-date"><span>比賽日</span></label>
        <input id="g-date" type="date" className={`oneline${errs.date ? " bad" : ""}`} value={date} min={today} onChange={(e) => setDate(e.target.value)} aria-invalid={!!errs.date} />
        {errs.date ? <p className="err" role="alert">{errs.date}</p> : <p className="gf-hint">倒數用這一天</p>}
      </div>
      <p className="privacy">第一次建立或加入群組時，這五項會分享給群組成員：進度彙總、完成事件、課表內容、跑步詳情、Woo 的判定；可以隨時到設定關掉。</p>
      <p className="privacy-risk">課表備註和 Woo 的評論可能提到傷痛或行程。</p>
      {errs.form ? <p className="err" role="alert">{errs.form}</p> : null}
      <div className="actions-row"><button type="button" className="btn compact primary" disabled={busy} onClick={() => void submit()}>{busy ? "建立中…" : "建立"}</button></div>
      <p className="sheet-foot">建好後你是擁有者，可以在「成員」產生邀請連結。</p>
    </>
  );
}

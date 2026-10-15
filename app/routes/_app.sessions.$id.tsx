import { useState } from "react";
import { useNavigate, useParams, useRevalidator } from "react-router";
import type { Route } from "./+types/_app.sessions.$id";
import { BackIcon } from "../components/icons";
import { MemoFields } from "../components/memo";
import { PlanPost } from "../components/posts";
import { ActivityPick } from "../components/pick";
import { SectionH, TopBar } from "../components/ui";
import { ApiError, putSession } from "../lib/api";
import { candidatesFor, defaultPick } from "../lib/plan";
import { NoPlan, usePlan } from "../lib/use-plan";

export function meta(): Route.MetaDescriptors {
  return [{ title: "記錄訓練 · 富士山マラソン 2026" }];
}

// "記錄訓練": pick which Strava activity was this session, write the feeling, send.
// One PUT …/session carries session + memo + RPE; the coach review is generated afterwards.

export default function LogSession() {
  const view = usePlan();
  const { id } = useParams();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const session = view?.data.sessions.find((s) => s.id === id) ?? null;
  const candidates = view && session ? candidatesFor(view, session) : [];
  const holder = view && session ? view.byDate.get(session.scheduled_date)?.activity ?? null : null;

  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [memo, setMemo] = useState<string | undefined>(undefined);
  const [rpe, setRpe] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!view) return <NoPlan title="記錄訓練" />;
  const back = (
    <button type="button" className="back" aria-label="返回" onClick={() => (window.history.length > 1 ? void navigate(-1) : void navigate("/"))}>
      <BackIcon />
    </button>
  );
  if (!session) {
    return (
      <>
        <TopBar title="記錄訓練" back={back} />
        <main><p className="empty">找不到這堂課。</p></main>
      </>
    );
  }

  // Form values start from what is stored (editing an already-logged session) or the default pick.
  const selectedId = picked !== undefined ? picked : defaultPick(session, candidates)?.id ?? null;
  const selected = candidates.find((a) => a.id === selectedId) ?? null;
  const memoValue = memo ?? selected?.memo ?? "";
  const rpeValue = rpe !== undefined ? rpe : selected?.rpe ?? null;

  async function submit() {
    if (!selected || !session) return;
    setBusy(true);
    setError(null);
    try {
      await putSession(selected.id, {
        session_id: session.id,
        memo: memoValue.trim() || null,
        rpe: rpeValue,
        replace: true,
      });
      await revalidator.revalidate();
      void navigate(`/activities/${selected.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 503 ? "資料庫還在啟動，幾秒後再按一次" : e.message) : "送出失敗，再試一次");
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title="記錄訓練" back={back} />
      <main>
        <PlanPost session={session} big weekNo />

        <SectionH>這堂課是哪個活動？</SectionH>
        {candidates.length ? (
          <div className="picks" role="radiogroup" aria-label="對應的 Strava 活動">
            {candidates.map((a) => (
              <ActivityPick
                key={a.id}
                activity={a}
                checked={a.id === selectedId}
                sessionDate={session.scheduled_date}
                onPick={() => { setPicked(a.id); setMemo(undefined); setRpe(undefined); }}
              />
            ))}
          </div>
        ) : (
          <div className="empty">
            Strava 還沒有同步到這幾天的活動。
            <div><button type="button" className="btn" onClick={() => void revalidator.revalidate()} disabled={revalidator.state === "loading"}>重新整理</button></div>
          </div>
        )}

        <SectionH>我的心得</SectionH>
        <section className="memo" style={{ borderBottom: "none" }}>
          <MemoFields memo={memoValue} rpe={rpeValue} onMemo={setMemo} onRpe={setRpe} />
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => void submit()} disabled={busy || !selected}>
              {busy ? "送出中…" : holder && holder.id === selected?.id ? "更新並重新分析" : "送出，請教練分析"}
            </button>
          </div>
          {error ? <p className="hint" style={{ color: "var(--v-bad)" }}>{error}</p> : null}
          <p className="hint">
            {selected ? "送出後這個活動會算成這堂課，教練會依數據和你寫的感受給判定，幾秒後出現在報告頁。" : "先選一個活動。"}
          </p>
        </section>
      </main>
    </>
  );
}

import { useState } from "react";
import { redirect, useLocation, useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/_app.settings";
import { Fold } from "../components/fold";
import { ShareSettingsSection } from "../components/share-settings";
import { BackPill, NavBar } from "../components/nav-bar";
import { SectionH } from "../components/ui";
import { ApiError, disconnectStrava, getGroups, getMe, getShare, postConstraint } from "../lib/api";
import { hasSession, logout } from "../lib/auth";
import { config, useMock } from "../lib/config";
import { periodMeta } from "../lib/constraints";
import { md, todayJst, toJstDate } from "../lib/date";
import { usePlan } from "../lib/use-plan";
import { pageTitle } from "../lib/meta";

export async function clientLoader() {
  if (!hasSession()) throw redirect("/login");
  try {
    // The share block is the 群組 feature's: an api from before it answers 404, then the block is left out and the page is as it was.
    // Any other failure is shown as a failure (it is the only place to see what is shared: it must not vanish quietly).
    // `inGroups` only picks the block's first sentence; if the groups can not be read the usual one is shown.
    const [me, share, groups] = await Promise.all([
      getMe(),
      getShare().then((r) => ({ state: "ok" as const, share: r.share })).catch((e: unknown) => (e instanceof ApiError && e.status === 404 ? { state: "missing" as const } : { state: "error" as const })),
      getGroups().catch(() => null),
    ]);
    return { me, share, inGroups: groups ? groups.groups.length > 0 : true };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw redirect("/login");
    throw e;
  }
}

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  return pageTitle("設定", matches);
}

/**
 * Woo 記住的限制: what he was told to remember (accepted from his 記下來 cards), one per row, with
 * a 刪除 that takes effect at once. No manual add: limits come from the conversation only.
 * Expired ones stay listed (marked 已過期) until deleted; Woo ignores them either way.
 */
function Constraints() {
  const list = usePlan()?.data.constraints ?? [];
  const revalidator = useRevalidator();
  const [gone, setGone] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const today = todayJst();
  const rows = list.filter((c) => c.status === "active");

  async function remove(id: string) {
    setError(null);
    try {
      await postConstraint(id, "dismiss");
      setGone((g) => [...g, id]);
      window.setTimeout(() => void revalidator.revalidate(), 250);
    } catch (e) {
      // 409: already gone (another device) — reload and the row is too.
      if (e instanceof ApiError && e.status === 409) void revalidator.revalidate();
      else setError(e instanceof ApiError ? e.message : "刪除失敗，再試一次");
    }
  }

  return (
    <section className="constraints" aria-label="Woo 記住的限制">
      <SectionH>Woo 記住的限制</SectionH>
      {rows.length === 0 ? <p className="empty-line">還沒有。跟 Woo 說「週三不能跑」之類的，他會問要不要記下。</p> : null}
      {rows.map((c) => {
        const meta = periodMeta(c, today);
        return (
          <div key={c.id} className={`constraint-wrap${gone.includes(c.id) ? " gone" : ""}`} inert={gone.includes(c.id)}>
            <div className="constraint">
              <div className="txt">
                <div className="t">{c.text}</div>
                <div className={`meta${meta.expired ? " expired" : ""}`}>{meta.text} · 來自 {md(toJstDate(c.created_at))} 的對話</div>
              </div>
              <button type="button" className="del" aria-label={`刪除：${c.text}`} onClick={() => void remove(c.id)}>刪除</button>
            </div>
          </div>
        );
      })}
      {error ? <p className="err" role="alert" style={{ marginTop: 8, fontSize: 13, color: "var(--v-bad)" }}>{error}</p> : null}
      {rows.length ? <p className="note-line">排課提案不會違反這些。過期的自動不算，不用刪；刪了 Woo 就當沒說過。</p> : null}
    </section>
  );
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { user, strava, strava_connect_url } = loaderData.me;
  const { share, inGroups } = loaderData;
  const loginVia = useMock ? "示範資料" : config.cognitoIdp === "SignInWithApple" ? "Apple" : "Cognito";
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Folded unless the url asks for it (#share, #strava) or there is nothing else to do here (no Strava yet). Not stored anywhere.
  const { hash, key } = useLocation();
  const navigate = useNavigate();
  const [stravaOpen, setStravaOpen] = useState(() => hash === "#strava" || !strava);
  const [shareOpen, setShareOpen] = useState(() => hash === "#share");

  async function unlink() {
    if (!window.confirm("解除 Strava 連結？之後的跑步不會再自動匯入，已匯入的紀錄會保留。")) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectStrava();
      await revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "解除失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <NavBar kind="inline" title="設定" left={<BackPill label="今天" ariaLabel="返回今天" onClick={() => void (key !== "default" ? navigate(-1) : navigate("/", { replace: true }))} />} />
      <main>
        <SectionH>帳號</SectionH>
        <div className="setting"><span className="k">名字</span><span className="v">{user.display_name}</span></div>
        <div className="setting"><span className="k">Email</span><span className="v">{user.email ?? "–"}</span></div>
        <div className="setting"><span className="k">登入方式</span><span className="v grey">{loginVia}</span></div>

        <Fold id="strava" title="Strava" summary={<span className={`status${strava ? " on" : ""}`}>{strava ? "已連結" : "尚未連結"}</span>} open={stravaOpen} onToggle={() => setStravaOpen((o) => !o)}>
          <div className="setting">
            <span className="k">狀態</span>
            <span className="v">
              {strava
                ? <span className="status on">已連結 · athlete {strava.athlete_id}</span>
                : <span className="status">尚未連結</span>}
            </span>
          </div>
          {strava ? (
            <div className="setting"><span className="k">權限</span><span className="v grey">{strava.scope}</span></div>
          ) : null}
          <a className={`btn${strava ? "" : " primary"}`} href={strava_connect_url} target="_blank" rel="noopener">
            {strava ? "重新連結 Strava" : "連結 Strava"}
          </a>
          {strava ? (
            <button type="button" className="btn danger" onClick={() => void unlink()} disabled={busy}>
              {busy ? "解除中…" : "解除 Strava 連結"}
            </button>
          ) : null}
          {error ? <p className="err" role="alert" style={{ marginTop: 8, fontSize: 13, color: "var(--v-bad)" }}>{error}</p> : null}
          <p className="note" style={{ textAlign: "left" }}>
            連結後 Strava 的每次跑步會自動配對課表。{strava ? "重新連結會換新的授權；解除連結會向 Strava 撤銷授權，已匯入的紀錄保留。" : "會開 Strava 的授權頁，同意後回到這裡重新整理。"}
          </p>
        </Fold>

        {share.state === "ok" ? <ShareSettingsSection initial={share.share} inGroups={inGroups} open={shareOpen} onToggle={() => setShareOpen((o) => !o)} /> : null}
        {share.state === "error" ? (
          <Fold id="share" title="隱私" summary="讀不到" open={shareOpen} onToggle={() => setShareOpen((o) => !o)}>
            <div className="share">
              <p className="sf" role="alert">讀不到分享設定。</p>
              <button type="button" className="chip" style={{ marginTop: 8 }} onClick={() => void revalidator.revalidate()}>再試一次</button>
            </div>
          </Fold>
        ) : null}

        <Constraints />

        <SectionH>關於</SectionH>
        <div className="setting"><span className="k">資料來源</span><span className="v grey">{useMock ? "內建示範資料" : config.apiUrl.replace(/^https?:\/\//, "")}</span></div>
        <div className="setting"><span className="k">使用者 ID</span><span className="v grey" style={{ fontSize: 12 }}>{user.id}</span></div>

        <button type="button" className="btn danger" onClick={logout} style={{ marginTop: 28 }}>登出</button>
      </main>
    </>
  );
}

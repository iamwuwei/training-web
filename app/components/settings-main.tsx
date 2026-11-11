import { useState } from "react";
import { Link, useRevalidator } from "react-router";
import { ChevronIcon } from "./icons";
import { SectionH } from "./ui";
import { ApiError, postConstraint } from "../lib/api";
import { logout } from "../lib/auth";
import { config, useMock } from "../lib/config";
import { periodMeta } from "../lib/constraints";
import { todayJst } from "../lib/date";
import type { SettingsContext } from "../lib/settings-context";
import { shareSummary } from "../lib/share-summary";
import { usePlan } from "../lib/use-plan";

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
                <div className={`meta${meta.expired ? " expired" : ""}`}>{meta.text}</div>
              </div>
              <button type="button" className="del" aria-label={`刪除：${c.text}`} onClick={() => void remove(c.id)}>刪除</button>
            </div>
          </div>
        );
      })}
      {error ? <p className="err" role="alert" style={{ marginTop: 8, fontSize: 13, color: "var(--v-bad)" }}>{error}</p> : null}
      {rows.length ? <p className="note-line">排課提案不會違反這些。</p> : null}
    </section>
  );
}

/**
 * The settings page itself (02 §2.6): account, a row each for Strava and 隱私 (they push a page of their own), what Woo remembers, about, 登出.
 * The links carry `preventScrollReset` (this page stays mounted under the pushed one and keeps its place) and say where they come from (`fromSettings`: the pushed page's back goes one step back).
 */
export function SettingsMain({ ctx }: { ctx: SettingsContext }) {
  const { user, strava } = ctx.me;
  const loginVia = useMock ? "示範資料" : config.cognitoIdp === "SignInWithApple" ? "Apple" : "Cognito";
  const state = { fromSettings: true };
  return (
    <main>
      <SectionH>帳號</SectionH>
      <div className="setting"><span className="k">名字</span><span className="v">{user.display_name}</span></div>
      <div className="setting"><span className="k">Email</span><span className="v">{user.email ?? "–"}</span></div>
      <div className="setting"><span className="k">登入方式</span><span className="v grey">{loginVia}</span></div>

      <div className="grp plain links">
        <Link to="/settings/strava" state={state} preventScrollReset className="row link">
          <span className="t">Strava</span>
          <span className="v">{strava ? "已連結" : "尚未連結"}</span>
          <ChevronIcon small className="chev" aria-hidden="true" />
        </Link>
        {ctx.shareState !== "missing" ? (
          <Link to="/settings/privacy" state={state} preventScrollReset className="row link">
            <span className="t">隱私</span>
            <span className="v">{ctx.share ? shareSummary(ctx.share, ctx.inGroups) : "讀不到"}</span>
            <ChevronIcon small className="chev" aria-hidden="true" />
          </Link>
        ) : null}
      </div>

      <Constraints />

      <SectionH>關於</SectionH>
      <div className="setting"><span className="k">資料來源</span><span className="v grey">{useMock ? "內建示範資料" : config.apiUrl.replace(/^https?:\/\//, "")}</span></div>
      <div className="setting"><span className="k">使用者 ID</span><span className="v grey" style={{ fontSize: 12 }}>{user.id}</span></div>

      <button type="button" className="txtbtn logout" onClick={logout}>登出</button>
    </main>
  );
}

import { useState } from "react";
import { redirect, useRevalidator } from "react-router";
import type { Route } from "./+types/_app.settings";
import { SectionH, TopBar } from "../components/ui";
import { ApiError, disconnectStrava, getMe } from "../lib/api";
import { hasSession, logout } from "../lib/auth";
import { config, useMock } from "../lib/config";

export async function clientLoader() {
  if (!hasSession()) throw redirect("/login");
  try {
    return await getMe();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw redirect("/login");
    throw e;
  }
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "設定 · 富士山マラソン 2026" }];
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { user, strava, strava_connect_url } = loaderData;
  const loginVia = useMock ? "示範資料" : config.cognitoIdp === "SignInWithApple" ? "Apple" : "Cognito";
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <TopBar title="設定" />
      <main>
        <SectionH>帳號</SectionH>
        <div className="setting"><span className="k">名字</span><span className="v">{user.display_name}</span></div>
        <div className="setting"><span className="k">Email</span><span className="v">{user.email ?? "–"}</span></div>
        <div className="setting"><span className="k">登入方式</span><span className="v grey">{loginVia}</span></div>

        <SectionH>Strava</SectionH>
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

        <SectionH>關於</SectionH>
        <div className="setting"><span className="k">資料來源</span><span className="v grey">{useMock ? "內建示範資料" : config.apiUrl.replace(/^https?:\/\//, "")}</span></div>
        <div className="setting"><span className="k">使用者 ID</span><span className="v grey" style={{ fontSize: 12 }}>{user.id}</span></div>

        <button type="button" className="btn danger" onClick={logout} style={{ marginTop: 28 }}>登出</button>
      </main>
    </>
  );
}

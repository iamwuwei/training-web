import { useState } from "react";
import { useOutletContext } from "react-router";
import type { Route } from "./+types/_app.settings.strava";
import { disconnectStrava } from "../lib/api";
import { pageTitle } from "../lib/meta";
import type { SettingsContext } from "../lib/settings-context";

/** The tab title of this page (a layout's `meta` only sees the matches down to itself, so the sub page names itself). */
export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  return pageTitle("Strava", matches);
}

/**
 * /settings/strava (02 §2.6): the connection and what can be done to it. The way Strava gets linked is unchanged: the button is a link that opens
 * the authorisation in a new tab (`strava_connect_url`), the api's callback page ends it there, and this page does not know until it is read again.
 */
export default function SettingsStrava() {
  const ctx = useOutletContext<SettingsContext>();
  const { strava, strava_connect_url } = ctx.me;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlink() {
    if (!window.confirm("解除 Strava 連結？之後的跑步不會再自動匯入，已匯入的紀錄會保留。")) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectStrava();
      await ctx.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "解除失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="grp">
        <div className="row two">
          <span className="t">狀態</span>
          <span className="v">
            {strava
              ? <span className="status on">已連結 · athlete {strava.athlete_id}</span>
              : <span className="status">尚未連結</span>}
          </span>
        </div>
        {strava ? (
          <div className="row two"><span className="t">權限</span><span className="v grey">{strava.scope}</span></div>
        ) : null}
      </div>
      {strava ? (
        <div className="grp">
          <a className="row act" href={strava_connect_url} target="_blank" rel="noopener">重新連結 Strava</a>
          <button type="button" className="row act" onClick={() => void unlink()} disabled={busy}>{busy ? "解除中…" : "解除 Strava 連結"}</button>
        </div>
      ) : (
        <a className="btn primary" href={strava_connect_url} target="_blank" rel="noopener">連結 Strava</a>
      )}
      {error ? <p className="sf err" role="alert">{error}</p> : null}
      <p className="sf">
        連結後 Strava 的每次跑步會自動配對課表。{strava ? "重新連結會換新的授權；解除連結會向 Strava 撤銷授權，已匯入的紀錄保留。" : "會開 Strava 的授權頁，同意後回到這裡重新整理。"}
      </p>
    </main>
  );
}

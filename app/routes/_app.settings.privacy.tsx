import { useOutletContext } from "react-router";
import type { Route } from "./+types/_app.settings.privacy";
import { ShareSettingsBody } from "../components/share-settings";
import { pageTitle } from "../lib/meta";
import type { SettingsContext } from "../lib/settings-context";

/** The tab title of this page (a layout's `meta` only sees the matches down to itself, so the sub page names itself). */
export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
  return pageTitle("隱私", matches);
}

/** /settings/privacy: the five switches. The page's bar and title are drawn by the layout's PushStack; this is the content. */
export default function SettingsPrivacy() {
  const ctx = useOutletContext<SettingsContext>();
  return (
    <main>
      {ctx.share ? (
        <ShareSettingsBody share={ctx.share} update={ctx.updateShare} inGroups={ctx.inGroups} />
      ) : (
        <div className="share">
          <p className="sf lead" role="alert">讀不到分享設定。</p>
          <button type="button" className="chip" style={{ marginTop: 8 }} onClick={() => void ctx.reload()}>再試一次</button>
        </div>
      )}
    </main>
  );
}

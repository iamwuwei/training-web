import { useOutletContext } from "react-router";
import { ShareSettingsBody } from "../components/share-settings";
import type { SettingsContext } from "../lib/settings-context";

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

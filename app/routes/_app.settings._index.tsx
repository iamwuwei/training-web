import { Navigate, useLocation } from "react-router";

/**
 * /settings itself: the page is drawn by the layout (it stays mounted under the pushed sub pages). All this route does is send the old anchors on
 * (`/settings#strava`, `/settings#share`: links that were shared or bookmarked before Strava and 隱私 got their own pages). A hash never reaches a loader, so it is read here.
 */
export default function SettingsIndex() {
  const { hash } = useLocation();
  if (hash === "#strava") return <Navigate to="/settings/strava" replace state={{ fromSettings: false }} />;
  if (hash === "#share") return <Navigate to="/settings/privacy" replace state={{ fromSettings: false }} />;
  return null;
}

import { gearGroups } from "../lib/gear";
import type { ApiActivity } from "../types/api";
import { CloudIcon, ShoeIcon, WatchIcon } from "./icons";

const ICONS = { shoe: ShoeIcon, watch: WatchIcon, weather: CloudIcon };

/**
 * The report's bottom block: 這趟 (big numbers, from Strava, not editable) / 裝備 / 天氣. A group with nothing in
 * it is left out — except 裝備, which is always there with its 編輯 › (the shoe, device and weather are
 * edited in one sheet; with all three empty this is the only way in).
 */
export function GearInfo({ activity, onEdit }: { activity: ApiActivity; onEdit: () => void }) {
  const groups = gearGroups(activity);
  if (!groups.some((g) => g.title === "裝備")) groups.splice(groups.some((g) => g.title === "這趟") ? 1 : 0, 0, { title: "裝備", rows: [] });
  return (
    <section className="gear-info" aria-label="這趟的細節">
      {groups.map((g) => (
        <div className="gi-group" key={g.title}>
          {g.title === "裝備" ? (
            <div className="gi-head"><h2 className="gi-h">裝備</h2><button type="button" className="gi-edit" onClick={onEdit}>編輯 ›</button></div>
          ) : <h2 className="gi-h">{g.title}</h2>}
          {g.title === "這趟" ? (
            <dl className="gi-stats">
              {g.rows.map((r) => (
                <div className="gi-stat" key={r.k}>
                  <dt>{r.k}</dt>
                  <dd><b className="num">{r.v}</b>{r.unit ? <span className="unit">{r.unit}</span> : null}</dd>
                </div>
              ))}
            </dl>
          ) : g.rows.length ? (
            <ul className="gi-items">
              {g.rows.map((r) => {
                const Icon = r.icon ? ICONS[r.icon] : null;
                return (
                  <li className="gi-item" key={r.k}>
                    {Icon ? <Icon /> : <span />}
                    <span className="gi-v">{r.v}</span>
                    {g.title === "裝備" ? <span className="gi-k">{r.edited ? `${r.k} · 手動` : r.k}</span> : <span />}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ))}
    </section>
  );
}

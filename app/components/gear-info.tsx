import { gearGroups } from "../lib/gear";
import type { ApiActivity } from "../types/api";
import { CloudIcon, ShoeIcon, WatchIcon } from "./icons";

const ICONS = { shoe: ShoeIcon, watch: WatchIcon, weather: CloudIcon };

/** The report's bottom block: 這趟 (big numbers) / 裝備 / 天氣. Not clickable; nothing at all when there is nothing to show. */
export function GearInfo({ activity }: { activity: ApiActivity }) {
  const groups = gearGroups(activity);
  if (!groups.length) return null;
  return (
    <section className="gear-info" aria-label="這趟的細節">
      {groups.map((g) => (
        <div className="gi-group" key={g.title}>
          <h2 className="gi-h">{g.title}</h2>
          {g.title === "這趟" ? (
            <dl className="gi-stats">
              {g.rows.map((r) => (
                <div className="gi-stat" key={r.k}>
                  <dt>{r.k}</dt>
                  <dd><b className="num">{r.v}</b>{r.unit ? <span className="unit">{r.unit}</span> : null}</dd>
                </div>
              ))}
            </dl>
          ) : (
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
          )}
        </div>
      ))}
    </section>
  );
}

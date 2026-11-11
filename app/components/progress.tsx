import { km, kmPlan, pace } from "../lib/format";
import type { PlanView } from "../lib/plan";
import { aerobicTrend, longTrend, mpTrend, paceTone, totals, type Tone } from "../lib/trend";
import { SectionH } from "./ui";

// 進步: one sentence + one big number (Easy aerobic efficiency), three metrics
// (aerobic, longest run, MP pace; no card, no mini chart), then the cumulative row. Everything comes from PlanView.

function Metric({ k, value, unit, delta, tone }: { k: string; value: string; unit?: string; delta: string; tone: Tone }) {
  return (
    <div className="metric" role="group" aria-label={`${k} ${value}${unit ?? ""}，${delta}`}>
      <div className="k">{k}</div>
      <div className="v"><b className="num">{value}</b>{unit ? <span className="unit">{unit}</span> : null}</div>
      <div className={`d ${tone}`}>{delta}</div>
    </div>
  );
}

const sign = (n: number) => (n < 0 ? `−${Math.abs(n)}` : n > 0 ? `+${n}` : "0");

export function Progress({ view }: { view: PlanView }) {
  const aero = aerobicTrend(view);
  const long = longTrend(view);
  const mp = mpTrend(view);
  const t = totals(view);
  const band = aero.lo != null && aero.hi != null ? `${aero.lo}〜${aero.hi}` : null;

  const tone: Tone = aero.delta == null ? "flat" : paceTone(aero.delta);
  const lead = aero.delta == null ? "再跑幾次 Easy 就看得到" : aero.delta < 0 ? `Easy 跑起來比 ${aero.weeks} 週前輕鬆` : aero.delta > 0 ? `Easy 比 ${aero.weeks} 週前吃力` : `跟 ${aero.weeks} 週前差不多`;

  const mpDelta = mp.off == null ? (mp.latest ? "–" : "還沒跑過 MP") : mp.off === 0 ? "在目標內 ✓" : mp.off > 0 ? `慢 ${mp.off} 秒` : `快 ${-mp.off} 秒`;
  const mpTone: Tone = mp.off == null ? "flat" : mp.off === 0 ? "good" : mp.off > 0 ? "worse" : "flat";

  return (
    <>
      <SectionH>進步</SectionH>
      <section className="blk prog" aria-label="進步">
        <p className="lead">{lead}</p>
        {aero.delta == null ? (
          <p className="lead-sub">再跑兩次心拍 {band ?? "區間"} 的 Easy 就算得出來</p>
        ) : (
          <div className={`delta ${tone}`}>
            <b className="num">{sign(aero.delta)}</b>
            <span className="unit">秒 /km</span>
            {band ? <span className="sub">心拍 {band} 時的配速</span> : null}
          </div>
        )}
        <div className="metrics">
          <Metric
            k="有氧效率"
            value={aero.delta != null && aero.latest ? pace(aero.latest.v) : "–"}
            unit={aero.delta != null ? "/km" : undefined}
            delta={aero.delta != null ? `${sign(aero.delta)} 秒 · ${aero.weeks} 週` : "還沒有線"}
            tone={tone}
          />
          <Metric
            k="長跑最遠"
            value={long.max_m != null ? km(long.max_m) : "–"}
            unit={long.max_m != null ? "km" : undefined}
            delta={long.remain_m != null ? `42.195 還差 ${Math.round(long.remain_m / 1000)}` : "還沒有線"}
            tone="flat"
          />
          <Metric
            k="MP 配速"
            value={mp.latest ? pace(mp.latest.v) : "–"}
            unit={mp.latest ? "/km" : undefined}
            delta={mpDelta}
            tone={mpTone}
          />
        </div>
        <div className="totals" aria-label="累積">
          <div>
            <div className="k">累積</div>
            <div className="v"><b className="num">{km(t.actual_m)}</b><span>/ {kmPlan(t.plan_to_date_m)} km · {t.pct}%</span></div>
          </div>
          <div>
            <div className="k">完成</div>
            <div className="v"><b className="num">{t.done}</b><span>/ {t.planned} 堂</span></div>
          </div>
          <div>
            <div className="k">連續達標</div>
            <div className="v"><b className={`num${t.streak > 0 ? " good" : ""}`}>{t.streak}</b><span>週</span></div>
          </div>
        </div>
      </section>
    </>
  );
}

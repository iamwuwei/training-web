import type { ReactNode } from "react";
import { km, kmPlan, pace } from "../lib/format";
import type { PlanView } from "../lib/plan";
import { aerobicTrend, longTrend, mpTrend, paceTone, totals, type Tone, type TrendPoint } from "../lib/trend";
import { SectionH } from "./ui";

// 進步: one sentence + one big number (Easy aerobic efficiency), three small cards
// (aerobic, longest run, MP pace), then the cumulative row. Everything comes from PlanView.

const W = 100, H = 40, PAD = 4;

/** A pace line: faster (smaller) sits higher; the last point is the accent. */
function Line({ points, label }: { points: TrendPoint[]; label: string }) {
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs), max = Math.max(...vs), span = Math.max(20, max - min);
  const x = (i: number) => (points.length > 1 ? PAD + (i / (points.length - 1)) * (W - PAD * 2) : W - PAD);
  const y = (v: number) => PAD + ((v - min) / span) * (H - PAD * 2);
  const last = points.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      {points.length > 1 ? <polyline points={points.map((p, i) => `${x(i)},${y(p.v)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}
      <circle cx={x(last)} cy={y(points[last].v)} r="3" fill="var(--accent)" />
    </svg>
  );
}

/** One bar per long run, right-aligned; the last bar is the accent. */
function Bars({ points, label }: { points: TrendPoint[]; label: string }) {
  const max = Math.max(1, ...points.map((p) => p.v));
  const gap = 4;
  const w = Math.min(14, (W - gap * (points.length - 1)) / points.length);
  const x0 = W - (points.length * w + (points.length - 1) * gap);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      {points.map((p, i) => {
        const h = Math.max(2, (p.v / max) * H);
        return <rect key={p.a.id} x={x0 + i * (w + gap)} y={H - h} width={w} height={h} rx="2" fill={i === points.length - 1 ? "var(--accent)" : "var(--chip-line)"} />;
      })}
    </svg>
  );
}

function Card({ k, value, unit, delta, tone, chart }: { k: string; value: string; unit?: string; delta: string; tone: Tone; chart: ReactNode }) {
  return (
    <div className="card">
      <div className="k">{k}</div>
      <div className="v"><b className="num">{value}</b>{unit ? <span className="unit">{unit}</span> : null}</div>
      <div className={`d ${tone}`}>{delta}</div>
      {chart ?? <div className="ph" aria-hidden="true" />}
    </div>
  );
}

const sign = (n: number) => (n < 0 ? `−${Math.abs(n)}` : n > 0 ? `+${n}` : "0");
const dateOf = (p: TrendPoint) => p.a.start_time.slice(5, 10).replace("-", "/");

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
      <section className="progress" aria-label="進步">
        <SectionH>進步</SectionH>
        <p className="lead">{lead}</p>
        {aero.delta == null ? (
          <p className="lead-sub">有氧效率要兩次以上心拍落在 {band ?? "區間"} 的 Easy 才算得出來</p>
        ) : (
          <div className={`delta ${tone}`}>
            <b className="num">{sign(aero.delta)}</b>
            <span className="unit">秒 /km</span>
            {band ? <span className="sub">心拍 {band} 時的配速</span> : null}
          </div>
        )}
        <div className="cards">
          <Card
            k="有氧效率"
            value={aero.delta != null && aero.latest ? pace(aero.latest.v) : "–"}
            unit={aero.delta != null ? "/km" : undefined}
            delta={aero.delta != null ? `${sign(aero.delta)} 秒 · ${aero.weeks} 週` : "還沒有線"}
            tone={tone}
            chart={aero.delta != null ? <Line points={aero.points} label={aero.points.map((p) => `${dateOf(p)} ${pace(p.v)}`).join("，")} /> : null}
          />
          <Card
            k="長跑最遠"
            value={long.max_m != null ? km(long.max_m) : "–"}
            unit={long.max_m != null ? "km" : undefined}
            delta={long.remain_m != null ? `42.195 還差 ${Math.round(long.remain_m / 1000)}` : "還沒有線"}
            tone="flat"
            chart={long.points.length ? <Bars points={long.points} label={long.points.map((p) => `${dateOf(p)} ${km(p.v)} km`).join("，")} /> : null}
          />
          <Card
            k="MP 配速"
            value={mp.latest ? pace(mp.latest.v) : "–"}
            unit={mp.latest ? "/km" : undefined}
            delta={mpDelta}
            tone={mpTone}
            chart={mp.latest ? <Line points={mp.points} label={`${mp.points.map((p) => `${dateOf(p)} ${pace(p.v)}`).join("，")}${mp.hrTop != null ? `，最高心拍 ${mp.hrTop}` : ""}`} /> : null}
          />
        </div>
      </section>
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
    </>
  );
}

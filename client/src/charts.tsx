import { useState } from 'react';
import { fmtDay } from './format';

// ---------- yearly activity heatmap ----------
export function Heatmap({ from, to, days }: { from: string; to: string; days: Record<string, number> }) {
  const [hover, setHover] = useState<{ day: string; n: number; x: number; y: number } | null>(null);
  const cell = 11;
  const gap = 3;
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  const values = Object.values(days).filter((v) => v > 0).sort((a, b) => a - b);
  // Quartile thresholds over active days, so a steady 1–3/day still spreads across shades.
  const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))] ?? 1;
  const t = [q(0.25), q(0.5), q(0.75)];
  const level = (n: number) => (n <= 0 ? 0 : n <= t[0] ? 1 : n <= t[1] ? 2 : n <= t[2] ? 3 : 4);

  const cells: { day: string; n: number; x: number; y: number }[] = [];
  const months: { x: number; label: string }[] = [];
  let col = 0;
  let lastMonth = -1;
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = (d.getUTCDay() + 6) % 7; // Monday first
    if (dow === 0 && cells.length) col++;
    const key = d.toISOString().slice(0, 10);
    if (d.getUTCMonth() !== lastMonth && dow === 0) {
      lastMonth = d.getUTCMonth();
      months.push({ x: col * (cell + gap), label: d.toLocaleString('en-CA', { month: 'short', timeZone: 'UTC' }) });
    }
    cells.push({ day: key, n: days[key] ?? 0, x: col * (cell + gap), y: dow * (cell + gap) });
  }
  const width = (col + 1) * (cell + gap) + 24;
  const height = 7 * (cell + gap) + 18;

  return (
    <div style={{ position: 'relative', overflowX: 'auto' }}>
      <svg className="heat" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily solved problems over the past year">
        {months.map((m, i) => (
          <text key={i} x={m.x + 24} y={10} fontSize="10" fill="var(--ink-3)">{m.label}</text>
        ))}
        {['Mon', 'Wed', 'Fri'].map((l, i) => (
          <text key={l} x={0} y={18 + (i * 2) * (cell + gap) + 9} fontSize="9.5" fill="var(--ink-3)">{l}</text>
        ))}
        <g transform="translate(24 16)">
          {cells.map((c) => (
            <rect
              key={c.day}
              x={c.x}
              y={c.y}
              width={cell}
              height={cell}
              rx={2.5}
              fill={`var(--heat-${level(c.n)})`}
              onMouseEnter={() => setHover(c)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </g>
      </svg>
      {hover && (
        <div className="card small" style={{ position: 'absolute', left: Math.min(hover.x + 24, width - 180), top: hover.y + 34, padding: '4px 8px', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          <b className="num">{hover.n}</b> solved · {fmtDay(hover.day, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      )}
      <div className="spread" style={{ marginTop: 6 }}>
        <span className="small muted">Distinct problems accepted per day, in your time zone</span>
        <span className="heat-legend">
          Less {[0, 1, 2, 3, 4].map((l) => <i key={l} style={{ background: `var(--heat-${l})` }} />)} More
        </span>
      </div>
    </div>
  );
}

// ---------- stacked horizontal bars ----------
const SERIES = [
  { key: 'codeforces', label: 'Codeforces', color: 'var(--cf)' },
  { key: 'leetcode', label: 'LeetCode', color: 'var(--lc)' },
  { key: 'kattis', label: 'Kattis', color: 'var(--kt)' },
] as const;

export function BandBars({ rows }: { rows: { band: string; codeforces: number; leetcode: number; kattis: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.codeforces + r.leetcode + r.kattis));
  const active = SERIES.filter((s) => rows.some((r) => r[s.key] > 0));
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '78px 1fr 40px', gap: '7px 10px', alignItems: 'center' }}>
        {rows.map((r) => {
          const total = r.codeforces + r.leetcode + r.kattis;
          return [
            <span key={`${r.band}l`} className="small muted num">{r.band}</span>,
            <div key={`${r.band}b`} style={{ display: 'flex', height: 14, borderRadius: 3, overflow: 'hidden', background: 'var(--bg)' }} title={SERIES.map((s) => `${s.label}: ${r[s.key]}`).join(' · ')}>
              {SERIES.map((s) => r[s.key] > 0 && <div key={s.key} style={{ width: `${(r[s.key] / max) * 100}%`, background: s.color, marginRight: 1 }} />)}
            </div>,
            <span key={`${r.band}n`} className="small num" style={{ textAlign: 'right' }}>{total}</span>,
          ];
        })}
      </div>
      {active.length > 1 && (
        <div className="row small muted" style={{ marginTop: 12, gap: 14 }}>
          {active.map((s) => <span key={s.key} className={`pf ${s.key}`}>{s.label}</span>)}
        </div>
      )}
    </div>
  );
}

// ---------- weekly trend ----------
export function WeeklyTrend({ weeks }: { weeks: { week: string; solved: number; avgRating: number | null }[] }) {
  const w = 560;
  const h = 170;
  const pad = { l: 28, r: 36, t: 10, b: 22 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const max = Math.max(4, ...weeks.map((x) => x.solved));
  const ratings = weeks.map((x) => x.avgRating).filter((x): x is number => x != null);
  const rMin = ratings.length ? Math.min(...ratings) - 100 : 800;
  const rMax = ratings.length ? Math.max(...ratings) + 100 : 2000;
  const bw = iw / weeks.length;
  const ry = (r: number) => pad.t + ih - ((r - rMin) / (rMax - rMin || 1)) * ih;
  const pts = weeks.map((x, i) => (x.avgRating != null ? [pad.l + bw * i + bw / 2, ry(x.avgRating)] : null)).filter((p): p is number[] => !!p);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Problems solved per week">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={w - pad.r} y1={pad.t + ih * (1 - f)} y2={pad.t + ih * (1 - f)} stroke="var(--line)" />
          <text x={pad.l - 6} y={pad.t + ih * (1 - f) + 3} fontSize="10" textAnchor="end" fill="var(--ink-3)">{Math.round(max * f)}</text>
        </g>
      ))}
      {weeks.map((x, i) => {
        const bh = (x.solved / max) * ih;
        return (
          <g key={x.week}>
            <rect x={pad.l + bw * i + bw * 0.18} y={pad.t + ih - bh} width={bw * 0.64} height={Math.max(bh, x.solved ? 2 : 0)} rx={3} fill="var(--ink-2)" opacity={i === weeks.length - 1 ? 1 : 0.55}>
              <title>{`Week of ${fmtDay(x.week, { month: 'short', day: 'numeric' })}: ${x.solved} solved${x.avgRating ? `, avg difficulty ${x.avgRating}` : ''}`}</title>
            </rect>
            {i % 2 === 1 && (
              <text x={pad.l + bw * i + bw / 2} y={h - 6} fontSize="10" textAnchor="middle" fill="var(--ink-3)">{fmtDay(x.week, { month: 'short', day: 'numeric' })}</text>
            )}
          </g>
        );
      })}
      {pts.length > 1 && <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />}
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />)}
      {ratings.length > 0 && (
        <>
          <text x={w - pad.r + 6} y={ry(rMax - 100) + 3} fontSize="10" fill="var(--accent)">{rMax - 100}</text>
          <text x={w - pad.r + 6} y={ry(rMin + 100) + 3} fontSize="10" fill="var(--accent)">{rMin + 100}</text>
        </>
      )}
    </svg>
  );
}

// ---------- rating history sparkline ----------
export function RatingLine({ points }: { points: { t: number; r: number }[] }) {
  if (points.length < 2) return null;
  const w = 240;
  const h = 44;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const r0 = Math.min(...points.map((p) => p.r));
  const r1 = Math.max(...points.map((p) => p.r));
  const d = points.map((p) => `${((p.t - t0) / (t1 - t0 || 1)) * (w - 4) + 2},${h - 2 - ((p.r - r0) / (r1 - r0 || 1)) * (h - 4)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 44 }} aria-label="Rating history">
      <polyline points={d} fill="none" stroke="var(--cf)" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

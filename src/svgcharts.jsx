// ─── กราฟ SVG ในตัว (แทน recharts) — ไม่มี dependency ภายนอกเลย ───────────────
//   เหตุผล: recharts + ไม่มี lock file → build ดึงเวอร์ชันย่อยที่พังมา → React #130
//   กราฟพวกนี้เขียนด้วย <svg> ล้วน วัดขนาด container เองด้วย ResizeObserver
import { useRef, useState, useEffect } from "react";

// วัดขนาดกล่อง (แทน ResponsiveContainer)
function useSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size.w, size.h];
}

// หา tick แกน Y ให้กลม ๆ (0 → top)
function niceScale(max, count = 4) {
  if (!(max > 0)) return { ticks: [0, 1], top: 1 };
  const rough = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = nice * mag;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step * 1e-6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { ticks, top };
}
const fmtTick = (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : `${v}`);
const trunc = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// ─── กราฟแท่ง (แทน BarChart) — data: [{ name, count }] ────────────────────────
export function SimpleBarChart({ data = [], color = "#10b981", height = 260 }) {
  const [ref, W] = useSize();
  const H = height, padL = 46, padR = 14, padT = 12, padB = 52;
  const iw = Math.max(0, W - padL - padR), ih = Math.max(0, H - padT - padB);
  const vals = data.map((d) => Number(d.count) || 0);
  const { ticks, top } = niceScale(Math.max(1, ...(vals.length ? vals : [1])), 4);
  const n = data.length, step = n > 0 ? iw / n : 0;
  const barW = Math.max(3, Math.min(46, step * 0.6));
  const rot = n > 7;
  return (
    <div ref={ref} style={{ width: "100%", height }}>
      {W > 0 && (
        <svg width={W} height={H} role="img" style={{ display: "block", fontFamily: "inherit" }}>
          {ticks.map((tk, i) => {
            const y = padT + ih - (top ? (tk / top) * ih : 0);
            return (
              <g key={"t" + i}>
                <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e1e9e5" strokeDasharray="3 3" />
                <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="12" fill="#6d7d76">{fmtTick(tk)}</text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const cx = padL + i * step + step / 2;
            const bh = top ? ((Number(d.count) || 0) / top) * ih : 0;
            const by = padT + ih - bh;
            const ly = H - padB + 16;
            return (
              <g key={"b" + i}>
                <rect x={cx - barW / 2} y={by} width={barW} height={Math.max(0, bh)} rx={5} ry={5} fill={color}>
                  <title>{`${d.name}: ${d.count}`}</title>
                </rect>
                <text x={cx} y={ly} fontSize="12" fill="#6d7d76"
                  textAnchor={rot ? "end" : "middle"}
                  transform={rot ? `rotate(-32 ${cx} ${ly})` : undefined}>{trunc(d.name, rot ? 12 : 14)}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// ─── กราฟพื้นที่ (แทน AreaChart) — data: [{ hour, pcs, kg }] · 2 แกน (pcs ซ้าย/kg ขวา) ──
export function SimpleAreaChart({ data = [], showPcs = true, showKg = true, height }) {
  const [ref, W, H0] = useSize();
  const H = typeof height === "number" ? height : (H0 || 220);
  const padL = 44, padR = 48, padT = 14, padB = 32;
  const iw = Math.max(0, W - padL - padR), ih = Math.max(0, H - padT - padB);
  const n = data.length;
  const pcs = niceScale(Math.max(1, ...(data.map((d) => Number(d.pcs) || 0).concat(1))), 4);
  const kg = niceScale(Math.max(1, ...(data.map((d) => Number(d.kg) || 0).concat(1))), 4);
  const xAt = (i) => padL + (n > 1 ? (i / (n - 1)) * iw : iw / 2);
  const yP = (v) => padT + ih - (pcs.top ? (v / pcs.top) * ih : 0);
  const yK = (v) => padT + ih - (kg.top ? (v / kg.top) * ih : 0);
  const linePath = (yfn, key) => data.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yfn(Number(d[key]) || 0)}`).join(" ");
  const pcsLine = linePath(yP, "pcs");
  const pcsArea = n > 0 ? `${pcsLine} L${xAt(n - 1)},${padT + ih} L${xAt(0)},${padT + ih} Z` : "";
  const kgLine = linePath(yK, "kg");
  const gridScale = showPcs ? pcs : kg;
  const labelEvery = n > 12 ? Math.ceil(n / 8) : 1;
  return (
    <div ref={ref} style={{ width: "100%", height: typeof height === "number" ? height : "100%" }}>
      {W > 0 && H > 0 && (
        <svg width={W} height={H} style={{ display: "block", fontFamily: "inherit" }}>
          <defs>
            <linearGradient id="mlsDashArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#14e39a" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#14e39a" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {gridScale.ticks.map((tk, i) => {
            const y = padT + ih - (gridScale.top ? (tk / gridScale.top) * ih : 0);
            return <line key={"g" + i} x1={padL} y1={y} x2={W - padR} y2={y} stroke="#24302a" />;
          })}
          {data.map((d, i) =>
            (i % labelEvery === 0 || i === n - 1)
              ? <text key={"x" + i} x={xAt(i)} y={H - padB + 18} textAnchor="middle" fontSize="13" fill="#9db1a8">{d.hour}</text>
              : null
          )}
          {showPcs && pcs.ticks.map((tk, i) => <text key={"yp" + i} x={padL - 6} y={yP(tk) + 4} textAnchor="end" fontSize="12" fill="#14e39a">{fmtTick(tk)}</text>)}
          {showKg && kg.ticks.map((tk, i) => <text key={"yk" + i} x={W - padR + 6} y={yK(tk) + 4} textAnchor="start" fontSize="12" fill="#ffc23d">{fmtTick(tk)}</text>)}
          {showPcs && n > 0 && (
            <g>
              <path d={pcsArea} fill="url(#mlsDashArea)" />
              <path d={pcsLine} fill="none" stroke="#14e39a" strokeWidth="3" strokeLinejoin="round" />
              {data.map((d, i) => <circle key={"cp" + i} cx={xAt(i)} cy={yP(Number(d.pcs) || 0)} r="3" fill="#14e39a" />)}
            </g>
          )}
          {showKg && n > 0 && (
            <g>
              <path d={kgLine} fill="none" stroke="#ffc23d" strokeWidth="2.5" strokeLinejoin="round" />
              {data.map((d, i) => <circle key={"ck" + i} cx={xAt(i)} cy={yK(Number(d.kg) || 0)} r="3" fill="#ffc23d" />)}
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

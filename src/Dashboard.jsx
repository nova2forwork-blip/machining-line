/* ═══════════════════════════════════════════════════════════════════════
   LIVE PRODUCTION DASHBOARD — จอโชว์ลูกค้า (ดาร์ก คอนโทรลรูม, เรียลไทม์)
   ออกแบบสำหรับทีวี/จอใหญ่แนวนอน 16:9 · ทุกขนาดอิงหน่วย vh เพื่อสเกลตามจอ
   สี: พื้นดำ + เขียวแบรนด์ (แม็กนิจูด) + สถานะ good/warning (สงวนไว้)
   ═══════════════════════════════════════════════════════════════════════ */
:root {
  --dash-bg: #0b0f0d;
  --dash-surface: #141a17;
  --dash-surface-2: #1a221e;
  --dash-line: #24302a;
  --dash-ink: #ffffff;
  --dash-ink-2: #9db1a8;
  --dash-muted: #6b7d75;
  --dash-green: #14e39a;      /* เขียวแบรนด์สดสำหรับจอ (magnitude) */
  --dash-green-dk: #0b8f63;
  --dash-good: #22e07a;       /* Finished */
  --dash-warn: #ffc23d;       /* In Process */
  --dash-glow: 0 0 24px rgba(20, 227, 154, 0.35);
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; background: var(--dash-bg); overflow: hidden; }
body.dash-body {
  font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans Thai", sans-serif;
  color: var(--dash-ink);
  -webkit-font-smoothing: antialiased;
}
.dash-num { font-variant-numeric: tabular-nums; }

/* ── layout: header / KPI / (machines + chart) / feed ─────────────────── */
.dash {
  height: 100vh; width: 100vw; padding: 1.6vh 1.8vh;
  display: grid; gap: 1.4vh;
  grid-template-rows: auto auto auto 1fr;
  grid-template-columns: 1fr 30vw;
  grid-template-areas:
    "head  head"
    "kpi   kpi"
    "line  line"
    "main  feed";
  background:
    radial-gradient(1200px 500px at 15% -10%, rgba(20,227,154,0.10), transparent 60%),
    radial-gradient(900px 500px at 100% 0%, rgba(20,227,154,0.06), transparent 55%),
    var(--dash-bg);
}
.dash-head { grid-area: head; display: flex; align-items: center; justify-content: space-between; }
.dash-kpi-row { grid-area: kpi; display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.4vh; }
.dash-line { grid-area: line; height: 15vh; padding: 0.6vh 1.2vh; display: flex; align-items: center; overflow: hidden; }
.dash-line .mline { width: 100%; height: 100%; }
.dash-main { grid-area: main; display: grid; grid-template-rows: auto 1fr; gap: 1.4vh; min-height: 0; }
.dash-feed { grid-area: feed; min-height: 0; display: flex; flex-direction: column; }

/* ── header ───────────────────────────────────────────────────────────── */
.dash-title { font-size: 3.2vh; font-weight: 800; letter-spacing: .02em; line-height: 1.1; }
.dash-title .sub { display: block; font-size: 1.5vh; font-weight: 500; color: var(--dash-ink-2); margin-top: .3vh; letter-spacing: .12em; text-transform: uppercase; }
.dash-headright { display: flex; align-items: center; gap: 2.4vh; }
.dash-live { display: flex; align-items: center; gap: .9vh; font-size: 1.7vh; font-weight: 700; letter-spacing: .14em; color: var(--dash-good); }
.dash-live .dot { width: 1.3vh; height: 1.3vh; border-radius: 50%; background: var(--dash-good); box-shadow: 0 0 0 0 rgba(34,224,122,.7); animation: dashPulse 1.6s infinite; }
.dash-langsel { display: flex; gap: 0; border: 1px solid var(--dash-line); border-radius: 999px; overflow: hidden; }
.dash-langsel button {
  background: transparent; color: var(--dash-ink-2); border: none; cursor: pointer;
  font-size: 1.5vh; font-weight: 700; padding: 0.7vh 1.6vh; font-family: inherit;
}
.dash-langsel button.on { background: var(--dash-green); color: #05271b; }
.dash-clock { font-size: 3.4vh; font-weight: 800; letter-spacing: .02em; }
.dash-date { font-size: 1.5vh; color: var(--dash-ink-2); text-align: right; }

/* ── KPI cards (hero numbers, count-up) ───────────────────────────────── */
.dash-kpi {
  background: linear-gradient(160deg, var(--dash-surface-2), var(--dash-surface));
  border: 1px solid var(--dash-line); border-radius: 1.6vh;
  padding: 1.6vh 1.8vh; position: relative; overflow: hidden;
}
.dash-kpi::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: .5vh; background: var(--dash-green); box-shadow: var(--dash-glow); }
.dash-kpi .lbl { font-size: 1.5vh; color: var(--dash-ink-2); letter-spacing: .04em; margin-bottom: .6vh; }
.dash-kpi .val { font-size: 5.2vh; font-weight: 800; line-height: 1; letter-spacing: -.01em; }
.dash-kpi .val .unit { font-size: 2.2vh; font-weight: 600; color: var(--dash-ink-2); margin-left: .6vh; }
.dash-kpi.flash { animation: dashKpiFlash .9s ease; }

/* ── machine cards ────────────────────────────────────────────────────── */
.dash-panel { background: var(--dash-surface); border: 1px solid var(--dash-line); border-radius: 1.6vh; padding: 1.6vh 1.8vh; min-height: 0; display: flex; flex-direction: column; }
.dash-panel-h { font-size: 1.7vh; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--dash-ink-2); margin-bottom: 1.2vh; display: flex; justify-content: space-between; align-items: center; }
.dash-machines { display: grid; grid-template-columns: repeat(auto-fill, minmax(20vh, 1fr)); gap: 1.2vh; overflow: hidden; }
.dash-mach {
  background: var(--dash-surface-2); border: 1px solid var(--dash-line); border-radius: 1.3vh;
  padding: 1.3vh 1.4vh; position: relative; overflow: hidden; transition: border-color .3s, box-shadow .3s;
}
.dash-mach.hit { border-color: var(--dash-green); box-shadow: var(--dash-glow); animation: dashHit 1.1s ease; }
.dash-mach .name { font-size: 1.9vh; font-weight: 800; margin-bottom: .8vh; display: flex; align-items: center; gap: .7vh; }
.dash-mach .name .op { font-size: 1.2vh; font-weight: 600; color: var(--dash-ink-2); background: var(--dash-line); padding: .2vh .8vh; border-radius: 999px; }
.dash-mach .big { font-size: 3.4vh; font-weight: 800; line-height: 1; }
.dash-mach .big .unit { font-size: 1.5vh; color: var(--dash-ink-2); font-weight: 600; margin-left: .4vh; }
.dash-mach .meta { font-size: 1.3vh; color: var(--dash-ink-2); margin-top: .5vh; }
.dash-bar-track { height: 1vh; background: #0d1310; border-radius: 999px; margin-top: 1vh; overflow: hidden; }
.dash-bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--dash-green-dk), var(--dash-green)); box-shadow: var(--dash-glow); transition: width .9s cubic-bezier(.22,.61,.36,1); }

/* ── bar chart (กก. by machine) ───────────────────────────────────────── */
.dash-chart { display: flex; flex-direction: column; gap: 1.1vh; justify-content: center; }
.dash-chart-row { display: grid; grid-template-columns: 12vh 1fr auto; align-items: center; gap: 1.2vh; }
.dash-chart-row .cname { font-size: 1.6vh; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dash-chart-track { height: 2.2vh; background: #0d1310; border-radius: 999px; overflow: hidden; }
.dash-chart-bar { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--dash-green-dk), var(--dash-green)); transition: width 1s cubic-bezier(.22,.61,.36,1); box-shadow: var(--dash-glow); }
.dash-chart-row .cval { font-size: 1.7vh; font-weight: 800; white-space: nowrap; min-width: 9vh; text-align: right; }

/* ── live feed ────────────────────────────────────────────────────────── */
.dash-feed .dash-panel-h { color: var(--dash-good); }
.dash-feed-list { flex: 1; overflow: hidden; display: flex; flex-direction: column; gap: .8vh; }
.dash-feed-item {
  background: var(--dash-surface-2); border: 1px solid var(--dash-line); border-left: .4vh solid var(--dash-green);
  border-radius: 1vh; padding: 1vh 1.3vh; display: grid; grid-template-columns: 1fr auto; gap: .3vh 1vh; align-items: center;
}
.dash-feed-item.fresh { animation: dashSlideIn .6s ease; border-left-color: var(--dash-good); box-shadow: var(--dash-glow); }
.dash-feed-item .part { font-size: 1.9vh; font-weight: 800; }
.dash-feed-item .qty { font-size: 2.2vh; font-weight: 800; color: var(--dash-green); text-align: right; }
.dash-feed-item .line2 { font-size: 1.3vh; color: var(--dash-ink-2); display: flex; gap: .8vh; align-items: center; flex-wrap: wrap; }
.dash-feed-item .chip { background: var(--dash-line); color: var(--dash-ink); padding: .15vh .8vh; border-radius: 999px; font-weight: 600; }
.dash-feed-item .st-fin { color: var(--dash-good); font-weight: 700; }
.dash-feed-item .st-inp { color: var(--dash-warn); font-weight: 700; }
/* ขั้นตอน (Cut/Drill...) ใช้สีเหลืองแบบเดียวกับสถานะเดิม + ดันไปท้ายแถว (ตำแหน่งที่สถานะเคยอยู่) */
.dash-feed-item .op { color: var(--dash-warn); font-weight: 700; margin-left: auto; }
.dash-feed-item .time { font-size: 1.3vh; color: var(--dash-muted); text-align: right; }
.dash-empty { color: var(--dash-muted); font-size: 1.7vh; text-align: center; padding: 4vh 0; }

/* ── keyframes ────────────────────────────────────────────────────────── */
@keyframes dashPulse { 0% { box-shadow: 0 0 0 0 rgba(34,224,122,.6); } 70% { box-shadow: 0 0 0 1.4vh rgba(34,224,122,0); } 100% { box-shadow: 0 0 0 0 rgba(34,224,122,0); } }
@keyframes dashHit { 0% { transform: scale(1); } 30% { transform: scale(1.03); } 100% { transform: scale(1); } }
@keyframes dashKpiFlash { 0% { background: linear-gradient(160deg, #1c3a2e, #16241d); } 100% { background: linear-gradient(160deg, var(--dash-surface-2), var(--dash-surface)); } }
@keyframes dashSlideIn { 0% { transform: translateY(-1.4vh); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }

/* ── loading / offline states ─────────────────────────────────────────── */
.dash-boot { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2vh; color: var(--dash-ink-2); }
.dash-boot .spin { width: 6vh; height: 6vh; border: .6vh solid var(--dash-line); border-top-color: var(--dash-green); border-radius: 50%; animation: dashSpin 1s linear infinite; }
@keyframes dashSpin { to { transform: rotate(360deg); } }

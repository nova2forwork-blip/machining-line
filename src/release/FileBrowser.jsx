// ★ 2026-10-16: ดูไฟล์เป็น "โฟลเดอร์" — เข้า/ออกโฟลเดอร์ได้ · ไฟล์ PDF กดเปิด · รูปโชว์ภาพย่อ
//   ใช้ได้กับทุก bucket ของ Storage: roots = [{ key, name, bucket, prefix, note }] (โฟลเดอร์ระดับบนสุดเรียงข้างกัน)
//   api = { listStorage(bucket, prefix), signedUrls(bucket, paths) }
import { useEffect, useState } from "react";

const isImg = (n) => /\.(jpe?g|png|webp|gif)$/i.test(n);
const isPdf = (n) => /\.pdf$/i.test(n);
const fmtSize = (b) => (b == null ? "" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const fmtDate = (s) => { try { return s ? new Date(s).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : ""; } catch { return ""; } };

export default function FileBrowser({ api, roots }) {
  const [loc, setLoc] = useState(null);                 // null = หน้าแรก (โฟลเดอร์ระดับบนสุด) · { root, path:[ชื่อโฟลเดอร์…] }
  const [st, setSt] = useState({ s: "idle", items: [], err: "" });
  const [thumbs, setThumbs] = useState({});
  const prefixOf = (l) => [l.root.prefix, ...l.path].filter(Boolean).join("/");

  useEffect(() => {
    if (!loc) { setSt({ s: "idle", items: [], err: "" }); return undefined; }
    let alive = true; setSt({ s: "loading", items: [], err: "" }); setThumbs({});
    api.listStorage(loc.root.bucket, prefixOf(loc))
      .then(async (items) => {
        if (!alive) return;
        setSt({ s: "ok", items, err: "" });
        const imgs = items.filter((x) => x.file && isImg(x.name)).slice(0, 60).map((x) => (prefixOf(loc) ? prefixOf(loc) + "/" : "") + x.name);
        if (imgs.length) { try { const m = await api.signedUrls(loc.root.bucket, imgs); if (alive) setThumbs(m); } catch { /* ไม่มีภาพย่อ = โชว์ชื่อเฉยๆ */ } }
      })
      .catch((e) => { if (alive) setSt({ s: "err", items: [], err: String(e?.message || e) }); });
    return () => { alive = false; };
  }, [loc, api]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function openFile(name) {
    const p = (prefixOf(loc) ? prefixOf(loc) + "/" : "") + name;
    try { const m = await api.signedUrls(loc.root.bucket, [p]); window.open(m[p], "_blank", "noopener"); }
    catch (e) { setSt((s) => ({ ...s, err: "เปิดไฟล์ไม่ได้: " + (e?.message || e) })); }
  }

  const crumbs = loc ? [{ n: "📁 ไฟล์ทั้งหมด", go: () => setLoc(null) }, { n: loc.root.name, go: () => setLoc({ root: loc.root, path: [] }) }, ...loc.path.map((p, i) => ({ n: p, go: () => setLoc({ root: loc.root, path: loc.path.slice(0, i + 1) }) }))] : [];

  return (
    <div className="fb">
      {loc ? (
        <div className="fb-crumbs">
          {crumbs.map((c, i) => <span key={i}>{i ? <span className="rw-muted"> / </span> : null}{i < crumbs.length - 1 ? <button type="button" className="rw-link" onClick={c.go}>{c.n}</button> : <b>{c.n}</b>}</span>)}
        </div>
      ) : null}
      {!loc ? (
        <div className="fb-grid">
          {roots.map((r) => (
            <button key={r.key} type="button" className="fb-folder big" onClick={() => setLoc({ root: r, path: [] })}>
              <span className="fb-ic">📁</span><b>{r.name}</b><small>{r.note}</small>
            </button>))}
        </div>
      ) : st.s === "loading" ? <div className="rw-muted small" style={{ padding: 14 }}>กำลังโหลด…</div>
        : st.s === "err" ? <div className="rw-msg bad">✗ เปิดโฟลเดอร์ไม่ได้: {st.err}{/bucket|not found/i.test(st.err) ? " — ยังไม่ได้รัน migration-release-pdfs.sql ?" : ""}</div>
        : (
          <>
            {st.err ? <div className="rw-msg bad">{st.err}</div> : null}
            {!st.items.length ? <div className="rw-muted small" style={{ padding: 14 }}>โฟลเดอร์ว่าง</div> : null}
            <div className="fb-grid">
              {st.items.filter((x) => !x.file).map((x) => (
                <button key={x.name} type="button" className="fb-folder" onClick={() => setLoc({ root: loc.root, path: [...loc.path, x.name] })}><span className="fb-ic">📁</span><b>{x.name}</b></button>))}
              {st.items.filter((x) => x.file).map((x) => {
                const p = (prefixOf(loc) ? prefixOf(loc) + "/" : "") + x.name;
                return (
                  <button key={x.name} type="button" className="fb-file" onClick={() => openFile(x.name)} title={x.name}>
                    {thumbs[p] ? <img src={thumbs[p]} alt={x.name} loading="lazy" /> : <span className="fb-ic">{isPdf(x.name) ? "📄" : isImg(x.name) ? "🖼" : "📎"}</span>}
                    <b>{x.name}</b><small>{[fmtSize(x.size), fmtDate(x.updated)].filter(Boolean).join(" · ")}</small>
                  </button>);
              })}
            </div>
          </>
        )}
    </div>
  );
}

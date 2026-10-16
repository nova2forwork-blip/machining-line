// หลัง build หน้าตัวอย่าง: ทำ dist-demo/index.html เป็นหน้าเดียว (ส่วนเนื้อหา) + assets/ ข้างๆ
import fs from "fs";
const src = "dist-demo/demo/release-demo.html";
const html = fs.readFileSync(src, "utf8").replaceAll("../assets/", "./assets/");
const head = (html.match(/<head>([\s\S]*?)<\/head>/) || [])[1] || "";
const tags = [...head.matchAll(/<script[^>]*><\/script>|<link rel="stylesheet"[^>]*>/g)].map((m) => m[0]).join("\n");
const page = `<title>Machining Line ปล่อยงานใหม่</title>
<style>html,body{background:#eef3f1;color:#142420;color-scheme:light}</style>
${tags}
<div id="root"></div>
`;
fs.writeFileSync("dist-demo/index.html", page);
fs.rmSync("dist-demo/demo", { recursive: true, force: true });
for (const f of ["sw.js", "manifest.webmanifest"]) fs.rmSync("dist-demo/" + f, { force: true });
fs.rmSync("dist-demo/icons", { recursive: true, force: true });
console.log(page);
console.log("assets:", fs.readdirSync("dist-demo/assets").join(" "));

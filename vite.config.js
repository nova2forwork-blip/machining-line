import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// แยก vendor เป็นก้อนๆ เพื่อให้ browser cache แยกและโหลดขนาน:
//  - xlsx ถูก dynamic-import อยู่แล้ว (โหลดเฉพาะตอนนำเข้า Excel)
//  - qrcode/supabase แยกก้อน ทำให้หน้า Login เบาลง
// ★ 2026-10-15 ทดลองบนคอม: npm run dev -- --host + .env.local VITE_SUPABASE_URL=same-origin
//   → คำขอ API ผ่านพอร์ต 5173 แล้วส่งต่อไป Supabase ในเครื่อง (supabase start) · ไม่ต้องเปิดพอร์ต 54321 ให้วง LAN
//   (มีผลเฉพาะ dev server · build ขึ้น Vercel ไม่เกี่ยว)
const LOCAL_SUPABASE = process.env.LOCAL_SUPABASE_TARGET || "http://127.0.0.1:54321";
const devProxy = Object.fromEntries(
  ["/rest/v1", "/storage/v1", "/functions/v1", "/auth/v1"].map((p) => [p, { target: LOCAL_SUPABASE, changeOrigin: true }])
);
devProxy["/realtime/v1"] = { target: LOCAL_SUPABASE, changeOrigin: true, ws: true };

export default defineConfig({
  plugins: [react()],
  server: { proxy: devProxy },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          qr: ["qrcode.react", "jsqr"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
});

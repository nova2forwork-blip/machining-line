import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// แยก vendor เป็นก้อนๆ เพื่อให้ browser cache แยกและโหลดขนาน:
//  - xlsx ถูก dynamic-import อยู่แล้ว (โหลดเฉพาะตอนนำเข้า Excel)
//  - recharts/qrcode/supabase แยกก้อน ทำให้หน้า Login เบาลง
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          charts: ["recharts"],
          qr: ["qrcode.react", "jsqr"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
});

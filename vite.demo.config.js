// build หน้าตัวอย่าง "ปล่อยงานใหม่" (ไม่ต่อฐานข้อมูล) → dist-demo/demo/release-demo.html
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist-demo", emptyOutDir: true, rollupOptions: { input: "demo/release-demo.html" } },
});

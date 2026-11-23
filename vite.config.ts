import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages 에 올릴 때는 VITE_BASE=/저장소이름/ 으로 빌드하세요.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? "/",
});

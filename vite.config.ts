import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  // MapLibre alone is ~1 MB; it is lazy-loaded with the map pages.
  build: { chunkSizeWarningLimit: 1200 },
});

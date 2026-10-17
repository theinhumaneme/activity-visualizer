import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  // MapLibre alone is ~1 MB; it is lazy-loaded with the map pages.
  build: { chunkSizeWarningLimit: 1200 },
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            // React, the router and the store change far less often than the app: their own
            // chunk stays cached (immutable) across deploys instead of re-downloading with app code.
            codeSplitting: {
              groups: [{ name: "react", test: /node_modules[\\/](react|react-dom|scheduler|react-router|zustand)[\\/]/ }],
            },
          },
        },
      },
    },
  },
});

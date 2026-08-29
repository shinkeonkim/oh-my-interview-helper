import { fileURLToPath, URL } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

export default defineConfig(({ mode }) => ({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    proxy:
      mode === "test"
        ? {}
        : {
            "/api": {
              target: "http://127.0.0.1:3000",
              changeOrigin: true,
              ws: true
            }
          }
  },
  build: {
    emptyOutDir: true,
    outDir: fileURLToPath(new URL("../server/public", import.meta.url))
  }
}))

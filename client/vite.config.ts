import { fileURLToPath, URL } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

export default defineConfig(({ mode }) => {
  const apiProxyTarget = process.env["VITE_API_PROXY_TARGET"] ?? "http://127.0.0.1:3000"
  const port = Number(process.env["VITE_PORT"] ?? "5173")

  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url))
      }
    },
    server: {
      port,
      strictPort: true,
      proxy:
        mode === "test"
          ? {}
          : {
              "/api": {
                target: apiProxyTarget,
                changeOrigin: true,
                headers: { origin: apiProxyTarget },
                ws: true
              }
            }
    },
    build: {
      emptyOutDir: true,
      outDir: fileURLToPath(new URL("../server/public", import.meta.url))
    }
  }
})

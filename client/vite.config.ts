import { fileURLToPath, URL } from "node:url"

import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [vue()],
  build: {
    emptyOutDir: true,
    outDir: fileURLToPath(new URL("../server/public", import.meta.url))
  }
})

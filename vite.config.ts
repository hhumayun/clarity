import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig(() => ({
  plugins: [
    nodePolyfills({
      include: ["stream", "crypto", "process"],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
    react(),
  ],
  build: {
    assetsDir: "_assets",
  },
  server: {
    port: 5173,
    proxy: {
      // In dev, forward API calls to the Hono server (tsx watch server.ts)
      "/_api": "http://localhost:3333",
    },
  },
}));

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
      "/ws": {
        target: "http://localhost:5000",
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on("error", (err) => {
            console.warn(`[ws proxy] ${err.code || err.message}`);
          });
          proxy.on("proxyReqWs", (_proxyReq, _req, socket) => {
            socket.on("error", (err) => {
              console.warn(`[ws proxy socket] ${err.code || err.message}`);
            });
          });
        },
      },
    },
  },
});

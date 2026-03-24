import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    https: false,
    allowedHosts: [
      'rashly-uncoached-kody.ngrok-free.dev'
    ]
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    https: false,
  },
});

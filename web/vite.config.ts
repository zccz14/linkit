import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/v1": "http://127.0.0.1:8080",
      "/backend-api": "http://127.0.0.1:8080",
    },
  },
  resolve: {
    dedupe: ["auth-mini-react-components", "react", "react-dom"],
    alias: [
      {
        find: "linkit-react-components/styles.css",
        replacement: path.resolve(
          __dirname,
          "../packages/linkit-react-components/src/styles.css",
        ),
      },
      {
        find: "linkit-react-components",
        replacement: path.resolve(
          __dirname,
          "../packages/linkit-react-components/src/index.ts",
        ),
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
});

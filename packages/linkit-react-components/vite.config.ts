import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    rollupOptions: {
      external: ["auth-mini-react-components", "clsx", "react", "react-dom", "tailwind-merge"],
      output: { banner: "'use client';" },
    },
  },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "https://app.example.test/" } },
    setupFiles: ["tests/setup.ts"],
  },
});

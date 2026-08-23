import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    rollupOptions: {
      external: (id) => id.startsWith("@base-ui/react") || ["auth-mini-react-components", "clsx", "lucide-react", "react", "react-dom", "tailwind-merge"].includes(id),
      output: { banner: "'use client';" },
    },
  },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "https://app.example.test/" } },
    setupFiles: ["tests/setup.ts"],
  },
});

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { HashRouter } from "react-router-dom"

import "./index.css"
import App from "./App.tsx"
import { I18nProvider } from "@/components/i18n-provider.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"

if ("serviceWorker" in navigator)
  void navigator.serviceWorker.register("/sw.js")

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 5_000 } },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <ThemeProvider>
          <I18nProvider>
            <App />
          </I18nProvider>
        </ThemeProvider>
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>
)

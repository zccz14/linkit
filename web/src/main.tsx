import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";

import "./index.css";
import "linkit-react-components/styles.css";
import App from "./App.tsx";
import { I18nProvider } from "@/components/i18n-provider.tsx";
import { RenderErrorBoundary } from "@/components/render-error-boundary.tsx";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 5_000 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RenderErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <I18nProvider>
            <App />
          </I18nProvider>
        </HashRouter>
      </QueryClientProvider>
    </RenderErrorBoundary>
  </StrictMode>,
);

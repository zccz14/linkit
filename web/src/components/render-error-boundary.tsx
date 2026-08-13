import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { renderErrorCopy } from "@/lib/render-error-copy.ts";

type RenderErrorBoundaryProps = {
  children: ReactNode;
};

type RenderErrorBoundaryState = {
  error: Error | null;
};

export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  state: RenderErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RenderErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Linkit render error", error, errorInfo);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const copy = renderErrorCopy(navigator.language);
    return (
      <main
        className="grid min-h-screen place-items-center bg-muted/30 p-6"
        role="alert"
      >
        <section className="w-full max-w-md rounded-xl border bg-background p-6 text-center shadow-sm">
          <TriangleAlertIcon className="mx-auto mb-4 size-8 text-destructive" />
          <h1 className="text-xl font-semibold">{copy.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {copy.description}
          </p>
          <Button
            className="mt-6"
            onClick={() => window.location.reload()}
            type="button"
          >
            {copy.refresh}
          </Button>
        </section>
      </main>
    );
  }
}

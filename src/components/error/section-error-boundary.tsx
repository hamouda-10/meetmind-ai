import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  silent?: boolean;
}

interface State {
  hasError: boolean;
  message: string;
}

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error || "Unexpected error"),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("[SectionErrorBoundary]", error, info.componentStack);
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    if (this.props.silent) {
      return null;
    }
    if (this.props.fallback) {
      return this.props.fallback;
    }
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-border/60 bg-card/60 p-6 text-center">
        <p className="text-sm font-semibold text-foreground">
          حدث خطأ غير متوقع في هذا القسم · Something went wrong in this section
        </p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">{this.state.message}</p>
        <button
          type="button"
          onClick={() => this.setState({ hasError: false, message: "" })}
          className="mt-4 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 cursor-pointer"
        >
          إعادة المحاولة · Try Again
        </button>
      </div>
    );
  }
}

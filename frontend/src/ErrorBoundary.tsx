import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("HeatBudget UI render failure", error, info);
  }

  render() {
    if (this.state.error) {
      return <main style={{ padding: 24, fontFamily: "system-ui", color: "#7f1d1d" }}>
        <h1>Could not load the dashboard</h1>
        <p>{this.state.error.message}</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </main>;
    }
    return this.props.children;
  }
}

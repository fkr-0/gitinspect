import { Component, type ReactNode } from "react";

export interface RuntimeDiagnostics {
  readonly version: string;
  readonly wasmApiVersion: number | "unavailable";
  readonly capabilities: Readonly<Record<string, string | number | boolean>>;
}

interface Props {
  readonly feature: string;
  readonly diagnostics: RuntimeDiagnostics;
  readonly children: ReactNode;
}

interface State {
  readonly error?: Error;
}

/** A feature failure must never reveal stack traces or repository content. */
export class RuntimeErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  private copyDiagnostics = async (): Promise<void> => {
    const { version, wasmApiVersion, capabilities } = this.props.diagnostics;
    const report = JSON.stringify(
      {
        version,
        wasmApiVersion,
        capabilities,
        error: this.state.error?.message.slice(0, 512) ?? "Unknown error",
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      this.setState({ error: new Error("Clipboard unavailable. Check clipboard permissions.") });
    }
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <section role="alert" className="wasm-boot wasm-boot--error">
        <h2>{this.props.feature} failed</h2>
        <p>{this.state.error.message}</p>
        <p>Retry this feature or reload the application.</p>
        <button type="button" onClick={() => this.setState({ error: undefined })}>
          Retry
        </button>
        <button type="button" onClick={() => void this.copyDiagnostics()}>
          Copy diagnostics
        </button>
      </section>
    );
  }
}

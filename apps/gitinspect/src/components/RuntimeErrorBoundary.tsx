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
  readonly error?: Error | undefined;
}

/** External runtime errors may contain repository paths or sensitive data. */
export function safeRuntimeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unexpected runtime error.";
  if (/webgl|context lost/i.test(error.message))
    return "WebGL is unavailable or its context was lost.";
  if (/webassembly|wasm|instantiate/i.test(error.message))
    return "The WebAssembly runtime could not initialize.";
  if (/clipboard/i.test(error.message)) return "Clipboard access is unavailable.";
  return "Unexpected runtime error.";
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
        error: safeRuntimeErrorMessage(this.state.error),
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
        <p>{safeRuntimeErrorMessage(this.state.error)}</p>
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

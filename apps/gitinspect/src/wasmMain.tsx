import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { loadGitInspectWasmRuntime, type GitInspectWasmRuntime } from "./wasmRuntime";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("gitinspect wasm root element is missing");
}

function WasmEdition() {
  const [runtime, setRuntime] = useState<GitInspectWasmRuntime>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void loadGitInspectWasmRuntime()
      .then((loaded) => {
        if (active) setRuntime(loaded);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <main className="wasm-boot wasm-boot--error">
        <p className="eyebrow">Experimental browser edition</p>
        <h1>WebAssembly runtime did not initialize</h1>
        <p>{error}</p>
        <p>The browser edition fails closed instead of silently presenting the JavaScript demo as WASM.</p>
      </main>
    );
  }

  if (!runtime) {
    return (
      <main className="wasm-boot">
        <p className="eyebrow">Experimental browser edition</p>
        <h1>Starting Rust/WebAssembly runtime…</h1>
        <p>Repository authority remains disabled in the browser boundary.</p>
      </main>
    );
  }

  return (
    <>
      <aside className="wasm-runtime-badge" aria-label="WebAssembly runtime status">
        Rust/WASM API {runtime.apiVersion} · demo {runtime.demoFingerprint} · read-only synthetic repository
      </aside>
      <App autoOpenDemo />
    </>
  );
}

createRoot(root).render(
  <StrictMode>
    <WasmEdition />
  </StrictMode>,
);

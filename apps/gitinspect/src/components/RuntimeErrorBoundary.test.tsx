import { describe, expect, it } from "vitest";
import { safeRuntimeErrorMessage } from "./RuntimeErrorBoundary";

describe("runtime error diagnostics privacy", () => {
  it("does not disclose arbitrary repository data or absolute paths", () => {
    expect(safeRuntimeErrorMessage(new Error("Read failed at /home/example/private/file"))).toBe(
      "Unexpected runtime error.",
    );
  });

  it("classifies WebGL and WASM failures without echoing untrusted detail", () => {
    expect(safeRuntimeErrorMessage(new Error("WebGL context lost: private data"))).toBe(
      "WebGL is unavailable or its context was lost.",
    );
    expect(safeRuntimeErrorMessage(new Error("WebAssembly instantiate failed: private data"))).toBe(
      "The WebAssembly runtime could not initialize.",
    );
  });

  it("rejects non-Error thrown values", () => {
    expect(safeRuntimeErrorMessage({ message: "secret" })).toBe("Unexpected runtime error.");
  });
});

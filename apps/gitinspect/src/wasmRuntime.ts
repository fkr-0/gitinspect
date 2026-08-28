export interface GitInspectWasmCapabilities {
  readonly runtime: "rust-wasm";
  readonly repositoryMode: "synthetic";
  readonly nativeGit: false;
  readonly filesystemWatch: false;
  readonly mutationAuthority: false;
}

export interface GitInspectWasmRuntime {
  readonly apiVersion: number;
  readonly demoFingerprint: string;
  readonly capabilities: GitInspectWasmCapabilities;
}

interface WasmBindgenModule {
  default(input?: unknown): Promise<unknown>;
  api_version(): number;
  runtime_fingerprint(value: string): string;
  capabilities_json(): string;
}

function parseCapabilities(value: string): GitInspectWasmCapabilities {
  const parsed = JSON.parse(value) as Partial<GitInspectWasmCapabilities>;
  if (
    parsed.runtime !== "rust-wasm" ||
    parsed.repositoryMode !== "synthetic" ||
    parsed.nativeGit !== false ||
    parsed.filesystemWatch !== false ||
    parsed.mutationAuthority !== false
  ) {
    throw new Error("GitInspect WASM capability contract is invalid or unexpectedly permissive.");
  }
  return parsed as GitInspectWasmCapabilities;
}

export async function loadGitInspectWasmRuntime(): Promise<GitInspectWasmRuntime> {
  const moduleUrl = new URL(`${import.meta.env.BASE_URL}wasm/gitinspect_wasm.js`, window.location.href);
  const module = (await import(/* @vite-ignore */ moduleUrl.href)) as WasmBindgenModule;
  await module.default();

  const apiVersion = module.api_version();
  if (apiVersion !== 1) {
    throw new Error(`Unsupported GitInspect WASM API version: ${apiVersion}`);
  }

  const demoFingerprint = module.runtime_fingerprint("/demo/gitinspect");
  if (demoFingerprint !== "00413b2e") {
    throw new Error(`Unexpected GitInspect WASM runtime fingerprint: ${demoFingerprint}`);
  }

  return Object.freeze({
    apiVersion,
    demoFingerprint,
    capabilities: parseCapabilities(module.capabilities_json()),
  });
}

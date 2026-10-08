/** Validate externally supplied inspection JSON before it enters application state. */
const MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 24;
const MAX_NODES = 20000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shape(
  value: unknown,
  required: string[],
  optional: string[] = [],
): asserts value is Record<string, unknown> {
  if (!record(value)) throw new Error("Invalid inspection record");
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new Error("Invalid inspection fields");
  }
}

function string(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4096;
}

/** Arbitrary Git property values are data-only and bounded recursively. */
function validateData(value: unknown, counter: { nodes: number }, depth = 0): void {
  if (++counter.nodes > MAX_NODES || depth > MAX_DEPTH)
    throw new Error("Inspection data exceeds limits");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > 65536) throw new Error("Inspection text exceeds limit");
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) validateData(item, counter, depth + 1);
    return;
  }
  if (!record(value)) throw new Error("Invalid inspection value");
  for (const [key, entry] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key) || key.length > 4096) {
      throw new Error("Unsafe inspection property");
    }
    validateData(entry, counter, depth + 1);
  }
}

export interface ParsedInspectionEnvelope {
  readonly schema: "gitinspect-inspection/v1";
  readonly repository: { readonly path: string; readonly revision: string };
  readonly selection: {
    readonly rootElementId: string | null;
    readonly activeElementId: string;
    readonly navigationDepth: number;
  };
  readonly element: {
    readonly id: string;
    readonly kind: string;
    readonly label: string | null;
    readonly group: string | null;
    readonly weight: number | null;
    readonly properties: Record<string, unknown>;
  };
  readonly commitDiff?: Record<string, unknown>;
  readonly fileDetail?: Record<string, unknown>;
  readonly pluginReport?: Record<string, unknown>;
}

/** Rejects unexpected envelope fields, invalid selection and recursive hostile properties. */
export function parseInspectionJson(source: string): ParsedInspectionEnvelope {
  if (new TextEncoder().encode(source).length > MAX_BYTES)
    throw new Error("Inspection JSON exceeds 1 MiB");
  const value: unknown = JSON.parse(source);
  shape(
    value,
    ["schema", "repository", "selection", "element"],
    ["commitDiff", "fileDetail", "pluginReport"],
  );
  if (value.schema !== "gitinspect-inspection/v1") throw new Error("Unsupported inspection schema");
  shape(value.repository, ["path", "revision"]);
  if (!string(value.repository.path) || !string(value.repository.revision))
    throw new Error("Invalid repository identity");
  shape(value.selection, ["rootElementId", "activeElementId", "navigationDepth"]);
  if (
    (value.selection.rootElementId !== null && !string(value.selection.rootElementId)) ||
    !string(value.selection.activeElementId) ||
    !Number.isInteger(value.selection.navigationDepth) ||
    (value.selection.navigationDepth as number) < 0 ||
    (value.selection.navigationDepth as number) > 2
  ) {
    throw new Error("Invalid inspection selection");
  }
  shape(value.element, ["id", "kind", "label", "group", "weight", "properties"]);
  if (
    !string(value.element.id) ||
    !string(value.element.kind) ||
    (value.element.label !== null && !string(value.element.label)) ||
    (value.element.group !== null && !string(value.element.group)) ||
    (value.element.weight !== null &&
      (typeof value.element.weight !== "number" || !Number.isFinite(value.element.weight))) ||
    !record(value.element.properties) ||
    value.element.id !== value.selection.activeElementId
  ) {
    throw new Error("Invalid inspection element");
  }
  for (const key of ["commitDiff", "fileDetail", "pluginReport"] as const) {
    if (Object.hasOwn(value, key) && !record(value[key]))
      throw new Error("Invalid inspection attachment");
  }
  validateData(value, { nodes: 0 });
  return value as unknown as ParsedInspectionEnvelope;
}

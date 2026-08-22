import type {
  ElementId,
  GraphDataset,
  GraphNodeRecord,
} from "@gitinspect/graph-elements";

export type GitSearchMode = "exact" | "substring" | "fuzzy";
export type GitSignatureState = "valid" | "invalid" | "unknown" | "unsigned";

export interface GitDateRangeFilter {
  readonly fromMs?: number;
  readonly toMs?: number;
}

interface CompiledFilters {
  readonly objectKinds: readonly string[];
  readonly authors: readonly string[];
  readonly fromMs?: number;
  readonly toMs?: number;
  readonly refs: readonly string[];
  readonly signatureStates: ReadonlySet<GitSignatureState>;
  readonly paths: readonly string[];
  readonly merge?: boolean;
}

export interface GitSearchFilters {
  readonly objectKinds?: readonly string[];
  readonly authors?: readonly string[];
  readonly dateRange?: GitDateRangeFilter;
  readonly refs?: readonly string[];
  readonly signatureStates?: readonly GitSignatureState[];
  readonly changedPaths?: readonly string[];
  readonly merge?: boolean;
}

export interface GitSearchQuery {
  readonly text?: string;
  readonly mode?: GitSearchMode;
  readonly filters?: GitSearchFilters;
  readonly limit?: number;
  /** Maximum edit distance for fuzzy matching. Clamped to 1..3. */
  readonly fuzzyMaxDistance?: number;
  /** Hard document budget for fuzzy mode. Clamped to 64..8192. */
  readonly fuzzyDocumentBudget?: number;
  /** Hard token-comparison budget for fuzzy mode. Clamped to 256..65536. */
  readonly fuzzyTokenBudget?: number;
}

export interface GitSearchResult {
  readonly id: ElementId;
  readonly score: number;
  readonly match: "exact" | "substring" | "fuzzy" | "filter";
  readonly matchedFields: readonly string[];
}

export interface GitSearchIndexUpdateStats {
  readonly revision: string;
  readonly indexedDocuments: number;
  readonly rebuiltDocuments: number;
  readonly reusedDocuments: number;
  readonly removedDocuments: number;
  /** Conservative index-owned string/reference accounting, not heap profiling. */
  readonly estimatedIndexBytes: number;
}

export interface GitSearchStats extends GitSearchIndexUpdateStats {
  readonly documentsScanned: number;
  readonly fuzzyTokensCompared: number;
  readonly fuzzyTruncated: boolean;
}

export interface GitSearchOutcome {
  readonly results: readonly GitSearchResult[];
  readonly hitIds: ReadonlySet<ElementId>;
  readonly stats: GitSearchStats;
}

export interface GitFilterOutcome {
  readonly ids: ReadonlySet<ElementId>;
  readonly stats: GitSearchIndexUpdateStats & {
    readonly documentsScanned: number;
    readonly matchedDocuments: number;
  };
}

export interface GitSearchHighlight {
  readonly rank: number;
  readonly score: number;
  readonly match: GitSearchResult["match"];
}

export interface GitSearchHighlightOverlay {
  readonly hitIds: ReadonlySet<ElementId>;
  readonly byId: ReadonlyMap<ElementId, GitSearchHighlight>;
}

type SearchFieldName =
  | "id"
  | "kind"
  | "label"
  | "message"
  | "oid"
  | "author"
  | "refs"
  | "paths"
  | "remote";

interface SearchDocument {
  readonly id: ElementId;
  readonly kind: string;
  readonly idText: string;
  readonly kindText: string;
  readonly labelText: string;
  readonly messageText: string;
  readonly oidText: string;
  readonly authorText: string;
  readonly refsText: string;
  readonly pathsText: string;
  readonly remoteText: string;
  readonly committedAtMs?: number;
  readonly signature?: GitSignatureState;
  readonly merge?: boolean;
}

interface CachedDocument {
  readonly fingerprint: string;
  readonly document: SearchDocument;
  readonly estimatedBytes: number;
}

const EMPTY_PACKED = "\u0000";

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function changedPaths(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const paths: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const path = stringValue((entry as { readonly path?: unknown }).path);
    if (path) paths.push(path);
  }
  return paths;
}

function signatureValue(value: unknown): GitSignatureState | undefined {
  return value === "valid" || value === "invalid" || value === "unknown" || value === "unsigned"
    ? value
    : undefined;
}

function uniqueNormalized(values: readonly (string | undefined)[]): readonly string[] {
  return [...new Set(values.flatMap((value) => value ? [normalize(value)] : []).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function packTerms(values: readonly (string | undefined)[]): string {
  const normalized = uniqueNormalized(values);
  return normalized.length === 0 ? EMPTY_PACKED : `\u0000${normalized.join("\u0000")}\u0000`;
}

function packedExact(packed: string, needle: string): boolean {
  return packed.includes(`\u0000${needle}\u0000`);
}

function packedSubstring(packed: string, needle: string): boolean {
  return packed.includes(needle);
}

function fieldEntries(document: SearchDocument): readonly (readonly [SearchFieldName, string])[] {
  return [
    ["id", document.idText],
    ["kind", document.kindText],
    ["label", document.labelText],
    ["message", document.messageText],
    ["oid", document.oidText],
    ["author", document.authorText],
    ["refs", document.refsText],
    ["paths", document.pathsText],
    ["remote", document.remoteText],
  ];
}

function matchedFields(document: SearchDocument, needle: string, exact: boolean): readonly string[] {
  const matches = exact ? packedExact : packedSubstring;
  const result: SearchFieldName[] = [];
  if (matches(document.idText, needle)) result.push("id");
  if (matches(document.kindText, needle)) result.push("kind");
  if (matches(document.labelText, needle)) result.push("label");
  if (matches(document.messageText, needle)) result.push("message");
  if (matches(document.oidText, needle)) result.push("oid");
  if (matches(document.authorText, needle)) result.push("author");
  if (matches(document.refsText, needle)) result.push("refs");
  if (matches(document.pathsText, needle)) result.push("paths");
  if (matches(document.remoteText, needle)) result.push("remote");
  return result;
}

function fuzzyTokensFor(document: SearchDocument): readonly string[] {
  const tokens = new Set<string>();
  for (const [, packed] of fieldEntries(document)) {
    for (const value of packed.split("\u0000")) {
      if (!value) continue;
      if (value.length <= 96) tokens.add(value);
      for (const token of value.split(/[^\p{L}\p{N}._/@:-]+/u)) {
        if (token.length >= 2 && token.length <= 64) tokens.add(token);
        if (tokens.size >= 48) break;
      }
      if (tokens.size >= 48) break;
    }
    if (tokens.size >= 48) break;
  }
  return [...tokens].sort((left, right) => left.localeCompare(right));
}

function hashStep(hash: number, value: string): number {
  let next = hash >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, 0x01000193) >>> 0;
  }
  return next >>> 0;
}

function fingerprintNode(node: GraphNodeRecord): string {
  const props = node.properties;
  const pieces = [
    node.id,
    node.kind,
    node.label ?? "",
    stringValue(props.message) ?? "",
    stringValue(props.oid) ?? "",
    stringValue(props.targetOid) ?? "",
    stringValue(props.authorName) ?? "",
    stringValue(props.authorEmail) ?? "",
    String(finiteNumber(props.authoredAtMs) ?? ""),
    String(finiteNumber(props.committedAtMs) ?? ""),
    stringValue(props.signatureStatus) ?? "",
    String(props.isMerge === true),
    ...stringArray(props.tags),
    ...stringArray(props.localBranches),
    ...stringArray(props.remoteBranches),
    stringValue(props.name) ?? "",
    stringValue(props.upstream) ?? "",
    stringValue(props.symbolicTarget) ?? "",
    stringValue(props.remote) ?? "",
    ...stringArray(props.fetchUrls),
    ...stringArray(props.pushUrls),
    ...changedPaths(props.files),
  ];
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const piece of pieces) {
    first = hashStep(first, piece);
    first = hashStep(first, "\u0000");
    second = hashStep(second ^ 0x85ebca6b, piece);
    second = hashStep(second, "\u0001");
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function createDocument(node: GraphNodeRecord): SearchDocument {
  const props = node.properties;
  const committedAtMs = finiteNumber(props.committedAtMs) ?? finiteNumber(props.authoredAtMs);
  const signature = signatureValue(props.signatureStatus);
  return {
    id: node.id,
    kind: normalize(node.kind),
    idText: packTerms([node.id]),
    kindText: packTerms([node.kind]),
    labelText: packTerms([node.label]),
    messageText: packTerms([stringValue(props.message)]),
    oidText: packTerms([stringValue(props.oid), stringValue(props.targetOid)]),
    authorText: packTerms([stringValue(props.authorName), stringValue(props.authorEmail)]),
    refsText: packTerms([
      ...stringArray(props.tags),
      ...stringArray(props.localBranches),
      ...stringArray(props.remoteBranches),
      stringValue(props.name),
      stringValue(props.upstream),
      stringValue(props.symbolicTarget),
    ]),
    pathsText: packTerms(changedPaths(props.files)),
    remoteText: packTerms([
      stringValue(props.remote),
      ...stringArray(props.fetchUrls),
      ...stringArray(props.pushUrls),
    ]),
    ...(committedAtMs !== undefined ? { committedAtMs } : {}),
    ...(signature ? { signature } : {}),
    ...(typeof props.isMerge === "boolean" ? { merge: props.isMerge } : {}),
  };
}

function estimateDocumentBytes(document: SearchDocument): number {
  const textCharacters = fieldEntries(document).reduce((sum, [, packed]) => sum + packed.length, 0);
  // One packed normalized copy per field plus conservative object/map/reference overhead.
  return 512 + textCharacters * 2;
}

function normalizedList(values: readonly string[] | undefined): readonly string[] {
  return uniqueNormalized(values ?? []);
}

function compileFilters(filters: GitSearchFilters | undefined): CompiledFilters | undefined {
  if (!filters) return undefined;
  return {
    objectKinds: normalizedList(filters.objectKinds),
    authors: normalizedList(filters.authors),
    ...(filters.dateRange?.fromMs !== undefined ? { fromMs: filters.dateRange.fromMs } : {}),
    ...(filters.dateRange?.toMs !== undefined ? { toMs: filters.dateRange.toMs } : {}),
    refs: normalizedList(filters.refs),
    signatureStates: new Set(filters.signatureStates ?? []),
    paths: normalizedList(filters.changedPaths),
    ...(filters.merge !== undefined ? { merge: filters.merge } : {}),
  };
}

function packedMatchesAny(packed: string, needles: readonly string[]): boolean {
  if (needles.length === 0) return true;
  return needles.some((needle) => packedExact(packed, needle) || packedSubstring(packed, needle));
}

function matchesFilters(document: SearchDocument, filters: CompiledFilters | undefined): boolean {
  if (!filters) return true;
  if (filters.objectKinds.length > 0 && !filters.objectKinds.includes(document.kind)) return false;

  if (!packedMatchesAny(document.authorText, filters.authors)) return false;

  if ((filters.fromMs !== undefined || filters.toMs !== undefined) && document.committedAtMs === undefined) return false;
  if (filters.fromMs !== undefined && document.committedAtMs !== undefined && document.committedAtMs < filters.fromMs) return false;
  if (filters.toMs !== undefined && document.committedAtMs !== undefined && document.committedAtMs > filters.toMs) return false;

  if (!packedMatchesAny(document.refsText, filters.refs)) return false;

  if (filters.signatureStates.size > 0) {
    if (!document.signature || !filters.signatureStates.has(document.signature)) return false;
  }

  if (!packedMatchesAny(document.pathsText, filters.paths)) return false;

  if (filters.merge !== undefined && document.merge !== filters.merge) return false;
  return true;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function boundedLevenshtein(left: string, right: string, maxDistance: number): number | undefined {
  if (Math.abs(left.length - right.length) > maxDistance) return undefined;
  if (left === right) return 0;
  if (left.length === 0) return right.length <= maxDistance ? right.length : undefined;
  if (right.length === 0) return left.length <= maxDistance ? left.length : undefined;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = new Array<number>(right.length + 1);
    current[0] = row;
    let rowMinimum = row;
    const leftChar = left.charCodeAt(row - 1);
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1] ?? 0;
      const insertion = current[column - 1] ?? 0;
      const deletion = previous[column] ?? 0;
      const cost = leftChar === right.charCodeAt(column - 1) ? 0 : 1;
      const value = Math.min(deletion + 1, insertion + 1, substitution + cost);
      current[column] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maxDistance) return undefined;
    previous = current;
  }
  const distance = previous[right.length] ?? maxDistance + 1;
  return distance <= maxDistance ? distance : undefined;
}

export class GitSearchIndex {
  private readonly cache = new Map<ElementId, CachedDocument>();
  private orderedIds: readonly ElementId[] = [];
  private estimatedDocumentBytes = 0;
  private lastDataset: GraphDataset | undefined;
  private lastUpdate: GitSearchIndexUpdateStats = {
    revision: "",
    indexedDocuments: 0,
    rebuiltDocuments: 0,
    reusedDocuments: 0,
    removedDocuments: 0,
    estimatedIndexBytes: 0,
  };

  update(dataset: GraphDataset): GitSearchIndexUpdateStats {
    if (this.lastDataset === dataset) return this.lastUpdate;

    const liveIds = new Set<ElementId>();
    let rebuiltDocuments = 0;
    let reusedDocuments = 0;
    for (const node of dataset.nodes) {
      liveIds.add(node.id);
      const fingerprint = fingerprintNode(node);
      const cached = this.cache.get(node.id);
      if (cached?.fingerprint === fingerprint) {
        reusedDocuments += 1;
        continue;
      }
      if (cached) this.estimatedDocumentBytes -= cached.estimatedBytes;
      const document = createDocument(node);
      const estimatedBytes = estimateDocumentBytes(document);
      this.cache.set(node.id, { fingerprint, document, estimatedBytes });
      this.estimatedDocumentBytes += estimatedBytes;
      rebuiltDocuments += 1;
    }

    let removedDocuments = 0;
    for (const id of this.cache.keys()) {
      if (!liveIds.has(id)) {
        this.estimatedDocumentBytes -= this.cache.get(id)?.estimatedBytes ?? 0;
        this.cache.delete(id);
        removedDocuments += 1;
      }
    }

    this.orderedIds = Object.freeze([...liveIds].sort((left, right) => left.localeCompare(right)));
    this.lastDataset = dataset;
    this.lastUpdate = Object.freeze({
      revision: dataset.revision,
      indexedDocuments: this.cache.size,
      rebuiltDocuments,
      reusedDocuments,
      removedDocuments,
      estimatedIndexBytes: Math.max(0, this.estimatedDocumentBytes) + this.orderedIds.length * 8,
    });
    return this.lastUpdate;
  }

  filter(dataset: GraphDataset, filters: GitSearchFilters = {}): GitFilterOutcome {
    const update = this.update(dataset);
    const compiledFilters = compileFilters(filters);
    const ids = new Set<ElementId>();
    let documentsScanned = 0;
    for (const id of this.orderedIds) {
      const document = this.cache.get(id)?.document;
      if (!document) continue;
      documentsScanned += 1;
      if (matchesFilters(document, compiledFilters)) ids.add(id);
    }
    return Object.freeze({
      ids,
      stats: Object.freeze({
        ...update,
        documentsScanned,
        matchedDocuments: ids.size,
      }),
    });
  }

  search(dataset: GraphDataset, query: GitSearchQuery = {}): GitSearchOutcome {
    const update = this.update(dataset);
    const needle = normalize(query.text ?? "");
    const mode = query.mode ?? "substring";
    const limit = clampInteger(query.limit, 200, 1, 1_000);
    const maxDistance = clampInteger(query.fuzzyMaxDistance, 2, 1, 3);
    const fuzzyDocumentBudget = clampInteger(query.fuzzyDocumentBudget, 4_096, 64, 8_192);
    const fuzzyTokenBudget = clampInteger(query.fuzzyTokenBudget, 16_384, 256, 65_536);
    const compiledFilters = compileFilters(query.filters);
    const results: GitSearchResult[] = [];
    let documentsScanned = 0;
    let fuzzyTokensCompared = 0;
    let fuzzyTruncated = false;

    for (const id of this.orderedIds) {
      const document = this.cache.get(id)?.document;
      if (!document || !matchesFilters(document, compiledFilters)) continue;
      documentsScanned += 1;

      if (needle.length === 0) {
        if (results.length < limit) results.push({ id, score: 10, match: "filter", matchedFields: [] });
        continue;
      }

      if (mode === "exact" || mode === "substring") {
        const fields = matchedFields(document, needle, mode === "exact");
        if (fields.length === 0) continue;
        const score = mode === "exact"
          ? (fields.includes("id") ? 120 : 100)
          : 60 + Math.min(20, needle.length) + (fields.includes("id") ? 5 : 0);
        results.push({ id, score, match: mode, matchedFields: fields });
        continue;
      }

      if (documentsScanned > fuzzyDocumentBudget) {
        fuzzyTruncated = true;
        break;
      }
      let bestDistance: number | undefined;
      for (const token of fuzzyTokensFor(document)) {
        if (fuzzyTokensCompared >= fuzzyTokenBudget) {
          fuzzyTruncated = true;
          break;
        }
        fuzzyTokensCompared += 1;
        const distance = boundedLevenshtein(needle, token, maxDistance);
        if (distance !== undefined && (bestDistance === undefined || distance < bestDistance)) {
          bestDistance = distance;
          if (distance === 0) break;
        }
      }
      if (fuzzyTruncated && bestDistance === undefined) break;
      if (bestDistance !== undefined) {
        results.push({
          id,
          score: 50 - bestDistance * 10,
          match: "fuzzy",
          matchedFields: matchedFields(document, needle, false),
        });
      }
    }

    results.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    const limited = Object.freeze(results.slice(0, limit));
    return Object.freeze({
      results: limited,
      hitIds: new Set(limited.map((result) => result.id)),
      stats: Object.freeze({
        ...update,
        documentsScanned,
        fuzzyTokensCompared,
        fuzzyTruncated,
      }),
    });
  }
}

export function createSearchHighlightOverlay(outcome: GitSearchOutcome): GitSearchHighlightOverlay {
  const byId = new Map<ElementId, GitSearchHighlight>();
  outcome.results.forEach((result, index) => {
    byId.set(result.id, {
      rank: index,
      score: result.score,
      match: result.match,
    });
  });
  return Object.freeze({
    hitIds: new Set(outcome.hitIds),
    byId,
  });
}

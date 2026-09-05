const SELECTION_PARAM = "selection";
const MAX_SELECTION_URL_ID_LENGTH = 4_096;
const CHILD_WORLD_PARAM = "world";
const CHILD_TARGET_PARAM = "worldTarget";
const CHILD_SELECTION_PARAM = "worldSelection";
const MAX_CHILD_URL_ID_LENGTH = 4_096;
const CHILD_HISTORY_STATE_KEY = "gitinspectChildNavigation";
const CHILD_HISTORY_STATE_VERSION = 1;

export type ChildNavigationUrlState =
  | {
      readonly depth: 1;
      readonly localSelectionId?: string;
    }
  | {
      readonly depth: 2;
      readonly fileElementId: string;
      readonly localSelectionId?: string;
    };

export type ChildNavigationUrlParse =
  | { readonly status: "none" }
  | { readonly status: "valid"; readonly state: ChildNavigationUrlState }
  | { readonly status: "invalid"; readonly message: string };

export interface ChildNavigationHistoryState {
  readonly gitinspectChildNavigation: {
    readonly version: 1;
    readonly depth: 1 | 2;
  };
}

export function childNavigationHistoryState(depth: 1 | 2): ChildNavigationHistoryState {
  return Object.freeze({
    [CHILD_HISTORY_STATE_KEY]: Object.freeze({
      version: CHILD_HISTORY_STATE_VERSION,
      depth,
    }),
  });
}

export function childNavigationHistoryDepth(state: unknown): 1 | 2 | undefined {
  if (typeof state !== "object" || state === null) return undefined;
  const marker = (state as Readonly<Record<string, unknown>>)[CHILD_HISTORY_STATE_KEY];
  if (typeof marker !== "object" || marker === null) return undefined;
  const record = marker as Readonly<Record<string, unknown>>;
  if (record.version !== CHILD_HISTORY_STATE_VERSION) return undefined;
  return record.depth === 1 || record.depth === 2 ? record.depth : undefined;
}

export function selectionFromHref(href: string): string | undefined {
  try {
    const value = new URL(href).searchParams.get(SELECTION_PARAM)?.trim();
    return value && value.length <= MAX_SELECTION_URL_ID_LENGTH ? value : undefined;
  } catch {
    return undefined;
  }
}

export function hrefWithSelection(href: string, elementId: string | undefined): string {
  const url = new URL(href);
  const normalizedElementId = elementId?.trim();
  if (normalizedElementId && normalizedElementId.length <= MAX_SELECTION_URL_ID_LENGTH) {
    url.searchParams.set(SELECTION_PARAM, normalizedElementId);
  } else {
    url.searchParams.delete(SELECTION_PARAM);
  }
  return url.toString();
}

function boundedChildId(
  params: URLSearchParams,
  key: string,
):
  | { readonly status: "missing" }
  | { readonly status: "valid"; readonly value: string }
  | {
      readonly status: "invalid";
      readonly message: string;
    } {
  if (!params.has(key)) return { status: "missing" };
  const value = params.get(key)?.trim() ?? "";
  if (value.length === 0) {
    return { status: "invalid", message: `${key} must not be empty.` };
  }
  if (value.length > MAX_CHILD_URL_ID_LENGTH) {
    return {
      status: "invalid",
      message: `${key} exceeds the ${MAX_CHILD_URL_ID_LENGTH}-character child-navigation limit.`,
    };
  }
  return { status: "valid", value };
}

export function childNavigationFromHref(href: string): ChildNavigationUrlParse {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { status: "invalid", message: "Child-navigation URL could not be parsed." };
  }

  const params = url.searchParams;
  const hasWorld = params.has(CHILD_WORLD_PARAM);
  const world = params.get(CHILD_WORLD_PARAM)?.trim();
  const hasTarget = params.has(CHILD_TARGET_PARAM);
  const hasSelection = params.has(CHILD_SELECTION_PARAM);
  if (!world) {
    return hasWorld || hasTarget || hasSelection
      ? {
          status: "invalid",
          message: "Child-navigation target/selection requires an explicit world.",
        }
      : { status: "none" };
  }

  const localSelection = boundedChildId(params, CHILD_SELECTION_PARAM);
  if (localSelection.status === "invalid") return localSelection;

  if (world === "commit") {
    if (hasTarget) {
      return {
        status: "invalid",
        message: "Commit-world URLs must not contain a file-world target.",
      };
    }
    return {
      status: "valid",
      state: {
        depth: 1,
        ...(localSelection.status === "valid" ? { localSelectionId: localSelection.value } : {}),
      },
    };
  }

  if (world === "file") {
    const target = boundedChildId(params, CHILD_TARGET_PARAM);
    if (target.status === "missing") {
      return { status: "invalid", message: "File-world URL is missing worldTarget." };
    }
    if (target.status === "invalid") return target;
    return {
      status: "valid",
      state: {
        depth: 2,
        fileElementId: target.value,
        ...(localSelection.status === "valid" ? { localSelectionId: localSelection.value } : {}),
      },
    };
  }

  return {
    status: "invalid",
    message: `Unsupported child-navigation world: ${world}.`,
  };
}

export function hrefWithChildNavigation(
  href: string,
  state: ChildNavigationUrlState | undefined,
): string {
  const url = new URL(href);
  url.searchParams.delete(CHILD_WORLD_PARAM);
  url.searchParams.delete(CHILD_TARGET_PARAM);
  url.searchParams.delete(CHILD_SELECTION_PARAM);

  if (!state) return url.toString();
  const serializableIds =
    (state.localSelectionId === undefined ||
      (state.localSelectionId.length > 0 &&
        state.localSelectionId.length <= MAX_CHILD_URL_ID_LENGTH)) &&
    (state.depth === 1 ||
      (state.fileElementId.length > 0 && state.fileElementId.length <= MAX_CHILD_URL_ID_LENGTH));
  if (!serializableIds) return url.toString();
  if (state.depth === 1) {
    url.searchParams.set(CHILD_WORLD_PARAM, "commit");
  } else {
    url.searchParams.set(CHILD_WORLD_PARAM, "file");
    url.searchParams.set(CHILD_TARGET_PARAM, state.fileElementId);
  }
  if (state.localSelectionId) {
    url.searchParams.set(CHILD_SELECTION_PARAM, state.localSelectionId);
  }
  return url.toString();
}
